import hashlib
import json
import os
import secrets
import sys
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import text
from sqlalchemy.engine import make_url

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from packages.py_common.config import get_settings  # noqa: E402
from packages.py_common.db.init_schema import init_database_schema  # noqa: E402
from packages.py_common.db.session import get_engine  # noqa: E402

PASSWORD_SEPARATOR = "$"


def _normalize_account(account: str | None) -> str:
    return (account or "").strip().lower()


def _hash_password(password: str) -> dict[str, str]:
    password_salt = secrets.token_hex(16)
    password_hash = hashlib.scrypt(
        str(password).encode("utf-8"),
        salt=password_salt.encode("utf-8"),
        n=2**14,
        r=8,
        p=1,
        dklen=64,
    ).hex()
    return {"passwordSalt": password_salt, "passwordHash": password_hash}


def _encode_password(password_salt: str, password_hash: str) -> str:
    return f"{password_salt}{PASSWORD_SEPARATOR}{password_hash}"


def seed_default_admin(conn) -> bool:
    """Create the initial Portal admin for a new database if no admin exists."""
    admin_exists = conn.execute(
        text("SELECT EXISTS (SELECT 1 FROM core.users WHERE is_admin IS TRUE LIMIT 1)")
    ).scalar_one()
    if admin_exists:
        return False

    admin_username = _normalize_account(os.getenv("PORTAL_ADMIN_USERNAME", "admin"))
    admin_password = os.getenv("PORTAL_ADMIN_PASSWORD", "admin123456")
    admin_display_name = os.getenv("PORTAL_ADMIN_DISPLAY_NAME", "系统管理员")
    hashed = _hash_password(admin_password)
    row = (
        conn.execute(
            text(
                """
                INSERT INTO core.users (
                  username, display_name, password_hash, is_admin, is_active, created_at, updated_at
                )
                VALUES (
                  :username, :display_name, :password_hash, TRUE, TRUE, now(), now()
                )
                ON CONFLICT (username) DO UPDATE
                  SET is_admin = TRUE,
                      is_active = TRUE,
                      display_name = EXCLUDED.display_name,
                      password_hash = EXCLUDED.password_hash,
                      updated_at = now()
                RETURNING id
                """
            ),
            {
                "username": admin_username,
                "display_name": admin_display_name,
                "password_hash": _encode_password(hashed["passwordSalt"], hashed["passwordHash"]),
            },
        )
        .mappings()
        .one()
    )
    user_id = str(row["id"])
    conn.execute(
        text(
            """
            INSERT INTO portal.user_profiles (user_id, role)
            VALUES (:user_id, 'admin')
            ON CONFLICT (user_id) DO UPDATE
              SET role = 'admin',
                  updated_at = now()
            """
        ),
        {"user_id": user_id},
    )
    conn.execute(
        text(
            """
            INSERT INTO core.audit_logs (user_id, action, module_code, target_type, target_id, detail)
            VALUES (
              :user_id,
              'system.seed_default_admin',
              'portal',
              'user',
              :target_id,
              CAST(:detail AS jsonb)
            )
            """
        ),
        {
            "user_id": user_id,
            "target_id": user_id,
            "detail": json.dumps({"account": admin_username, "actorName": "system"}, ensure_ascii=False),
        },
    )
    return True


def _safe_database_target() -> str:
    try:
        url = make_url(get_settings().resolved_database_url())
    except Exception as exc:
        return f"unresolved database URL ({exc})"
    return (
        f"host={url.host}, port={url.port or 5432}, "
        f"db={url.database}, user={url.username}"
    )


def main() -> int:
    load_dotenv(ROOT / ".env")
    try:
        engine = get_engine()
        with engine.connect() as conn:
            version = conn.execute(text("SELECT version()")).scalar_one()
        print(f"Connected to {version}")

        result = init_database_schema(engine)
        with engine.begin() as conn:
            admin_created = seed_default_admin(conn)
        print("Created extension: pgcrypto")
        for schema in result.schemas:
            print(f"Ensured schema: {schema}")
        print("Ensured core tables")
        print("Ensured core indexes")
        for index in result.core_indexes:
            print(f"Ensured index: core.{index}")
        print("Ensured portal tables")
        print("Ensured portal indexes")
        for index in result.portal_indexes:
            print(f"Ensured index: portal.{index}")
        print("Ensured contract_review tables")
        print("Ensured contract_review indexes")
        for index in result.contract_review_indexes:
            print(f"Ensured index: contract_review.{index}")
        print("Ensured bid_generator tables")
        print("Ensured bid_generator indexes")
        for index in result.bid_generator_indexes:
            print(f"Ensured index: bid_generator.{index}")
        print("Ensured rag tables")
        print("Ensured rag indexes")
        for index in result.rag_indexes:
            print(f"Ensured index: rag.{index}")
        print("Ensured competitor_analysis tables")
        print("Ensured competitor_analysis indexes")
        for index in result.competitor_analysis_indexes:
            print(f"Ensured index: competitor_analysis.{index}")
        print("Ensured module_meta tables")
        if admin_created:
            print("Created default Portal admin")
        else:
            print("Default Portal admin already exists")
        print("Database initialization completed")
        return 0
    except Exception as exc:
        print(f"Database initialization failed for {_safe_database_target()}", file=sys.stderr)
        print(f"Error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
