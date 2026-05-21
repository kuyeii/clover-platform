from __future__ import annotations

import json
import logging
import os
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from typing import Any, Iterator
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.core.config import get_api_settings
from app.core.security import hash_password, normalize_account, sanitize_user
from packages.py_common.apps import iter_ordered_apps
from packages.py_common.config.loader import load_apps_config
from packages.py_common.db.session import get_engine

logger = logging.getLogger(__name__)

APP_USAGE_TTL_SECONDS = int(os.getenv("PORTAL_USAGE_TTL_SECONDS", "120"))
SESSION_TTL_SECONDS = int(os.getenv("PORTAL_SESSION_TTL_SECONDS", str(12 * 60 * 60)))
ROLE_VALUES = {"admin", "operator", "viewer"}
PASSWORD_SEPARATOR = "$"
FALLBACK_APP_IDS = [
    "bid-generator",
    "contract-review",
    "competitor-analysis",
    "rag-web-search",
]


@lru_cache(maxsize=1)
def app_ids() -> list[str]:
    try:
        apps_config = load_apps_config(get_api_settings().repo_root)
        codes = [
            str(app.get("code") or "")
            for _, app in iter_ordered_apps(apps_config)
            if isinstance(app, dict) and bool(app.get("iframe_enabled", False))
        ]
        resolved = [code for code in codes if code and code != "platform-api"]
        return resolved or list(FALLBACK_APP_IDS)
    except Exception:
        return list(FALLBACK_APP_IDS)


def _now_dt() -> datetime:
    return datetime.now(timezone.utc)


def _expiry_dt(seconds: int) -> datetime:
    return _now_dt() + timedelta(seconds=seconds)


def _usage_expiry_dt() -> datetime:
    return _now_dt() + timedelta(seconds=APP_USAGE_TTL_SECONDS)


