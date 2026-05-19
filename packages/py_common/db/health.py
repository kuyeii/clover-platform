from __future__ import annotations

from typing import Any

from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from .init_schema import CORE_TABLES, SCHEMAS
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
    except SQLAlchemyError as exc:
        return {"ok": False, "error": str(exc)}

    return {
        "ok": True,
        "version": server["version"],
        "database": server["database_name"],
        "user": server["user_name"],
        "schemas": schemas,
        "missing_schemas": sorted(set(SCHEMAS) - set(schemas)),
        "core_tables": tables,
        "missing_core_tables": sorted(set(CORE_TABLES) - set(tables)),
    }
