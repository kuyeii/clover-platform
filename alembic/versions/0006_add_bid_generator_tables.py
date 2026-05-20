"""add bid generator pipt-lite tables

Revision ID: 0006_bid_generator_tables
Revises: 0005_contract_review_tables
Create Date: 2026-05-20
"""

from alembic import op
from sqlalchemy import text

from packages.py_common.db.ddl import (
    CREATE_BID_GENERATOR_INDEX_SQLS,
    CREATE_BID_GENERATOR_TABLE_SQLS,
)


revision = "0006_bid_generator_tables"
down_revision = "0005_contract_review_tables"
branch_labels = None
depends_on = None


def _execute(sql: str) -> None:
    op.get_bind().execute(text(sql))


def upgrade() -> None:
    _execute('CREATE SCHEMA IF NOT EXISTS "bid_generator"')
    for statement in CREATE_BID_GENERATOR_TABLE_SQLS:
        _execute(statement)
    for statement in CREATE_BID_GENERATOR_INDEX_SQLS:
        _execute(statement)


def downgrade() -> None:
    # Intentionally non-destructive: do not drop bid generator project or mapping data.
    pass