def _to_iso(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    return str(value)


def _json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _json_loads_dict(value: str | dict[str, Any] | None) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if not value:
        return {}
    try:
        data = json.loads(value)
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


def _is_uuid(value: str | None) -> bool:
    if not value:
        return False
    try:
        UUID(str(value))
    except ValueError:
        return False
    return True


def _encode_password(password_salt: str, password_hash: str) -> str:
    return f"{password_salt}{PASSWORD_SEPARATOR}{password_hash}"


def _decode_password(value: str | None) -> tuple[str | None, str | None]:
    if not value or PASSWORD_SEPARATOR not in value:
        return None, value
    password_salt, password_hash = value.split(PASSWORD_SEPARATOR, 1)
    return password_salt, password_hash


class PortalConnection:
    def __init__(self, conn: Connection) -> None:
        self._conn = conn

    def execute(self, sql: str, params: dict[str, Any] | None = None):
        return self._conn.execute(text(sql), params or {})

    def one(self, sql: str, params: dict[str, Any] | None = None) -> dict[str, Any] | None:
        row = self.execute(sql, params).mappings().first()
        return dict(row) if row else None

    def all(self, sql: str, params: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        return [dict(row) for row in self.execute(sql, params).mappings().all()]


@contextmanager
def connect() -> Iterator[PortalConnection]:
    try:
        with get_engine().begin() as conn:
            yield PortalConnection(conn)
    except Exception:
        logger.error("Portal core PostgreSQL transaction failed")
        raise


def normalize_permissions(role: str, permissions: list[str] | None) -> list[str]:
    current_app_ids = app_ids()
    if role == "admin":
        return list(current_app_ids)
    if permissions is None:
        return list(current_app_ids)

    seen: set[str] = set()
    normalized: list[str] = []
    for app_id in permissions:
        if app_id in current_app_ids and app_id not in seen:
            normalized.append(app_id)
            seen.add(app_id)
    return normalized


def can_access_app(user: dict[str, Any], app_id: str) -> bool:
    return user.get("role") == "admin" or app_id in user.get("appPermissions", [])


def _permissions_for_user(conn: PortalConnection, user_id: str, is_admin: bool) -> list[str]:
    current_app_ids = app_ids()
    if is_admin:
        return list(current_app_ids)

    rows = conn.all(
        """
        SELECT app_code, can_access
        FROM core.user_app_permissions
        WHERE user_id = :user_id
        """,
        {"user_id": user_id},
    )
    permission_map = {str(row["app_code"]): bool(row["can_access"]) for row in rows}
    return [app_id for app_id in current_app_ids if permission_map.get(app_id, True)]


def _row_to_user(conn: PortalConnection, row: dict[str, Any] | None) -> dict[str, Any] | None:
    if row is None:
        return None
    password_salt, password_hash = _decode_password(row.get("password_hash"))
    is_admin = bool(row.get("is_admin"))
    role = str(row.get("role") or ("admin" if is_admin else "operator"))
    return {
        "id": str(row["id"]),
        "name": row.get("display_name") or row.get("username"),
        "account": row.get("username"),
        "role": role,
        "enabled": bool(row.get("is_active")),
        "appPermissions": _permissions_for_user(conn, str(row["id"]), is_admin),
        "createdAt": _to_iso(row.get("created_at")),
        "updatedAt": _to_iso(row.get("updated_at")),
        "lastLoginAt": _to_iso(row.get("last_login_at")),
        "passwordSalt": password_salt,
        "passwordHash": password_hash,
    }


def _row_to_usage_session(row: dict[str, Any]) -> dict[str, Any]:
    metadata = _json_loads_dict(row.get("metadata"))
    return {
        "id": str(row["id"]),
        "appId": row["app_code"],
        "clientId": str(metadata.get("clientId") or ""),
        "userId": str(row["user_id"]),
        "userName": row.get("display_name") or row.get("username") or "",
        "startedAt": _to_iso(row.get("entered_at")),
        "lastActiveAt": _to_iso(row.get("last_seen_at")),
        "confirmedConflict": bool(metadata.get("confirmedConflict")),
    }


def _upsert_profile(conn: PortalConnection, user_id: str, role: str) -> None:
    conn.execute(
        """
        INSERT INTO portal.user_profiles (user_id, role)
        VALUES (:user_id, :role)
        ON CONFLICT (user_id) DO UPDATE
          SET role = EXCLUDED.role,
              updated_at = now()
        """,
        {"user_id": user_id, "role": role},
    )


def audit(
    conn: PortalConnection,
    actor: dict[str, Any] | None,
    action: str,
    detail: dict[str, Any] | None = None,
) -> None:
    actor_id = actor.get("id") if actor else None
    conn.execute(
        """
        INSERT INTO core.audit_logs (user_id, action, module_code, target_type, target_id, detail)
        VALUES (:user_id, :action, 'portal', :target_type, :target_id, CAST(:detail AS jsonb))
        """,
        {
            "user_id": actor_id if _is_uuid(str(actor_id)) else None,
            "action": action,
            "target_type": (detail or {}).get("targetType"),
            "target_id": (detail or {}).get("targetId"),
            "detail": _json_dumps(
                {
                    **(detail or {}),
                    "actorName": actor.get("name") if actor else "system",
                }
            ),
        },
    )


def purge_expired_auth_sessions(conn: PortalConnection) -> None:
    conn.execute("DELETE FROM core.sessions WHERE expires_at <= now()")


def purge_expired_usage_sessions(conn: PortalConnection) -> None:
    conn.execute("DELETE FROM core.app_usage_sessions WHERE expires_at IS NOT NULL AND expires_at <= now()")


def _base_user_sql(where_clause: str = "") -> str:
    return f"""
        SELECT
          u.id,
          u.username,
          u.display_name,
          u.password_hash,
          u.is_admin,
          u.is_active,
          u.created_at,
          u.updated_at,
          p.role,
          p.last_login_at
        FROM core.users u
        LEFT JOIN portal.user_profiles p ON p.user_id = u.id
        {where_clause}
    """


def list_users(conn: PortalConnection) -> list[dict[str, Any]]:
    rows = conn.all(f"{_base_user_sql()} ORDER BY u.created_at ASC, u.id ASC")
    return [user for row in rows if (user := _row_to_user(conn, row))]


def get_user_by_id(conn: PortalConnection, user_id: str) -> dict[str, Any] | None:
    if not _is_uuid(user_id):
        return None
    row = conn.one(_base_user_sql("WHERE u.id = :user_id"), {"user_id": user_id})
    return _row_to_user(conn, row)


def get_user_by_account(conn: PortalConnection, account: str) -> dict[str, Any] | None:
    row = conn.one(_base_user_sql("WHERE u.username = :account"), {"account": normalize_account(account)})
    return _row_to_user(conn, row)


def account_exists(conn: PortalConnection, account: str, exclude_user_id: str | None = None) -> bool:
    normalized = normalize_account(account)
    if exclude_user_id and _is_uuid(exclude_user_id):
        row = conn.one(
            "SELECT 1 AS ok FROM core.users WHERE username = :account AND id <> :exclude_user_id LIMIT 1",
            {"account": normalized, "exclude_user_id": exclude_user_id},
        )
    else:
        row = conn.one("SELECT 1 AS ok FROM core.users WHERE username = :account LIMIT 1", {"account": normalized})
    return row is not None


def _replace_user_permissions(conn: PortalConnection, user_id: str, role: str, permissions: list[str] | None) -> None:
    conn.execute("DELETE FROM core.user_app_permissions WHERE user_id = :user_id", {"user_id": user_id})
    if role == "admin" or permissions is None:
        return
    allowed = set(normalize_permissions(role, permissions))
    for app_id in app_ids():
        conn.execute(
            """
            INSERT INTO core.user_app_permissions (user_id, app_code, can_access)
            VALUES (:user_id, :app_code, :can_access)
            ON CONFLICT (user_id, app_code) DO UPDATE
              SET can_access = EXCLUDED.can_access,
                  updated_at = now()
            """,
            {"user_id": user_id, "app_code": app_id, "can_access": app_id in allowed},
        )


def create_user(conn: PortalConnection, payload: dict[str, Any], actor: dict[str, Any]) -> dict[str, Any]:
    role = str(payload["role"])
    hashed = hash_password(str(payload["password"]))
    row = conn.one(
        """
        INSERT INTO core.users (
          username, display_name, password_hash, is_admin, is_active, created_at, updated_at
        )
        VALUES (
          :username, :display_name, :password_hash, :is_admin, TRUE, now(), now()
        )
        RETURNING id
        """,
        {
            "username": normalize_account(payload["account"]),
            "display_name": payload["name"].strip(),
            "password_hash": _encode_password(hashed["passwordSalt"], hashed["passwordHash"]),
            "is_admin": role == "admin",
        },
    )
    user_id = str(row["id"])
    _upsert_profile(conn, user_id, role)
    _replace_user_permissions(conn, user_id, role, payload.get("appPermissions"))
    user = get_user_by_id(conn, user_id)
    audit(conn, actor, "user.create", {"targetUserId": user_id, "account": user["account"] if user else ""})
    return user or {}


def update_user(conn: PortalConnection, user_id: str, patch: dict[str, Any], actor: dict[str, Any]) -> dict[str, Any]:
    current = get_user_by_id(conn, user_id)
    if not current:
        raise KeyError("USER_NOT_FOUND")

    core_patch: dict[str, Any] = {}
    profile_role = str(patch.get("role", current["role"]))
    has_permission_patch = "appPermissions" in patch
    permission_patch = patch.get("appPermissions") if has_permission_patch else None

    if "name" in patch:
        core_patch["display_name"] = str(patch["name"]).strip()
    if "account" in patch:
        core_patch["username"] = normalize_account(str(patch["account"]))
    if "role" in patch:
        core_patch["is_admin"] = profile_role == "admin"
    if "enabled" in patch:
        core_patch["is_active"] = bool(patch["enabled"])
    if patch.get("password"):
        hashed = hash_password(str(patch["password"]))
        core_patch["password_hash"] = _encode_password(hashed["passwordSalt"], hashed["passwordHash"])

    if core_patch:
        core_patch["updated_at"] = _now_dt()
        assignments = ", ".join(f"{column} = :{column}" for column in core_patch)
        conn.execute(
            f"UPDATE core.users SET {assignments} WHERE id = :user_id",
            {**core_patch, "user_id": user_id},
        )

    if "role" in patch:
        _upsert_profile(conn, user_id, profile_role)
    if has_permission_patch or "role" in patch:
        next_permissions = permission_patch if has_permission_patch else current.get("appPermissions")
        _replace_user_permissions(conn, user_id, profile_role, next_permissions)

    audit(conn, actor, "user.update", {"targetUserId": user_id, "changedFields": list(patch)})
    return get_user_by_id(conn, user_id) or current


def would_remove_last_enabled_admin(conn: PortalConnection, target_user_id: str, patch: dict[str, Any]) -> bool:
    users = list_users(conn)
    next_users = []
    for user in users:
        if user["id"] == target_user_id:
            next_user = {**user}
            if "role" in patch:
                next_user["role"] = str(patch["role"])
            if "enabled" in patch:
                next_user["enabled"] = bool(patch["enabled"])
            next_users.append(next_user)
        else:
            next_users.append(user)
    return len([user for user in next_users if user.get("enabled") and user.get("role") == "admin"]) == 0


def create_auth_session(conn: PortalConnection, user: dict[str, Any], client_id: str, token: str) -> None:
    expires_at = _expiry_dt(SESSION_TTL_SECONDS)
    conn.execute(
        """
        INSERT INTO core.sessions (token, user_id, expires_at)
        VALUES (:token, :user_id, :expires_at)
        """,
        {"token": token, "user_id": user["id"], "expires_at": expires_at},
    )
    conn.execute(
        """
        INSERT INTO portal.user_profiles (user_id, role, last_login_at)
        VALUES (:user_id, :role, now())
        ON CONFLICT (user_id) DO UPDATE
          SET last_login_at = now(),
              updated_at = now()
        """,
        {"user_id": user["id"], "role": user.get("role") or "operator"},
    )
    audit(conn, sanitize_user(user), "auth.login", {"account": user["account"], "clientId": client_id})


def get_user_by_session_token(conn: PortalConnection, token: str) -> dict[str, Any] | None:
    purge_expired_auth_sessions(conn)
    row = conn.one(
        """
        SELECT user_id
        FROM core.sessions
        WHERE token = :token AND expires_at > now()
        """,
        {"token": token},
    )
    if row is None:
        conn.execute("DELETE FROM core.sessions WHERE token = :token", {"token": token})
        return None
    conn.execute(
        "UPDATE core.sessions SET expires_at = :expires_at WHERE token = :token",
        {"expires_at": _expiry_dt(SESSION_TTL_SECONDS), "token": token},
    )
    user = get_user_by_id(conn, str(row["user_id"]))
    if not user or not user.get("enabled"):
        return None
    return user


def delete_auth_session(conn: PortalConnection, token: str) -> None:
    conn.execute("DELETE FROM core.sessions WHERE token = :token", {"token": token})


def leave_all_for_user_client(conn: PortalConnection, user: dict[str, Any], client_id: str) -> None:
    conn.execute(
        """
        DELETE FROM core.app_usage_sessions
        WHERE user_id = :user_id AND metadata->>'clientId' = :client_id
        """,
        {"user_id": user["id"], "client_id": client_id},
    )


def count_usage_sessions_for_user_client(conn: PortalConnection, user: dict[str, Any], client_id: str) -> int:
    row = conn.one(
        """
        SELECT COUNT(*) AS count
        FROM core.app_usage_sessions
        WHERE user_id = :user_id AND metadata->>'clientId' = :client_id
        """,
        {"user_id": user["id"], "client_id": client_id},
    )
    return int(row["count"]) if row else 0


def count_usage_sessions(conn: PortalConnection) -> int:
    row = conn.one("SELECT COUNT(*) AS count FROM core.app_usage_sessions")
    return int(row["count"]) if row else 0


def upsert_app_usage_session(
    conn: PortalConnection,
    user: dict[str, Any],
    app_id: str,
    client_id: str,
    confirmed_conflict: bool = False,
) -> None:
    purge_expired_usage_sessions(conn)
    existing = conn.one(
        """
        SELECT id, entered_at, metadata
        FROM core.app_usage_sessions
        WHERE app_code = :app_code
          AND user_id = :user_id
          AND metadata->>'clientId' = :client_id
        LIMIT 1
        """,
        {"app_code": app_id, "user_id": user["id"], "client_id": client_id},
    )
    metadata = _json_loads_dict(existing.get("metadata") if existing else None)
    metadata["clientId"] = client_id
    metadata["confirmedConflict"] = bool(metadata.get("confirmedConflict") or confirmed_conflict)

    params = {
        "app_code": app_id,
        "user_id": user["id"],
        "username": user["account"],
        "display_name": user["name"],
        "expires_at": _usage_expiry_dt(),
        "metadata": _json_dumps(metadata),
    }
    if existing:
        conn.execute(
            """
            UPDATE core.app_usage_sessions
            SET username = :username,
                display_name = :display_name,
                last_seen_at = now(),
                expires_at = :expires_at,
                metadata = CAST(:metadata AS jsonb)
            WHERE id = :id
            """,
            {**params, "id": str(existing["id"])},
        )
    else:
        conn.execute(
            """
            INSERT INTO core.app_usage_sessions (
              app_code, user_id, username, display_name, expires_at, metadata
            )
            VALUES (
              :app_code, :user_id, :username, :display_name, :expires_at, CAST(:metadata AS jsonb)
            )
            """,
            params,
        )


def leave_app(conn: PortalConnection, user: dict[str, Any], app_id: str, client_id: str) -> None:
    conn.execute(
        """
        DELETE FROM core.app_usage_sessions
        WHERE app_code = :app_code
          AND user_id = :user_id
          AND metadata->>'clientId' = :client_id
        """,
        {"app_code": app_id, "user_id": user["id"], "client_id": client_id},
    )


def build_usage_summary(conn: PortalConnection, current_user_id: str) -> list[dict[str, Any]]:
    purge_expired_usage_sessions(conn)
    rows = conn.all(
        """
        SELECT *
        FROM core.app_usage_sessions
        ORDER BY entered_at ASC
        """
    )
    sessions = [_row_to_usage_session(row) for row in rows]
    summaries: list[dict[str, Any]] = []

    def unique(values: list[str]) -> list[str]:
        result: list[str] = []
        for value in values:
            if value and value not in result:
                result.append(value)
        return result

    for app_id in app_ids():
        app_sessions = [session for session in sessions if session["appId"] == app_id]
        current_user_sessions = [
            session for session in app_sessions if session["userId"] == current_user_id
        ]
        other_user_sessions = [
            session for session in app_sessions if session["userId"] != current_user_id
        ]
        summaries.append(
            {
                "appId": app_id,
                "sessions": app_sessions,
                "currentUserSessions": current_user_sessions,
                "otherUserSessions": other_user_sessions,
                "inUse": len(app_sessions) > 0,
                "inUseByOthers": len(other_user_sessions) > 0,
                "userNames": unique([session["userName"] for session in app_sessions]),
                "otherUserNames": unique([session["userName"] for session in other_user_sessions]),
            }
        )
    return summaries
