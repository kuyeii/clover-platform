from __future__ import annotations

import argparse
import sys
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import text
from sqlalchemy.engine import make_url

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from packages.py_common.config import get_settings  # noqa: E402
from packages.py_common.db.session import get_engine  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Clear superadmin PIPT gateway mapping vault rows.",
    )
    parser.add_argument(
        "--yes",
        action="store_true",
        help="Actually delete rows. Without this flag the script only prints counts.",
    )
    parser.add_argument(
        "--include-events",
        action="store_true",
        help="Also delete core.pipt_gateway_events audit rows. Default keeps audit events.",
    )
    return parser.parse_args()


def _safe_database_target() -> str:
    try:
        url = make_url(get_settings().resolved_database_url())
    except Exception as exc:
        return f"unresolved database URL ({exc})"
    return f"host={url.host}, port={url.port or 5432}, db={url.database}, user={url.username}"


def _table_exists(conn, table_name: str) -> bool:
    return bool(conn.execute(text("SELECT to_regclass(:table_name) IS NOT NULL"), {"table_name": table_name}).scalar_one())


def _count_rows(conn, table_name: str) -> int:
    return int(conn.execute(text(f"SELECT COUNT(*) FROM {table_name}")).scalar_one())


def main() -> int:
    args = parse_args()
    load_dotenv(ROOT / ".env")

    try:
        with get_engine().begin() as conn:
            mappings_exists = _table_exists(conn, "core.pipt_gateway_mappings")
            events_exists = _table_exists(conn, "core.pipt_gateway_events")
            if not mappings_exists:
                print("core.pipt_gateway_mappings does not exist. Run scripts/init_db.py first.")
                return 2

            mappings_before = _count_rows(conn, "core.pipt_gateway_mappings")
            events_before = _count_rows(conn, "core.pipt_gateway_events") if events_exists else 0

            print(f"Database: {_safe_database_target()}")
            print(f"core.pipt_gateway_mappings rows: {mappings_before}")
            print(f"core.pipt_gateway_events rows: {events_before}" if events_exists else "core.pipt_gateway_events does not exist")

            if not args.yes:
                print("Dry run only. Re-run with --yes to delete mapping vault rows.")
                return 0

            deleted_mappings = conn.execute(text("DELETE FROM core.pipt_gateway_mappings")).rowcount or 0
            deleted_events = 0
            if args.include_events and events_exists:
                deleted_events = conn.execute(text("DELETE FROM core.pipt_gateway_events")).rowcount or 0

            mappings_after = _count_rows(conn, "core.pipt_gateway_mappings")
            events_after = _count_rows(conn, "core.pipt_gateway_events") if events_exists else 0

            print(f"Deleted core.pipt_gateway_mappings rows: {deleted_mappings}")
            if args.include_events:
                print(f"Deleted core.pipt_gateway_events rows: {deleted_events}")
            else:
                print("Kept core.pipt_gateway_events audit rows.")
            print(f"core.pipt_gateway_mappings rows: {mappings_before} -> {mappings_after}")
            if events_exists:
                print(f"core.pipt_gateway_events rows: {events_before} -> {events_after}")
            return 0
    except Exception as exc:
        print(f"Failed to clear PIPT gateway mappings on {_safe_database_target()}", file=sys.stderr)
        print(f"Error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
