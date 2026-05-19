"""init platform schemas and core tables

Revision ID: 0001_init_platform
Revises:
Create Date: 2026-05-19
"""

from alembic import op
from sqlalchemy import text

from packages.py_common.db.ddl import (
    CREATE_CORE_INDEX_SQLS,
    CREATE_CORE_TABLE_SQLS,
    CREATE_EXTENSION_SQL,
    CREATE_MODULE_META_TABLE_SQLS,
    CREATE_SCHEMA_SQLS,
    UPSERT_MODULE_META_SQLS,
)


revision = "0001_init_platform"
down_revision = None
branch_labels = None
depends_on = None


def _execute(sql: str, params: dict | None = None) -> None:
    op.get_bind().execute(text(sql), params or {})


def upgrade() -> None:
    _execute(CREATE_EXTENSION_SQL)
    for statement in CREATE_SCHEMA_SQLS:
        _execute(statement)
    for statement in CREATE_CORE_TABLE_SQLS:
        _execute(statement)
    for statement in CREATE_CORE_INDEX_SQLS:
        _execute(statement)
    for _, statement in CREATE_MODULE_META_TABLE_SQLS:
        _execute(statement)
    for _, statement, params in UPSERT_MODULE_META_SQLS:
        _execute(statement, params)


def downgrade() -> None:
    pass
