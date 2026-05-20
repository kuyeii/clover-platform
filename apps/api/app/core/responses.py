from __future__ import annotations

from typing import Any

from fastapi import Request
from fastapi.responses import JSONResponse


def get_request_id(request: Request | None) -> str:
    if request is None:
        return ""
    return str(getattr(request.state, "request_id", "") or "")


def success_envelope(
    data: Any = None,
    *,
    message: str = "ok",
    request_id: str = "",
) -> dict[str, Any]:
    return {
        "success": True,
        "data": {} if data is None else data,
        "message": message,
        "request_id": request_id,
    }


def error_envelope(
    *,
    code: str,
    message: str,
    details: dict[str, Any] | None = None,
    request_id: str = "",
) -> dict[str, Any]:
    return {
        "success": False,
        "error": {
            "code": code,
            "message": message,
            "details": details or {},
        },
        "request_id": request_id,
    }


def ok(request: Request, data: Any = None, *, message: str = "ok") -> dict[str, Any]:
    return success_envelope(data, message=message, request_id=get_request_id(request))


def error_response(
    request: Request,
    *,
    status_code: int,
    code: str,
    message: str,
    details: dict[str, Any] | None = None,
) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content=error_envelope(
            code=code,
            message=message,
            details=details,
            request_id=get_request_id(request),
        ),
    )

