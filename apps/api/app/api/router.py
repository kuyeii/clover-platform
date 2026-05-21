from __future__ import annotations

from fastapi import APIRouter

from app.api import app_usage, auth, health, modules, runtime, users

router = APIRouter()
router.include_router(health.router, tags=["health"])
router.include_router(modules.router, tags=["modules"])
router.include_router(runtime.router, tags=["runtime"])
router.include_router(auth.router, tags=["portal-auth"])
router.include_router(users.router, tags=["portal-users"])
router.include_router(app_usage.router, tags=["portal-app-usage"])
