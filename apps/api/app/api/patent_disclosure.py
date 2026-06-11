from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, File, Form, Query, Request, UploadFile
from fastapi.responses import StreamingResponse

from app.core.deps import get_current_user
from app.core.errors import PlatformError
from app.schemas.patent_disclosure import GenerateDisclosureRequest, PatentCaseCreate, ReviseDisclosureRequest
from app.services import portal_store
from app.services.patent_disclosure_service import APP_CODE, get_patent_disclosure_service

router = APIRouter(prefix="/patent-disclosure")


def require_patent_disclosure_user(user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    if not portal_store.can_access_app(user, APP_CODE):
        raise PlatformError(
            code="PATENT_PERMISSION_DENIED",
            message="当前用户没有访问专利交底书模块的权限。",
            status_code=403,
        )
    return user


def _current_user_for_sse(request: Request, access_token: str | None) -> dict[str, Any]:
    if access_token:
        authorization = f"Bearer {access_token}"
    else:
        authorization = request.headers.get("Authorization")
    user = get_current_user(authorization)
    if not portal_store.can_access_app(user, APP_CODE):
        raise PlatformError(
            code="PATENT_PERMISSION_DENIED",
            message="当前用户没有访问专利交底书模块的权限。",
            status_code=403,
        )
    return user


@router.get("/api/health")
async def get_patent_disclosure_health(
    user: dict[str, Any] = Depends(require_patent_disclosure_user),
) -> dict[str, Any]:
    _ = user
    return get_patent_disclosure_service().health()


@router.post("/api/cases")
async def create_patent_case(
    payload: PatentCaseCreate,
    user: dict[str, Any] = Depends(require_patent_disclosure_user),
) -> dict[str, Any]:
    return get_patent_disclosure_service().create_case(user, payload.model_dump())


@router.get("/api/cases")
async def list_patent_cases(
    limit: int = Query(default=30, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    user: dict[str, Any] = Depends(require_patent_disclosure_user),
) -> dict[str, Any]:
    return get_patent_disclosure_service().list_cases(user, limit=limit, offset=offset)


@router.get("/api/cases/{case_id}")
async def get_patent_case_detail(
    case_id: str,
    user: dict[str, Any] = Depends(require_patent_disclosure_user),
) -> dict[str, Any]:
    return get_patent_disclosure_service().get_case_detail(user, case_id)


@router.get("/api/cases/{case_id}/materials")
async def list_patent_case_materials(
    case_id: str,
    user: dict[str, Any] = Depends(require_patent_disclosure_user),
) -> dict[str, Any]:
    return get_patent_disclosure_service().list_materials(user, case_id)


@router.post("/api/cases/{case_id}/materials")
async def upload_patent_case_materials(
    case_id: str,
    files: list[UploadFile] = File(...),
    materialType: str = Form(default="source"),
    user: dict[str, Any] = Depends(require_patent_disclosure_user),
) -> dict[str, Any]:
    return get_patent_disclosure_service().upload_materials(
        user,
        case_id=case_id,
        files=files,
        material_type=materialType,
    )


@router.delete("/api/materials/{material_id}")
async def delete_patent_material(
    material_id: str,
    user: dict[str, Any] = Depends(require_patent_disclosure_user),
) -> dict[str, Any]:
    return get_patent_disclosure_service().delete_material(user, material_id)


@router.post("/api/cases/{case_id}/generate")
async def start_patent_generation(
    case_id: str,
    payload: GenerateDisclosureRequest,
    user: dict[str, Any] = Depends(require_patent_disclosure_user),
) -> dict[str, Any]:
    return get_patent_disclosure_service().start_generation(user, case_id, payload.model_dump())


@router.post("/api/cases/{case_id}/revise")
async def start_patent_revision(
    case_id: str,
    payload: ReviseDisclosureRequest,
    user: dict[str, Any] = Depends(require_patent_disclosure_user),
) -> dict[str, Any]:
    return get_patent_disclosure_service().start_revision(user, case_id, payload.model_dump())


@router.get("/api/jobs/{job_id}")
async def get_patent_job(
    job_id: str,
    user: dict[str, Any] = Depends(require_patent_disclosure_user),
) -> dict[str, Any]:
    return get_patent_disclosure_service().get_job(user, job_id)


@router.get("/api/jobs/{job_id}/stream")
async def stream_patent_job(
    request: Request,
    job_id: str,
    access_token: str | None = Query(default=None),
) -> StreamingResponse:
    user = _current_user_for_sse(request, access_token)
    service = get_patent_disclosure_service()
    service.get_job(user, job_id)
    return StreamingResponse(
        service.stream_job_events(user, job_id),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/api/cases/{case_id}/artifacts")
async def list_patent_artifacts(
    case_id: str,
    scope: str = Query(default="latest", pattern="^(latest|all)$"),
    user: dict[str, Any] = Depends(require_patent_disclosure_user),
) -> dict[str, Any]:
    return get_patent_disclosure_service().list_artifacts(user, case_id, scope=scope)


@router.get("/api/artifacts/{artifact_id}/download")
async def download_patent_artifact(
    artifact_id: str,
    user: dict[str, Any] = Depends(require_patent_disclosure_user),
):
    return get_patent_disclosure_service().download_artifact(user, artifact_id)
