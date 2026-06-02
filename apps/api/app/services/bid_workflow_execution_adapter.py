from __future__ import annotations

import importlib
import threading
from types import ModuleType
from typing import Any, Mapping

from fastapi import HTTPException

from app.core.errors import PlatformError
from app.services.bid_task_execution_adapter import ensure_legacy_runtime


_IMPORT_LOCK = threading.RLock()
_LEGACY_MODULES: dict[str, ModuleType] = {}


async def generate_template_architecture_payload(body: Mapping[str, Any]) -> dict[str, Any]:
    """
    调用 legacy 模板结构生成。

    该能力暂时保留在 legacy：
    - 现网仍依赖 legacy `config.yaml` 中的 `dify.api_key`
    - 统一后端其它大纲链路已切到 `.env` / `DIFY_WORKFLOW_STRUCTURE_GENERATOR`
    这是凭据权威来源冲突，当前不做静默迁移。
    """
    response = await _call_legacy_route_response(
        getattr(_legacy_routes(), "generate_template_architecture"),
        _legacy_schema_model("GenerateStructureRequest", body),
        error_code="TEMPLATE_GENERATE_FAILED",
    )
    return _legacy_json_payload(response)


async def forge_document_response(body: Mapping[str, Any]) -> Any:
    """
    调用 legacy DOCX 组装导出；保持 legacy 二进制响应对象。

    该能力暂时保留在 legacy：
    - 依赖 legacy EntityRegistry / FernetEncryptor / placeholder protocol
    - 依赖 ImageRegistry / gateway-out / docxcompose
    当前不做静默迁移。
    """
    routes = _legacy_routes()
    request_model = getattr(routes, "_ForgeDocumentRequest")
    return await _call_legacy_route_response(
        getattr(routes, "forge_document"),
        request_model(**_json_object_body(body)),
        error_code="FORGE_FAILED",
    )


async def export_report_response(body: Mapping[str, Any]) -> Any:
    """
    调用 legacy 解析报告 PDF 导出；保持 legacy 二进制响应对象。

    该能力暂时保留在 legacy：
    - 依赖 WeasyPrint
    - 与当前 Python 3.10 slim 容器目标存在运行时依赖冲突
    当前不做静默迁移。
    """
    routes = _legacy_routes()
    request_model = getattr(routes, "_ExportReportRequest")
    return await _call_legacy_route_response(
        getattr(routes, "export_report_pdf"),
        request_model(**_json_object_body(body)),
        error_code="EXPORT_FAILED",
    )


def _legacy_routes() -> ModuleType:
    return _ensure_legacy_imported("app.api_lite.routes")


def _legacy_schemas() -> ModuleType:
    return _ensure_legacy_imported("app.api_lite.schemas")


async def _call_legacy_route_response(route: Any, *args: Any, error_code: str, **kwargs: Any) -> Any:
    try:
        return await route(*args, **kwargs)
    except HTTPException as exc:
        detail = exc.detail if isinstance(exc.detail, str) else "legacy 路由调用失败"
        if exc.status_code == 400:
            raise PlatformError(code="INVALID_REQUEST", message=detail, status_code=400) from exc
        if exc.status_code == 403:
            raise PlatformError(code="PERMISSION_DENIED", message=detail, status_code=403) from exc
        if exc.status_code == 404:
            raise PlatformError(code="RESOURCE_NOT_FOUND", message=detail, status_code=404) from exc
        raise PlatformError(code=error_code, message=detail, status_code=exc.status_code) from exc


def _legacy_schema_model(model_name: str, body: Mapping[str, Any]) -> Any:
    model = getattr(_legacy_schemas(), model_name)
    try:
        return model(**_json_object_body(body))
    except Exception as exc:
        raise PlatformError(code="INVALID_REQUEST", message=f"{model_name} 请求体无效: {exc}", status_code=400) from exc


def _legacy_json_payload(value: Any) -> dict[str, Any]:
    converted = _model_or_mapping_to_dict(value)
    return converted if isinstance(converted, dict) else {"data": converted}


def _json_object_body(body: Mapping[str, Any]) -> dict[str, Any]:
    return dict(body) if isinstance(body, Mapping) else {}


def _model_or_mapping_to_dict(value: Any) -> dict[str, Any]:
    if isinstance(value, Mapping):
        return dict(value)
    model_dump = getattr(value, "model_dump", None)
    if callable(model_dump):
        dumped = model_dump()
        return dict(dumped) if isinstance(dumped, Mapping) else {"data": dumped}
    legacy_dict = getattr(value, "dict", None)
    if callable(legacy_dict):
        dumped = legacy_dict()
        return dict(dumped) if isinstance(dumped, Mapping) else {"data": dumped}
    return {"data": value}


def _ensure_legacy_imported(name: str) -> ModuleType:
    module = _LEGACY_MODULES.get(name)
    if module is not None:
        return module
    with _IMPORT_LOCK:
        module = _LEGACY_MODULES.get(name)
        if module is not None:
            return module
        ensure_legacy_runtime()
        imported = importlib.import_module(name)
        _LEGACY_MODULES[name] = imported
        return imported
