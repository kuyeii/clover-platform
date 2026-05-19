from __future__ import annotations

from typing import Any

from .config import MONOREPO_ROOT

from packages.py_common.config.loader import load_apps_config
from packages.py_common.runtime import read_ports_file


def _fallback_url(port: int) -> str:
    return f"http://localhost:{port}"


def _int_config(value: Any) -> int | None:
    if value is None or value == "":
        return None
    try:
        port = int(value)
    except (TypeError, ValueError):
        return None
    return port if port > 0 else None


def _static_app_payload(app: dict[str, Any]) -> dict[str, Any] | None:
    if not app.get("iframe_enabled", False):
        return None

    dev = app.get("dev") or {}
    frontend_port = _int_config(dev.get("frontend_preferred_port")) or _int_config(
        dev.get("preferred_port")
    )
    if frontend_port is None:
        return None
    backend_port = (
        _int_config(dev.get("backend_preferred_port"))
        or _int_config(dev.get("preferred_port"))
        or frontend_port
    )

    return {
        "code": app.get("code"),
        "name": app.get("name"),
        "iframeUrl": _fallback_url(frontend_port),
        "url": _fallback_url(frontend_port),
        "healthUrl": f"{_fallback_url(backend_port)}{app.get('legacy_health_check') or ''}",
        "enabled": bool(app.get("enabled", True)),
    }


def get_runtime_apps_payload() -> dict[str, Any]:
    apps_config = load_apps_config(MONOREPO_ROOT)
    config_apps = apps_config.get("apps") or {}
    runtime_payload = read_ports_file(MONOREPO_ROOT) or {}
    runtime_apps = runtime_payload.get("apps") or {}

    apps: list[dict[str, Any]] = []
    for _, app in config_apps.items():
        if not isinstance(app, dict) or not app.get("iframe_enabled", False):
            continue

        code = str(app.get("code") or "")
        runtime_app = runtime_apps.get(code) if isinstance(runtime_apps, dict) else None
        if isinstance(runtime_app, dict):
            iframe_url = str(
                runtime_app.get("iframe_url")
                or runtime_app.get("frontend_url")
                or runtime_app.get("url")
                or ""
            )
            backend_url = str(runtime_app.get("backend_url") or "")
            health_url = str(runtime_app.get("health_url") or "")
            health_check = str(app.get("legacy_health_check") or "")
            apps.append(
                {
                    "code": code,
                    "name": app.get("name"),
                    "iframeUrl": iframe_url,
                    "url": iframe_url,
                    "healthUrl": health_url
                    or (f"{backend_url}{health_check}" if backend_url and health_check else ""),
                    "enabled": bool(runtime_app.get("enabled", app.get("enabled", True))),
                }
            )
            continue

        fallback = _static_app_payload(app)
        if fallback:
            apps.append(fallback)

    return {"apps": apps}
