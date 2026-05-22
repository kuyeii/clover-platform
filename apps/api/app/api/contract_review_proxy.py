"""Contract review direct/proxy routes mounted as /api/v1/contract-review."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse

from app.core.deps import get_client_id, get_current_user
from app.core.errors import PlatformError
from app.services import portal_store
from app.services.business_proxy import proxy_business_request
from app.services import contract_review_service as contract_review

APP_CODE = "contract-review"

router = APIRouter(prefix="/contract-review")


def require_contract_review_user(user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    if not portal_store.can_access_app(user, APP_CODE):
        raise PlatformError(code="PERMISSION_DENIED", message="当前用户没有访问合同审查的权限。", status_code=403)
    return user


def legacy_json(payload: Any, *, status_code: int = 200) -> JSONResponse:
    return JSONResponse(content=payload, status_code=status_code)


def legacy_business_error(exc: HTTPException) -> JSONResponse:
    return legacy_json(
        contract_review.build_legacy_error_content(exc.status_code, exc.detail),
        status_code=exc.status_code,
    )


async def read_legacy_json_body(request: Request) -> dict[str, Any]:
    try:
        body = await request.json()
    except Exception:
        return {}
    return body if isinstance(body, dict) else {}


@router.get("/api/health")
async def get_contract_review_health(
    user: dict[str, Any] = Depends(require_contract_review_user),
) -> JSONResponse:
    _ = user
    return legacy_json(contract_review.get_health_payload())


@router.get("/api/config")
async def get_contract_review_config(
    user: dict[str, Any] = Depends(require_contract_review_user),
) -> JSONResponse:
    _ = user
    return legacy_json(contract_review.get_config_payload())


@router.get("/api/diagnostics/converters")
async def get_contract_review_converter_diagnostics(
    user: dict[str, Any] = Depends(require_contract_review_user),
) -> JSONResponse:
    _ = user
    try:
        return legacy_json(contract_review.converter_diagnostics())
    except HTTPException as exc:
        return legacy_business_error(exc)


@router.post("/api/reviews")
async def create_contract_review(
    request: Request,
    user: dict[str, Any] = Depends(require_contract_review_user),
) -> JSONResponse:
    _ = user
    try:
        try:
            form = await request.form()
        except Exception as exc:
            raise HTTPException(status_code=422, detail="multipart/form-data 解析失败，请检查上传文件。") from exc
        file = form.get("file")
        if not hasattr(file, "filename") or not hasattr(file, "file"):
            raise HTTPException(status_code=422, detail="请上传合同文件。")
        payload = await contract_review.create_review(
            file=file,
            review_side=str(form.get("review_side") or ""),
            contract_type_hint=str(form.get("contract_type_hint") or "service_agreement"),
            analysis_scope=str(form.get("analysis_scope") or "full_detail"),
        )
    except HTTPException as exc:
        return legacy_business_error(exc)
    return legacy_json(payload)


@router.get("/api/reviews/history")
async def get_contract_review_history(
    request: Request,
    user: dict[str, Any] = Depends(require_contract_review_user),
) -> JSONResponse:
    _ = user
    try:
        raw_limit = str(request.query_params.get("limit") or "30").strip()
        try:
            limit = int(raw_limit)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail="limit 必须为整数") from exc
        if limit < 1 or limit > 200:
            raise HTTPException(status_code=422, detail="limit 必须在 1 到 200 之间")
        return legacy_json(contract_review.get_review_history(limit=limit))
    except HTTPException as exc:
        return legacy_business_error(exc)


@router.get("/api/reviews/{run_id}")
async def get_contract_review_status(
    run_id: str,
    user: dict[str, Any] = Depends(require_contract_review_user),
) -> JSONResponse:
    _ = user
    try:
        return legacy_json(contract_review.get_review_status(run_id))
    except HTTPException as exc:
        return legacy_business_error(exc)


@router.get("/api/reviews/{run_id}/result")
async def get_contract_review_result(
    run_id: str,
    user: dict[str, Any] = Depends(require_contract_review_user),
) -> JSONResponse:
    _ = user
    try:
        return legacy_json(contract_review.get_review_result(run_id))
    except HTTPException as exc:
        return legacy_business_error(exc)


@router.get("/api/reviews/{run_id}/document")
async def get_contract_review_document(
    run_id: str,
    user: dict[str, Any] = Depends(require_contract_review_user),
):
    _ = user
    try:
        return contract_review.get_review_document(run_id)
    except HTTPException as exc:
        return legacy_business_error(exc)


@router.get("/api/reviews/{run_id}/download")
async def download_contract_review_document(
    run_id: str,
    user: dict[str, Any] = Depends(require_contract_review_user),
):
    _ = user
    try:
        return contract_review.download_reviewed_docx(run_id)
    except HTTPException as exc:
        return legacy_business_error(exc)


@router.patch("/api/reviews/{run_id}/risks/{risk_id}")
async def patch_contract_review_risk(
    run_id: str,
    risk_id: str,
    request: Request,
    user: dict[str, Any] = Depends(require_contract_review_user),
) -> JSONResponse:
    _ = user
    try:
        body = await read_legacy_json_body(request)
        payload = contract_review.patch_risk_status(
            run_id,
            risk_id,
            contract_review.RiskPatchBody(status=str(body.get("status") or "")),
        )
    except HTTPException as exc:
        return legacy_business_error(exc)
    return legacy_json(payload)


@router.post("/api/reviews/{run_id}/risks/accept_all")
async def accept_all_contract_review_risks(
    run_id: str,
    user: dict[str, Any] = Depends(require_contract_review_user),
) -> JSONResponse:
    _ = user
    try:
        return legacy_json(contract_review.accept_all_risks(run_id))
    except HTTPException as exc:
        return legacy_business_error(exc)


@router.post("/api/reviews/{run_id}/risks/{risk_id}/ai_apply")
async def apply_contract_review_risk_ai(
    run_id: str,
    risk_id: str,
    user: dict[str, Any] = Depends(require_contract_review_user),
) -> JSONResponse:
    _ = user
    try:
        return legacy_json(contract_review.ai_apply_risk(run_id, risk_id))
    except HTTPException as exc:
        return legacy_business_error(exc)


@router.post("/api/reviews/{run_id}/ai_apply_all")
async def apply_all_contract_review_risk_ai(
    run_id: str,
    user: dict[str, Any] = Depends(require_contract_review_user),
) -> JSONResponse:
    _ = user
    try:
        return legacy_json(contract_review.ai_apply_all_risks(run_id))
    except HTTPException as exc:
        return legacy_business_error(exc)


@router.post("/api/reviews/{run_id}/risks/{risk_id}/ai_accept")
async def accept_contract_review_risk_ai(
    run_id: str,
    risk_id: str,
    request: Request,
    user: dict[str, Any] = Depends(require_contract_review_user),
) -> JSONResponse:
    _ = user
    try:
        body = await read_legacy_json_body(request)
        payload = contract_review.ai_accept_risk(
            run_id,
            risk_id,
            contract_review.AiAcceptBody(
                revised_text=body.get("revised_text"),
                target_text=body.get("target_text"),
            ),
        )
    except HTTPException as exc:
        return legacy_business_error(exc)
    return legacy_json(payload)


@router.patch("/api/reviews/{run_id}/risks/{risk_id}/ai_edit")
async def edit_contract_review_risk_ai(
    run_id: str,
    risk_id: str,
    request: Request,
    user: dict[str, Any] = Depends(require_contract_review_user),
) -> JSONResponse:
    _ = user
    try:
        body = await read_legacy_json_body(request)
        payload = contract_review.ai_edit_risk(
            run_id,
            risk_id,
            contract_review.AiEditBody(revised_text=str(body.get("revised_text") or "")),
        )
    except HTTPException as exc:
        return legacy_business_error(exc)
    return legacy_json(payload)


@router.post("/api/reviews/{run_id}/risks/{risk_id}/ai_reject")
async def reject_contract_review_risk_ai(
    run_id: str,
    risk_id: str,
    user: dict[str, Any] = Depends(require_contract_review_user),
) -> JSONResponse:
    _ = user
    try:
        return legacy_json(contract_review.ai_reject_risk(run_id, risk_id))
    except HTTPException as exc:
        return legacy_business_error(exc)


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
