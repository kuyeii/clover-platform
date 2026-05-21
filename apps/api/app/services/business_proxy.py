from __future__ import annotations

import os
import logging
from string import Formatter
from typing import Any

import httpx
from fastapi import Request
from fastapi.responses import StreamingResponse

from app.core.config import get_api_settings
from app.core.errors import PlatformError
from packages.py_common.apps import app_by_code
from packages.py_common.config.loader import load_apps_config
from packages.py_common.runtime import read_ports_file

logger = logging.getLogger(__name__)
PROXY_TIMEOUT = httpx.Timeout(connect=10.0, read=None, write=60.0, pool=10.0)
HOP_BY_HOP_HEADERS = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "trailers",
    "transfer-encoding",
    "upgrade",
}
BLOCKED_REQUEST_HEADERS = HOP_BY_HOP_HEADERS | {
    "authorization",
    "cookie",
    "host",
}
BLOCKED_RESPONSE_HEADERS = HOP_BY_HOP_HEADERS | {
    "access-control-allow-origin",
    "access-control-allow-credentials",
    "access-control-allow-methods",
    "access-control-allow-headers",
    "access-control-expose-headers",
    "access-control-max-age",
    "content-length",
    "set-cookie",
}


def _normalize_backend_url(value: Any) -> str:
    backend_url = str(value or "").strip().rstrip("/")
    if not backend_url:
        return ""
    if not backend_url.startswith(("http://", "https://")):
        return ""
    return backend_url


def _int_config(value: Any) -> int | None:
    if value is None or value == "":
        return None
    try:
        port = int(value)
    except (TypeError, ValueError):
        return None
    return port if port > 0 else None


def _format_config_url(template: str, *, backend_port: int | None, frontend_port: int | None) -> str:
    if not template:
        return ""

    names = {field_name for _, field_name, _, _ in Formatter().parse(template) if field_name}
    if not names:
        return template
    if not names.issubset({"backend_port", "frontend_port"}):
        return ""

    try:
        return template.format(backend_port=backend_port or "", frontend_port=frontend_port or "")
    except (KeyError, IndexError, ValueError):
        return ""


def _safe_env_url(env_name: Any) -> str:
    name = str(env_name or "").strip()
    if not name:
        return ""
    return _normalize_backend_url(os.getenv(name))


def _backend_url_from_runtime(app_code: str) -> str:
    try:
        runtime_payload = read_ports_file(get_api_settings().repo_root) or {}
    except (OSError, ValueError) as exc:
        logger.warning("Failed to read runtime ports file for business proxy: %s", exc)
        return ""
    runtime_apps = runtime_payload.get("apps") or {}
    runtime_app = runtime_apps.get(app_code) if isinstance(runtime_apps, dict) else None
    if not isinstance(runtime_app, dict):
        return ""
    return _normalize_backend_url(runtime_app.get("backend_url"))


def _backend_url_from_config(app: dict[str, Any]) -> str:
    direct_env_url = _safe_env_url(app.get("backend_url_env"))
    if direct_env_url:
        return direct_env_url

    dev = app.get("dev") or {}
    if not isinstance(dev, dict):
        dev = {}

    backend_port = _int_config(dev.get("backend_preferred_port")) or _int_config(dev.get("preferred_port"))
    frontend_port = _int_config(dev.get("frontend_preferred_port")) or _int_config(dev.get("preferred_port"))

    for key in ("backend_url", "backend_base_url"):
        configured_url = _normalize_backend_url(
            _format_config_url(str(dev.get(key) or ""), backend_port=backend_port, frontend_port=frontend_port)
        )
        if configured_url:
            return configured_url

    dev_env = dev.get("env") or {}
    if isinstance(dev_env, dict):
        for key in ("BACKEND_URL", "VITE_API_BASE_URL", "VITE_API_TARGET"):
            configured_url = _normalize_backend_url(
                _format_config_url(str(dev_env.get(key) or ""), backend_port=backend_port, frontend_port=frontend_port)
            )
            if configured_url:
                return configured_url

    if backend_port:
        return f"http://127.0.0.1:{backend_port}"

    return _safe_env_url(app.get("iframe_url_env"))


def resolve_business_backend_url(app_code: str) -> str:
    runtime_backend_url = _backend_url_from_runtime(app_code)
    if runtime_backend_url:
        return runtime_backend_url

    apps_config = load_apps_config(get_api_settings().repo_root)
    app = app_by_code(apps_config).get(app_code)
    if not isinstance(app, dict) or not app.get("enabled", True):
        raise PlatformError(
            code="BUSINESS_BACKEND_UNAVAILABLE",
            message="业务模块后端不可用。",
            status_code=502,
            details={"app_code": app_code},
        )

    config_backend_url = _backend_url_from_config(app)
    if config_backend_url:
        return config_backend_url

    raise PlatformError(
        code="BUSINESS_BACKEND_UNAVAILABLE",
        message="业务模块后端不可用。",
        status_code=502,
        details={"app_code": app_code},
    )


def _target_url(backend_url: str, path: str, query: str) -> httpx.URL:
    target = httpx.URL(f"{backend_url.rstrip('/')}/{path.lstrip('/')}")
    if query:
        return target.copy_with(query=query.encode("utf-8"))
    return target


def _request_headers(request: Request, user: dict[str, Any], client_id: str) -> dict[str, str]:
    headers: dict[str, str] = {}
    for name, value in request.headers.items():
        lower_name = name.lower()
        if lower_name in BLOCKED_REQUEST_HEADERS:
            continue
        headers[name] = value

    headers["Accept-Encoding"] = "identity"
    headers["X-Portal-User-Id"] = str(user.get("id") or "")
    headers["X-Portal-User-Account"] = str(user.get("account") or "")
    headers["X-Portal-User-Role"] = str(user.get("role") or "")
    headers["X-Portal-Client-Id"] = client_id
    request_id = str(getattr(request.state, "request_id", "") or "")
    if request_id:
        headers["X-Request-ID"] = request_id
    return headers


def _response_headers(headers: httpx.Headers) -> dict[str, str]:
    return {
        name: value
        for name, value in headers.items()
        if name.lower() not in BLOCKED_RESPONSE_HEADERS
    }


async def _stream_upstream_response(response: httpx.Response, client: httpx.AsyncClient):
    try:
        async for chunk in response.aiter_raw():
            yield chunk
    finally:
        await response.aclose()
        await client.aclose()


async def proxy_business_request(
    *,
    request: Request,
    app_code: str,
    path: str,
    user: dict[str, Any],
    client_id: str,
) -> StreamingResponse:
    backend_url = resolve_business_backend_url(app_code)
    target_url = _target_url(backend_url, path, request.url.query)
    client = httpx.AsyncClient(timeout=PROXY_TIMEOUT, follow_redirects=False, trust_env=False)
    upstream_request = client.build_request(
        request.method,
        target_url,
        headers=_request_headers(request, user, client_id),
        content=request.stream(),
    )

    try:
        upstream_response = await client.send(upstream_request, stream=True)
    except httpx.RequestError as exc:
        await client.aclose()
        raise PlatformError(
            code="BUSINESS_PROXY_ERROR",
            message="业务模块后端连接失败。",
            status_code=502,
            details={"app_code": app_code},
        ) from exc

    return StreamingResponse(
        _stream_upstream_response(upstream_response, client),
        status_code=upstream_response.status_code,
        headers=_response_headers(upstream_response.headers),
    )
