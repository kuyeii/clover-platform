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
    "pipt_gateway_events",
    "pipt_gateway_mappings",
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
    """
    CREATE TABLE IF NOT EXISTS core.pipt_gateway_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      request_id TEXT NOT NULL,
      module_code VARCHAR(100) NOT NULL,
      purpose VARCHAR(100) NOT NULL,
      operation VARCHAR(50) NOT NULL,
      status VARCHAR(50) NOT NULL,
      mode VARCHAR(50) NOT NULL DEFAULT 'compatibility',
      input_text_hash TEXT NULL,
      output_text_hash TEXT NULL,
      placeholder_count INTEGER NOT NULL DEFAULT 0,
      unsupported_count INTEGER NOT NULL DEFAULT 0,
      missing_count INTEGER NOT NULL DEFAULT 0,
      unexpected_count INTEGER NOT NULL DEFAULT 0,
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS core.pipt_gateway_mappings (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      request_id TEXT NOT NULL,
      module_code VARCHAR(100) NOT NULL,
      purpose VARCHAR(100) NOT NULL,
      placeholder TEXT NOT NULL,
      entity_type VARCHAR(100) NOT NULL,
      original_text_enc TEXT NOT NULL,
      original_text_hash TEXT NOT NULL,
      placeholder_protocol VARCHAR(50) NOT NULL DEFAULT 'strong',
      encryption_status VARCHAR(50) NOT NULL DEFAULT 'plaintext',
      expires_at TIMESTAMPTZ NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(request_id, placeholder)
    )
    """,
)

