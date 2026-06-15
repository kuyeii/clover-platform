from __future__ import annotations

import asyncio
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.app_usage import websocket_router
from app.api.router import api_router
from app.core.config import SERVICE_TITLE, get_api_settings
from app.core.errors import register_exception_handlers
from app.core.logging import configure_logging
from app.core.middleware import RequestIdMiddleware
from app.services.app_usage_service import cleanup_expired_usage_loop, shutdown_usage_cleanup_task
from app.services.pipt_recognition_adapter import warmup_recognition_provider

logger = logging.getLogger(__name__)


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
            expose_headers=["Content-Disposition", "X-Request-ID"],
        )

    register_exception_handlers(app)
    app.include_router(api_router, prefix="/api/v1")
    app.include_router(websocket_router)

    @app.on_event("startup")
    async def start_app_usage_cleanup() -> None:
        app.state.usage_cleanup_task = asyncio.create_task(cleanup_expired_usage_loop())
        app.state.pipt_warmup_task = asyncio.create_task(_warmup_pipt_recognition_provider())

    @app.on_event("shutdown")
    async def stop_app_usage_cleanup() -> None:
        await shutdown_usage_cleanup_task(getattr(app.state, "usage_cleanup_task", None))

    return app


async def _warmup_pipt_recognition_provider() -> None:
    try:
        await asyncio.to_thread(warmup_recognition_provider)
    except Exception:
        logger.exception("PIPT 识别引擎启动预热失败，后续任务将回退到首次调用时初始化。")
