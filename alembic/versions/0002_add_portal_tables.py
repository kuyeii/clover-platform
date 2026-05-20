"""add portal module tables

Revision ID: 0002_add_portal_tables
Revises: 0001_init_platform
Create Date: 2026-05-20
"""

from alembic import op
from sqlalchemy import text

from packages.py_common.db.ddl import CREATE_PORTAL_INDEX_SQLS, CREATE_PORTAL_TABLE_SQLS


revision = "0002_add_portal_tables"
down_revision = "0001_init_platform"
branch_labels = None
depends_on = None


def _execute(sql: str) -> None:
    op.get_bind().execute(text(sql))


def upgrade() -> None:
    _execute('CREATE SCHEMA IF NOT EXISTS "portal"')
    for statement in CREATE_PORTAL_TABLE_SQLS:
        _execute(statement)
    for statement in CREATE_PORTAL_INDEX_SQLS:
        _execute(statement)


def downgrade() -> None:
    # Intentionally non-destructive: do not drop Portal tables or user data.
    pass
