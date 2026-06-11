"""Bid generator proxy mounted as /api/v1/bid-generator."""

from __future__ import annotations

import os
from typing import Any

from fastapi import APIRouter, Depends, File, Form, Request, UploadFile
from fastapi.responses import JSONResponse, Response, StreamingResponse

from app.core.deps import get_client_id, get_current_user
from app.core.errors import PlatformError
from app.services import portal_store
from app.services.bid_bidder_pipt_service import normalize_bidder_pipt_payload
from app.services.bid_pipt_compat_service import (
    batch_desensitize_payload,
    desensitize_payload,
    recognize_payload,
    restore_payload,
)
from app.services.bid_generator_service import (
    BidProjectConflict,
    BidProjectNotFound,
    analyze_document_response,
    analyze_node_response,
    batch_create_projects_payload,
    build_scoring_table_payload,
    cancel_task_payload,
    create_project_payload,
    delete_project_payload,
    delete_project_caches_payload,
    delete_template_config_payload,
    extract_bid_attachment_by_block_docx_response,
    extract_bid_attachment_by_block_payload,
    extract_bid_attachment_payload,
    extract_requirements_payload,
    extract_requirements_stream_response,
    export_report_response,
    export_scoring_table_response,
    fill_scoring_row_payload,
    forge_document_response,
    generate_attachment_payload,
    generate_blueprint_payload,
    generate_content_payload,
    generate_content_stream_response,
    generate_outline_payload,
    generate_outline_stream_response,
    generate_template_architecture_payload,
    get_analysis_framework_payload,
    get_analysis_report_payload,
    get_cached_pdf_payload,
    get_diagram_artifact_svg_payload,
    get_extracted_image_by_hash_payload,
    get_extracted_image_payload,
    get_health_payload,
    get_kb_sync_status_payload,
    get_knowledge_documents_payload,
    get_template_config_payload,
    list_kb_sync_jobs_payload,
    list_knowledge_images_payload,
    list_pipt_audit_logs_payload,
    get_project_mappings_payload,
    get_project_doc_blocks_payload,
    get_project_payload,
    get_source_docx_payload,
    get_mermaid_diagram_artifact_payload,
    get_supported_entities_payload,
    get_task_status_payload,
    get_workflow_status_payload,
    list_projects_payload,
    patch_project_payload,
    re_extract_requirements_payload,
    rebuild_locator_payload,
    save_analysis_report_payload,
    start_analyze_task_payload,
    start_content_group_task_payload,
    start_content_rewrite_task_payload,
    start_content_task_payload,
    start_diagram_batch_task_payload,
    start_diagram_task_payload,
    start_extract_task_payload,
    start_group_review_task_payload,
    start_outline_task_payload,
    stream_task_progress_response,
    update_knowledge_image_payload,
    update_global_config_payload,
    update_template_config_payload,
    upload_pdf_payload,
    update_project_payload,
    test_locators_payload,
)
from app.services.business_proxy import proxy_business_request

APP_CODE = "bid-generator"
ALLOW_LEGACY_PROXY_ENV = "BID_GENERATOR_ALLOW_LEGACY_PROXY"

router = APIRouter(prefix="/bid-generator")


