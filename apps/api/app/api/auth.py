from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Request

from app.core.deps import get_client_id, get_current_user, get_current_user_with_token
from app.core.responses import ok
from app.schemas.portal import ChangePasswordInput, LoginInput
from app.services import auth_service
from app.services.app_usage_service import app_usage_ws_manager

router = APIRouter(prefix="/auth")


@router.post("/login", name="portal_auth_login")
def login(request: Request, payload: LoginInput, client_id: str = Depends(get_client_id)) -> dict[str, Any]:
    data = auth_service.login(account=payload.account, password=payload.password, client_id=client_id)
    return ok(request, data)


@router.get("/me", name="portal_auth_me")
def me(request: Request, user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    return ok(request, {"user": user})


@router.post("/logout", name="portal_auth_logout")
async def logout(
    request: Request,
    auth: tuple[str, dict[str, Any]] = Depends(get_current_user_with_token),
    client_id: str = Depends(get_client_id),
) -> dict[str, Any]:
    token, user = auth
    data = auth_service.logout(token=token, user=user, client_id=client_id)
    await app_usage_ws_manager.broadcast_usage()
    return ok(request, data)


@router.patch("/password", name="portal_auth_change_password")
def change_current_user_password(
    request: Request,
    payload: ChangePasswordInput,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    data = auth_service.change_password(
        user=user,
        current_password=payload.currentPassword,
        new_password=payload.newPassword,
    )
    return ok(request, data)
