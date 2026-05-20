from __future__ import annotations

import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.encoders import jsonable_encoder
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.responses import error_response

logger = logging.getLogger(__name__)


class PlatformError(Exception):
    def __init__(
        self,
        *,
        code: str,
        message: str,
        status_code: int = 400,
        details: dict[str, Any] | None = None,
    ) -> None:
        self.code = code
        self.message = message
        self.status_code = status_code
        self.details = details or {}
        super().__init__(message)


class NotFoundError(PlatformError):
    def __init__(self, message: str = "资源不存在", details: dict[str, Any] | None = None) -> None:
        super().__init__(
            code="RESOURCE_NOT_FOUND",
            message=message,
            status_code=404,
            details=details,
        )


class ValidationError(PlatformError):
    def __init__(self, message: str = "请求参数校验失败", details: dict[str, Any] | None = None) -> None:
        super().__init__(
            code="VALIDATION_ERROR",
            message=message,
            status_code=422,
            details=details,
        )


def _http_error_code(status_code: int) -> str:
    if status_code == 401:
        return "UNAUTHORIZED"
    if status_code == 403:
        return "PERMISSION_DENIED"
    if status_code == 404:
        return "RESOURCE_NOT_FOUND"
    if status_code == 422:
        return "VALIDATION_ERROR"
    return "HTTP_ERROR"


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(PlatformError)
    async def platform_error_handler(request: Request, exc: PlatformError):
        return error_response(
            request,
            status_code=exc.status_code,
            code=exc.code,
            message=exc.message,
            details=exc.details,
        )

    @app.exception_handler(StarletteHTTPException)
    async def http_exception_handler(request: Request, exc: StarletteHTTPException):
        message = exc.detail if isinstance(exc.detail, str) else "请求处理失败"
        return error_response(
            request,
            status_code=exc.status_code,
            code=_http_error_code(exc.status_code),
            message=message,
            details={},
        )

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(request: Request, exc: RequestValidationError):
        return error_response(
            request,
            status_code=422,
            code="VALIDATION_ERROR",
            message="请求参数校验失败",
            details={"errors": jsonable_encoder(exc.errors())},
        )

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception):
        logger.exception("Unhandled API error request_id=%s", getattr(request.state, "request_id", ""))
        return error_response(
            request,
            status_code=500,
            code="INTERNAL_ERROR",
            message="服务器内部错误",
            details={},
        )
