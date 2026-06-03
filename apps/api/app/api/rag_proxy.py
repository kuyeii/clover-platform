from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, Query, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse
from starlette.datastructures import UploadFile

from app.core.deps import get_client_id, get_current_user
from app.core.errors import PlatformError
from app.services import portal_store
from app.services.business_proxy import proxy_business_request
from app.services.rag_dify_service import RagDifyError, get_default_user_id, stream_workflow_answer
from app.services.rag_knowledge_service import (
    RagKnowledgeError,
    create_local_file_document,
    create_local_text_document,
    delete_knowledge_document,
    download_knowledge_document,
    get_knowledge_document_detail,
    list_knowledge_documents,
    sync_knowledge_document_to_dify,
)
from app.services.rag_service import (
    coerce_session_uuid,
    create_session_payload,
    list_conversations_payload,
    save_turn,
    sync_conversations,
)

APP_CODE = "rag-web-search"
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/rag")


def require_rag_user(user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    if not portal_store.can_access_app(user, APP_CODE):
        raise PlatformError(code="PERMISSION_DENIED", message="当前用户没有访问 RAG 问答的权限。", status_code=403)
    return user


def legacy_json(payload: Any, *, status_code: int = 200) -> JSONResponse:
    return JSONResponse(content=payload, status_code=status_code)


def legacy_error(detail: str, *, status_code: int) -> JSONResponse:
    return legacy_json({"detail": detail}, status_code=status_code)


def sse_data(payload: dict[str, Any]) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


def knowledge_response(payload: Any, *, status_code: int = 200) -> JSONResponse:
    return legacy_json(payload, status_code=status_code)


def knowledge_error(exc: RagKnowledgeError) -> JSONResponse:
    return legacy_error(exc.detail, status_code=exc.status_code)


async def _sync_rag_knowledge_document_background(document_id: str) -> None:
    try:
        await sync_knowledge_document_to_dify(document_id)
    except Exception:
        # 同步错误会在 service 内写回本地状态；这里兜底避免后台任务异常污染请求日志。
        logger.exception("RAG knowledge background sync failed: %s", document_id)
        return


def parse_legacy_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return False


@router.get("/api/v1/health")
async def get_rag_health(
    user: dict[str, Any] = Depends(require_rag_user),
) -> JSONResponse:
    _ = user
    return legacy_json({"status": "ok"})


@router.post("/api/v1/sessions")
async def create_rag_session(
    user: dict[str, Any] = Depends(require_rag_user),
) -> JSONResponse:
    _ = user
    return legacy_json(create_session_payload())


@router.get("/api/v1/conversations")
async def get_rag_conversations(
    user: dict[str, Any] = Depends(require_rag_user),
) -> JSONResponse:
    _ = user
    return legacy_json(list_conversations_payload())


@router.put("/api/v1/conversations/sync")
async def sync_rag_conversations(
    request: Request,
    user: dict[str, Any] = Depends(require_rag_user),
) -> Response:
    _ = user
    try:
        payload = await request.json()
    except json.JSONDecodeError as exc:
        raise PlatformError(code="VALIDATION_ERROR", message="请求体不是合法 JSON。", status_code=422) from exc
    sync_conversations(payload)
    return Response(status_code=204)


@router.post("/api/v1/chat/stream")
async def stream_rag_chat(
    request: Request,
    user: dict[str, Any] = Depends(require_rag_user),
) -> StreamingResponse:
    _ = user
    request_id = str(uuid.uuid4())
    try:
        body = await request.json()
    except json.JSONDecodeError:
        body = {}
    if not isinstance(body, dict):
        body = {}

    message = str(body.get("message") or "")
    raw_session_id = str(body.get("session_id") or uuid.uuid4())
    user_id = str(body.get("user_id") or get_default_user_id()).strip() or get_default_user_id()
    allow_search = "1" if parse_legacy_bool(body.get("allow_search")) else "0"
    history = str(body.get("history") or "[]")

    async def event_stream():
        try:
            if not message:
                raise RagDifyError("message 不能为空", status_code=400)
            session_id = coerce_session_uuid(raw_session_id, "session_id")
            yield sse_data({"type": "session", "session_id": session_id, "request_id": request_id})
            started_at = time.perf_counter()
            full_text_parts: list[str] = []
            upstream_metadata: dict[str, Any] = {}

            async for chunk in stream_workflow_answer(
                question=message,
                allow_search=allow_search,
                history=history,
                metadata=upstream_metadata,
            ):
                full_text_parts.append(chunk)
                yield sse_data({"type": "delta", "text": chunk})

            await asyncio.to_thread(
                save_turn,
                user_id=user_id,
                session_id=session_id,
                user_message=message,
                assistant_message="".join(full_text_parts),
                extra={
                    "request_id": request_id,
                    "allow_search": allow_search,
                    "duration_ms": int((time.perf_counter() - started_at) * 1000),
                    **upstream_metadata,
                },
            )
            yield sse_data({"type": "done", "request_id": request_id})
        except asyncio.CancelledError:
            return
        except (PlatformError, RagDifyError) as exc:
            detail = getattr(exc, "detail", None) or getattr(exc, "message", None) or str(exc) or "Request failed"
            yield sse_data({"type": "error", "detail": detail, "request_id": request_id})
        except Exception:
            yield sse_data({"type": "error", "detail": "Internal server error", "request_id": request_id})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Request-Id": request_id},
    )


