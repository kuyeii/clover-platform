from __future__ import annotations

import hmac
import os
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, Request

from app.core.deps import extract_token, get_current_user, require_admin
from app.core.responses import ok
from app.services.pipt_gateway_service import (
    batch_postprocess_payload,
    batch_preprocess_payload,
    build_gateway_payload,
    cleanup_gateway_mappings_payload,
    cleanup_unrestorable_gateway_mappings_payload,
    get_gateway_admin_summary_payload,
    get_gateway_status_payload,
    list_gateway_mappings_payload,
    list_gateway_events_payload,
    postprocess_payload,
    preprocess_payload,
    validate_placeholders_payload,
)
from app.services.pipt_config_service import (
    delete_custom_entity_type_payload,
    get_pipt_config_payload,
    test_custom_regex_payload,
    update_task_configs_payload,
    upsert_custom_entity_type_payload,
)

router = APIRouter()


def require_pipt_gateway_admin_access(
    authorization: Annotated[str | None, Header()] = None,
) -> dict[str, Any]:
    """
    PIPT 管理面允许平台管理员会话或 superadmin service token。
    service token 只用于底层管理后台，不放宽普通 PIPT 业务接口权限。
    """
    token = extract_token(authorization)
    service_token = os.environ.get("PIPT_GATEWAY_ADMIN_TOKEN", "").strip()
    if service_token and token and hmac.compare_digest(token, service_token):
        return {"id": "superadmin-service", "role": "admin", "auth_source": "pipt_gateway_admin_token"}
    return require_admin(get_current_user(authorization))


@router.get("/pipt-gateway/status", name="get_pipt_gateway_status")
def get_pipt_gateway_status(
    request: Request,
    user: dict[str, Any] = Depends(get_current_user),
):
    _ = user
    return ok(request, get_gateway_status_payload())


@router.post("/pipt-gateway/payload", name="build_pipt_gateway_payload")
async def build_pipt_gateway_payload(
    request: Request,
    user: dict[str, Any] = Depends(get_current_user),
):
    _ = user
    body = await _read_json_body(request)
    return ok(request, build_gateway_payload(body))


@router.post("/pipt-gateway/preprocess", name="preprocess_pipt_gateway_payload")
async def preprocess_pipt_gateway_payload(
    request: Request,
    user: dict[str, Any] = Depends(get_current_user),
):
    _ = user
    body = await _read_json_body(request)
    return ok(request, preprocess_payload(body))


@router.post("/pipt-gateway/preprocess/batch", name="batch_preprocess_pipt_gateway_payload")
async def batch_preprocess_pipt_gateway_payload(
    request: Request,
    user: dict[str, Any] = Depends(get_current_user),
):
    _ = user
    body = await _read_json_body(request)
    return ok(request, batch_preprocess_payload(body))


@router.post("/pipt-gateway/postprocess", name="postprocess_pipt_gateway_payload")
async def postprocess_pipt_gateway_payload(
    request: Request,
    user: dict[str, Any] = Depends(get_current_user),
):
    _ = user
    body = await _read_json_body(request)
    return ok(request, postprocess_payload(body))


@router.post("/pipt-gateway/postprocess/batch", name="batch_postprocess_pipt_gateway_payload")
async def batch_postprocess_pipt_gateway_payload(
    request: Request,
    user: dict[str, Any] = Depends(get_current_user),
):
    _ = user
    body = await _read_json_body(request)
    return ok(request, batch_postprocess_payload(body))


@router.post("/pipt-gateway/validate-placeholders", name="validate_pipt_gateway_placeholders")
async def validate_pipt_gateway_placeholders(
    request: Request,
    user: dict[str, Any] = Depends(get_current_user),
):
    _ = user
    body = await _read_json_body(request)
    return ok(request, validate_placeholders_payload(body))


@router.get("/pipt-gateway/admin-summary", name="get_pipt_gateway_admin_summary")
def get_pipt_gateway_admin_summary(
    request: Request,
    user: dict[str, Any] = Depends(require_pipt_gateway_admin_access),
):
    _ = user
    return ok(request, get_gateway_admin_summary_payload())


