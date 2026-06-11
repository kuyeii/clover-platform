"""add rag knowledge documents

Revision ID: 0013_rag_kb_docs
Revises: 0012_pipt_map_encrypt
Create Date: 2026-05-29
"""

from alembic import op
from sqlalchemy import text


revision = "0013_rag_kb_docs"
down_revision = "0012_pipt_map_encrypt"
branch_labels = None
depends_on = None


CREATE_TABLE_SQL = """
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
"""

ALTER_TABLE_SQLS = (
    "ALTER TABLE rag.knowledge_documents ADD COLUMN IF NOT EXISTS original_content BYTEA NULL",
    "ALTER TABLE rag.knowledge_documents ALTER COLUMN content_text SET DEFAULT ''",
    "ALTER TABLE rag.knowledge_documents ALTER COLUMN content_hash SET DEFAULT repeat('0', 64)",
    "ALTER TABLE rag.knowledge_documents ADD COLUMN IF NOT EXISTS parse_status TEXT NOT NULL DEFAULT 'pending'",
    "ALTER TABLE rag.knowledge_documents ADD COLUMN IF NOT EXISTS parsed_at TIMESTAMPTZ NULL",
)

INDEX_SQLS = (
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


def _execute(sql: str) -> None:
    op.get_bind().execute(text(sql))


def upgrade() -> None:
    _execute('CREATE SCHEMA IF NOT EXISTS "rag"')
    _execute(CREATE_TABLE_SQL)
    for statement in ALTER_TABLE_SQLS:
        _execute(statement)
    for statement in INDEX_SQLS:
        _execute(statement)


def downgrade() -> None:
    # RAG knowledge documents may contain user-uploaded source material; rollback is non-destructive.
    pass
