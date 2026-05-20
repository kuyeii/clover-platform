from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import router
from app.core.config import API_PREFIX, SERVICE_TITLE, get_api_settings
from app.core.errors import register_exception_handlers
from app.core.logging import configure_logging
from app.core.middleware import RequestIdMiddleware


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
    return app

