from __future__ import annotations

import asyncio

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.app_usage import websocket_router
from app.api.router import business_router, router
from app.core.config import API_PREFIX, SERVICE_TITLE, get_api_settings
from app.core.errors import register_exception_handlers
from app.core.logging import configure_logging
from app.core.middleware import RequestIdMiddleware
from app.services.app_usage_service import cleanup_expired_usage_loop, shutdown_usage_cleanup_task


def create_app() -> FastAPI:
    settings = get_api_settings()
    configure_logging(settings.environment)

    app = FastAPI(title=SERVICE_TITLE, version=settings.version)
    app.add_middleware(RequestIdMiddleware)

    if settings.environment in {"dev", "development", "local", "test"}:
        app.add_middleware(
            CORSMiddleware,
            allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?",
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    register_exception_handlers(app)
    app.include_router(router, prefix=API_PREFIX)
    app.include_router(business_router, prefix="/api/v1")
    app.include_router(websocket_router)

    @app.on_event("startup")
    async def start_app_usage_cleanup() -> None:
        app.state.usage_cleanup_task = asyncio.create_task(cleanup_expired_usage_loop())

    @app.on_event("shutdown")
    async def stop_app_usage_cleanup() -> None:
        await shutdown_usage_cleanup_task(getattr(app.state, "usage_cleanup_task", None))

    return app
