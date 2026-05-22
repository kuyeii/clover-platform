"""Contract review proxy mounted as /api/v1/contract-review."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, StreamingResponse

from app.core.deps import get_client_id, get_current_user
from app.core.errors import PlatformError
from app.services import portal_store
from app.services.business_proxy import proxy_business_request
from app.services.contract_review_service import get_config_payload, get_health_payload

APP_CODE = "contract-review"

router = APIRouter(prefix="/contract-review")


def require_contract_review_user(user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    if not portal_store.can_access_app(user, APP_CODE):
        raise PlatformError(code="PERMISSION_DENIED", message="当前用户没有访问合同审查的权限。", status_code=403)
    return user


def legacy_json(payload: Any, *, status_code: int = 200) -> JSONResponse:
    return JSONResponse(content=payload, status_code=status_code)


@router.get("/api/health")
async def get_contract_review_health(
    user: dict[str, Any] = Depends(require_contract_review_user),
) -> JSONResponse:
    _ = user
    return legacy_json(get_health_payload())


@router.get("/api/config")
async def get_contract_review_config(
    user: dict[str, Any] = Depends(require_contract_review_user),
) -> JSONResponse:
    _ = user
    return legacy_json(get_config_payload())


@router.api_route("", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"])
@router.api_route("/", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"])
async def empty_proxy_path(
    user: dict[str, Any] = Depends(require_contract_review_user),
) -> None:
    _ = user
    raise PlatformError(code="RESOURCE_NOT_FOUND", message="业务代理路径不存在。", status_code=404)


@router.api_route("/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"])
async def proxy_contract_review(
    request: Request,
    path: str,
    user: dict[str, Any] = Depends(require_contract_review_user),
    client_id: str = Depends(get_client_id),
) -> StreamingResponse:
    return await proxy_business_request(
        request=request,
        app_code=APP_CODE,
        path=path,
        user=user,
        client_id=client_id,
    )
