"""add competitor analysis tables

Revision ID: 0003_competitor_tables
Revises: 0002_add_portal_tables
Create Date: 2026-05-20
"""

from alembic import op
from sqlalchemy import text

from packages.py_common.db.ddl import (
    CREATE_COMPETITOR_ANALYSIS_INDEX_SQLS,
    CREATE_COMPETITOR_ANALYSIS_TABLE_SQLS,
)


revision = "0003_competitor_tables"
down_revision = "0002_add_portal_tables"
branch_labels = None
depends_on = None


def _execute(sql: str) -> None:
    op.get_bind().execute(text(sql))


def upgrade() -> None:
    _execute('CREATE SCHEMA IF NOT EXISTS "competitor_analysis"')
    for statement in CREATE_COMPETITOR_ANALYSIS_TABLE_SQLS:
        _execute(statement)
    for statement in CREATE_COMPETITOR_ANALYSIS_INDEX_SQLS:
        _execute(statement)


def downgrade() -> None:
    # Intentionally non-destructive: do not drop competitor analysis runtime data.
    pass
