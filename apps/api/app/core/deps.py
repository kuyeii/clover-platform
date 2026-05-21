from __future__ import annotations

from typing import Annotated, Any, Optional

from fastapi import Depends, Header

from app.core.errors import PlatformError
from app.core.security import sanitize_user
from app.services.portal_store import connect, get_user_by_session_token


def get_client_id(x_portal_client_id: Annotated[Optional[str], Header()] = None) -> str:
    return (x_portal_client_id or "unknown-client")[:160]


def extract_token(authorization: str | None) -> str:
    if not authorization:
        return ""
    prefix = "Bearer "
    if not authorization.startswith(prefix):
        return ""
    return authorization[len(prefix) :].strip()


def get_current_user(
    authorization: Annotated[Optional[str], Header()] = None,
) -> dict[str, Any]:
    token = extract_token(authorization)
    if not token:
        raise PlatformError(code="UNAUTHORIZED", message="请先登录。", status_code=401)
    with connect() as conn:
        user = get_user_by_session_token(conn, token)
    if not user:
        raise PlatformError(code="UNAUTHORIZED", message="请先登录。", status_code=401)
    return sanitize_user(user)


def get_current_user_with_token(
    authorization: Annotated[Optional[str], Header()] = None,
) -> tuple[str, dict[str, Any]]:
    token = extract_token(authorization)
    if not token:
        raise PlatformError(code="UNAUTHORIZED", message="请先登录。", status_code=401)
    with connect() as conn:
        user = get_user_by_session_token(conn, token)
    if not user:
        raise PlatformError(code="UNAUTHORIZED", message="请先登录。", status_code=401)
    return token, sanitize_user(user)


def require_admin(user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    if user.get("role") != "admin":
        raise PlatformError(code="FORBIDDEN", message="当前用户没有管理员权限。", status_code=403)
    return user
