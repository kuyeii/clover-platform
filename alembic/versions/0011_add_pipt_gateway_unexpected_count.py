"""add pipt gateway unexpected count

Revision ID: 0011_pipt_unexpected
Revises: 0010_core_pipt_gateway_events
Create Date: 2026-05-29
"""

from alembic import op
from sqlalchemy import text


revision = "0011_pipt_unexpected"
down_revision = "0010_core_pipt_gateway_events"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.get_bind().execute(
        text(
            """
            ALTER TABLE core.pipt_gateway_events
            ADD COLUMN IF NOT EXISTS unexpected_count INTEGER NOT NULL DEFAULT 0
            """
        )
    )


def downgrade() -> None:
    # 网关事件是安全审计数据，回滚迁移不删除历史计数字段。
    pass
