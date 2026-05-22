from __future__ import annotations

from typing import Any

from app.core.config import get_api_settings
from packages.py_common.apps import iter_ordered_apps
from packages.py_common.config.loader import load_apps_config
from packages.py_common.runtime import read_ports_file


def _int_config(value: Any) -> int | None:
    if value is None or value == "":
        return None
    try:
        port = int(value)
    except (TypeError, ValueError):
        return None
    return port if port > 0 else None


def _localhost_url(port: int) -> str:
    return f"http://127.0.0.1:{port}"


def _dev_mode(dev: dict[str, Any]) -> str:
    return "auto" if bool(dev.get("enabled", False)) else "manual"


def _fallback_app_payload(app: dict[str, Any]) -> dict[str, Any] | None:
    if not app.get("iframe_enabled", False):
        return None

    dev = app.get("dev") or {}
    frontend_port = _int_config(dev.get("frontend_preferred_port")) or _int_config(dev.get("preferred_port"))
    if frontend_port is None:
        return None

    iframe_url = _localhost_url(frontend_port)
    return {
        "code": app.get("code"),
        "name": app.get("name"),
        "routePath": app.get("route_path") or "",
        "frontendUrl": iframe_url,
        "backendUrl": "",
        "iframeUrl": iframe_url,
        "url": iframe_url,
        "healthUrl": "",
        "enabled": bool(app.get("enabled", True)),
        "devMode": _dev_mode(dev if isinstance(dev, dict) else {}),
    }


def get_runtime_apps_payload() -> dict[str, Any]:
    repo_root = get_api_settings().repo_root
    apps_config = load_apps_config(repo_root)
    runtime_payload = read_ports_file(repo_root) or {}
    runtime_apps = runtime_payload.get("apps") or {}

    apps: list[dict[str, Any]] = []
    for _, app in iter_ordered_apps(apps_config):
        if not isinstance(app, dict) or not app.get("iframe_enabled", False):
            continue

        code = str(app.get("code") or "")
        if code in {"portal", "platform-api"}:
            continue

        runtime_app = runtime_apps.get(code) if isinstance(runtime_apps, dict) else None
        dev = app.get("dev") or {}
        if isinstance(runtime_app, dict):
            iframe_url = str(
                runtime_app.get("iframe_url")
                or runtime_app.get("frontend_url")
                or runtime_app.get("url")
                or ""
            )
            backend_url = str(runtime_app.get("backend_url") or "")
            health_url = str(runtime_app.get("health_url") or "")
            health_check = str(dev.get("health_check") or app.get("legacy_health_check") or "")
            apps.append(
                {
                    "code": code,
                    "name": app.get("name"),
                    "routePath": app.get("route_path") or "",
                    "frontendUrl": iframe_url,
                    "backendUrl": backend_url,
                    "iframeUrl": iframe_url,
                    "url": iframe_url,
                    "healthUrl": health_url
                    or (f"{backend_url}{health_check}" if backend_url and health_check else ""),
                    "enabled": bool(runtime_app.get("enabled", app.get("enabled", True))),
                    "devMode": str(runtime_app.get("dev_mode") or _dev_mode(dev if isinstance(dev, dict) else {})),
                }
            )
            continue

        fallback = _fallback_app_payload(app)
        if fallback:
            apps.append(fallback)

    return {"apps": apps}
