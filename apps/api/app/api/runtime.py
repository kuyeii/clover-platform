from __future__ import annotations

from fastapi import APIRouter, Request

from app.core.responses import ok
from app.services.runtime_apps import get_runtime_apps_payload

router = APIRouter()


@router.get("/runtime/apps", name="get_runtime_apps")
def get_runtime_apps(request: Request):
    return ok(request, get_runtime_apps_payload())

