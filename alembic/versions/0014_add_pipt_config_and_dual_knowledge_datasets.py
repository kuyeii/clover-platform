"""add pipt config and dual knowledge datasets

Revision ID: 0014_pipt_config_dual_kb
Revises: 0013_rag_kb_docs
Create Date: 2026-06-09
"""

from alembic import op
from sqlalchemy import text


revision = "0014_pipt_config_dual_kb"
down_revision = "0013_rag_kb_docs"
branch_labels = None
depends_on = None


def _execute(sql: str) -> None:
    op.get_bind().execute(text(sql))


def upgrade() -> None:
    _execute('CREATE SCHEMA IF NOT EXISTS "core"')
    _execute('CREATE SCHEMA IF NOT EXISTS "rag"')
    _execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")
    _execute(
        """
        CREATE TABLE IF NOT EXISTS core.pipt_custom_entity_types (
          code VARCHAR(100) PRIMARY KEY,
          label TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          examples JSONB NOT NULL DEFAULT '[]'::jsonb,
          regex_rules JSONB NOT NULL DEFAULT '[]'::jsonb,
          enabled BOOLEAN NOT NULL DEFAULT TRUE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    _execute(
        """
        CREATE TABLE IF NOT EXISTS core.pipt_task_configs (
          module_code VARCHAR(100) PRIMARY KEY,
          enabled BOOLEAN NOT NULL DEFAULT TRUE,
          enabled_entity_types JSONB NOT NULL DEFAULT '[]'::jsonb,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    _execute(
        """
        INSERT INTO core.pipt_task_configs (module_code, enabled, enabled_entity_types)
        VALUES
          ('contract-review', TRUE, '["name","phone","id_number","email","addr","bank","car_id","ip","org","credit_code"]'::jsonb),
          ('bid-generator', TRUE, '["name","phone","id_number","email"]'::jsonb)
        ON CONFLICT (module_code) DO NOTHING
        """
    )
    for statement in (
        "ALTER TABLE rag.knowledge_documents ADD COLUMN IF NOT EXISTS raw_dify_document_id TEXT NULL",
        "ALTER TABLE rag.knowledge_documents ADD COLUMN IF NOT EXISTS raw_dify_batch TEXT NULL",
        "ALTER TABLE rag.knowledge_documents ADD COLUMN IF NOT EXISTS raw_sync_status TEXT NOT NULL DEFAULT 'pending'",
        "ALTER TABLE rag.knowledge_documents ADD COLUMN IF NOT EXISTS desensitized_dify_document_id TEXT NULL",
        "ALTER TABLE rag.knowledge_documents ADD COLUMN IF NOT EXISTS desensitized_dify_batch TEXT NULL",
        "ALTER TABLE rag.knowledge_documents ADD COLUMN IF NOT EXISTS desensitized_sync_status TEXT NOT NULL DEFAULT 'pending'",
        """
        UPDATE rag.knowledge_documents
        SET desensitized_dify_document_id = COALESCE(desensitized_dify_document_id, dify_document_id),
            desensitized_dify_batch = COALESCE(desensitized_dify_batch, dify_batch),
            desensitized_sync_status = CASE
              WHEN dify_document_id IS NOT NULL AND sync_status = 'synced' THEN 'synced'
              ELSE desensitized_sync_status
            END
        WHERE dify_document_id IS NOT NULL
        """,
        """
        CREATE INDEX IF NOT EXISTS idx_rag_knowledge_documents_raw_sync_status
          ON rag.knowledge_documents(raw_sync_status)
        """,
        """
        CREATE INDEX IF NOT EXISTS idx_rag_knowledge_documents_desensitized_sync_status
          ON rag.knowledge_documents(desensitized_sync_status)
        """,
    ):
        _execute(statement)


def downgrade() -> None:
    # PIPT 配置与知识库双库同步状态属于运行配置和业务审计数据，回滚不自动删除。
    pass
