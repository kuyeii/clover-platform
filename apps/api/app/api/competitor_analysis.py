from __future__ import annotations

import json
import asyncio
import threading
from queue import Full, Queue
from typing import Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse

from app.core.deps import get_client_id, get_current_user
from app.core.errors import PlatformError
from app.services import portal_store
from app.services.business_proxy import proxy_business_request
from app.services.competitor_analysis_service import (
    AppError,
    CompetitorAnalysisBadRequest,
    clear_history_records,
    delete_history_record,
    read_history_record_by_id,
    read_history_records,
    run_company_detail_workflow,
    run_company_name_validation_workflow,
    run_compare_report_workflow,
    run_full_analysis,
    run_full_analysis_stream,
    run_input_validation_workflow,
    run_score_workflow,
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


def legacy_error(exc: Exception, *, fallback_message: str, status_code: int | None = None) -> JSONResponse:
    status = int(status_code or getattr(exc, "status_code", 500) or 500)
    message = getattr(exc, "message", None) or str(exc) or fallback_message
    code = getattr(exc, "code", "ERROR") or "ERROR"
    return legacy_json({"message": message, "code": code}, status_code=status)


def ensure_legacy_body_mapping(body: Any) -> dict[str, Any]:
    if body is None:
        return {}
    if not isinstance(body, dict):
        raise CompetitorAnalysisBadRequest("请求体必须为对象")
    return body


def ndjson_line(event_type: str, data: Any) -> bytes:
    return (json.dumps({"type": event_type, "data": data}, ensure_ascii=False) + "\n").encode("utf-8")


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


@router.post("/api/analysis")
async def run_competitor_analysis(
    request: Request,
    user: dict[str, Any] = Depends(require_competitor_analysis_user),
) -> JSONResponse:
    _ = user
    try:
        body = ensure_legacy_body_mapping(await read_legacy_json_body(request))
        record = run_full_analysis(**body)
        save_history_record(record)
    except CompetitorAnalysisBadRequest as exc:
        return legacy_error(exc, fallback_message="分析失败")
    except AppError as exc:
        return legacy_error(exc, fallback_message="分析失败")
    return legacy_json({"ok": True, "item": record, "warnings": record.get("warnings") or []}, status_code=201)


async def stream_analysis_events(body: dict[str, Any]):
    queue: Queue[bytes | None] = Queue(maxsize=100)
    closed = threading.Event()

    def enqueue(item: bytes | None) -> bool:
        while not closed.is_set():
            try:
                queue.put(item, timeout=0.5)
                return True
            except Full:
                continue
        return False

    def emit(event_type: str, data: Any) -> None:
        if closed.is_set() or not enqueue(ndjson_line(event_type, data)):
            raise BrokenPipeError()

    def worker() -> None:
        try:
            run_full_analysis_stream(emit, **body)
        except BrokenPipeError:
            return
        except Exception as exc:
            if not closed.is_set():
                enqueue(
                    ndjson_line(
                        "analysis_error",
                        {"message": getattr(exc, "message", str(exc)) or "分析失败"},
                    )
                )
        finally:
            if not closed.is_set():
                enqueue(None)

    thread = threading.Thread(target=worker, daemon=True)
    thread.start()
    try:
        while True:
            item = await asyncio.to_thread(queue.get)
            if item is None:
                break
            yield item
    except asyncio.CancelledError:
        closed.set()
        raise


@router.post("/api/analysis/stream")
async def stream_competitor_analysis(
    request: Request,
    user: dict[str, Any] = Depends(require_competitor_analysis_user),
) -> Response:
    _ = user
    try:
        body = ensure_legacy_body_mapping(await read_legacy_json_body(request))
    except CompetitorAnalysisBadRequest as exc:
        return legacy_error(exc, fallback_message="分析失败")

    return StreamingResponse(
        stream_analysis_events(body),
        media_type="application/x-ndjson; charset=utf-8",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/api/workflows/validate")
async def validate_competitor_analysis_input(
    request: Request,
    user: dict[str, Any] = Depends(require_competitor_analysis_user),
) -> JSONResponse:
    _ = user
    try:
        body = ensure_legacy_body_mapping(await read_legacy_json_body(request))
        return legacy_json(run_input_validation_workflow(**body))
    except (CompetitorAnalysisBadRequest, AppError) as exc:
        return legacy_error(exc, fallback_message="输入校验失败")


@router.post("/api/workflows/company-name-validate")
async def validate_competitor_analysis_company_name(
    request: Request,
    user: dict[str, Any] = Depends(require_competitor_analysis_user),
) -> JSONResponse:
    _ = user
    try:
        body = ensure_legacy_body_mapping(await read_legacy_json_body(request))
        return legacy_json(run_company_name_validation_workflow(**body))
    except (CompetitorAnalysisBadRequest, AppError) as exc:
        return legacy_error(exc, fallback_message="企业名称输入校验失败")


@router.post("/api/workflows/company-detail")
async def get_competitor_analysis_company_detail(
    request: Request,
    user: dict[str, Any] = Depends(require_competitor_analysis_user),
) -> JSONResponse:
    _ = user
    try:
        body = ensure_legacy_body_mapping(await read_legacy_json_body(request))
        return legacy_json(run_company_detail_workflow(**body))
    except (CompetitorAnalysisBadRequest, AppError) as exc:
        return legacy_error(exc, fallback_message="企业详情请求失败")


@router.post("/api/workflows/compare-report")
async def get_competitor_analysis_compare_report(
    request: Request,
    user: dict[str, Any] = Depends(require_competitor_analysis_user),
) -> JSONResponse:
    _ = user
    try:
        body = ensure_legacy_body_mapping(await read_legacy_json_body(request))
        return legacy_json(run_compare_report_workflow(**body))
    except (CompetitorAnalysisBadRequest, AppError) as exc:
        return legacy_error(exc, fallback_message="对比报告请求失败")


@router.post("/api/workflows/score")
async def get_competitor_analysis_score(
    request: Request,
    user: dict[str, Any] = Depends(require_competitor_analysis_user),
) -> JSONResponse:
    _ = user
    try:
        body = ensure_legacy_body_mapping(await read_legacy_json_body(request))
        return legacy_json(run_score_workflow(**body))
    except (CompetitorAnalysisBadRequest, AppError) as exc:
        return legacy_error(exc, fallback_message="评分请求失败")


@router.get("/api/health")
async def get_competitor_analysis_health(
    user: dict[str, Any] = Depends(require_competitor_analysis_user),
) -> JSONResponse:
    _ = user
    return legacy_json({"ok": True, "service": "competitor-analysis-backend"})


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
