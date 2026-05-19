from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterator

from .config import (
    APP_IDS,
    APP_USAGE_TTL_SECONDS,
    DATA_DIR,
    DB_FILE,
    DEFAULT_USERS,
    LEGACY_JSON_FILE,
    SESSION_TTL_SECONDS,
)
from .security import create_id, hash_password, normalize_account, now_iso, sanitize_user


def _parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _expiry_iso(seconds: int) -> str:
    return (
        datetime.now(timezone.utc) + timedelta(seconds=seconds)
    ).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _json_loads_list(value: str | None) -> list[str]:
    if not value:
        return []
    try:
        data = json.loads(value)
    except json.JSONDecodeError:
        return []
    return data if isinstance(data, list) else []


def normalize_permissions(role: str, permissions: list[str] | None) -> list[str]:
    if role == "admin":
        return list(APP_IDS)

    seen: set[str] = set()
    normalized: list[str] = []
    for app_id in permissions or []:
        if app_id in APP_IDS and app_id not in seen:
            normalized.append(app_id)
            seen.add(app_id)
    return normalized


def can_access_app(user: dict[str, Any], app_id: str) -> bool:
    return user.get("role") == "admin" or app_id in user.get("appPermissions", [])


def _row_to_user(row: sqlite3.Row | None) -> dict[str, Any] | None:
    if row is None:
        return None
    return {
        "id": row["id"],
        "name": row["name"],
        "account": row["account"],
        "role": row["role"],
        "enabled": bool(row["enabled"]),
        "appPermissions": _json_loads_list(row["app_permissions"]),
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
        "lastLoginAt": row["last_login_at"],
        "passwordSalt": row["password_salt"],
        "passwordHash": row["password_hash"],
    }


def _row_to_usage_session(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "appId": row["app_id"],
        "clientId": row["client_id"],
        "userId": row["user_id"],
        "userName": row["user_name"],
        "startedAt": row["started_at"],
        "lastActiveAt": row["last_active_at"],
        "confirmedConflict": bool(row["confirmed_conflict"]),
    }


