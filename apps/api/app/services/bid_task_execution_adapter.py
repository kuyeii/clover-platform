from __future__ import annotations

import importlib
import os
import sys
import threading
from types import ModuleType
from typing import Any

from fastapi import HTTPException

from app.core.config import get_api_settings
from app.core.errors import PlatformError


_IMPORT_LOCK = threading.RLock()
_LEGACY_MODULES: dict[str, ModuleType] = {}


def ensure_legacy_runtime() -> None:
    """准备 legacy 执行引擎命名空间；仅供任务执行 adapter 按需使用。"""
    repo_root = get_api_settings().repo_root
    legacy_root = repo_root / "legacy" / "bid-generator"
    pipt_root = legacy_root / "pipt-flask"
    os.environ.setdefault("PRO_ENGINE_ROOT", str(legacy_root))
    os.environ.setdefault("PIPT_ROOT", str(pipt_root))
    import app as platform_app

    legacy_app_path = str(pipt_root / "app")
    if legacy_app_path not in platform_app.__path__:
        platform_app.__path__.append(legacy_app_path)
    for source_root in (legacy_root / "gateway-out" / "src", legacy_root / "dify-bridge" / "src"):
        if source_root.is_dir() and str(source_root.parent) not in sys.path:
            sys.path.insert(0, str(source_root.parent))


def legacy_task_manager() -> Any:
    return _ensure_legacy_imported("app.api_lite.task_manager").task_manager


async def call_legacy_task_route(
    route_name: str,
    *args: Any,
    error_code: str = "LEGACY_TASK_ROUTE_FAILED",
    **kwargs: Any,
) -> dict[str, Any]:
    """调用尚未迁出的 legacy 任务启动函数；入参透传，出参归一为 dict。"""
    task_routes = _ensure_legacy_imported("app.api_lite.task_routes")
    route = getattr(task_routes, route_name)
    try:
        payload = await route(*args, **kwargs)
    except HTTPException as exc:
        detail = exc.detail if isinstance(exc.detail, str) else "任务路由调用失败"
        if exc.status_code == 400:
            raise PlatformError(code="INVALID_REQUEST", message=detail, status_code=400) from exc
        if exc.status_code == 403:
            raise PlatformError(code="PERMISSION_DENIED", message=detail, status_code=403) from exc
        if exc.status_code == 404:
            raise PlatformError(code="RESOURCE_NOT_FOUND", message=detail, status_code=404) from exc
        raise PlatformError(code=error_code, message=detail, status_code=exc.status_code) from exc
    return payload if isinstance(payload, dict) else {"data": payload}


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
