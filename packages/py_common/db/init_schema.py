from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import text
from sqlalchemy.engine import Connection, Engine

from .ddl import (
    CORE_INDEXES,
    CORE_TABLES,
    CREATE_CORE_INDEX_SQLS,
    CREATE_CORE_TABLE_SQLS,
    CREATE_EXTENSION_SQL,
    CREATE_MODULE_META_TABLE_SQLS,
    CREATE_SCHEMA_SQLS,
    SCHEMAS,
    UPSERT_MODULE_META_SQLS,
)


@dataclass(frozen=True)
class InitResult:
    schemas: tuple[str, ...]
    core_tables: tuple[str, ...]
    core_indexes: tuple[str, ...]
    module_meta_schemas: tuple[str, ...]


def _execute(conn: Connection, sql: str, params: dict | None = None) -> None:
    conn.execute(text(sql), params or {})


def init_database_schema(engine: Engine) -> InitResult:
    with engine.begin() as conn:
        _execute(conn, CREATE_EXTENSION_SQL)
        for statement in CREATE_SCHEMA_SQLS:
            _execute(conn, statement)
        for statement in CREATE_CORE_TABLE_SQLS:
            _execute(conn, statement)
        for statement in CREATE_CORE_INDEX_SQLS:
            _execute(conn, statement)
        for _, statement in CREATE_MODULE_META_TABLE_SQLS:
            _execute(conn, statement)
        for _, statement, params in UPSERT_MODULE_META_SQLS:
            _execute(conn, statement, params)

    return InitResult(
        schemas=SCHEMAS,
        core_tables=CORE_TABLES,
        core_indexes=CORE_INDEXES,
        module_meta_schemas=tuple(schema for schema, _ in CREATE_MODULE_META_TABLE_SQLS),
    )