@router.get("/api/v1/knowledge/documents")
async def get_rag_knowledge_documents(
    user: dict[str, Any] = Depends(require_rag_user),
) -> JSONResponse:
    _ = user
    try:
        return knowledge_response(await list_knowledge_documents())
    except RagKnowledgeError as exc:
        return knowledge_error(exc)


@router.post("/api/v1/knowledge/documents/create-by-text")
async def create_rag_knowledge_text_document(
    request: Request,
    background_tasks: BackgroundTasks,
    user: dict[str, Any] = Depends(require_rag_user),
) -> JSONResponse:
    _ = user
    try:
        body = await request.json()
    except json.JSONDecodeError:
        return legacy_error("请求体不是合法 JSON", status_code=422)
    name = str(body.get("name") or "")
    text = str(body.get("text") or "")
    if not name.strip():
        return legacy_error("name 不能为空", status_code=422)
    if not text:
        return legacy_error("text 不能为空", status_code=422)
    try:
        result = await create_local_text_document(name, text)
        background_tasks.add_task(_sync_rag_knowledge_document_background, result["document_id"])
        return knowledge_response(result)
    except RagKnowledgeError as exc:
        return knowledge_error(exc)


@router.post("/api/v1/knowledge/documents/create-by-file")
async def create_rag_knowledge_file_document(
    request: Request,
    background_tasks: BackgroundTasks,
    user: dict[str, Any] = Depends(require_rag_user),
) -> JSONResponse:
    _ = user
    form = await request.form()
    file = form.get("file")
    if not isinstance(file, UploadFile):
        return legacy_error("file 字段不能为空", status_code=422)
    try:
        result = await create_local_file_document(file)
        background_tasks.add_task(_sync_rag_knowledge_document_background, result["document_id"])
        return knowledge_response(result)
    except RagKnowledgeError as exc:
        return knowledge_error(exc)


@router.post("/api/v1/knowledge/documents/{document_id}/desensitized-sync")
async def sync_rag_knowledge_document_desensitized(
    document_id: str,
    user: dict[str, Any] = Depends(require_rag_user),
) -> JSONResponse:
    _ = user
    try:
        return knowledge_response(await sync_knowledge_document_to_dify(document_id))
    except RagKnowledgeError as exc:
        return knowledge_error(exc)


@router.get("/api/v1/knowledge/documents/{document_id}/detail")
async def get_rag_knowledge_document_detail(
    document_id: str,
    user: dict[str, Any] = Depends(require_rag_user),
) -> JSONResponse:
    _ = user
    try:
        return knowledge_response(await get_knowledge_document_detail(document_id))
    except RagKnowledgeError as exc:
        return knowledge_error(exc)


@router.get("/api/v1/knowledge/documents/{document_id}/download")
async def download_rag_knowledge_document(
    document_id: str,
    format: str = Query(default="markdown", pattern="^(markdown|json)$"),
    user: dict[str, Any] = Depends(require_rag_user),
) -> Response:
    _ = user
    try:
        return await download_knowledge_document(document_id, format=format)
    except RagKnowledgeError as exc:
        return knowledge_error(exc)


@router.delete("/api/v1/knowledge/documents/{document_id}")
async def delete_rag_knowledge_document(
    document_id: str,
    user: dict[str, Any] = Depends(require_rag_user),
) -> Response:
    _ = user
    try:
        return await delete_knowledge_document(document_id)
    except RagKnowledgeError as exc:
        return knowledge_error(exc)


@router.api_route("", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"])
@router.api_route("/", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"])
async def empty_proxy_path(
    user: dict[str, Any] = Depends(require_rag_user),
) -> None:
    _ = user
    raise PlatformError(code="RESOURCE_NOT_FOUND", message="业务代理路径不存在。", status_code=404)


@router.api_route("/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"])
async def proxy_rag(
    request: Request,
    path: str,
    user: dict[str, Any] = Depends(require_rag_user),
    client_id: str = Depends(get_client_id),
) -> StreamingResponse:
    return await proxy_business_request(
        request=request,
        app_code=APP_CODE,
        path=path,
        user=user,
        client_id=client_id,
    )
