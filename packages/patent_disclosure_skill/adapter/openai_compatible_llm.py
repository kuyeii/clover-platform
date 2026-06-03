from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any

import httpx


class PatentLlmError(RuntimeError):
    def __init__(self, message: str, *, code: str = "PATENT_LLM_REQUEST_FAILED") -> None:
        self.code = code
        super().__init__(message)


@dataclass(frozen=True)
class PatentLlmConfig:
    base_url: str
    api_key: str
    model: str
    timeout_seconds: int = 180
    max_retries: int = 2
    temperature: float = 0.2

    @property
    def configured(self) -> bool:
        return bool(self.base_url and self.api_key and self.model)


class OpenAICompatibleLLMClient:
    def __init__(self, config: PatentLlmConfig) -> None:
        self.config = config

    def chat(
        self,
        messages: list[dict[str, str]],
        *,
        temperature: float | None = None,
        timeout: int | None = None,
    ) -> str:
        if not self.config.configured:
            raise PatentLlmError(
                "专利交底书生成模型尚未配置，请配置 OpenAI-compatible 中转站 API。",
                code="PATENT_LLM_NOT_CONFIGURED",
            )

        url = f"{self.config.base_url.rstrip('/')}/chat/completions"
        payload: dict[str, Any] = {
            "model": self.config.model,
            "messages": messages,
            "temperature": self.config.temperature if temperature is None else temperature,
        }
        headers = {"Authorization": f"Bearer {self.config.api_key}", "Content-Type": "application/json"}

        last_error: Exception | None = None
        attempts = max(1, self.config.max_retries + 1)
        retryable_statuses = {408, 425, 429, 500, 502, 503, 504}
        for attempt in range(attempts):
            try:
                with httpx.Client(timeout=timeout or self.config.timeout_seconds) as client:
                    response = client.post(url, json=payload, headers=headers)
                if response.status_code in {401, 403}:
                    raise PatentLlmError("中转站 API Key 无效或无权限。")
                if response.status_code == 404:
                    raise PatentLlmError("中转站模型名或 base url 配置错误。")
                if response.status_code in retryable_statuses:
                    message = "中转站请求被限流，请稍后重试。" if response.status_code == 429 else "中转站服务异常。"
                    last_error = PatentLlmError(message)
                    if attempt < attempts - 1:
                        time.sleep(min(8.0, 1.5 * (attempt + 1)))
                        continue
                    raise last_error
                response.raise_for_status()
                data = response.json()
                content = data.get("choices", [{}])[0].get("message", {}).get("content")
                if not isinstance(content, str) or not content.strip():
                    raise PatentLlmError("中转站未返回有效生成内容。")
                return content.strip()
            except httpx.TimeoutException as exc:
                last_error = exc
            except PatentLlmError:
                raise
            except Exception as exc:  # httpx and JSON errors share the same user-facing path.
                last_error = exc

        raise PatentLlmError(f"大模型生成失败：{last_error or '未知错误'}")