@router.get("/pipt-gateway/config", name="get_pipt_gateway_config")
def get_pipt_gateway_config(
    request: Request,
    user: dict[str, Any] = Depends(require_pipt_gateway_admin_access),
):
    _ = user
    return ok(request, get_pipt_config_payload())


@router.put("/pipt-gateway/config/tasks", name="update_pipt_gateway_task_config")
async def update_pipt_gateway_task_config(
    request: Request,
    user: dict[str, Any] = Depends(require_pipt_gateway_admin_access),
):
    _ = user
    body = await _read_json_body(request)
    return ok(request, update_task_configs_payload(body.get("items")))


@router.post("/pipt-gateway/config/custom-types", name="upsert_pipt_gateway_custom_entity_type")
async def upsert_pipt_gateway_custom_entity_type(
    request: Request,
    user: dict[str, Any] = Depends(require_pipt_gateway_admin_access),
):
    _ = user
    body = await _read_json_body(request)
    return ok(request, upsert_custom_entity_type_payload(body))


@router.delete("/pipt-gateway/config/custom-types/{code}", name="delete_pipt_gateway_custom_entity_type")
def delete_pipt_gateway_custom_entity_type(
    code: str,
    request: Request,
    user: dict[str, Any] = Depends(require_pipt_gateway_admin_access),
):
    _ = user
    return ok(request, delete_custom_entity_type_payload(code))


@router.post("/pipt-gateway/config/custom-types/test", name="test_pipt_gateway_custom_entity_type_regex")
async def test_pipt_gateway_custom_entity_type_regex(
    request: Request,
    user: dict[str, Any] = Depends(require_pipt_gateway_admin_access),
):
    _ = user
    body = await _read_json_body(request)
    return ok(request, test_custom_regex_payload(body))


@router.get("/pipt-gateway/events", name="list_pipt_gateway_events")
def list_pipt_gateway_events(
    request: Request,
    request_id: str | None = None,
    module_code: str | None = None,
    purpose: str | None = None,
    operation: str | None = None,
    status: str | None = None,
    limit: int = 100,
    user: dict[str, Any] = Depends(require_pipt_gateway_admin_access),
):
    _ = user
    return ok(
        request,
        list_gateway_events_payload(
            request_id=request_id,
            module_code=module_code,
            purpose=purpose,
            operation=operation,
            status=status,
            limit=limit,
        ),
    )


@router.get("/pipt-gateway/mappings", name="list_pipt_gateway_mappings")
def list_pipt_gateway_mappings(
    request: Request,
    request_id: str | None = None,
    module_code: str | None = None,
    purpose: str | None = None,
    entity_type: str | None = None,
    limit: int = 100,
    user: dict[str, Any] = Depends(require_pipt_gateway_admin_access),
):
    _ = user
    return ok(
        request,
        list_gateway_mappings_payload(
            request_id=request_id,
            module_code=module_code,
            purpose=purpose,
            entity_type=entity_type,
            limit=limit,
        ),
    )


@router.delete("/pipt-gateway/mappings/expired", name="cleanup_pipt_gateway_expired_mappings")
def cleanup_pipt_gateway_expired_mappings(
    request: Request,
    older_than_seconds: int | None = None,
    user: dict[str, Any] = Depends(require_pipt_gateway_admin_access),
):
    _ = user
    return ok(request, cleanup_gateway_mappings_payload(older_than_seconds=older_than_seconds))


@router.delete("/pipt-gateway/mappings/unrestorable", name="cleanup_pipt_gateway_unrestorable_mappings")
def cleanup_pipt_gateway_unrestorable_mappings(
    request: Request,
    user: dict[str, Any] = Depends(require_pipt_gateway_admin_access),
):
    _ = user
    return ok(request, cleanup_unrestorable_gateway_mappings_payload())


async def _read_json_body(request: Request) -> dict[str, Any]:
    try:
        body = await request.json()
    except Exception:
        return {}
    return body if isinstance(body, dict) else {}
