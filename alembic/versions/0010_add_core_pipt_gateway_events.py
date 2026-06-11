"""add core pipt gateway events and mappings

Revision ID: 0010_core_pipt_gateway_events
Revises: 0009_bid_pipt_strong_placeholder
Create Date: 2026-05-29
"""

from alembic import op
from sqlalchemy import text


revision = "0010_core_pipt_gateway_events"
down_revision = "0009_bid_pipt_strong_placeholder"
branch_labels = None
depends_on = None


CREATE_TABLE_SQL = """
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
"""

CREATE_MAPPING_TABLE_SQL = """
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
"""

CREATE_INDEX_SQLS = (
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


def _execute(sql: str) -> None:
    op.get_bind().execute(text(sql))


def upgrade() -> None:
    _execute('CREATE SCHEMA IF NOT EXISTS "core"')
    _execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")
    _execute(CREATE_TABLE_SQL)
    _execute("ALTER TABLE core.pipt_gateway_events ADD COLUMN IF NOT EXISTS unexpected_count INTEGER NOT NULL DEFAULT 0")
    _execute(CREATE_MAPPING_TABLE_SQL)
    _execute(
        "ALTER TABLE core.pipt_gateway_mappings "
        "ADD COLUMN IF NOT EXISTS encryption_status VARCHAR(50) NOT NULL DEFAULT 'plaintext'"
    )
    for statement in CREATE_INDEX_SQLS:
        _execute(statement)


def downgrade() -> None:
    # 网关事件用于安全审计和后续 superadmin 对接，不在自动回滚中删除历史数据。
    pass
