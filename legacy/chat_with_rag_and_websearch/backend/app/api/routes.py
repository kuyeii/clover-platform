import asyncio
import json
import time
import uuid
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from app.config import Settings, get_settings
from app.observability import MetricsHooks, log_duration_ms, logger, new_request_id
from app.schemas.chat import ChatStreamRequest, SessionCreateResponse
from app.services.llm_client import stream_workflow_answer
from app.services.turn_store import save_turn

router = APIRouter(prefix="/api/v1")


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@router.post("/sessions", response_model=SessionCreateResponse)
async def create_session() -> SessionCreateResponse:
    MetricsHooks.increment_counter("sessions_created")
    return SessionCreateResponse(session_id=str(uuid.uuid4()))


def _sse_data(obj: dict) -> str:
    return f"data: {json.dumps(obj, ensure_ascii=False)}\n\n"


def _validate_uuid(value: str, field_name: str) -> None:
    try:
        UUID(str(value))
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=f"{field_name} 不是合法 UUID") from exc


@router.post("/chat/stream")
async def chat_stream(
    body: ChatStreamRequest,
    settings: Annotated[Settings, Depends(get_settings)],
) -> StreamingResponse:
    request_id = new_request_id()
    user_id = (body.user_id or settings.default_user_id).strip() or settings.default_user_id
    session_id = body.session_id or str(uuid.uuid4())
    _validate_uuid(session_id, "session_id")
    user_message = body.message
    allow_search = "1" if body.allow_search else "0"
    history = body.history

    async def event_stream():
        try:
            yield _sse_data({"type": "session", "session_id": session_id, "request_id": request_id})
            t0 = time.perf_counter()

            full_text_parts: list[str] = []
            async for chunk in stream_workflow_answer(
                settings,
                question=user_message,
                allow_search=allow_search,
                history=history,
            ):
                full_text_parts.append(chunk)
                yield _sse_data({"type": "delta", "text": chunk})

            log_duration_ms("upstream_stream_complete", t0)
            full_text = "".join(full_text_parts)

            await asyncio.to_thread(
                save_turn,
                settings,
                user_id=user_id,
                session_id=session_id,
                user_message=user_message,
                assistant_message=full_text,
                extra={
                    "request_id": request_id,
                    "allow_search": allow_search,
                },
            )
            yield _sse_data({"type": "done", "request_id": request_id})
        except HTTPException as exc:
            detail = exc.detail
            if not isinstance(detail, str):
                detail = "Request failed"
            logger.warning("chat_stream failed: %s", detail)
            yield _sse_data({"type": "error", "detail": detail, "request_id": request_id})
        except Exception as exc:  # noqa: BLE001
            logger.exception("chat_stream unexpected error: %s", exc)
            yield _sse_data(
                {
                    "type": "error",
                    "detail": "Internal server error",
                    "request_id": request_id,
                }
            )

    headers = {
        "Cache-Control": "no-cache",
        "X-Request-Id": request_id,
    }
    return StreamingResponse(event_stream(), media_type="text/event-stream", headers=headers)
