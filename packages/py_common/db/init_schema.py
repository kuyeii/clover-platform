from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import text
from sqlalchemy.engine import Connection, Engine


SCHEMAS: tuple[str, ...] = (
    "core",
    "portal",
    "contract_review",
    "bid_generator",
    "rag",
    "competitor_analysis",
)

CORE_TABLES: tuple[str, ...] = (
    "users",
    "sessions",
    "user_app_permissions",
    "app_usage_sessions",
    "audit_logs",
    "files",
    "jobs",
)

MODULE_META: tuple[tuple[str, str, str], ...] = (
    ("portal", "portal", "统一入口"),
    ("contract_review", "contract-review", "合同审查"),
    ("bid_generator", "bid-generator", "标书生成"),
    ("rag", "rag-web-search", "RAG 问答"),
    ("competitor_analysis", "competitor-analysis", "竞对分析"),
)


@dataclass(frozen=True)
class InitResult:
    schemas: tuple[str, ...]
    core_tables: tuple[str, ...]
    module_meta_schemas: tuple[str, ...]


def _execute(conn: Connection, sql: str, params: dict | None = None) -> None:
    conn.execute(text(sql), params or {})


def create_extension(conn: Connection) -> None:
    _execute(conn, "CREATE EXTENSION IF NOT EXISTS pgcrypto")


def create_schemas(conn: Connection) -> None:
    for schema in SCHEMAS:
        _execute(conn, f'CREATE SCHEMA IF NOT EXISTS "{schema}"')


def create_core_tables(conn: Connection) -> None:
    statements = [
        """
        CREATE TABLE IF NOT EXISTS core.users (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          username VARCHAR(100) UNIQUE NOT NULL,
          display_name VARCHAR(100),
          password_hash TEXT NOT NULL,
          is_admin BOOLEAN NOT NULL DEFAULT FALSE,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          tenant_id UUID NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS core.sessions (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
          token TEXT UNIQUE NOT NULL,
          expires_at TIMESTAMPTZ NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS core.user_app_permissions (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
          app_code VARCHAR(100) NOT NULL,
          can_access BOOLEAN NOT NULL DEFAULT TRUE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          UNIQUE(user_id, app_code)
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS core.app_usage_sessions (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          app_code VARCHAR(100) NOT NULL,
          user_id UUID NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
          username VARCHAR(100),
          display_name VARCHAR(100),
          entered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          expires_at TIMESTAMPTZ NULL,
          metadata JSONB NOT NULL DEFAULT '{}'::jsonb
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS core.audit_logs (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID NULL REFERENCES core.users(id) ON DELETE SET NULL,
          action VARCHAR(100) NOT NULL,
          module_code VARCHAR(100),
          target_type VARCHAR(100),
          target_id TEXT,
          detail JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS core.files (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          module_code VARCHAR(100) NOT NULL,
          owner_user_id UUID NULL REFERENCES core.users(id) ON DELETE SET NULL,
          tenant_id UUID NULL,
          filename TEXT NOT NULL,
          storage_backend VARCHAR(50) NOT NULL DEFAULT 'local',
          storage_path TEXT NOT NULL,
          mime_type VARCHAR(200),
          size_bytes BIGINT,
          metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS core.jobs (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          module_code VARCHAR(100) NOT NULL,
          job_type VARCHAR(100) NOT NULL,
          status VARCHAR(50) NOT NULL,
          progress INTEGER NOT NULL DEFAULT 0,
          input JSONB NOT NULL DEFAULT '{}'::jsonb,
          output JSONB NOT NULL DEFAULT '{}'::jsonb,
          error_message TEXT,
          created_by UUID NULL REFERENCES core.users(id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          finished_at TIMESTAMPTZ NULL
        )
        """,
    ]
    for statement in statements:
        _execute(conn, statement)


def create_module_meta_tables(conn: Connection) -> None:
    for schema, module_code, display_name in MODULE_META:
        _execute(
            conn,
            f"""
            CREATE TABLE IF NOT EXISTS "{schema}".module_meta (
              id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
              module_code VARCHAR(100) UNIQUE NOT NULL,
              display_name VARCHAR(100) NOT NULL,
              status VARCHAR(50) NOT NULL DEFAULT 'active',
              metadata JSONB NOT NULL DEFAULT '{{}}'::jsonb,
              created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
              updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
            """,
        )
        _execute(
            conn,
            f"""
            INSERT INTO "{schema}".module_meta (module_code, display_name)
            VALUES (:module_code, :display_name)
            ON CONFLICT (module_code) DO UPDATE
              SET display_name = EXCLUDED.display_name,
                  updated_at = now()
            """,
            {"module_code": module_code, "display_name": display_name},
        )


def init_database_schema(engine: Engine) -> InitResult:
    with engine.begin() as conn:
        create_extension(conn)
        create_schemas(conn)
        create_core_tables(conn)
        create_module_meta_tables(conn)
    return InitResult(
        schemas=SCHEMAS,
        core_tables=CORE_TABLES,
        module_meta_schemas=tuple(schema for schema, _, _ in MODULE_META),
    )
