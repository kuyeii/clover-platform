"""add bid generator pipt strong placeholder

Revision ID: 0009_bid_pipt_strong_placeholder
Revises: 0008_bid_pipt_audit_logs
Create Date: 2026-05-29
"""

from alembic import op
from sqlalchemy import text


revision = "0009_bid_pipt_strong_placeholder"
down_revision = "0008_bid_pipt_audit_logs"
branch_labels = None
depends_on = None


def _execute(sql: str) -> None:
    op.get_bind().execute(text(sql))


def upgrade() -> None:
    _execute("ALTER TABLE bid_generator.entity_registry ADD COLUMN IF NOT EXISTS strong_placeholder TEXT NULL")
    _execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_bid_entity_registry_strong_placeholder "
        "ON bid_generator.entity_registry(strong_placeholder) WHERE strong_placeholder IS NOT NULL"
    )
    _execute(
        "CREATE INDEX IF NOT EXISTS idx_bid_entity_registry_strong_placeholder "
        "ON bid_generator.entity_registry(strong_placeholder)"
    )


def downgrade() -> None:
    _execute("DROP INDEX IF EXISTS bid_generator.idx_bid_entity_registry_strong_placeholder")
    _execute("DROP INDEX IF EXISTS bid_generator.uq_bid_entity_registry_strong_placeholder")
    _execute("ALTER TABLE bid_generator.entity_registry DROP COLUMN IF EXISTS strong_placeholder")
