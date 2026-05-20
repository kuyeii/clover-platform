from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any

from app.core.config import SERVICE_NAME, SERVICE_VERSION, get_api_settings
from app.core.errors import PlatformError
from app.core.logging import redact
from packages.py_common.apps import iter_ordered_apps
from packages.py_common.config.loader import load_apps_config
from packages.py_common.db.health import check_database_connection
from packages.py_common.runtime import read_ports_file

HEALTH_TIMEOUT_SECONDS = 2.0


def get_service_health() -> dict[str, Any]:
    settings = get_api_settings()
    return {
        "ok": True,
        "service": SERVICE_NAME,
        "version": SERVICE_VERSION,
        "environment": settings.environment,
    }


def _missing_items(result: dict[str, Any]) -> dict[str, list[str]]:
    return {
        key: value
        for key, value in result.items()
        if key.startswith("missing_") and isinstance(value, list) and value
    }


def get_database_health() -> dict[str, Any]:
    result = check_database_connection()
    if not result.get("ok"):
        raise PlatformError(
            code="DATABASE_UNAVAILABLE",
            message="PostgreSQL 连接不可用",
            status_code=503,
            details={
                "error_type": result.get("error_type") or "DatabaseError",
                "error": redact(result.get("error") or "unknown error"),
            },
        )

    missing = _missing_items(result)
    data = {
        "ok": not bool(missing),
        "database": result.get("database"),
        "user": result.get("user"),
        "version": result.get("version"),
        "schemas": result.get("schemas", []),
        "core_tables": result.get("core_tables", []),
        "core_indexes": result.get("core_indexes", []),
        "portal_tables": result.get("portal_tables", []),
        "portal_indexes": result.get("portal_indexes", []),
        "contract_review_tables": result.get("contract_review_tables", []),
        "contract_review_indexes": result.get("contract_review_indexes", []),
        "bid_generator_tables": result.get("bid_generator_tables", []),
        "bid_generator_indexes": result.get("bid_generator_indexes", []),
        "rag_tables": result.get("rag_tables", []),
        "rag_indexes": result.get("rag_indexes", []),
        "competitor_analysis_tables": result.get("competitor_analysis_tables", []),
        "competitor_analysis_indexes": result.get("competitor_analysis_indexes", []),
        "missing": missing,
    }
    if missing:
        raise PlatformError(
            code="DATABASE_UNHEALTHY",
            message="PostgreSQL 关键 schema/table/index 不完整",
            status_code=503,
            details=data,
        )
    return data


def _runtime_apps() -> dict[str, Any]:
    runtime_payload = read_ports_file(get_api_settings().repo_root) or {}
    runtime_apps = runtime_payload.get("apps") or {}
    return runtime_apps if isinstance(runtime_apps, dict) else {}


def _health_url_from_config(app: dict[str, Any]) -> str:
    dev = app.get("dev") or {}
    health_check = str(dev.get("health_check") or app.get("legacy_health_check") or "")
    backend_port = dev.get("backend_preferred_port")
    frontend_port = dev.get("frontend_preferred_port") or dev.get("preferred_port")

    if backend_port:
        return f"http://127.0.0.1:{int(backend_port)}{health_check}"
    if frontend_port:
        return f"http://127.0.0.1:{int(frontend_port)}{health_check}"
    return ""


def _health_url(app: dict[str, Any], runtime_apps: dict[str, Any], *, self_health_url: str) -> str:
    code = str(app.get("code") or "")
    if code == "platform-api":
        runtime_app = runtime_apps.get(code)
        if isinstance(runtime_app, dict) and runtime_app.get("health_url"):
            return str(runtime_app["health_url"])
        return self_health_url

    runtime_app = runtime_apps.get(code)
    if isinstance(runtime_app, dict):
        if runtime_app.get("health_url"):
            return str(runtime_app["health_url"])
        backend_url = str(runtime_app.get("backend_url") or "")
        health_check = str((app.get("dev") or {}).get("health_check") or app.get("legacy_health_check") or "")
        if backend_url and health_check:
            return f"{backend_url}{health_check}"

    return _health_url_from_config(app)


def _check_http_health(url: str) -> str:
    if not url:
        return "unknown"
    try:
        request = urllib.request.Request(url, headers={"Accept": "application/json"})
        with urllib.request.urlopen(request, timeout=HEALTH_TIMEOUT_SECONDS) as response:
            if not 200 <= int(response.status) < 300:
                return "down"
            body = response.read(4096)
    except (urllib.error.URLError, TimeoutError, OSError):
        return "down"

    try:
        payload = json.loads(body.decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError):
        return "ok"

    if isinstance(payload, dict):
        if payload.get("success") is False:
            return "down"
        data = payload.get("data")
        if isinstance(data, dict) and data.get("ok") is False:
            return "down"
    return "ok"


def get_modules_health(*, self_health_url: str) -> dict[str, Any]:
    apps_config = load_apps_config(get_api_settings().repo_root)
    runtime_apps = _runtime_apps()
    modules: list[dict[str, Any]] = []

    for _, app in iter_ordered_apps(apps_config):
        if not isinstance(app, dict) or not bool(app.get("enabled", True)):
            continue
        code = str(app.get("code") or "")
        dev = app.get("dev") or {}
        health_url = _health_url(app, runtime_apps, self_health_url=self_health_url)
        status = "ok" if code == "platform-api" else _check_http_health(health_url)
        modules.append(
            {
                "code": code,
                "name": app.get("name") or code,
                "enabled": bool(app.get("enabled", True)),
                "devMode": "auto" if bool(dev.get("enabled", False)) else "manual",
                "healthUrl": health_url,
                "status": status,
            }
        )

    return {"ok": True, "modules": modules}

