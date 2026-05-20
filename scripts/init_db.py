import sys
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import text
from sqlalchemy.engine import make_url

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from packages.py_common.config import get_settings  # noqa: E402
from packages.py_common.db.init_schema import init_database_schema  # noqa: E402
from packages.py_common.db.session import get_engine  # noqa: E402


def _safe_database_target() -> str:
    try:
        url = make_url(get_settings().resolved_database_url())
    except Exception as exc:
        return f"unresolved database URL ({exc})"
    return (
        f"host={url.host}, port={url.port or 5432}, "
        f"db={url.database}, user={url.username}"
    )


def main() -> int:
    load_dotenv(ROOT / ".env")
    try:
        engine = get_engine()
        with engine.connect() as conn:
            version = conn.execute(text("SELECT version()")).scalar_one()
        print(f"Connected to {version}")

        result = init_database_schema(engine)
        print("Created extension: pgcrypto")
        for schema in result.schemas:
            print(f"Ensured schema: {schema}")
        print("Ensured core tables")
        print("Ensured core indexes")
        for index in result.core_indexes:
            print(f"Ensured index: core.{index}")
        print("Ensured portal tables")
        print("Ensured portal indexes")
        for index in result.portal_indexes:
            print(f"Ensured index: portal.{index}")
        print("Ensured contract_review tables")
        print("Ensured contract_review indexes")
        for index in result.contract_review_indexes:
            print(f"Ensured index: contract_review.{index}")
        print("Ensured rag tables")
        print("Ensured rag indexes")
        for index in result.rag_indexes:
            print(f"Ensured index: rag.{index}")
        print("Ensured competitor_analysis tables")
        print("Ensured competitor_analysis indexes")
        for index in result.competitor_analysis_indexes:
            print(f"Ensured index: competitor_analysis.{index}")
        print("Ensured module_meta tables")
        print("Database initialization completed")
        return 0
    except Exception as exc:
        print(f"Database initialization failed for {_safe_database_target()}", file=sys.stderr)
        print(f"Error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
