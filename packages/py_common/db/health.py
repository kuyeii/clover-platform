from __future__ import annotations

from typing import Any

from sqlalchemy import text

from .ddl import (
    COMPETITOR_ANALYSIS_INDEXES,
    COMPETITOR_ANALYSIS_TABLES,
    CONTRACT_REVIEW_INDEXES,
    CONTRACT_REVIEW_TABLES,
    CORE_INDEXES,
    CORE_TABLES,
    MODULE_META,
    PORTAL_INDEXES,
    PORTAL_TABLES,
    RAG_INDEXES,
    RAG_TABLES,
    SCHEMAS,
)
from .session import get_engine


def check_database_connection() -> dict[str, Any]:
    try:
        with get_engine().connect() as conn:
            server = conn.execute(
                text(
                    """
                    SELECT
                      version() AS version,
                      current_database() AS database_name,
                      current_user AS user_name
                    """
                )
            ).mappings().one()
            schemas = [
                row[0]
                for row in conn.execute(
                    text(
                        """
                        SELECT schema_name
                        FROM information_schema.schemata
                        WHERE schema_name = ANY(:schemas)
                        ORDER BY schema_name
                        """
                    ),
                    {"schemas": list(SCHEMAS)},
                )
            ]
            tables = [
                row[0]
                for row in conn.execute(
                    text(
                        """
                        SELECT table_name
                        FROM information_schema.tables
                        WHERE table_schema = 'core'
                          AND table_name = ANY(:tables)
                        ORDER BY table_name
                        """
                    ),
                    {"tables": list(CORE_TABLES)},
                )
            ]
            module_meta_tables = [
                row[0]
                for row in conn.execute(
                    text(
                        """
                        SELECT table_schema
                        FROM information_schema.tables
                        WHERE table_name = 'module_meta'
                          AND table_schema = ANY(:schemas)
                        ORDER BY table_schema
                        """
                    ),
                    {"schemas": [schema for schema, _, _ in MODULE_META]},
                )
            ]
            core_indexes = [
                row[0]
                for row in conn.execute(
                    text(
                        """
                        SELECT indexname
                        FROM pg_indexes
                        WHERE schemaname = 'core'
                          AND indexname = ANY(:indexes)
                        ORDER BY indexname
                        """
                    ),
                    {"indexes": list(CORE_INDEXES)},
                )
            ]
            portal_tables = [
                row[0]
                for row in conn.execute(
                    text(
                        """
                        SELECT table_name
                        FROM information_schema.tables
                        WHERE table_schema = 'portal'
                          AND table_name = ANY(:tables)
                        ORDER BY table_name
                        """
                    ),
                    {"tables": list(PORTAL_TABLES)},
                )
            ]
            portal_indexes = [
                row[0]
                for row in conn.execute(
                    text(
                        """
                        SELECT indexname
                        FROM pg_indexes
                        WHERE schemaname = 'portal'
                          AND indexname = ANY(:indexes)
                        ORDER BY indexname
                        """
                    ),
                    {"indexes": list(PORTAL_INDEXES)},
                )
            ]
            contract_review_tables = [
                row[0]
                for row in conn.execute(
                    text(
                        """
                        SELECT table_name
                        FROM information_schema.tables
                        WHERE table_schema = 'contract_review'
                          AND table_name = ANY(:tables)
                        ORDER BY table_name
                        """
                    ),
                    {"tables": list(CONTRACT_REVIEW_TABLES)},
                )
            ]
            contract_review_indexes = [
                row[0]
                for row in conn.execute(
                    text(
                        """
                        SELECT indexname
                        FROM pg_indexes
                        WHERE schemaname = 'contract_review'
                          AND indexname = ANY(:indexes)
                        ORDER BY indexname
                        """
                    ),
                    {"indexes": list(CONTRACT_REVIEW_INDEXES)},
                )
            ]
            rag_tables = [
                row[0]
                for row in conn.execute(
                    text(
                        """
                        SELECT table_name
                        FROM information_schema.tables
                        WHERE table_schema = 'rag'
                          AND table_name = ANY(:tables)
                        ORDER BY table_name
                        """
                    ),
                    {"tables": list(RAG_TABLES)},
                )
            ]
            rag_indexes = [
                row[0]
                for row in conn.execute(
                    text(
                        """
                        SELECT indexname
                        FROM pg_indexes
                        WHERE schemaname = 'rag'
                          AND indexname = ANY(:indexes)
                        ORDER BY indexname
                        """
                    ),
                    {"indexes": list(RAG_INDEXES)},
                )
            ]
            competitor_analysis_tables = [
                row[0]
                for row in conn.execute(
                    text(
                        """
                        SELECT table_name
                        FROM information_schema.tables
                        WHERE table_schema = 'competitor_analysis'
                          AND table_name = ANY(:tables)
                        ORDER BY table_name
                        """
                    ),
                    {"tables": list(COMPETITOR_ANALYSIS_TABLES)},
                )
            ]
            competitor_analysis_indexes = [
                row[0]
                for row in conn.execute(
                    text(
                        """
                        SELECT indexname
                        FROM pg_indexes
                        WHERE schemaname = 'competitor_analysis'
                          AND indexname = ANY(:indexes)
                        ORDER BY indexname
                        """
                    ),
                    {"indexes": list(COMPETITOR_ANALYSIS_INDEXES)},
                )
            ]
    except Exception as exc:
        return {"ok": False, "error": str(exc), "error_type": exc.__class__.__name__}

    module_meta_schemas = tuple(schema for schema, _, _ in MODULE_META)
    return {
        "ok": True,
        "version": server["version"],
        "database": server["database_name"],
        "user": server["user_name"],
        "schemas": schemas,
        "missing_schemas": sorted(set(SCHEMAS) - set(schemas)),
        "core_tables": tables,
        "missing_core_tables": sorted(set(CORE_TABLES) - set(tables)),
        "module_meta_tables": module_meta_tables,
        "missing_module_meta_tables": sorted(set(module_meta_schemas) - set(module_meta_tables)),
        "core_indexes": core_indexes,
        "missing_core_indexes": sorted(set(CORE_INDEXES) - set(core_indexes)),
        "portal_tables": portal_tables,
        "missing_portal_tables": sorted(set(PORTAL_TABLES) - set(portal_tables)),
        "portal_indexes": portal_indexes,
        "missing_portal_indexes": sorted(set(PORTAL_INDEXES) - set(portal_indexes)),
        "contract_review_tables": contract_review_tables,
        "missing_contract_review_tables": sorted(set(CONTRACT_REVIEW_TABLES) - set(contract_review_tables)),
        "contract_review_indexes": contract_review_indexes,
        "missing_contract_review_indexes": sorted(set(CONTRACT_REVIEW_INDEXES) - set(contract_review_indexes)),
        "rag_tables": rag_tables,
        "missing_rag_tables": sorted(set(RAG_TABLES) - set(rag_tables)),
        "rag_indexes": rag_indexes,
        "missing_rag_indexes": sorted(set(RAG_INDEXES) - set(rag_indexes)),
        "competitor_analysis_tables": competitor_analysis_tables,
        "missing_competitor_analysis_tables": sorted(
            set(COMPETITOR_ANALYSIS_TABLES) - set(competitor_analysis_tables)
        ),
        "competitor_analysis_indexes": competitor_analysis_indexes,
        "missing_competitor_analysis_indexes": sorted(
            set(COMPETITOR_ANALYSIS_INDEXES) - set(competitor_analysis_indexes)
        ),
    }
