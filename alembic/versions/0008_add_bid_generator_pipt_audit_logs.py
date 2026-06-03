"""add bid generator pipt audit logs

Revision ID: 0008_bid_pipt_audit_logs
Revises: 0007_bid_kb_images
Create Date: 2026-05-29
"""

from alembic import op
from sqlalchemy import text


revision = "0008_bid_pipt_audit_logs"
down_revision = "0007_bid_kb_images"
branch_labels = None
depends_on = None


CREATE_TABLE_SQL = """
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
"""

CREATE_INDEX_SQLS = (
    "CREATE INDEX IF NOT EXISTS idx_bid_pipt_audit_logs_operation ON bid_generator.pipt_audit_logs(operation)",
    "CREATE INDEX IF NOT EXISTS idx_bid_pipt_audit_logs_status ON bid_generator.pipt_audit_logs(status)",
    "CREATE INDEX IF NOT EXISTS idx_bid_pipt_audit_logs_project_id ON bid_generator.pipt_audit_logs(project_id)",
    "CREATE INDEX IF NOT EXISTS idx_bid_pipt_audit_logs_session_id ON bid_generator.pipt_audit_logs(session_id)",
    "CREATE INDEX IF NOT EXISTS idx_bid_pipt_audit_logs_placeholder ON bid_generator.pipt_audit_logs(placeholder)",
    "CREATE INDEX IF NOT EXISTS idx_bid_pipt_audit_logs_created_at ON bid_generator.pipt_audit_logs(created_at)",
)


def _execute(sql: str) -> None:
    op.get_bind().execute(text(sql))


def upgrade() -> None:
    _execute('CREATE SCHEMA IF NOT EXISTS "bid_generator"')
    _execute(CREATE_TABLE_SQL)
    for statement in CREATE_INDEX_SQLS:
        _execute(statement)


def downgrade() -> None:
    # 审计日志涉及问题追踪，不在自动回滚中删除历史数据。
    pass
