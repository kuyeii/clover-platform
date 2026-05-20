"""add contract review tables

Revision ID: 0005_contract_review_tables
Revises: 0004_add_rag_tables
Create Date: 2026-05-20
"""

from alembic import op
from sqlalchemy import text

from packages.py_common.db.ddl import (
    CREATE_CONTRACT_REVIEW_INDEX_SQLS,
    CREATE_CONTRACT_REVIEW_TABLE_SQLS,
)


revision = "0005_contract_review_tables"
down_revision = "0004_add_rag_tables"
branch_labels = None
depends_on = None


def _execute(sql: str) -> None:
    op.get_bind().execute(text(sql))


def upgrade() -> None:
    _execute('CREATE SCHEMA IF NOT EXISTS "contract_review"')
    for statement in CREATE_CONTRACT_REVIEW_TABLE_SQLS:
        _execute(statement)
    for statement in CREATE_CONTRACT_REVIEW_INDEX_SQLS:
        _execute(statement)


def downgrade() -> None:
    # Intentionally non-destructive: do not drop contract review run metadata or artifacts.
    pass
