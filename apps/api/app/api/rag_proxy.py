from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse

from app.core.deps import get_client_id, get_current_user
from app.core.errors import PlatformError
from app.services import portal_store
from app.services.business_proxy import proxy_business_request
from app.services.rag_service import create_session_payload, list_conversations_payload, sync_conversations

APP_CODE = "rag-web-search"

router = APIRouter(prefix="/rag")


def require_rag_user(user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    if not portal_store.can_access_app(user, APP_CODE):
        raise PlatformError(code="PERMISSION_DENIED", message="当前用户没有访问 RAG 问答的权限。", status_code=403)
    return user


def legacy_json(payload: Any, *, status_code: int = 200) -> JSONResponse:
    return JSONResponse(content=payload, status_code=status_code)


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