ALTER_CORE_TABLE_SQLS: tuple[str, ...] = (
    """
    ALTER TABLE core.pipt_gateway_events
    ADD COLUMN IF NOT EXISTS unexpected_count INTEGER NOT NULL DEFAULT 0
    """,
    """
    ALTER TABLE core.pipt_gateway_mappings
    ADD COLUMN IF NOT EXISTS encryption_status VARCHAR(50) NOT NULL DEFAULT 'plaintext'
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
    "CREATE INDEX IF NOT EXISTS idx_pipt_gateway_events_request_id ON core.pipt_gateway_events(request_id)",
    "CREATE INDEX IF NOT EXISTS idx_pipt_gateway_events_module_code ON core.pipt_gateway_events(module_code)",
    "CREATE INDEX IF NOT EXISTS idx_pipt_gateway_events_operation ON core.pipt_gateway_events(operation)",
    "CREATE INDEX IF NOT EXISTS idx_pipt_gateway_events_status ON core.pipt_gateway_events(status)",
    "CREATE INDEX IF NOT EXISTS idx_pipt_gateway_events_created_at ON core.pipt_gateway_events(created_at)",
    "CREATE INDEX IF NOT EXISTS idx_pipt_gateway_mappings_request_id ON core.pipt_gateway_mappings(request_id)",
    "CREATE INDEX IF NOT EXISTS idx_pipt_gateway_mappings_placeholder ON core.pipt_gateway_mappings(placeholder)",
    "CREATE INDEX IF NOT EXISTS idx_pipt_gateway_mappings_module_code ON core.pipt_gateway_mappings(module_code)",
    "CREATE INDEX IF NOT EXISTS idx_pipt_gateway_mappings_created_at ON core.pipt_gateway_mappings(created_at)",
    "CREATE INDEX IF NOT EXISTS idx_pipt_gateway_mappings_expires_at ON core.pipt_gateway_mappings(expires_at)",
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
    "idx_pipt_gateway_events_request_id",
    "idx_pipt_gateway_events_module_code",
    "idx_pipt_gateway_events_operation",
    "idx_pipt_gateway_events_status",
    "idx_pipt_gateway_events_created_at",
    "idx_pipt_gateway_mappings_request_id",
    "idx_pipt_gateway_mappings_placeholder",
    "idx_pipt_gateway_mappings_module_code",
    "idx_pipt_gateway_mappings_created_at",
    "idx_pipt_gateway_mappings_expires_at",
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

CONTRACT_REVIEW_TABLES: tuple[str, ...] = (
    "review_runs",
    "review_json_artifacts",
    "review_text_artifacts",
    "review_file_assets",
)

CREATE_CONTRACT_REVIEW_TABLE_SQLS: tuple[str, ...] = (
    """
    CREATE TABLE IF NOT EXISTS contract_review.review_runs (
      run_id TEXT PRIMARY KEY,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      status TEXT,
      file_name TEXT,
      review_side TEXT,
      contract_type_hint TEXT,
      analysis_scope TEXT,
      analysis_scope_label TEXT,
      step TEXT,
      progress INTEGER,
      error TEXT,
      warning TEXT,
      run_dir TEXT,
      document_ready BOOLEAN,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS contract_review.review_json_artifacts (
      run_id TEXT NOT NULL,
      artifact_name TEXT NOT NULL,
      payload JSONB NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (run_id, artifact_name),
      FOREIGN KEY (run_id) REFERENCES contract_review.review_runs(run_id) ON DELETE CASCADE
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS contract_review.review_text_artifacts (
      run_id TEXT NOT NULL,
      artifact_name TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (run_id, artifact_name),
      FOREIGN KEY (run_id) REFERENCES contract_review.review_runs(run_id) ON DELETE CASCADE
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS contract_review.review_file_assets (
      run_id TEXT NOT NULL,
      asset_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      mime_type TEXT,
      file_size BIGINT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (run_id, asset_name),
      FOREIGN KEY (run_id) REFERENCES contract_review.review_runs(run_id) ON DELETE CASCADE
    )
    """,
)

CREATE_CONTRACT_REVIEW_INDEX_SQLS: tuple[str, ...] = (
    """
    CREATE INDEX IF NOT EXISTS idx_contract_review_runs_updated_at
      ON contract_review.review_runs(updated_at DESC)
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_contract_review_runs_status
      ON contract_review.review_runs(status)
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_contract_review_json_artifacts_run
      ON contract_review.review_json_artifacts(run_id)
    """,
)

CONTRACT_REVIEW_INDEXES: tuple[str, ...] = (
    "idx_contract_review_runs_updated_at",
    "idx_contract_review_runs_status",
    "idx_contract_review_json_artifacts_run",
)

RAG_TABLES: tuple[str, ...] = (
    "conversations",
    "chat_turns",
    "knowledge_documents",
)

CREATE_RAG_TABLE_SQLS: tuple[str, ...] = (
    """
    CREATE TABLE IF NOT EXISTS rag.conversations (
      id UUID PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      session_id UUID NOT NULL,
      messages JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at_ms BIGINT NOT NULL,
      updated_at_ms BIGINT NOT NULL,
      pinned BOOLEAN NULL,
      pinned_at_ms BIGINT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS rag.chat_turns (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id TEXT NOT NULL,
      session_id UUID NOT NULL,
      user_message TEXT NOT NULL,
      assistant_message TEXT NOT NULL,
      meta JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS rag.knowledge_documents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      source_type TEXT NOT NULL DEFAULT 'file',
      original_content BYTEA NULL,
      content_text TEXT NOT NULL DEFAULT '',
      content_hash CHAR(64) NOT NULL DEFAULT repeat('0', 64),
      mime_type TEXT NULL,
      file_size BIGINT NULL,
      parse_status TEXT NOT NULL DEFAULT 'pending',
      privacy_status TEXT NOT NULL DEFAULT 'pending',
      has_sensitive BOOLEAN NOT NULL DEFAULT FALSE,
      sensitive_count INTEGER NOT NULL DEFAULT 0,
      sensitive_types JSONB NOT NULL DEFAULT '[]'::jsonb,
      recognition_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
      sync_status TEXT NOT NULL DEFAULT 'pending',
      dify_document_id TEXT NULL,
      dify_batch TEXT NULL,
      pipt_request_id TEXT NULL,
      pipt_mapping_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      parsed_at TIMESTAMPTZ NULL,
      synced_at TIMESTAMPTZ NULL
    )
    """,
)

CREATE_RAG_INDEX_SQLS: tuple[str, ...] = (
    """
    CREATE INDEX IF NOT EXISTS idx_rag_conversations_updated_at
      ON rag.conversations(updated_at_ms DESC)
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_rag_conversations_pinned_at
      ON rag.conversations(pinned_at_ms DESC)
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_rag_chat_turns_session_created
      ON rag.chat_turns(session_id, created_at DESC)
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_rag_chat_turns_user_created
      ON rag.chat_turns(user_id, created_at DESC)
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_rag_knowledge_documents_updated_at
      ON rag.knowledge_documents(updated_at DESC)
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_rag_knowledge_documents_sync_status
      ON rag.knowledge_documents(sync_status)
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_rag_knowledge_documents_has_sensitive
      ON rag.knowledge_documents(has_sensitive)
    """,
)

RAG_INDEXES: tuple[str, ...] = (
    "idx_rag_conversations_updated_at",
    "idx_rag_conversations_pinned_at",
    "idx_rag_chat_turns_session_created",
    "idx_rag_chat_turns_user_created",
    "idx_rag_knowledge_documents_updated_at",
    "idx_rag_knowledge_documents_sync_status",
    "idx_rag_knowledge_documents_has_sensitive",
)

COMPETITOR_ANALYSIS_TABLES: tuple[str, ...] = (
    "history_records",
    "storage_meta",
    "company_profiles",
    "company_validation_queries",
)

CREATE_COMPETITOR_ANALYSIS_TABLE_SQLS: tuple[str, ...] = (
    """
    CREATE TABLE IF NOT EXISTS competitor_analysis.history_records (
      id TEXT PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL,
      query_time TEXT NOT NULL,
      title TEXT NOT NULL,
      input_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      record_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      sort_order BIGINT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS competitor_analysis.storage_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS competitor_analysis.company_profiles (
      normalized_name TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      intro TEXT NOT NULL DEFAULT '',
      business TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS competitor_analysis.company_validation_queries (
      normalized_query TEXT PRIMARY KEY,
      query TEXT NOT NULL,
      candidate_items_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      response_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
)

CREATE_COMPETITOR_ANALYSIS_INDEX_SQLS: tuple[str, ...] = (
    "CREATE INDEX IF NOT EXISTS idx_competitor_history_records_sort_order ON competitor_analysis.history_records(sort_order DESC)",
    "CREATE INDEX IF NOT EXISTS idx_competitor_history_records_created_at ON competitor_analysis.history_records(created_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_competitor_company_profiles_updated_at ON competitor_analysis.company_profiles(updated_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_competitor_company_validation_queries_updated_at ON competitor_analysis.company_validation_queries(updated_at DESC)",
)

COMPETITOR_ANALYSIS_INDEXES: tuple[str, ...] = (
    "idx_competitor_history_records_sort_order",
    "idx_competitor_history_records_created_at",
    "idx_competitor_company_profiles_updated_at",
    "idx_competitor_company_validation_queries_updated_at",
)

BID_GENERATOR_TABLES: tuple[str, ...] = (
    "mapping_records",
    "entity_registry",
    "pipt_audit_logs",
    "image_registry",
    "knowledge_image_assets",
    "projects",
)

CREATE_BID_GENERATOR_TABLE_SQLS: tuple[str, ...] = (
    """
    CREATE TABLE IF NOT EXISTS bid_generator.mapping_records (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      placeholder TEXT NOT NULL,
      original_text TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS bid_generator.entity_registry (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      entity_key TEXT UNIQUE NOT NULL,
      entity_type TEXT NOT NULL,
      original_text_enc TEXT NOT NULL,
      placeholder TEXT UNIQUE NOT NULL,
      strong_placeholder TEXT UNIQUE NULL,
      global_index INTEGER NOT NULL,
      first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      hit_count INTEGER NOT NULL DEFAULT 1
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS bid_generator.pipt_audit_logs (
      id TEXT PRIMARY KEY,
      operation TEXT NOT NULL,
      status TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT '',
      session_id TEXT NULL,
      project_id TEXT NULL,
      task_id TEXT NULL,
      placeholder TEXT NULL,
      entity_type TEXT NULL,
      original_hash TEXT NULL,
      text_hash TEXT NULL,
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS bid_generator.image_registry (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      image_hash TEXT UNIQUE NOT NULL,
      project_id TEXT NULL,
      abs_path TEXT NOT NULL,
      preview_url TEXT NOT NULL,
      placeholder TEXT UNIQUE NOT NULL,
      vlm_caption TEXT NULL,
      is_reference_only INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS bid_generator.knowledge_image_assets (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      image_hash TEXT UNIQUE NOT NULL,
      placeholder TEXT UNIQUE NOT NULL,
      source_doc TEXT NOT NULL DEFAULT '',
      source_page INTEGER NULL,
      nearby_text_sanitized TEXT NULL,
      caption TEXT NOT NULL DEFAULT '',
      image_type TEXT NOT NULL DEFAULT '',
      summary TEXT NOT NULL DEFAULT '',
      tags_json TEXT NOT NULL DEFAULT '[]',
      caption_status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS bid_generator.projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'uploading',
      data TEXT NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
)

ALTER_BID_GENERATOR_TABLE_SQLS: tuple[str, ...] = (
    """
    ALTER TABLE bid_generator.entity_registry
    ADD COLUMN IF NOT EXISTS strong_placeholder TEXT NULL
    """,
)

CREATE_BID_GENERATOR_INDEX_SQLS: tuple[str, ...] = (
    "CREATE INDEX IF NOT EXISTS idx_bid_mapping_records_session_id ON bid_generator.mapping_records(session_id)",
    "CREATE INDEX IF NOT EXISTS idx_bid_mapping_records_placeholder ON bid_generator.mapping_records(placeholder)",
    "CREATE INDEX IF NOT EXISTS idx_bid_entity_registry_entity_key ON bid_generator.entity_registry(entity_key)",
    "CREATE INDEX IF NOT EXISTS idx_bid_entity_registry_placeholder ON bid_generator.entity_registry(placeholder)",
    "CREATE INDEX IF NOT EXISTS idx_bid_entity_registry_strong_placeholder ON bid_generator.entity_registry(strong_placeholder)",
    "CREATE INDEX IF NOT EXISTS idx_bid_entity_registry_entity_type ON bid_generator.entity_registry(entity_type)",
    "CREATE INDEX IF NOT EXISTS idx_bid_pipt_audit_logs_operation ON bid_generator.pipt_audit_logs(operation)",
    "CREATE INDEX IF NOT EXISTS idx_bid_pipt_audit_logs_status ON bid_generator.pipt_audit_logs(status)",
    "CREATE INDEX IF NOT EXISTS idx_bid_pipt_audit_logs_project_id ON bid_generator.pipt_audit_logs(project_id)",
    "CREATE INDEX IF NOT EXISTS idx_bid_pipt_audit_logs_session_id ON bid_generator.pipt_audit_logs(session_id)",
    "CREATE INDEX IF NOT EXISTS idx_bid_pipt_audit_logs_placeholder ON bid_generator.pipt_audit_logs(placeholder)",
    "CREATE INDEX IF NOT EXISTS idx_bid_pipt_audit_logs_created_at ON bid_generator.pipt_audit_logs(created_at)",
    "CREATE INDEX IF NOT EXISTS idx_bid_image_registry_image_hash ON bid_generator.image_registry(image_hash)",
    "CREATE INDEX IF NOT EXISTS idx_bid_image_registry_project_id ON bid_generator.image_registry(project_id)",
    "CREATE INDEX IF NOT EXISTS idx_bid_image_registry_placeholder ON bid_generator.image_registry(placeholder)",
    "CREATE INDEX IF NOT EXISTS idx_bid_knowledge_image_assets_image_hash ON bid_generator.knowledge_image_assets(image_hash)",
    "CREATE INDEX IF NOT EXISTS idx_bid_knowledge_image_assets_placeholder ON bid_generator.knowledge_image_assets(placeholder)",
    "CREATE INDEX IF NOT EXISTS idx_bid_knowledge_image_assets_source_doc ON bid_generator.knowledge_image_assets(source_doc)",
    "CREATE INDEX IF NOT EXISTS idx_bid_knowledge_image_assets_caption_status ON bid_generator.knowledge_image_assets(caption_status)",
    "CREATE INDEX IF NOT EXISTS idx_bid_projects_created_at ON bid_generator.projects(created_at)",
    "CREATE INDEX IF NOT EXISTS idx_bid_projects_updated_at ON bid_generator.projects(updated_at)",
    "CREATE INDEX IF NOT EXISTS idx_bid_projects_status ON bid_generator.projects(status)",
)

BID_GENERATOR_INDEXES: tuple[str, ...] = (
    "idx_bid_mapping_records_session_id",
    "idx_bid_mapping_records_placeholder",
    "idx_bid_entity_registry_entity_key",
    "idx_bid_entity_registry_placeholder",
    "idx_bid_entity_registry_strong_placeholder",
    "idx_bid_entity_registry_entity_type",
    "idx_bid_pipt_audit_logs_operation",
    "idx_bid_pipt_audit_logs_status",
    "idx_bid_pipt_audit_logs_project_id",
    "idx_bid_pipt_audit_logs_session_id",
    "idx_bid_pipt_audit_logs_placeholder",
    "idx_bid_pipt_audit_logs_created_at",
    "idx_bid_image_registry_image_hash",
    "idx_bid_image_registry_project_id",
    "idx_bid_image_registry_placeholder",
    "idx_bid_knowledge_image_assets_image_hash",
    "idx_bid_knowledge_image_assets_placeholder",
    "idx_bid_knowledge_image_assets_source_doc",
    "idx_bid_knowledge_image_assets_caption_status",
    "idx_bid_projects_created_at",
    "idx_bid_projects_updated_at",
    "idx_bid_projects_status",
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
