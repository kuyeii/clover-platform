from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, StreamingResponse

from app.core.deps import get_client_id, get_current_user
from app.core.errors import PlatformError
from app.services import portal_store
from app.services.business_proxy import proxy_business_request
from app.services.competitor_analysis_service import (
    CompetitorAnalysisBadRequest,
    clear_history_records,
    delete_history_record,
    read_history_record_by_id,
    read_history_records,
    save_history_record,
)

APP_CODE = "competitor-analysis"
MAX_BODY_BYTES = 20 * 1024 * 1024

router = APIRouter(prefix="/competitor-analysis")


def require_competitor_analysis_user(user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    if not portal_store.can_access_app(user, APP_CODE):
        raise PlatformError(code="PERMISSION_DENIED", message="当前用户没有访问竞对分析的权限。", status_code=403)
    return user


def legacy_json(payload: Any, *, status_code: int = 200) -> JSONResponse:
    return JSONResponse(content=payload, status_code=status_code)


async def read_legacy_json_body(request: Request) -> Any:
    raw = await request.body()
    if len(raw) > MAX_BODY_BYTES:
        raise CompetitorAnalysisBadRequest("请求体过大", code="PAYLOAD_TOO_LARGE", status_code=413)
    if not raw:
        return {}
    try:
        return json.loads(raw.decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise CompetitorAnalysisBadRequest("请求体不是合法 JSON", code="INVALID_JSON") from exc


@router.get("/api/health")
async def get_competitor_analysis_health(
    user: dict[str, Any] = Depends(require_competitor_analysis_user),
) -> JSONResponse:
    _ = user
    return legacy_json({"ok": True, "service": "competitor-analysis", "mode": "apps-api"})


@router.get("/api/history")
async def list_competitor_analysis_history(
    user: dict[str, Any] = Depends(require_competitor_analysis_user),
) -> JSONResponse:
    _ = user
    return legacy_json({"items": read_history_records()})


@router.get("/api/history/{history_id}")
async def get_competitor_analysis_history(
    history_id: str,
    user: dict[str, Any] = Depends(require_competitor_analysis_user),
) -> JSONResponse:
    _ = user
    record = read_history_record_by_id(history_id)
    if not record:
        return legacy_json({"message": "未找到历史记录"}, status_code=404)
    return legacy_json({"item": record})


@router.post("/api/history")
async def create_competitor_analysis_history(
    request: Request,
    user: dict[str, Any] = Depends(require_competitor_analysis_user),
) -> JSONResponse:
    _ = user
    try:
        record = save_history_record(await read_legacy_json_body(request))
    except CompetitorAnalysisBadRequest as exc:
        return legacy_json({"message": exc.message, "code": exc.code}, status_code=exc.status_code)
    return legacy_json({"ok": True, "item": record}, status_code=201)


@router.delete("/api/history")
async def delete_competitor_analysis_history(
    user: dict[str, Any] = Depends(require_competitor_analysis_user),
) -> JSONResponse:
    _ = user
    clear_history_records()
    return legacy_json({"ok": True})


@router.delete("/api/history/{history_id}")
async def delete_competitor_analysis_history_record(
    history_id: str,
    user: dict[str, Any] = Depends(require_competitor_analysis_user),
) -> JSONResponse:
    _ = user
    delete_history_record(history_id)
    return legacy_json({"ok": True})


@router.api_route("", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"])
@router.api_route("/", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"])
async def empty_proxy_path(
    user: dict[str, Any] = Depends(require_competitor_analysis_user),
) -> None:
    _ = user
    raise PlatformError(code="RESOURCE_NOT_FOUND", message="业务代理路径不存在。", status_code=404)


@router.api_route("/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"])
async def proxy_competitor_analysis(
    request: Request,
    path: str,
    user: dict[str, Any] = Depends(require_competitor_analysis_user),
    client_id: str = Depends(get_client_id),
) -> StreamingResponse:
    return await proxy_business_request(
        request=request,
        app_code=APP_CODE,
        path=path,
        user=user,
        client_id=client_id,
    )
