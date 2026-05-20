from __future__ import annotations

from typing import Any

from app.core.config import get_api_settings
from packages.py_common.apps import iter_ordered_apps
from packages.py_common.config.loader import load_apps_config


def _safe_dev(dev: dict[str, Any]) -> dict[str, Any]:
    return {
        "kind": str(dev.get("kind") or ""),
        "enabled": bool(dev.get("enabled", False)),
    }


def _safe_module(app: dict[str, Any]) -> dict[str, Any]:
    dev = app.get("dev") or {}
    return {
        "code": str(app.get("code") or ""),
        "module_key": str(app.get("module_key") or ""),
        "name": app.get("name") or "",
        "description": app.get("description") or "",
        "enabled": bool(app.get("enabled", True)),
        "route_path": app.get("route_path") or "",
        "target_api_prefix": app.get("target_api_prefix") or "",
        "iframe_enabled": bool(app.get("iframe_enabled", False)),
        "permission_default": bool(app.get("permission_default", False)),
        "dev": _safe_dev(dev if isinstance(dev, dict) else {}),
        "legacy_health_check": app.get("legacy_health_check") or "",
        "storage_namespace": app.get("storage_namespace") or "",
    }


def get_safe_modules() -> list[dict[str, Any]]:
    apps_config = load_apps_config(get_api_settings().repo_root)
    return [_safe_module(app) for _, app in iter_ordered_apps(apps_config)]

