"""add rag tables

Revision ID: 0004_add_rag_tables
Revises: 0003_competitor_tables
Create Date: 2026-05-20
"""

from alembic import op
from sqlalchemy import text

from packages.py_common.db.ddl import CREATE_RAG_INDEX_SQLS, CREATE_RAG_TABLE_SQLS


revision = "0004_add_rag_tables"
down_revision = "0003_competitor_tables"
branch_labels = None
depends_on = None


def _execute(sql: str) -> None:
    op.get_bind().execute(text(sql))


def upgrade() -> None:
    _execute('CREATE SCHEMA IF NOT EXISTS "rag"')
    for statement in CREATE_RAG_TABLE_SQLS:
        _execute(statement)
    for statement in CREATE_RAG_INDEX_SQLS:
        _execute(statement)


def downgrade() -> None:
    # Intentionally non-destructive: do not drop RAG runtime conversations or chat turns.
    pass