@contextmanager
def connect() -> Iterator[sqlite3.Connection]:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_FILE, timeout=10, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_database() -> None:
    with connect() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                account TEXT NOT NULL UNIQUE,
                password_salt TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL CHECK(role IN ('admin', 'operator', 'viewer')),
                enabled INTEGER NOT NULL DEFAULT 1,
                app_permissions TEXT NOT NULL DEFAULT '[]',
                created_at TEXT NOT NULL,
                updated_at TEXT,
                last_login_at TEXT
            );

            CREATE TABLE IF NOT EXISTS auth_sessions (
                token TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                client_id TEXT NOT NULL,
                created_at TEXT NOT NULL,
                last_active_at TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);
            CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires ON auth_sessions(expires_at);

            CREATE TABLE IF NOT EXISTS app_usage_sessions (
                id TEXT PRIMARY KEY,
                app_id TEXT NOT NULL,
                client_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                user_name TEXT NOT NULL,
                started_at TEXT NOT NULL,
                last_active_at TEXT NOT NULL,
                confirmed_conflict INTEGER NOT NULL DEFAULT 0,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_app_usage_app ON app_usage_sessions(app_id);
            CREATE INDEX IF NOT EXISTS idx_app_usage_user_client ON app_usage_sessions(user_id, client_id);
            CREATE INDEX IF NOT EXISTS idx_app_usage_last_active ON app_usage_sessions(last_active_at);

            CREATE TABLE IF NOT EXISTS audit_logs (
                id TEXT PRIMARY KEY,
                action TEXT NOT NULL,
                actor_user_id TEXT NOT NULL,
                actor_name TEXT NOT NULL,
                detail TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);

            CREATE TABLE IF NOT EXISTS feedback_submissions (
                id TEXT PRIMARY KEY,
                kind TEXT NOT NULL CHECK(kind IN ('ticket', 'feature_request')),
                user_id TEXT NOT NULL,
                submitted_at TEXT NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_feedback_submissions_lookup
                ON feedback_submissions(kind, user_id, submitted_at);
            """
        )
        user_count = conn.execute("SELECT COUNT(*) AS count FROM users").fetchone()["count"]
        if user_count == 0 and _legacy_json_exists(LEGACY_JSON_FILE):
            _migrate_legacy_json(conn, LEGACY_JSON_FILE)
            user_count = conn.execute("SELECT COUNT(*) AS count FROM users").fetchone()["count"]
        if user_count == 0:
            _seed_default_users(conn)


def _legacy_json_exists(path: Path) -> bool:
    return path.exists() and path.is_file()


def _migrate_legacy_json(conn: sqlite3.Connection, path: Path) -> None:
    try:
        state = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return

    for user in state.get("users", []):
        if not isinstance(user, dict):
            continue
        account = normalize_account(str(user.get("account", "")))
        if not account:
            continue
        password_hash = user.get("passwordHash") or user.get("password_hash")
        password_salt = user.get("passwordSalt") or user.get("password_salt")
        if not password_hash or not password_salt:
            hashed = hash_password(str(user.get("initialPassword") or "123456"))
            password_hash = hashed["passwordHash"]
            password_salt = hashed["passwordSalt"]
        role = str(user.get("role") or "operator")
        app_permissions = normalize_permissions(role, user.get("appPermissions") or user.get("app_permissions") or [])
        conn.execute(
            """
            INSERT OR IGNORE INTO users (
                id, name, account, password_salt, password_hash, role, enabled,
                app_permissions, created_at, updated_at, last_login_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                user.get("id") or create_id("user"),
                str(user.get("name") or account),
                account,
                str(password_salt),
                str(password_hash),
                role if role in {"admin", "operator", "viewer"} else "operator",
                1 if user.get("enabled", True) else 0,
                _json_dumps(app_permissions),
                str(user.get("createdAt") or now_iso()),
                user.get("updatedAt"),
                user.get("lastLoginAt"),
            ),
        )

    audit(conn, None, "system.migrate_legacy_json", {"path": str(path)})


def _seed_default_users(conn: sqlite3.Connection) -> None:
    for default_user in DEFAULT_USERS:
        initial_password = str(default_user.get("initialPassword") or "123456")
        hashed = hash_password(initial_password)
        role = str(default_user.get("role") or "operator")
        conn.execute(
            """
            INSERT INTO users (
                id, name, account, password_salt, password_hash, role, enabled,
                app_permissions, created_at, updated_at, last_login_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                default_user["id"],
                default_user["name"],
                normalize_account(default_user["account"]),
                hashed["passwordSalt"],
                hashed["passwordHash"],
                role,
                1 if default_user.get("enabled", True) else 0,
                _json_dumps(normalize_permissions(role, default_user.get("appPermissions"))),
                default_user.get("createdAt") or now_iso(),
                None,
                None,
            ),
        )
    audit(conn, None, "system.seed", {})


def audit(
    conn: sqlite3.Connection,
    actor: dict[str, Any] | None,
    action: str,
    detail: dict[str, Any] | None = None,
) -> None:
    conn.execute(
        """
        INSERT INTO audit_logs (id, action, actor_user_id, actor_name, detail, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (
            create_id("audit"),
            action,
            actor.get("id") if actor else "system",
            actor.get("name") if actor else "system",
            _json_dumps(detail or {}),
            now_iso(),
        ),
    )
    conn.execute(
        """
        DELETE FROM audit_logs
        WHERE id NOT IN (
            SELECT id FROM audit_logs ORDER BY created_at DESC LIMIT 500
        )
        """
    )


def purge_expired_auth_sessions(conn: sqlite3.Connection) -> None:
    conn.execute("DELETE FROM auth_sessions WHERE expires_at <= ?", (now_iso(),))


def purge_expired_usage_sessions(conn: sqlite3.Connection) -> None:
    cutoff = (
        datetime.now(timezone.utc) - timedelta(seconds=APP_USAGE_TTL_SECONDS)
    ).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    conn.execute("DELETE FROM app_usage_sessions WHERE last_active_at <= ?", (cutoff,))


def list_users(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    rows = conn.execute("SELECT * FROM users ORDER BY created_at ASC, id ASC").fetchall()
    return [_row_to_user(row) for row in rows if row]


def get_user_by_id(conn: sqlite3.Connection, user_id: str) -> dict[str, Any] | None:
    row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    return _row_to_user(row)


def get_enabled_user_by_id(conn: sqlite3.Connection, user_id: str) -> dict[str, Any] | None:
    user = get_user_by_id(conn, user_id)
    if not user or not user.get("enabled"):
        return None
    return user


def get_user_by_account(conn: sqlite3.Connection, account: str) -> dict[str, Any] | None:
    row = conn.execute("SELECT * FROM users WHERE account = ?", (normalize_account(account),)).fetchone()
    return _row_to_user(row)


def account_exists(conn: sqlite3.Connection, account: str, exclude_user_id: str | None = None) -> bool:
    normalized = normalize_account(account)
    if exclude_user_id:
        row = conn.execute(
            "SELECT 1 FROM users WHERE account = ? AND id <> ? LIMIT 1",
            (normalized, exclude_user_id),
        ).fetchone()
    else:
        row = conn.execute("SELECT 1 FROM users WHERE account = ? LIMIT 1", (normalized,)).fetchone()
    return row is not None


def create_user(conn: sqlite3.Connection, payload: dict[str, Any], actor: dict[str, Any]) -> dict[str, Any]:
    now = now_iso()
    role = str(payload["role"])
    hashed = hash_password(str(payload["password"]))
    user = {
        "id": create_id("user"),
        "name": payload["name"].strip(),
        "account": normalize_account(payload["account"]),
        "role": role,
        "enabled": True,
        "appPermissions": normalize_permissions(role, payload.get("appPermissions")),
        "createdAt": now,
        "updatedAt": None,
        "lastLoginAt": None,
        "passwordSalt": hashed["passwordSalt"],
        "passwordHash": hashed["passwordHash"],
    }
    conn.execute(
        """
        INSERT INTO users (
            id, name, account, password_salt, password_hash, role, enabled,
            app_permissions, created_at, updated_at, last_login_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            user["id"],
            user["name"],
            user["account"],
            user["passwordSalt"],
            user["passwordHash"],
            user["role"],
            1,
            _json_dumps(user["appPermissions"]),
            user["createdAt"],
            user["updatedAt"],
            user["lastLoginAt"],
        ),
    )
    audit(conn, actor, "user.create", {"targetUserId": user["id"], "account": user["account"]})
    return user


def update_user(conn: sqlite3.Connection, user_id: str, patch: dict[str, Any], actor: dict[str, Any]) -> dict[str, Any]:
    current = get_user_by_id(conn, user_id)
    if not current:
        raise KeyError("USER_NOT_FOUND")

    next_user = {**current}
    db_patch: dict[str, Any] = {}

    if "name" in patch:
        next_user["name"] = str(patch["name"]).strip()
        db_patch["name"] = next_user["name"]
    if "account" in patch:
        next_user["account"] = normalize_account(str(patch["account"]))
        db_patch["account"] = next_user["account"]
    if "role" in patch:
        next_user["role"] = str(patch["role"])
        db_patch["role"] = next_user["role"]
    if "enabled" in patch:
        next_user["enabled"] = bool(patch["enabled"])
        db_patch["enabled"] = 1 if next_user["enabled"] else 0

    if "appPermissions" in patch or "role" in patch:
        next_user["appPermissions"] = normalize_permissions(
            next_user["role"], patch.get("appPermissions", current.get("appPermissions"))
        )
        db_patch["app_permissions"] = _json_dumps(next_user["appPermissions"])

    if patch.get("password"):
        hashed = hash_password(str(patch["password"]))
        next_user["passwordSalt"] = hashed["passwordSalt"]
        next_user["passwordHash"] = hashed["passwordHash"]
        db_patch["password_salt"] = hashed["passwordSalt"]
        db_patch["password_hash"] = hashed["passwordHash"]

    db_patch["updated_at"] = now_iso()
    next_user["updatedAt"] = db_patch["updated_at"]

    assignments = ", ".join(f"{column} = ?" for column in db_patch)
    conn.execute(
        f"UPDATE users SET {assignments} WHERE id = ?",
        [*db_patch.values(), user_id],
    )
    audit(conn, actor, "user.update", {"targetUserId": user_id, "changedFields": list(db_patch)})
    return next_user


def would_remove_last_enabled_admin(conn: sqlite3.Connection, target_user_id: str, patch: dict[str, Any]) -> bool:
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


def create_auth_session(conn: sqlite3.Connection, user: dict[str, Any], client_id: str, token: str) -> None:
    now = now_iso()
    conn.execute(
        """
        INSERT INTO auth_sessions (token, user_id, client_id, created_at, last_active_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (token, user["id"], client_id, now, now, _expiry_iso(SESSION_TTL_SECONDS)),
    )
    conn.execute("UPDATE users SET last_login_at = ? WHERE id = ?", (now, user["id"]))
    audit(conn, sanitize_user(user), "auth.login", {"account": user["account"], "clientId": client_id})


def get_user_by_session_token(conn: sqlite3.Connection, token: str) -> dict[str, Any] | None:
    purge_expired_auth_sessions(conn)
    row = conn.execute(
        """
        SELECT users.*
        FROM auth_sessions
        JOIN users ON users.id = auth_sessions.user_id
        WHERE auth_sessions.token = ? AND auth_sessions.expires_at > ? AND users.enabled = 1
        """,
        (token, now_iso()),
    ).fetchone()
    if row is None:
        conn.execute("DELETE FROM auth_sessions WHERE token = ?", (token,))
        return None
    conn.execute(
        "UPDATE auth_sessions SET last_active_at = ?, expires_at = ? WHERE token = ?",
        (now_iso(), _expiry_iso(SESSION_TTL_SECONDS), token),
    )
    return _row_to_user(row)


def delete_auth_session(conn: sqlite3.Connection, token: str) -> None:
    conn.execute("DELETE FROM auth_sessions WHERE token = ?", (token,))


def leave_all_for_user_client(conn: sqlite3.Connection, user: dict[str, Any], client_id: str) -> None:
    conn.execute(
        "DELETE FROM app_usage_sessions WHERE user_id = ? AND client_id = ?",
        (user["id"], client_id),
    )


def upsert_app_usage_session(
    conn: sqlite3.Connection,
    user: dict[str, Any],
    app_id: str,
    client_id: str,
    confirmed_conflict: bool = False,
) -> None:
    purge_expired_usage_sessions(conn)
    session_id = f"{client_id}:{user['id']}:{app_id}"
    existing = conn.execute(
        "SELECT started_at, confirmed_conflict FROM app_usage_sessions WHERE id = ?",
        (session_id,),
    ).fetchone()
    now = now_iso()
    started_at = existing["started_at"] if existing else now
    confirmed = bool((existing and existing["confirmed_conflict"]) or confirmed_conflict)
    conn.execute(
        """
        INSERT INTO app_usage_sessions (
            id, app_id, client_id, user_id, user_name, started_at, last_active_at, confirmed_conflict
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            user_name = excluded.user_name,
            last_active_at = excluded.last_active_at,
            confirmed_conflict = excluded.confirmed_conflict
        """,
        (
            session_id,
            app_id,
            client_id,
            user["id"],
            user["name"],
            started_at,
            now,
            1 if confirmed else 0,
        ),
    )


def leave_app(conn: sqlite3.Connection, user: dict[str, Any], app_id: str, client_id: str) -> None:
    conn.execute(
        "DELETE FROM app_usage_sessions WHERE app_id = ? AND user_id = ? AND client_id = ?",
        (app_id, user["id"], client_id),
    )


def build_usage_summary(conn: sqlite3.Connection, current_user_id: str) -> list[dict[str, Any]]:
    purge_expired_usage_sessions(conn)
    rows = conn.execute("SELECT * FROM app_usage_sessions ORDER BY started_at ASC").fetchall()
    sessions = [_row_to_usage_session(row) for row in rows]
    summaries: list[dict[str, Any]] = []

    def unique(values: list[str]) -> list[str]:
        result: list[str] = []
        for value in values:
            if value and value not in result:
                result.append(value)
        return result

    for app_id in APP_IDS:
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


def count_recent_feedback_submissions(
    conn: sqlite3.Connection,
    *,
    kind: str,
    user_id: str,
    since_iso: str,
) -> int:
    row = conn.execute(
        """
        SELECT COUNT(*) AS count
        FROM feedback_submissions
        WHERE kind = ? AND user_id = ? AND submitted_at > ?
        """,
        (kind, user_id, since_iso),
    ).fetchone()
    return int(row["count"]) if row else 0


def record_feedback_submission(
    conn: sqlite3.Connection,
    *,
    kind: str,
    user_id: str,
    submitted_at: str,
) -> None:
    conn.execute(
        """
        INSERT INTO feedback_submissions (id, kind, user_id, submitted_at)
        VALUES (?, ?, ?, ?)
        """,
        (create_id("feedback"), kind, user_id, submitted_at),
    )
