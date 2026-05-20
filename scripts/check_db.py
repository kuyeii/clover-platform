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

    print("Contract review tables:")
    for table in result["contract_review_tables"]:
        print(f"  - contract_review.{table}")

    if result["missing_contract_review_tables"]:
        print("Missing contract_review tables:")
        for table in result["missing_contract_review_tables"]:
            print(f"  - contract_review.{table}")
        print("Contract review tables are missing. Run: python scripts/init_db.py && alembic upgrade head")
        return 2

    print("Contract review indexes:")
    for index in result["contract_review_indexes"]:
        print(f"  - contract_review.{index}")

    if result["missing_contract_review_indexes"]:
        print("Missing contract_review indexes:")
        for index in result["missing_contract_review_indexes"]:
            print(f"  - contract_review.{index}")
        print("Contract review indexes are missing. Run: python scripts/init_db.py && alembic upgrade head")
        return 2

    print("Bid generator tables:")
    for table in result["bid_generator_tables"]:
        print(f"  - bid_generator.{table}")

    if result["missing_bid_generator_tables"]:
        print("Missing bid_generator tables:")
        for table in result["missing_bid_generator_tables"]:
            print(f"  - bid_generator.{table}")
        print("Bid generator tables are missing. Run: python scripts/init_db.py && alembic upgrade head")
        return 2

    print("Bid generator indexes:")
    for index in result["bid_generator_indexes"]:
        print(f"  - bid_generator.{index}")

    if result["missing_bid_generator_indexes"]:
        print("Missing bid_generator indexes:")
        for index in result["missing_bid_generator_indexes"]:
            print(f"  - bid_generator.{index}")
        print("Bid generator indexes are missing. Run: python scripts/init_db.py && alembic upgrade head")
        return 2

    print("RAG tables:")
    for table in result["rag_tables"]:
        print(f"  - rag.{table}")

    if result["missing_rag_tables"]:
        print("Missing RAG tables:")
        for table in result["missing_rag_tables"]:
            print(f"  - rag.{table}")
        print("RAG tables are missing. Run: python scripts/init_db.py && alembic upgrade head")
        return 2

    print("RAG indexes:")
    for index in result["rag_indexes"]:
        print(f"  - rag.{index}")

    if result["missing_rag_indexes"]:
        print("Missing RAG indexes:")
        for index in result["missing_rag_indexes"]:
            print(f"  - rag.{index}")
        print("RAG indexes are missing. Run: python scripts/init_db.py && alembic upgrade head")
        return 2

    print("Competitor analysis tables:")
    for table in result["competitor_analysis_tables"]:
        print(f"  - competitor_analysis.{table}")

    if result["missing_competitor_analysis_tables"]:
        print("Missing competitor_analysis tables:")
        for table in result["missing_competitor_analysis_tables"]:
            print(f"  - competitor_analysis.{table}")
        print("Competitor analysis tables are missing. Run: python scripts/init_db.py && alembic upgrade head")
        return 2

    print("Competitor analysis indexes:")
    for index in result["competitor_analysis_indexes"]:
        print(f"  - competitor_analysis.{index}")

    if result["missing_competitor_analysis_indexes"]:
        print("Missing competitor_analysis indexes:")
        for index in result["missing_competitor_analysis_indexes"]:
            print(f"  - competitor_analysis.{index}")
        print("Competitor analysis indexes are missing. Run: python scripts/init_db.py && alembic upgrade head")
        return 2

    if result["missing_schemas"]:
        print("Database connection OK, but required schemas are missing. Run: python scripts/init_db.py")
        return 2

    print("Database health check completed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
