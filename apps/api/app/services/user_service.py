from __future__ import annotations

from typing import Any

from app.core.errors import PlatformError
from app.core.security import normalize_account, sanitize_user, sanitize_users
from app.services import portal_store as store


def list_portal_users(actor: dict[str, Any]) -> dict[str, Any]:
    with store.connect() as conn:
        if actor.get("role") == "admin":
            return {"users": sanitize_users(store.list_users(conn))}
        current_user = store.get_user_by_id(conn, actor["id"])
        return {"users": sanitize_users([current_user] if current_user else [])}


def create_portal_user(payload: dict[str, Any], actor: dict[str, Any]) -> dict[str, Any]:
    name = str(payload.get("name") or "").strip()
    account = normalize_account(str(payload.get("account") or ""))
    password = str(payload.get("password") or "")
    role = str(payload.get("role") or "operator")

    if not name or not account or not password:
        raise PlatformError(code="INVALID_USER_INPUT", message="姓名、账号和初始密码不能为空。", status_code=400)
    if role not in store.ROLE_VALUES:
        raise PlatformError(code="INVALID_ROLE", message="用户角色不合法。", status_code=400)

    with store.connect() as conn:
        if store.account_exists(conn, account):
            raise PlatformError(code="ACCOUNT_EXISTS", message="账号已存在。", status_code=409)
        user = store.create_user(
            conn,
            {
                "name": name,
                "account": account,
                "password": password,
                "role": role,
                "appPermissions": payload.get("appPermissions"),
            },
            actor,
        )
        return {"user": sanitize_user(user)}


def update_portal_user(*, user_id: str, patch: dict[str, Any], actor: dict[str, Any]) -> dict[str, Any]:
    is_admin = actor.get("role") == "admin"
    is_self = actor.get("id") == user_id

    if not is_admin and not is_self:
        raise PlatformError(code="FORBIDDEN", message="当前用户没有权限修改该账号。", status_code=403)
    if not is_admin:
        forbidden_fields = set(patch) - {"name", "account"}
        if forbidden_fields:
            raise PlatformError(
                code="FORBIDDEN",
                message="普通用户只能修改自己的姓名和账号；修改密码请使用修改密码功能。",
                status_code=403,
            )

    if "name" in patch:
        patch["name"] = str(patch["name"] or "").strip()
        if not patch["name"]:
            raise PlatformError(code="INVALID_USER_INPUT", message="姓名不能为空。", status_code=400)
    if "account" in patch:
        patch["account"] = normalize_account(str(patch["account"] or ""))
        if not patch["account"]:
            raise PlatformError(code="INVALID_USER_INPUT", message="账号不能为空。", status_code=400)
    if "role" in patch and patch["role"] not in store.ROLE_VALUES:
        raise PlatformError(code="INVALID_ROLE", message="用户角色不合法。", status_code=400)
    if not patch:
        raise PlatformError(code="EMPTY_UPDATE", message="没有需要更新的内容。", status_code=400)

    with store.connect() as conn:
        current = store.get_user_by_id(conn, user_id)
        if not current:
            raise PlatformError(code="USER_NOT_FOUND", message="用户不存在。", status_code=404)
        if "account" in patch and store.account_exists(conn, patch["account"], exclude_user_id=user_id):
            raise PlatformError(code="ACCOUNT_EXISTS", message="账号已存在。", status_code=409)
        if "role" in patch or "appPermissions" in patch:
            next_role = patch.get("role", current["role"])
            patch["appPermissions"] = store.normalize_permissions(
                next_role,
                patch.get("appPermissions", current.get("appPermissions")),
            )
        if store.would_remove_last_enabled_admin(conn, user_id, patch):
            raise PlatformError(
                code="LAST_ADMIN_FORBIDDEN",
                message="系统至少需要保留一个启用的管理员。",
                status_code=400,
            )
        try:
            user = store.update_user(conn, user_id, patch, actor)
        except KeyError as exc:
            raise PlatformError(code="USER_NOT_FOUND", message="用户不存在。", status_code=404) from exc
        return {"user": sanitize_user(user)}
