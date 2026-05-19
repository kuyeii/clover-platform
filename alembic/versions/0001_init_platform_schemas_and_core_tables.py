"""init platform schemas and core tables

Revision ID: 0001_init_platform
Revises:
Create Date: 2026-05-19
"""

from alembic import op

from packages.py_common.db.init_schema import (
    create_core_tables,
    create_extension,
    create_module_meta_tables,
    create_schemas,
)


revision = "0001_init_platform"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    create_extension(conn)
    create_schemas(conn)
    create_core_tables(conn)
    create_module_meta_tables(conn)


def downgrade() -> None:
    pass
