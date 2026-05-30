"""add pipt gateway mapping encryption status

Revision ID: 0012_pipt_map_encrypt
Revises: 0011_pipt_unexpected
Create Date: 2026-05-29
"""

from alembic import op
from sqlalchemy import text


revision = "0012_pipt_map_encrypt"
down_revision = "0011_pipt_unexpected"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.get_bind().execute(
        text(
            """
            ALTER TABLE core.pipt_gateway_mappings
            ADD COLUMN IF NOT EXISTS encryption_status VARCHAR(50) NOT NULL DEFAULT 'plaintext'
            """
        )
    )


def downgrade() -> None:
    # 网关 mapping vault 是可逆脱敏恢复数据，回滚不删除安全状态字段。
    pass
