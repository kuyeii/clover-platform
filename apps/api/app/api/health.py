from __future__ import annotations

from fastapi import APIRouter, Request

from app.core.responses import ok
from app.services.health_check import get_database_health, get_service_health

router = APIRouter()


@router.get("/health", name="get_health")
def get_health(request: Request):
    return ok(request, get_service_health())


@router.get("/health/db", name="get_database_health")
def get_health_db(request: Request):
    return ok(request, get_database_health())

