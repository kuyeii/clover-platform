from __future__ import annotations

from collections.abc import AsyncIterator, Iterable
from dataclasses import dataclass
from functools import lru_cache
import json
import logging
import os
import threading
from typing import Any

import httpx

from app.core.config import get_api_settings
from packages.py_common.config.loader import load_yaml

logger = logging.getLogger(__name__)

DEFAULT_UPSTREAM_TIMEOUT_SECONDS = 120.0
DEFAULT_DIFY_API_BASE_URL = "http://localhost/v1"
_LEGACY_ENV_LOADED = False
_LEGACY_ENV_LOCK = threading.Lock()


class RagDifyError(Exception):
    def __init__(self, detail: str, *, status_code: int = 502) -> None:
        self.detail = detail
        self.status_code = status_code
        super().__init__(detail)


@dataclass(frozen=True)
class RagChatSettings:
    upstream_url: str
    upstream_bearer_token: str
    upstream_timeout_seconds: float
    workflow_remote_user: str
    question_input_key: str
    allow_search_input_key: str
    history_input_key: str


def _load_env_files_once() -> None:
    global _LEGACY_ENV_LOADED
    if _LEGACY_ENV_LOADED:
        return
    with _LEGACY_ENV_LOCK:
        if _LEGACY_ENV_LOADED:
            return
        try:
            from dotenv import load_dotenv
        except Exception:
            _LEGACY_ENV_LOADED = True
            return

        repo_root = get_api_settings().repo_root
        legacy_backend = repo_root / "legacy" / "chat_with_rag_and_websearch" / "backend"
        for env_path in (repo_root / ".env", legacy_backend / ".env", legacy_backend / ".env.local"):
            load_dotenv(env_path, override=False)
        _LEGACY_ENV_LOADED = True


@lru_cache(maxsize=1)
def _workflow_config() -> dict[str, Any]:
    workflows = load_yaml(get_api_settings().repo_root / "config" / "workflows.yaml").get("workflows") or {}
    rag_config = workflows.get("rag_qa")
    return rag_config if isinstance(rag_config, dict) else {}


def _config_env_names(*path: str, field: str) -> list[str]:
    node: Any = _workflow_config()
    for key in path:
        if not isinstance(node, dict):
            return []
        node = node.get(key)
    if not isinstance(node, dict):
        return []
    value = node.get(field)
    return [str(value)] if isinstance(value, str) and value.strip() else []


def _env_value(names: Iterable[str] | str, fallback: str = "") -> str:
    _load_env_files_once()
    candidates = [names] if isinstance(names, str) else list(names)
    for name in candidates:
        value = os.environ.get(name, "")
        if isinstance(value, str) and value.strip():
            return value.strip()
    return fallback


def _env_float(names: Iterable[str] | str, fallback: float) -> float:
    value = _env_value(names, str(fallback))
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return fallback
    return max(parsed, 1.0)


def _normalize_url(value: str, fallback: str = "") -> str:
    text = str(value or "").strip().rstrip("/")
    return text or fallback


def get_default_user_id() -> str:
    return _env_value("DEFAULT_USER_ID", "user").strip() or "user"


def get_chat_settings() -> RagChatSettings:
    inputs_path = ("workflow", "inputs")
    return RagChatSettings(
        upstream_url=_normalize_url(
            _env_value(_config_env_names("workflow", field="url_env") + ["UPSTREAM_URL"])
        ),
        upstream_bearer_token=_env_value(
            _config_env_names("workflow", field="api_key_env") + ["UPSTREAM_BEARER_TOKEN"]
        ),
        upstream_timeout_seconds=_env_float(
            _config_env_names("workflow", field="timeout_env") + ["UPSTREAM_TIMEOUT_SECONDS"],
            DEFAULT_UPSTREAM_TIMEOUT_SECONDS,
        ),
        workflow_remote_user=_env_value(
            _config_env_names("workflow", field="user_env") + ["WORKFLOW_REMOTE_USER"],
            "admin",
        ),
        question_input_key=_env_value(
            _config_env_names(*inputs_path, field="question_key_env") + ["WORKFLOW_QUESTION_INPUT_KEY"],
            "question",
        ),
        allow_search_input_key=_env_value(
            _config_env_names(*inputs_path, field="allow_search_key_env") + ["WORKFLOW_ALLOW_SEARCH_INPUT_KEY"],
            "allow_search",
        ),
        history_input_key=_env_value(
            _config_env_names(*inputs_path, field="history_key_env") + ["WORKFLOW_HISTORY_INPUT_KEY"],
            "history",
        ),
    )


def get_dataset_api_base_url() -> str:
    return _normalize_url(
        _env_value(
            _config_env_names("dataset", field="api_base_url_env") + ["DIFY_API_BASE_URL"],
            DEFAULT_DIFY_API_BASE_URL,
        ),
        DEFAULT_DIFY_API_BASE_URL,
    )


