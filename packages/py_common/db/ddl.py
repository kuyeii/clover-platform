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

CREATE_EXTENSION_SQL = "CREATE EXTENSION IF NOT EXISTS pgcrypto"

CREATE_SCHEMA_SQLS: tuple[str, ...] = tuple(
    f'CREATE SCHEMA IF NOT EXISTS "{schema}"' for schema in SCHEMAS
)

CREATE_CORE_TABLE_SQLS: tuple[str, ...] = (
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
)

CREATE_CORE_INDEX_SQLS: tuple[str, ...] = (
    "CREATE INDEX IF NOT EXISTS idx_app_usage_sessions_app_code ON core.app_usage_sessions(app_code)",
    "CREATE INDEX IF NOT EXISTS idx_app_usage_sessions_user_id ON core.app_usage_sessions(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_app_usage_sessions_expires_at ON core.app_usage_sessions(expires_at)",
    "CREATE INDEX IF NOT EXISTS idx_audit_logs_module_code ON core.audit_logs(module_code)",
    "CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON core.audit_logs(created_at)",
    "CREATE INDEX IF NOT EXISTS idx_files_module_code ON core.files(module_code)",
    "CREATE INDEX IF NOT EXISTS idx_files_owner_user_id ON core.files(owner_user_id)",
    "CREATE INDEX IF NOT EXISTS idx_jobs_module_code ON core.jobs(module_code)",
    "CREATE INDEX IF NOT EXISTS idx_jobs_status ON core.jobs(status)",
    "CREATE INDEX IF NOT EXISTS idx_jobs_created_by ON core.jobs(created_by)",
)

CORE_INDEXES: tuple[str, ...] = (
    "idx_app_usage_sessions_app_code",
    "idx_app_usage_sessions_user_id",
    "idx_app_usage_sessions_expires_at",
    "idx_audit_logs_module_code",
    "idx_audit_logs_created_at",
    "idx_files_module_code",
    "idx_files_owner_user_id",
    "idx_jobs_module_code",
    "idx_jobs_status",
    "idx_jobs_created_by",
)

PORTAL_TABLES: tuple[str, ...] = (
    "user_profiles",
    "feedback_submissions",
)

CREATE_PORTAL_TABLE_SQLS: tuple[str, ...] = (
    """
    CREATE TABLE IF NOT EXISTS portal.user_profiles (
      user_id UUID PRIMARY KEY REFERENCES core.users(id) ON DELETE CASCADE,
      role VARCHAR(50) NOT NULL DEFAULT 'operator',
      last_login_at TIMESTAMPTZ NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS portal.feedback_submissions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      kind VARCHAR(50) NOT NULL CHECK(kind IN ('ticket', 'feature_request')),
      user_id UUID NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
      submitted_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
)

CREATE_PORTAL_INDEX_SQLS: tuple[str, ...] = (
    """
    CREATE INDEX IF NOT EXISTS idx_feedback_submissions_lookup
      ON portal.feedback_submissions(kind, user_id, submitted_at)
    """,
)

PORTAL_INDEXES: tuple[str, ...] = (
    "idx_feedback_submissions_lookup",
)

CREATE_MODULE_META_TABLE_SQLS: tuple[tuple[str, str], ...] = tuple(
    (
        schema,
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
    for schema, _, _ in MODULE_META
)

UPSERT_MODULE_META_SQLS: tuple[tuple[str, str, dict[str, str]], ...] = tuple(
    (
        schema,
        f"""
        INSERT INTO "{schema}".module_meta (module_code, display_name)
        VALUES (:module_code, :display_name)
        ON CONFLICT (module_code) DO UPDATE
          SET display_name = EXCLUDED.display_name,
              updated_at = now()
        """,
        {"module_code": module_code, "display_name": display_name},
    )
    for schema, module_code, display_name in MODULE_META
)
