"""Bid generator proxy mounted as /api/v1/bid-generator."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, StreamingResponse

from app.core.deps import get_client_id, get_current_user
from app.core.errors import PlatformError
from app.services import portal_store
from app.services.bid_generator_service import (
    BidProjectNotFound,
    ensure_legacy_runtime,
    get_analysis_framework_payload,
    get_health_payload,
    get_legacy_api_routers,
    list_pipt_audit_logs_payload,
    get_project_mappings_payload,
    get_project_payload,
    get_supported_entities_payload,
    get_workflow_status_payload,
    list_projects_payload,
)
from app.services.business_proxy import proxy_business_request

APP_CODE = "bid-generator"

router = APIRouter(prefix="/bid-generator")


def require_bid_generator_user(user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    if not portal_store.can_access_app(user, APP_CODE):
        raise PlatformError(code="PERMISSION_DENIED", message="当前用户没有访问标书生成的权限。", status_code=403)
    ensure_legacy_runtime()
    return user


def legacy_json(payload: Any, *, status_code: int = 200) -> JSONResponse:
    return JSONResponse(content=payload, status_code=status_code)


@router.get("/health")
@router.get("/api/health")
async def get_bid_generator_health(
    user: dict[str, Any] = Depends(require_bid_generator_user),
) -> JSONResponse:
    _ = user
    return legacy_json(get_health_payload())


@router.get("/api/config/workflow-status")
async def get_bid_generator_workflow_status(
    user: dict[str, Any] = Depends(require_bid_generator_user),
) -> JSONResponse:
    _ = user
    return legacy_json(get_workflow_status_payload())


@router.get("/api/config/analysis-framework")
async def get_bid_generator_analysis_framework(
    user: dict[str, Any] = Depends(require_bid_generator_user),
) -> JSONResponse:
    _ = user
    return legacy_json(get_analysis_framework_payload())


@router.get("/api/entities")
async def get_bid_generator_entities(
    user: dict[str, Any] = Depends(require_bid_generator_user),
) -> JSONResponse:
    _ = user
    return legacy_json(get_supported_entities_payload())


@router.get("/api/projects")
async def list_bid_generator_projects(
    user: dict[str, Any] = Depends(require_bid_generator_user),
) -> JSONResponse:
    _ = user
    return legacy_json(list_projects_payload())


@router.get("/api/projects/{project_id}")
async def get_bid_generator_project(
    project_id: str,
    user: dict[str, Any] = Depends(require_bid_generator_user),
) -> JSONResponse:
    _ = user
    try:
        return legacy_json(get_project_payload(project_id))
    except BidProjectNotFound:
        return legacy_json({"detail": "项目不存在"}, status_code=404)


@router.get("/api/projects/{project_id}/mappings")
async def get_bid_generator_project_mappings(
    project_id: str,
    user: dict[str, Any] = Depends(require_bid_generator_user),
) -> JSONResponse:
    _ = user
    try:
        return legacy_json(get_project_mappings_payload(project_id))
    except BidProjectNotFound:
        return legacy_json({"detail": "项目不存在"}, status_code=404)


@router.get("/api/pipt-audit-logs")
async def list_bid_generator_pipt_audit_logs(
    project_id: str | None = None,
    task_id: str | None = None,
    session_id: str | None = None,
    operation: str | None = None,
    status: str | None = None,
    placeholder: str | None = None,
    limit: int = 100,
    user: dict[str, Any] = Depends(require_bid_generator_user),
) -> JSONResponse:
    _ = user
    return legacy_json(
        list_pipt_audit_logs_payload(
            project_id=project_id,
            task_id=task_id,
            session_id=session_id,
            operation=operation,
            status=status,
            placeholder=placeholder,
            limit=limit,
        )
    )


for _legacy_router in get_legacy_api_routers():
    router.include_router(
        _legacy_router,
        prefix="/api",
        dependencies=[Depends(require_bid_generator_user)],
    )


@router.api_route("", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"])
@router.api_route("/", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"])
async def empty_proxy_path(
    request: Request,
    user: dict[str, Any] = Depends(require_bid_generator_user),
    client_id: str = Depends(get_client_id),
) -> StreamingResponse:
    return await proxy_business_request(
        request=request,
        app_code=APP_CODE,
        path="",
        user=user,
        client_id=client_id,
    )


@router.api_route("/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"])
async def proxy_bid_generator(
    request: Request,
    path: str,
    user: dict[str, Any] = Depends(require_bid_generator_user),
    client_id: str = Depends(get_client_id),
) -> StreamingResponse:
    return await proxy_business_request(
        request=request,
        app_code=APP_CODE,
        path=path,
        user=user,
        client_id=client_id,
    )
