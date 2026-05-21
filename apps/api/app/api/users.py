from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Request, status
from fastapi.responses import JSONResponse

from app.core.deps import get_current_user, require_admin
from app.core.responses import ok
from app.schemas.portal import UserCreateInput, UserUpdateInput
from app.services import user_service

router = APIRouter(prefix="/users")


@router.get("", name="portal_users_list")
def users(request: Request, actor: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    return ok(request, user_service.list_portal_users(actor))


@router.post("", name="portal_users_create", status_code=status.HTTP_201_CREATED)
def create_portal_user(
    request: Request,
    payload: UserCreateInput,
    actor: dict[str, Any] = Depends(require_admin),
) -> JSONResponse:
    data = user_service.create_portal_user(payload.model_dump(), actor)
    return JSONResponse(status_code=status.HTTP_201_CREATED, content=ok(request, data))


@router.patch("/{user_id}", name="portal_users_update")
def update_portal_user(
    request: Request,
    user_id: str,
    payload: UserUpdateInput,
    actor: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    patch = payload.model_dump(exclude_unset=True)
    return ok(request, user_service.update_portal_user(user_id=user_id, patch=patch, actor=actor))
