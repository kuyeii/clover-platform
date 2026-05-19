from __future__ import annotations

import argparse
from pathlib import Path

from src.sqlite_store import import_legacy_meta_files, import_legacy_run_json_files, init_db


def main() -> int:
    parser = argparse.ArgumentParser(description="Import legacy data/web_meta and data/runs JSON files into SQLite.")
    parser.add_argument("--db", default="data/contract_review.sqlite3", help="SQLite DB path")
    parser.add_argument("--web-meta-root", default="data/web_meta", help="legacy web metadata directory")
    parser.add_argument("--run-root", default="data/runs", help="legacy run artifacts directory")
    parser.add_argument("--limit-runs", type=int, default=None, help="only import newest N run directories")
    parser.add_argument("--meta-only", action="store_true", help="only import run metadata, skip run JSON artifacts")
    args = parser.parse_args()

    db_path = Path(args.db)
    init_db(db_path)
    meta_count = import_legacy_meta_files(db_path=db_path, web_meta_root=Path(args.web_meta_root))
    artifact_count = 0
    if not args.meta_only:
        artifact_count = import_legacy_run_json_files(
            db_path=db_path,
            run_root=Path(args.run_root),
            limit_runs=args.limit_runs,
        )
    print(f"Imported {meta_count} metadata files and {artifact_count} run JSON artifacts into {db_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
