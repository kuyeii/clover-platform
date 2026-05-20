from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import text
from sqlalchemy.engine import Connection, Engine

from .ddl import (
    CONTRACT_REVIEW_INDEXES,
    CONTRACT_REVIEW_TABLES,
    CORE_INDEXES,
    CORE_TABLES,
    COMPETITOR_ANALYSIS_INDEXES,
    COMPETITOR_ANALYSIS_TABLES,
    CREATE_COMPETITOR_ANALYSIS_INDEX_SQLS,
    CREATE_COMPETITOR_ANALYSIS_TABLE_SQLS,
    CREATE_CONTRACT_REVIEW_INDEX_SQLS,
    CREATE_CONTRACT_REVIEW_TABLE_SQLS,
    CREATE_CORE_INDEX_SQLS,
    CREATE_CORE_TABLE_SQLS,
    CREATE_EXTENSION_SQL,
    CREATE_MODULE_META_TABLE_SQLS,
    CREATE_PORTAL_INDEX_SQLS,
    CREATE_PORTAL_TABLE_SQLS,
    CREATE_RAG_INDEX_SQLS,
    CREATE_RAG_TABLE_SQLS,
    CREATE_SCHEMA_SQLS,
    PORTAL_INDEXES,
    PORTAL_TABLES,
    RAG_INDEXES,
    RAG_TABLES,
    SCHEMAS,
    UPSERT_MODULE_META_SQLS,
)


@dataclass(frozen=True)
class InitResult:
    schemas: tuple[str, ...]
    core_tables: tuple[str, ...]
    core_indexes: tuple[str, ...]
    portal_tables: tuple[str, ...]
    portal_indexes: tuple[str, ...]
    contract_review_tables: tuple[str, ...]
    contract_review_indexes: tuple[str, ...]
    rag_tables: tuple[str, ...]
    rag_indexes: tuple[str, ...]
    competitor_analysis_tables: tuple[str, ...]
    competitor_analysis_indexes: tuple[str, ...]
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
        for statement in CREATE_PORTAL_TABLE_SQLS:
            _execute(conn, statement)
        for statement in CREATE_PORTAL_INDEX_SQLS:
            _execute(conn, statement)
        for statement in CREATE_CONTRACT_REVIEW_TABLE_SQLS:
            _execute(conn, statement)
        for statement in CREATE_CONTRACT_REVIEW_INDEX_SQLS:
            _execute(conn, statement)
        for statement in CREATE_RAG_TABLE_SQLS:
            _execute(conn, statement)
        for statement in CREATE_RAG_INDEX_SQLS:
            _execute(conn, statement)
        for statement in CREATE_COMPETITOR_ANALYSIS_TABLE_SQLS:
            _execute(conn, statement)
        for statement in CREATE_COMPETITOR_ANALYSIS_INDEX_SQLS:
            _execute(conn, statement)
        for _, statement in CREATE_MODULE_META_TABLE_SQLS:
            _execute(conn, statement)
        for _, statement, params in UPSERT_MODULE_META_SQLS:
            _execute(conn, statement, params)

    return InitResult(
        schemas=SCHEMAS,
        core_tables=CORE_TABLES,
        core_indexes=CORE_INDEXES,
        portal_tables=PORTAL_TABLES,
        portal_indexes=PORTAL_INDEXES,
        contract_review_tables=CONTRACT_REVIEW_TABLES,
        contract_review_indexes=CONTRACT_REVIEW_INDEXES,
        rag_tables=RAG_TABLES,
        rag_indexes=RAG_INDEXES,
        competitor_analysis_tables=COMPETITOR_ANALYSIS_TABLES,
        competitor_analysis_indexes=COMPETITOR_ANALYSIS_INDEXES,
        module_meta_schemas=tuple(schema for schema, _ in CREATE_MODULE_META_TABLE_SQLS),
    )
