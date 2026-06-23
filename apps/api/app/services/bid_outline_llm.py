from __future__ import annotations

import asyncio
import json
import os
from dataclasses import dataclass
from typing import Any

import httpx


class BidOutlineLlmError(RuntimeError):
    def __init__(self, message: str, *, code: str = "BID_OUTLINE_LLM_REQUEST_FAILED") -> None:
        self.code = code
        super().__init__(message)


@dataclass(frozen=True)
class BidOutlineLlmConfig:
    base_url: str
    api_key: str
    model: str
    timeout_seconds: float = 300.0
    max_retries: int = 2
    temperature: float = 0.2

    @property
    def configured(self) -> bool:
        return bool(self.base_url and self.api_key and self.model)


def _env_float(name: str, fallback: float) -> float:
    try:
        return max(1.0, float(os.environ.get(name, str(fallback)).strip()))
    except (TypeError, ValueError):
        return fallback


def _env_int(name: str, fallback: int) -> int:
    try:
        return max(0, int(os.environ.get(name, str(fallback)).strip()))
    except (TypeError, ValueError):
        return fallback


def get_bid_outline_llm_config() -> BidOutlineLlmConfig:
    """读取标书大纲直连模型配置；返回 OpenAI-compatible chat/completions 参数。"""
    return BidOutlineLlmConfig(
        base_url=os.environ.get("BID_OUTLINE_LLM_BASE_URL", "").strip().rstrip("/"),
        api_key=os.environ.get("BID_OUTLINE_LLM_API_KEY", "").strip(),
        model=os.environ.get("BID_OUTLINE_LLM_MODEL", "").strip(),
        timeout_seconds=_env_float("BID_OUTLINE_LLM_TIMEOUT_SECONDS", 300.0),
        max_retries=_env_int("BID_OUTLINE_LLM_MAX_RETRIES", 2),
        temperature=_env_float("BID_OUTLINE_LLM_TEMPERATURE", 0.2),
    )


class BidOutlineLlmClient:
    """标书大纲 OpenAI-compatible 异步客户端；入参为 messages，出参为模型文本。"""

    def __init__(self, config: BidOutlineLlmConfig | None = None) -> None:
        self.config = config or get_bid_outline_llm_config()

    async def chat_json(
        self,
        messages: list[dict[str, str]],
        *,
        temperature: float | None = None,
        response_format: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        content = await self.chat(
            messages,
            temperature=temperature,
            response_format=response_format or {"type": "json_object"},
        )
        parsed = _loads_json_object(content)
        if parsed is None:
            raise BidOutlineLlmError("标书大纲模型未返回合法 JSON 对象。")
        return parsed

    async def chat(
        self,
        messages: list[dict[str, str]],
        *,
        temperature: float | None = None,
        response_format: dict[str, str] | None = None,
    ) -> str:
        if not self.config.configured:
            raise BidOutlineLlmError(
                "标书大纲直连模型尚未配置，请设置 BID_OUTLINE_LLM_BASE_URL、BID_OUTLINE_LLM_API_KEY、BID_OUTLINE_LLM_MODEL。",
                code="BID_OUTLINE_LLM_NOT_CONFIGURED",
            )

        url = f"{self.config.base_url}/chat/completions"
        payload: dict[str, Any] = {
            "model": self.config.model,
            "messages": messages,
            "temperature": self.config.temperature if temperature is None else temperature,
        }
        if response_format:
            payload["response_format"] = response_format
        headers = {"Authorization": f"Bearer {self.config.api_key}", "Content-Type": "application/json"}

        retryable_statuses = {408, 425, 429, 500, 502, 503, 504}
        attempts = max(1, self.config.max_retries + 1)
        last_error: Exception | None = None
        async with httpx.AsyncClient(timeout=httpx.Timeout(self.config.timeout_seconds), trust_env=False) as client:
            for attempt in range(attempts):
                try:
                    response = await client.post(url, headers=headers, json=payload)
                    if response.status_code in {401, 403}:
                        raise BidOutlineLlmError("标书大纲模型 API Key 无效或无权限。")
                    if response.status_code == 404:
                        raise BidOutlineLlmError("标书大纲模型名或 base url 配置错误。")
                    if response.status_code in retryable_statuses:
                        last_error = BidOutlineLlmError(_upstream_error_message(response, "标书大纲模型服务暂不可用。"))
                        if attempt < attempts - 1:
                            await asyncio.sleep(min(8.0, 1.5 * (attempt + 1)))
                            continue
                        raise last_error
                    response.raise_for_status()
                    data = response.json()
                    content = (((data.get("choices") or [{}])[0] or {}).get("message") or {}).get("content")
                    if not isinstance(content, str) or not content.strip():
                        raise BidOutlineLlmError("标书大纲模型未返回有效内容。")
                    return content.strip()
                except asyncio.CancelledError:
                    raise
                except BidOutlineLlmError:
                    raise
                except httpx.TimeoutException as exc:
                    last_error = exc
                except Exception as exc:
                    last_error = exc
                if attempt < attempts - 1:
                    await asyncio.sleep(min(8.0, 1.5 * (attempt + 1)))
        raise BidOutlineLlmError(f"标书大纲模型请求失败：{last_error or '未知错误'}")


def _upstream_error_message(response: httpx.Response, fallback: str) -> str:
    try:
        payload = response.json()
        if isinstance(payload, dict):
            value = payload.get("message") or payload.get("detail") or payload.get("error")
            if value:
                return str(value)[:500]
    except Exception:
        pass
    return (response.text or fallback)[:500]


def _loads_json_object(raw: str) -> dict[str, Any] | None:
    text = str(raw or "").strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
    try:
        parsed = json.loads(text)
    except Exception:
        return None
    return parsed if isinstance(parsed, dict) else None
