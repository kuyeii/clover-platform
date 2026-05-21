from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import datetime, timezone
from typing import Any


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def normalize_account(account: str | None) -> str:
    return (account or "").strip().lower()


def hash_password(password: str, salt: str | None = None) -> dict[str, str]:
    resolved_salt = salt or secrets.token_hex(16)
    key = hashlib.scrypt(
        str(password).encode("utf-8"),
        salt=resolved_salt.encode("utf-8"),
        n=2**14,
        r=8,
        p=1,
        dklen=64,
    )
    return {"passwordSalt": resolved_salt, "passwordHash": key.hex()}


def verify_password(password: str, user: dict[str, Any]) -> bool:
    password_hash = user.get("passwordHash")
    password_salt = user.get("passwordSalt")
    if not password_hash or not password_salt:
        return False
    actual_hash = hash_password(password, str(password_salt))["passwordHash"]
    return hmac.compare_digest(str(password_hash), actual_hash)


def create_token() -> str:
    return secrets.token_urlsafe(48)


def sanitize_user(user: dict[str, Any]) -> dict[str, Any]:
    hidden_keys = {"passwordHash", "passwordSalt", "initialPassword"}
    return {key: value for key, value in user.items() if key not in hidden_keys}


def sanitize_users(users: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [sanitize_user(user) for user in users]
