from __future__ import annotations

from typing import Any

from app.core.errors import PlatformError
from app.core.security import create_token, normalize_account, sanitize_user, verify_password
from app.services import portal_store as store


def login(*, account: str, password: str, client_id: str) -> dict[str, Any]:
    normalized_account = normalize_account(account)
    if not normalized_account or not password:
        raise PlatformError(code="INVALID_LOGIN_INPUT", message="请输入账号和密码。", status_code=400)

    with store.connect() as conn:
        user = store.get_user_by_account(conn, normalized_account)
        if not user or not user.get("enabled") or not verify_password(password, user):
            raise PlatformError(
                code="INVALID_CREDENTIALS",
                message="账号或密码不正确，或该账号已停用。",
                status_code=401,
            )
        token = create_token()
        store.create_auth_session(conn, user, client_id, token)
        refreshed_user = store.get_user_by_id(conn, user["id"]) or user
        return {"token": token, "user": sanitize_user(refreshed_user)}


def logout(*, token: str, user: dict[str, Any], client_id: str) -> dict[str, bool]:
    with store.connect() as conn:
        store.delete_auth_session(conn, token)
        store.leave_all_for_user_client(conn, user, client_id)
        store.audit(conn, user, "auth.logout", {"clientId": client_id})
    return {"ok": True}


def change_password(
    *,
    user: dict[str, Any],
    current_password: str,
    new_password: str,
) -> dict[str, Any]:
    if not current_password or not new_password:
        raise PlatformError(code="INVALID_PASSWORD_INPUT", message="当前密码和新密码不能为空。", status_code=400)
    if current_password == new_password:
        raise PlatformError(code="PASSWORD_UNCHANGED", message="新密码不能和当前密码相同。", status_code=400)

    with store.connect() as conn:
        fresh_user = store.get_user_by_id(conn, user["id"])
        if not fresh_user or not fresh_user.get("enabled"):
            raise PlatformError(code="UNAUTHORIZED", message="请先登录。", status_code=401)
        if not verify_password(current_password, fresh_user):
            raise PlatformError(code="INVALID_CURRENT_PASSWORD", message="当前密码不正确。", status_code=400)
        updated_user = store.update_user(conn, user["id"], {"password": new_password}, user)
        return {"user": sanitize_user(updated_user)}


def get_user_by_raw_token(token: str) -> dict[str, Any] | None:
    if not token:
        return None
    with store.connect() as conn:
        user = store.get_user_by_session_token(conn, token)
    return sanitize_user(user) if user else None
