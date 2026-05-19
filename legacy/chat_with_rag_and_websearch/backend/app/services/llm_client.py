import json
from collections.abc import AsyncIterator

import httpx
from fastapi import HTTPException

from app.config import Settings
from app.observability import logger


def _build_payload(
    settings: Settings,
    question: str,
    allow_search: str,
    history: str,
) -> dict:
    return {
        "inputs": {
            settings.workflow_question_input_key: question,
            settings.workflow_allow_search_input_key: allow_search,
            settings.workflow_history_input_key: history,
        },
        "response_mode": "streaming",
        "user": settings.workflow_remote_user,
    }


async def stream_workflow_answer(
    settings: Settings,
    *,
    question: str,
    allow_search: str,
    history: str,
) -> AsyncIterator[str]:
    """
    Call upstream workflow API with response_mode=streaming; parse SSE lines (data: {...})
    and yield text segments from event == "text_chunk".
    """
    if not settings.upstream_url.strip():
        raise HTTPException(status_code=500, detail="UPSTREAM_URL is not configured.")
    if not settings.upstream_bearer_token.strip():
        raise HTTPException(status_code=500, detail="UPSTREAM_BEARER_TOKEN is not configured.")

    headers = {
        "Authorization": f"Bearer {settings.upstream_bearer_token}",
        "Content-Type": "application/json",
        "Accept": "text/event-stream, application/json",
    }
    payload = _build_payload(settings, question, allow_search, history)
    timeout = httpx.Timeout(settings.upstream_timeout_seconds)

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            async with client.stream(
                "POST",
                settings.upstream_url,
                headers=headers,
                json=payload,
            ) as response:
                if response.status_code >= 400:
                    body = (await response.aread()).decode("utf-8", errors="replace")[:4000]
                    logger.warning("Upstream HTTP %s: %s", response.status_code, body)
                    raise HTTPException(
                        status_code=502,
                        detail=f"Upstream returned status {response.status_code}.",
                    )

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
                        logger.debug("Skip non-JSON SSE payload: %s", raw[:200])
                        continue

                    event = event_data.get("event")
                    if event == "text_chunk":
                        data = event_data.get("data") or {}
                        if isinstance(data, dict):
                            chunk = data.get("text", "")
                            if isinstance(chunk, str) and chunk:
                                yield chunk
                    elif event == "error":
                        msg = ""
                        err = event_data.get("data") or event_data.get("message")
                        if isinstance(err, dict):
                            msg = str(err.get("message") or err.get("status") or err)
                        elif isinstance(err, str):
                            msg = err
                        elif err is not None:
                            msg = str(err)
                        raise HTTPException(
                            status_code=502,
                            detail=msg or "Upstream reported an error.",
                        )
    except HTTPException:
        raise
    except httpx.RequestError as exc:
        logger.exception("Upstream request/stream failed: %s", exc)
        raise HTTPException(status_code=502, detail="Upstream request failed.") from exc