def get_dataset_api_key() -> str:
    return _env_value(_config_env_names("dataset", field="api_key_env") + ["DIFY_DATASET_API_KEY"])


def get_default_dataset_id() -> str:
    return _env_value(_config_env_names("dataset", field="default_dataset_id_env") + ["DIFY_DEFAULT_DATASET_ID"])


def get_raw_dataset_id() -> str:
    return _env_value(
        _config_env_names("dataset", field="raw_dataset_id_env") + ["DIFY_RAW_DATASET_ID", "RAG_RAW_DATASET_ID"],
        get_default_dataset_id(),
    )


def get_desensitized_dataset_id() -> str:
    return _env_value(
        _config_env_names("dataset", field="desensitized_dataset_id_env")
        + ["DIFY_DESENSITIZED_DATASET_ID", "RAG_DESENSITIZED_DATASET_ID"],
        get_default_dataset_id(),
    )


def _build_chat_payload(
    settings: RagChatSettings,
    *,
    question: str,
    allow_search: str,
    history: str,
) -> dict[str, Any]:
    return {
        "inputs": {
            settings.question_input_key: question,
            settings.allow_search_input_key: allow_search,
            settings.history_input_key: history,
        },
        "response_mode": "streaming",
        "user": settings.workflow_remote_user,
    }


def _capture_stream_metadata(event_data: dict[str, Any], metadata: dict[str, Any]) -> None:
    for key in ("conversation_id", "message_id", "task_id", "workflow_run_id", "id"):
        value = event_data.get(key)
        if isinstance(value, (str, int, float)) and str(value):
            metadata.setdefault(key, str(value))

    data = event_data.get("data")
    if isinstance(data, dict):
        for key in ("conversation_id", "message_id", "task_id", "workflow_run_id", "id"):
            value = data.get(key)
            if isinstance(value, (str, int, float)) and str(value):
                metadata.setdefault(key, str(value))


def _extract_upstream_error(event_data: dict[str, Any]) -> str:
    data = event_data.get("data")
    if isinstance(data, dict):
        value = data.get("message") or data.get("status") or data.get("error")
        if value:
            return str(value)
    value = event_data.get("message") or event_data.get("error")
    return str(value) if value else "Upstream reported an error."


async def stream_workflow_answer(
    *,
    question: str,
    allow_search: str,
    history: str,
    metadata: dict[str, Any],
) -> AsyncIterator[str]:
    settings = get_chat_settings()
    if not settings.upstream_url:
        raise RagDifyError("UPSTREAM_URL is not configured.", status_code=500)
    if not settings.upstream_bearer_token:
        raise RagDifyError("UPSTREAM_BEARER_TOKEN is not configured.", status_code=500)

    headers = {
        "Authorization": f"Bearer {settings.upstream_bearer_token}",
        "Content-Type": "application/json",
        "Accept": "text/event-stream, application/json",
    }
    payload = _build_chat_payload(settings, question=question, allow_search=allow_search, history=history)
    timeout = httpx.Timeout(settings.upstream_timeout_seconds)

    try:
        async with httpx.AsyncClient(timeout=timeout, trust_env=False) as client:
            async with client.stream("POST", settings.upstream_url, headers=headers, json=payload) as response:
                if response.status_code >= 400:
                    body = (await response.aread()).decode("utf-8", errors="replace")[:500]
                    logger.warning("RAG upstream HTTP %s: %s", response.status_code, body)
                    raise RagDifyError(f"Upstream returned status {response.status_code}.")

                async for line in response.aiter_lines():
                    if not line:
                        continue
                    decoded = line.replace("\r", "").strip()
                    if not decoded.startswith("data:"):
                        continue
                    raw = decoded[5:].strip()
                    if not raw or raw == "[DONE]":
                        continue
                    try:
                        event_data = json.loads(raw)
                    except json.JSONDecodeError:
                        logger.debug("Skip non-JSON RAG SSE payload: %s", raw[:200])
                        continue
                    if not isinstance(event_data, dict):
                        continue

                    _capture_stream_metadata(event_data, metadata)
                    event = event_data.get("event")
                    if event == "text_chunk":
                        data = event_data.get("data") or {}
                        if isinstance(data, dict):
                            chunk = data.get("text", "")
                            if isinstance(chunk, str) and chunk:
                                yield chunk
                    elif event == "error":
                        raise RagDifyError(_extract_upstream_error(event_data))
    except RagDifyError:
        raise
    except httpx.TimeoutException as exc:
        logger.warning("RAG upstream request timed out")
        raise RagDifyError("Upstream request timed out.", status_code=503) from exc
    except httpx.RequestError as exc:
        logger.warning("RAG upstream request failed: %s", exc.__class__.__name__)
        raise RagDifyError("Upstream request failed.") from exc
