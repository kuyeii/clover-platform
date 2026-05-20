from __future__ import annotations

from fastapi import APIRouter, Request

from app.core.responses import ok
from app.services.health_check import get_modules_health
from app.services.module_registry import get_safe_modules

router = APIRouter()


@router.get("/modules", name="get_modules")
def get_modules(request: Request):
    return ok(request, {"modules": get_safe_modules()})


@router.get("/modules/health", name="get_modules_health")
def get_modules_health_endpoint(request: Request):
    self_health_url = str(request.url_for("get_health"))
    return ok(request, get_modules_health(self_health_url=self_health_url))

