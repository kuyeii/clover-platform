from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from config import settings  # noqa: E402
from src.db_storage import ReviewDatabase  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Migrate existing data/{web_meta,uploads,runs} into SQLite storage.")
    parser.add_argument("--data-root", default=str(ROOT / "data"), help="Existing data directory. Default: ./data")
    parser.add_argument("--database-url", default=str(settings.database_url), help="SQLite URL/path. Default: settings.database_url")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    data_root = Path(args.data_root).expanduser().resolve()
    db = ReviewDatabase(args.database_url, base_dir=ROOT)
    web_meta = data_root / "web_meta"
    uploads = data_root / "uploads"
    runs = data_root / "runs"

    run_ids: set[str] = set()
    if web_meta.exists():
        for path in web_meta.glob("*.json"):
            run_ids.add(path.stem)
    if runs.exists():
        for path in runs.iterdir():
            if path.is_dir():
                run_ids.add(path.name)
    if uploads.exists():
        for path in uploads.iterdir():
            if path.is_file() and path.name.startswith("web_"):
                run_ids.add(path.stem)

    migrated = 0
    for run_id in sorted(run_ids):
        meta_path = web_meta / f"{run_id}.json"
        if meta_path.exists():
            try:
                meta = json.loads(meta_path.read_text(encoding="utf-8"))
                if isinstance(meta, dict):
                    db.replace_meta(run_id, meta)
                else:
                    db.ensure_run(run_id)
            except Exception:
                db.ensure_run(run_id)
        else:
            db.ensure_run(run_id)

        if uploads.exists():
            candidates = sorted(uploads.glob(f"{run_id}.*"), key=lambda p: p.stat().st_mtime, reverse=True)
            if candidates:
                db.save_file_from_path(run_id=run_id, kind="upload", path=candidates[0], filename=candidates[0].name)

        run_dir = runs / run_id
        if run_dir.exists():
            source = run_dir / "source.docx"
            if source.exists():
                db.save_file_from_path(run_id=run_id, kind="source_docx", path=source, filename=source.name)
            reviewed = run_dir / "reviewed_comments.docx"
            if reviewed.exists():
                db.save_file_from_path(run_id=run_id, kind="reviewed_docx", path=reviewed, filename=reviewed.name)
            db.sync_run_dir(run_id, run_dir)
        migrated += 1

    print(f"Migrated {migrated} review runs into {db.path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
