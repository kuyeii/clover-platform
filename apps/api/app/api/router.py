from __future__ import annotations

from fastapi import APIRouter

from app.api import health, modules, runtime

router = APIRouter()
router.include_router(health.router, tags=["health"])
router.include_router(modules.router, tags=["modules"])
router.include_router(runtime.router, tags=["runtime"])

