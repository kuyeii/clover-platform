import sys
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy.engine import make_url

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from packages.py_common.config import get_settings  # noqa: E402
from packages.py_common.db.health import check_database_connection  # noqa: E402


def _safe_database_target() -> str:
    try:
        url = make_url(get_settings().resolved_database_url())
    except Exception as exc:
        return f"unresolved database URL: {exc}"
    return (
        f"host={url.host}, port={url.port or 5432}, "
        f"db={url.database}, user={url.username}"
    )


def main() -> int:
    load_dotenv(ROOT / ".env")
    result = check_database_connection()
    if not result["ok"]:
        print(f"Failed to connect to PostgreSQL {_safe_database_target()}", file=sys.stderr)
        print(f"Error: {result['error']}", file=sys.stderr)
        return 1

    print("Database connection OK")
    print(f"PostgreSQL version: {result['version']}")
    print(f"Database: {result['database']}")
    print(f"User: {result['user']}")
    print("Schemas:")
    for schema in result["schemas"]:
        print(f"  - {schema}")

    if result["missing_schemas"]:
        print("Missing schemas:")
        for schema in result["missing_schemas"]:
            print(f"  - {schema}")

    print("Core tables:")
    for table in result["core_tables"]:
        print(f"  - core.{table}")

    if result["missing_core_tables"]:
        print("Missing core tables:")
        for table in result["missing_core_tables"]:
            print(f"  - core.{table}")
        print("Database connection OK, but core tables are missing. Run: python scripts/init_db.py")
        return 2

    print("Module meta tables:")
    for schema in result["module_meta_tables"]:
        print(f"  - {schema}.module_meta")

    if result["missing_module_meta_tables"]:
        print("Missing module_meta tables:")
        for schema in result["missing_module_meta_tables"]:
            print(f"  - {schema}.module_meta")
        print("Database connection OK, but module_meta tables are missing. Run: python scripts/init_db.py")
        return 2

    print("Core indexes:")
    for index in result["core_indexes"]:
        print(f"  - core.{index}")

    if result["missing_core_indexes"]:
        print("Missing core indexes:")
        for index in result["missing_core_indexes"]:
            print(f"  - core.{index}")
        print("Database connection OK, but core indexes are missing. Run: python scripts/init_db.py")
        return 2

    print("Portal tables:")
    for table in result["portal_tables"]:
        print(f"  - portal.{table}")

    if result["missing_portal_tables"]:
        print("Missing Portal tables:")
        for table in result["missing_portal_tables"]:
            print(f"  - portal.{table}")
        print("Portal tables are missing. Run: python scripts/init_db.py && alembic upgrade head")
        return 2

    print("Portal indexes:")
    for index in result["portal_indexes"]:
        print(f"  - portal.{index}")

    if result["missing_portal_indexes"]:
        print("Missing Portal indexes:")
        for index in result["missing_portal_indexes"]:
            print(f"  - portal.{index}")
        print("Portal indexes are missing. Run: python scripts/init_db.py && alembic upgrade head")
        return 2

    if result["missing_schemas"]:
        print("Database connection OK, but required schemas are missing. Run: python scripts/init_db.py")
        return 2

    print("Database health check completed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
