from __future__ import annotations

from typing import Annotated, Any, Optional

from fastapi import Depends, Header, HTTPException

from .database import connect, get_user_by_session_token
from .security import sanitize_user


def api_error(status_code: int, code: str, message: str) -> HTTPException:
    return HTTPException(status_code=status_code, detail={"code": code, "message": message})


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
        raise api_error(401, "UNAUTHORIZED", "请先登录。")
    with connect() as conn:
        user = get_user_by_session_token(conn, token)
    if not user:
        raise api_error(401, "UNAUTHORIZED", "请先登录。")
    return sanitize_user(user)


def get_current_user_with_token(
    authorization: Annotated[Optional[str], Header()] = None,
) -> tuple[str, dict[str, Any]]:
    token = extract_token(authorization)
    if not token:
        raise api_error(401, "UNAUTHORIZED", "请先登录。")
    with connect() as conn:
        user = get_user_by_session_token(conn, token)
    if not user:
        raise api_error(401, "UNAUTHORIZED", "请先登录。")
    return token, sanitize_user(user)


def require_admin(user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    if user.get("role") != "admin":
        raise api_error(403, "FORBIDDEN", "当前用户没有管理员权限。")
    return user
