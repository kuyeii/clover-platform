"""add patent disclosure tables

Revision ID: 0008_patent_disclosure
Revises: 0007_bid_kb_images
Create Date: 2026-05-28
"""

from alembic import op
from sqlalchemy import text


revision = "0008_patent_disclosure"
down_revision = "0007_bid_kb_images"
branch_labels = None
depends_on = None


CREATE_TABLE_SQLS = (
    """
    CREATE TABLE IF NOT EXISTS patent_disclosure.cases (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_user_id UUID NULL REFERENCES core.users(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      technical_topic TEXT NOT NULL DEFAULT '',
      applicant TEXT NOT NULL DEFAULT '',
      project_name TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft',
      anonymize BOOLEAN NOT NULL DEFAULT TRUE,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS patent_disclosure.materials (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      case_id UUID NOT NULL REFERENCES patent_disclosure.cases(id) ON DELETE CASCADE,
      core_file_id UUID NULL REFERENCES core.files(id) ON DELETE SET NULL,
      filename TEXT NOT NULL,
      material_type TEXT NOT NULL DEFAULT 'source',
      storage_path TEXT NOT NULL,
      mime_type TEXT,
      size_bytes BIGINT,
      parse_status TEXT NOT NULL DEFAULT 'pending',
      parsed_text_path TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS patent_disclosure.jobs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      case_id UUID NOT NULL REFERENCES patent_disclosure.cases(id) ON DELETE CASCADE,
      core_job_id UUID NULL REFERENCES core.jobs(id) ON DELETE SET NULL,
      job_type TEXT NOT NULL DEFAULT 'generate_disclosure',
      status TEXT NOT NULL DEFAULT 'pending',
      step TEXT NOT NULL DEFAULT 'pending',
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
    CREATE TABLE IF NOT EXISTS patent_disclosure.artifacts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      case_id UUID NOT NULL REFERENCES patent_disclosure.cases(id) ON DELETE CASCADE,
      job_id UUID NULL REFERENCES patent_disclosure.jobs(id) ON DELETE SET NULL,
      core_file_id UUID NULL REFERENCES core.files(id) ON DELETE SET NULL,
      artifact_type TEXT NOT NULL,
      version_no INTEGER NOT NULL DEFAULT 1,
      filename TEXT NOT NULL,
      storage_path TEXT NOT NULL,
      mime_type TEXT,
      size_bytes BIGINT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
)

CREATE_INDEX_SQLS = (
    "CREATE INDEX IF NOT EXISTS idx_patent_cases_owner ON patent_disclosure.cases(owner_user_id)",
    "CREATE INDEX IF NOT EXISTS idx_patent_cases_updated ON patent_disclosure.cases(updated_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_patent_materials_case ON patent_disclosure.materials(case_id)",
    "CREATE INDEX IF NOT EXISTS idx_patent_jobs_case ON patent_disclosure.jobs(case_id)",
    "CREATE INDEX IF NOT EXISTS idx_patent_jobs_status ON patent_disclosure.jobs(status)",
    "CREATE INDEX IF NOT EXISTS idx_patent_artifacts_case ON patent_disclosure.artifacts(case_id)",
    "CREATE INDEX IF NOT EXISTS idx_patent_artifacts_type ON patent_disclosure.artifacts(artifact_type)",
)


def _execute(sql: str) -> None:
    op.get_bind().execute(text(sql))


def upgrade() -> None:
    _execute("CREATE SCHEMA IF NOT EXISTS patent_disclosure")
    for statement in CREATE_TABLE_SQLS:
        _execute(statement)
    for statement in CREATE_INDEX_SQLS:
        _execute(statement)


def downgrade() -> None:
    pass