def require_bid_generator_user(user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    if not portal_store.can_access_app(user, APP_CODE):
        raise PlatformError(code="PERMISSION_DENIED", message="当前用户没有访问标书生成的权限。", status_code=403)
    return user


def legacy_json(payload: Any, *, status_code: int = 200) -> JSONResponse:
    return JSONResponse(content=payload, status_code=status_code)


def _legacy_fallback_allowed() -> bool:
    return str(os.getenv(ALLOW_LEGACY_PROXY_ENV, "")).strip().lower() in {"1", "true", "yes", "on"}


def _raise_legacy_proxy_blocked(path: str) -> None:
    raise PlatformError(
        code="BID_GENERATOR_LEGACY_PROXY_BLOCKED",
        message="标书生成已迁移到统一后端原生路由，未知路径不会默认转发 legacy。若需临时回滚代理，请显式设置 BID_GENERATOR_ALLOW_LEGACY_PROXY=true。",
        status_code=410,
        details={
            "classification": "legacy_fallback_blocked",
            "route": f"/api/v1/bid-generator/{str(path or '').lstrip('/')}",
            "allow_env": ALLOW_LEGACY_PROXY_ENV,
        },
    )


def file_response(payload: Any) -> Response:
    disposition = "inline" if getattr(payload, "inline", True) else "attachment"
    headers = {
        "Content-Disposition": f'{disposition}; filename="{payload.filename}"',
        "Cache-Control": payload.cache_control,
    }
    extra_headers = getattr(payload, "headers", None)
    if isinstance(extra_headers, dict):
        headers.update(extra_headers)
    return Response(
        content=payload.content,
        media_type=payload.media_type,
        headers=headers,
    )


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


@router.get("/api/config/template")
async def get_bid_generator_template_config(
    template_name: str = "",
    user: dict[str, Any] = Depends(require_bid_generator_user),
) -> JSONResponse:
    _ = user
    return legacy_json(get_template_config_payload(template_name))


@router.put("/api/config/template")
async def update_bid_generator_template_config(
    request: Request,
    user: dict[str, Any] = Depends(require_bid_generator_user),
) -> JSONResponse:
    _ = user
    return legacy_json(await update_template_config_payload(await _read_json_body(request)))


@router.delete("/api/config/template")
async def delete_bid_generator_template_config(
    template_name: str,
    user: dict[str, Any] = Depends(require_bid_generator_user),
) -> JSONResponse:
    _ = user
    return legacy_json(await delete_template_config_payload(template_name))


@router.put("/api/config/global")
async def update_bid_generator_global_config(
    request: Request,
    user: dict[str, Any] = Depends(require_bid_generator_user),
) -> JSONResponse:
    _ = user
    return legacy_json(await update_global_config_payload(await _read_json_body(request)))


@router.post("/api/config/template/generate")
async def generate_bid_generator_template_architecture(
    request: Request,
    user: dict[str, Any] = Depends(require_bid_generator_user),
) -> JSONResponse:
    _ = user
    return legacy_json(await generate_template_architecture_payload(await _read_json_body(request)))


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


@router.post("/api/projects", status_code=201)
async def create_bid_generator_project(
    request: Request,
    user: dict[str, Any] = Depends(require_bid_generator_user),
) -> JSONResponse:
    _ = user
    try:
        return legacy_json(create_project_payload(await _read_json_body(request)), status_code=201)
    except BidProjectConflict:
        return legacy_json({"detail": "项目 ID 已存在"}, status_code=409)


@router.post("/api/projects/batch", status_code=201)
async def batch_create_bid_generator_projects(
    request: Request,
    user: dict[str, Any] = Depends(require_bid_generator_user),
) -> JSONResponse:
    _ = user
    return legacy_json(batch_create_projects_payload(await _read_json_or_list_body(request)), status_code=201)


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


@router.put("/api/projects/{project_id}")
async def update_bid_generator_project(
    project_id: str,
    request: Request,
    user: dict[str, Any] = Depends(require_bid_generator_user),
) -> JSONResponse:
    _ = user
    return legacy_json(update_project_payload(project_id, await _read_json_body(request)))


@router.patch("/api/projects/{project_id}")
async def patch_bid_generator_project(
    project_id: str,
    request: Request,
    user: dict[str, Any] = Depends(require_bid_generator_user),
) -> JSONResponse:
    _ = user
    try:
        return legacy_json(patch_project_payload(project_id, await _read_json_body(request)))
    except BidProjectNotFound:
        return legacy_json({"detail": "项目不存在"}, status_code=404)


@router.delete("/api/projects/{project_id}", status_code=204)
async def delete_bid_generator_project(
    project_id: str,
    user: dict[str, Any] = Depends(require_bid_generator_user),
) -> Response:
    _ = user
    try:
        delete_project_payload(project_id)
    except BidProjectNotFound:
        return legacy_json({"detail": "项目不存在"}, status_code=404)
    return Response(status_code=204)


@router.delete("/api/projects/{project_id}/caches")
async def delete_bid_generator_project_caches(
    project_id: str,
    user: dict[str, Any] = Depends(require_bid_generator_user),
) -> JSONResponse:
    _ = user
    return legacy_json(delete_project_caches_payload(project_id))


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


@router.get("/api/projects/{project_id}/doc-blocks")
async def get_bid_generator_project_doc_blocks(
    project_id: str,
    user: dict[str, Any] = Depends(require_bid_generator_user),
) -> JSONResponse:
    _ = user
    return legacy_json(get_project_doc_blocks_payload(project_id))


@router.post("/api/projects/{project_id}/rebuild-locator")
async def rebuild_bid_generator_project_locator(
    project_id: str,
    file: UploadFile = File(...),
    user: dict[str, Any] = Depends(require_bid_generator_user),
) -> JSONResponse:
    _ = user
    return legacy_json(await rebuild_locator_payload(project_id, file))


@router.post("/api/bid-attachment/extract")
async def extract_bid_generator_attachment(
    request: Request,
    user: dict[str, Any] = Depends(require_bid_generator_user),
) -> JSONResponse:
    _ = user
    return legacy_json(await extract_bid_attachment_payload(await _read_json_body(request)))


@router.get("/api/bid-attachment/test-locators")
async def test_bid_generator_locators(
    project_id: str,
    user: dict[str, Any] = Depends(require_bid_generator_user),
) -> JSONResponse:
    _ = user
    return legacy_json(await test_locators_payload(project_id))


@router.post("/api/bid-attachment/extract-by-block")
async def extract_bid_generator_attachment_by_block(
    request: Request,
    user: dict[str, Any] = Depends(require_bid_generator_user),
) -> JSONResponse:
    _ = user
    return legacy_json(await extract_bid_attachment_by_block_payload(await _read_json_body(request)))


@router.post("/api/bid-attachment/extract-by-block-docx")
async def extract_bid_generator_attachment_by_block_docx(
    request: Request,
    user: dict[str, Any] = Depends(require_bid_generator_user),
) -> Response:
    _ = user
    return file_response(await extract_bid_attachment_by_block_docx_response(await _read_json_body(request)))


@router.get("/api/projects/pdf/{project_id}")
async def get_bid_generator_cached_pdf(
    project_id: str,
    user: dict[str, Any] = Depends(require_bid_generator_user),
) -> Response:
    _ = user
    return file_response(get_cached_pdf_payload(project_id))


@router.post("/api/projects/upload-pdf")
async def upload_bid_generator_pdf(
    file: UploadFile = File(...),
    project_id: str = Form(...),
    user: dict[str, Any] = Depends(require_bid_generator_user),
) -> JSONResponse:
    _ = user
    return legacy_json(
        upload_pdf_payload(
            project_id,
            filename=file.filename or "",
            content=await file.read(),
        )
    )


@router.post("/api/projects/extract")
async def extract_bid_generator_requirements(
    file: UploadFile = File(...),
    project_name: str = Form(default=""),
    project_id: str = Form(default=""),
    enable_desensitize: bool = Form(default=True),
    desensitize_profile: str = Form(default="tender"),
    use_vision_parsing: bool = Form(default=False),
    user: dict[str, Any] = Depends(require_bid_generator_user),
) -> JSONResponse:
    _ = user
    return legacy_json(
        await extract_requirements_payload(
            file,
            project_name=project_name,
            project_id=project_id,
            enable_desensitize=enable_desensitize,
            desensitize_profile=desensitize_profile,
            use_vision_parsing=use_vision_parsing,
        )
    )


@router.post("/api/projects/extract-stream")
async def extract_bid_generator_requirements_stream(
    file: UploadFile = File(...),
    project_name: str = Form(default=""),
    project_id: str = Form(default=""),
    enable_desensitize: bool = Form(default=True),
    desensitize_profile: str = Form(default="tender"),
    use_vision_parsing: bool = Form(default=False),
    user: dict[str, Any] = Depends(require_bid_generator_user),
) -> StreamingResponse:
    _ = user
    return await extract_requirements_stream_response(
        file,
        project_name=project_name,
        project_id=project_id,
        enable_desensitize=enable_desensitize,
        desensitize_profile=desensitize_profile,
        use_vision_parsing=use_vision_parsing,
    )


@router.post("/api/projects/re-extract")
async def re_extract_bid_generator_requirements(
    request: Request,
    user: dict[str, Any] = Depends(require_bid_generator_user),
) -> JSONResponse:
    _ = user
    return legacy_json(await re_extract_requirements_payload(await _read_json_body(request)))


@router.get("/api/projects/{project_id}/source-docx")
async def get_bid_generator_source_docx(
    project_id: str,
    user: dict[str, Any] = Depends(require_bid_generator_user),
) -> Response:
    _ = user
    return file_response(get_source_docx_payload(project_id))


@router.post("/api/projects/export-report")
async def export_bid_generator_report(
    request: Request,
    user: dict[str, Any] = Depends(require_bid_generator_user),
) -> Response:
    _ = user
    return await export_report_response(await _read_json_body(request))


@router.post("/api/projects/export-scoring-table")
async def export_bid_generator_scoring_table(
    request: Request,
    user: dict[str, Any] = Depends(require_bid_generator_user),
) -> Response:
    _ = user
    return file_response(await export_scoring_table_response(await _read_json_body(request)))


@router.post("/api/projects/forge-document")
async def forge_bid_generator_document(
    request: Request,
    user: dict[str, Any] = Depends(require_bid_generator_user),
) -> Response:
    _ = user
    return await forge_document_response(await _read_json_body(request))


@router.post("/api/projects/generate-outline")
async def generate_bid_generator_outline(
    request: Request,
    user: dict[str, Any] = Depends(require_bid_generator_user),
) -> JSONResponse:
    _ = user
    return legacy_json(await generate_outline_payload(await _read_json_body(request)))


@router.post("/api/projects/generate-outline-stream")
async def generate_bid_generator_outline_stream(
    request: Request,
    user: dict[str, Any] = Depends(require_bid_generator_user),
) -> StreamingResponse:
    _ = user
    return await generate_outline_stream_response(await _read_json_body(request))


@router.post("/api/projects/generate-content")
async def generate_bid_generator_content(
    request: Request,
    user: dict[str, Any] = Depends(require_bid_generator_user),
) -> JSONResponse:
    _ = user
    return legacy_json(await generate_content_payload(await _read_json_body(request)))


@router.post("/api/projects/generate-content-stream")
async def generate_bid_generator_content_stream(
    request: Request,
    user: dict[str, Any] = Depends(require_bid_generator_user),
) -> StreamingResponse:
    _ = user
    return await generate_content_stream_response(await _read_json_body(request))


@router.post("/api/projects/generate-attachment")
async def generate_bid_generator_attachment(
    request: Request,
    user: dict[str, Any] = Depends(require_bid_generator_user),
) -> JSONResponse:
    _ = user
    return legacy_json(await generate_attachment_payload(await _read_json_body(request)))


@router.post("/api/projects/build-scoring-table")
async def build_bid_generator_scoring_table(
    request: Request,
    user: dict[str, Any] = Depends(require_bid_generator_user),
) -> JSONResponse:
    _ = user
    return legacy_json(await build_scoring_table_payload(await _read_json_body(request)))


@router.post("/api/projects/fill-scoring-row")
async def fill_bid_generator_scoring_row(
    request: Request,
    user: dict[str, Any] = Depends(require_bid_generator_user),
) -> JSONResponse:
    _ = user
    return legacy_json(await fill_scoring_row_payload(await _read_json_body(request)))


@router.post("/api/projects/generate-blueprint")
async def generate_bid_generator_blueprint(
    request: Request,
    user: dict[str, Any] = Depends(require_bid_generator_user),
) -> JSONResponse:
    _ = user
    return legacy_json(await generate_blueprint_payload(await _read_json_body(request)))


@router.get("/api/extracted-images/by-hash/{image_hash}")
async def get_bid_generator_extracted_image_by_hash(
    image_hash: str,
    user: dict[str, Any] = Depends(require_bid_generator_user),
) -> Response:
    _ = user
    return file_response(get_extracted_image_by_hash_payload(image_hash))


@router.get("/api/extracted-images/{filename}")
async def get_bid_generator_extracted_image(
    filename: str,
    user: dict[str, Any] = Depends(require_bid_generator_user),
) -> Response:
    _ = user
    return file_response(get_extracted_image_payload(filename))


@router.get("/api/diagram-artifacts/{diagram_id}.svg")
async def get_bid_generator_diagram_artifact_svg(
    diagram_id: str,
    project_id: str = "",
    user: dict[str, Any] = Depends(require_bid_generator_user),
) -> Response:
    _ = user
    return file_response(get_diagram_artifact_svg_payload(diagram_id, project_id=project_id))


@router.get("/api/diagram-artifacts/{diagram_id}.mmd")
async def get_bid_generator_mermaid_diagram_artifact(
    diagram_id: str,
    project_id: str = "",
    user: dict[str, Any] = Depends(require_bid_generator_user),
) -> Response:
    _ = user
    return file_response(get_mermaid_diagram_artifact_payload(diagram_id, project_id=project_id))


@router.get("/api/knowledge/images")
async def list_bid_generator_knowledge_images(
    source_doc: str = "",
    caption_status: str = "",
    limit: int = 200,
    user: dict[str, Any] = Depends(require_bid_generator_user),
) -> JSONResponse:
    _ = user
    return legacy_json(
        list_knowledge_images_payload(
            source_doc=source_doc,
            caption_status=caption_status,
            limit=limit,
        )
    )


@router.patch("/api/knowledge/images/{image_hash}")
async def update_bid_generator_knowledge_image(
    image_hash: str,
    request: Request,
    user: dict[str, Any] = Depends(require_bid_generator_user),
) -> JSONResponse:
    _ = user
    return legacy_json(update_knowledge_image_payload(image_hash, await _read_json_body(request)))


@router.get("/api/knowledge/documents")
async def get_bid_generator_knowledge_documents(
    user: dict[str, Any] = Depends(require_bid_generator_user),
) -> JSONResponse:
    _ = user
    return legacy_json(await get_knowledge_documents_payload())


@router.get("/api/kb/sync-jobs")
async def list_bid_generator_kb_sync_jobs(
    user: dict[str, Any] = Depends(require_bid_generator_user),
) -> JSONResponse:
    _ = user
    return legacy_json(list_kb_sync_jobs_payload())


@router.get("/api/kb/sync-status/{job_id}")
async def get_bid_generator_kb_sync_status(
    job_id: str,
    user: dict[str, Any] = Depends(require_bid_generator_user),
) -> JSONResponse:
    _ = user
    return legacy_json(get_kb_sync_status_payload(job_id))


@router.get("/api/tasks/{task_id}/status")
async def get_bid_generator_task_status(
    task_id: str,
    project_id: str | None = None,
    after_event_id: int = 0,
    user: dict[str, Any] = Depends(require_bid_generator_user),
) -> JSONResponse:
    _ = user
    return legacy_json(
        get_task_status_payload(
            task_id,
            project_id=project_id,
            after_event_id=after_event_id,
        )
    )


@router.post("/api/tasks/start-outline")
async def start_bid_generator_outline_task(
    request: Request,
    user: dict[str, Any] = Depends(require_bid_generator_user),
) -> JSONResponse:
    _ = user
    return legacy_json(await start_outline_task_payload(await _read_json_body(request)))


@router.post("/api/tasks/start-extract")
async def start_bid_generator_extract_task(
    file: UploadFile = File(...),
    project_name: str = Form(default=""),
    project_id: str = Form(default=""),
    enable_desensitize: bool = Form(default=True),
    desensitize_profile: str = Form(default="tender"),
    use_vision_parsing: bool = Form(default=False),
    user: dict[str, Any] = Depends(require_bid_generator_user),
) -> JSONResponse:
    _ = user
    return legacy_json(
        await start_extract_task_payload(
            file,
            project_name=project_name,
            project_id=project_id,
            enable_desensitize=enable_desensitize,
            desensitize_profile=desensitize_profile,
            use_vision_parsing=use_vision_parsing,
        )
    )


@router.post("/api/tasks/start-content")
async def start_bid_generator_content_task(
    request: Request,
    user: dict[str, Any] = Depends(require_bid_generator_user),
) -> JSONResponse:
    _ = user
    return legacy_json(await start_content_task_payload(await _read_json_body(request)))


@router.post("/api/tasks/start-content-rewrite")
async def start_bid_generator_content_rewrite_task(
    request: Request,
    user: dict[str, Any] = Depends(require_bid_generator_user),
) -> JSONResponse:
    _ = user
    return legacy_json(await start_content_rewrite_task_payload(await _read_json_body(request)))


@router.post("/api/tasks/start-content-group")
async def start_bid_generator_content_group_task(
    request: Request,
    user: dict[str, Any] = Depends(require_bid_generator_user),
) -> JSONResponse:
    _ = user
    return legacy_json(await start_content_group_task_payload(await _read_json_body(request)))


@router.post("/api/tasks/start-group-review")
async def start_bid_generator_group_review_task(
    request: Request,
    user: dict[str, Any] = Depends(require_bid_generator_user),
) -> JSONResponse:
    _ = user
    return legacy_json(await start_group_review_task_payload(await _read_json_body(request)))


@router.post("/api/tasks/start-diagram")
async def start_bid_generator_diagram_task(
    request: Request,
    user: dict[str, Any] = Depends(require_bid_generator_user),
) -> JSONResponse:
    _ = user
    return legacy_json(await start_diagram_task_payload(await _read_json_body(request)))


@router.post("/api/tasks/start-diagram-batch")
async def start_bid_generator_diagram_batch_task(
    request: Request,
    user: dict[str, Any] = Depends(require_bid_generator_user),
) -> JSONResponse:
    _ = user
    return legacy_json(await start_diagram_batch_task_payload(await _read_json_body(request)))


@router.post("/api/tasks/start-analyze")
async def start_bid_generator_analyze_task(
    raw_document: str = Form(default=""),
    project_id: str = Form(default=""),
    selected_node_ids: str = Form(default=""),
    user: dict[str, Any] = Depends(require_bid_generator_user),
) -> JSONResponse:
    _ = user
    return legacy_json(
        await start_analyze_task_payload(
            raw_document=raw_document,
            project_id=project_id,
            selected_node_ids=selected_node_ids,
        )
    )


@router.post("/api/tasks/{task_id}/cancel")
async def cancel_bid_generator_task(
    task_id: str,
    project_id: str | None = None,
    user: dict[str, Any] = Depends(require_bid_generator_user),
) -> JSONResponse:
    _ = user
    return legacy_json(await cancel_task_payload(task_id, project_id=project_id))


@router.get("/api/tasks/{task_id}/progress")
async def stream_bid_generator_task_progress(
    task_id: str,
    request: Request,
    project_id: str | None = None,
    user: dict[str, Any] = Depends(require_bid_generator_user),
) -> StreamingResponse:
    _ = user
    return await stream_task_progress_response(task_id, request, project_id=project_id)


@router.post("/api/projects/analyze")
async def analyze_bid_generator_document(
    raw_document: str = Form(default=""),
    project_id: str = Form(default=""),
    selected_node_ids: str = Form(default=""),
    user: dict[str, Any] = Depends(require_bid_generator_user),
) -> StreamingResponse:
    _ = user
    return await analyze_document_response(
        raw_document=raw_document,
        project_id=project_id,
        selected_node_ids=selected_node_ids,
    )


@router.post("/api/projects/{project_id}/analyze-node")
async def analyze_bid_generator_node(
    project_id: str,
    request: Request,
    user: dict[str, Any] = Depends(require_bid_generator_user),
) -> StreamingResponse:
    _ = user
    return await analyze_node_response(project_id, await _read_json_body(request))


@router.post("/api/projects/{project_id}/analysis-report")
async def save_bid_generator_analysis_report(
    project_id: str,
    request: Request,
    user: dict[str, Any] = Depends(require_bid_generator_user),
) -> JSONResponse:
    _ = user
    return legacy_json(save_analysis_report_payload(project_id, await _read_json_body(request)))


@router.get("/api/projects/{project_id}/analysis-report")
async def get_bid_generator_analysis_report(
    project_id: str,
    user: dict[str, Any] = Depends(require_bid_generator_user),
) -> JSONResponse:
    _ = user
    return legacy_json(get_analysis_report_payload(project_id))


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


@router.post("/api/recognize")
async def recognize_bid_generator_pipt(
    request: Request,
    user: dict[str, Any] = Depends(require_bid_generator_user),
) -> JSONResponse:
    _ = user
    return legacy_json(recognize_payload(await _read_json_body(request)))


@router.post("/api/desensitize")
async def desensitize_bid_generator_pipt(
    request: Request,
    user: dict[str, Any] = Depends(require_bid_generator_user),
) -> JSONResponse:
    _ = user
    return legacy_json(desensitize_payload(await _read_json_body(request)))


@router.post("/api/desensitize/batch")
async def batch_desensitize_bid_generator_pipt(
    request: Request,
    user: dict[str, Any] = Depends(require_bid_generator_user),
) -> JSONResponse:
    _ = user
    return legacy_json(batch_desensitize_payload(await _read_json_body(request)))


@router.post("/api/restore")
async def restore_bid_generator_pipt(
    request: Request,
    user: dict[str, Any] = Depends(require_bid_generator_user),
) -> JSONResponse:
    _ = user
    return legacy_json(restore_payload(await _read_json_body(request)))


@router.post("/api/bidder/normalize-pipt")
async def normalize_bid_generator_bidder_pipt(
    request: Request,
    user: dict[str, Any] = Depends(require_bid_generator_user),
) -> JSONResponse:
    _ = user
    return legacy_json(normalize_bidder_pipt_payload(await _read_json_body(request)))


async def _read_json_body(request: Request) -> dict[str, Any]:
    try:
        body = await request.json()
    except Exception:
        return {}
    return body if isinstance(body, dict) else {}


async def _read_json_or_list_body(request: Request) -> Any:
    try:
        return await request.json()
    except Exception:
        return []


@router.api_route("", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"])
@router.api_route("/", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"])
async def empty_proxy_path(
    request: Request,
    user: dict[str, Any] = Depends(require_bid_generator_user),
    client_id: str = Depends(get_client_id),
) -> StreamingResponse:
    if not _legacy_fallback_allowed():
        _raise_legacy_proxy_blocked("")
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
    if not _legacy_fallback_allowed():
        _raise_legacy_proxy_blocked(path)
    return await proxy_business_request(
        request=request,
        app_code=APP_CODE,
        path=path,
        user=user,
        client_id=client_id,
    )
