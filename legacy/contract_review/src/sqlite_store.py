from __future__ import annotations

import json
import os
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Any, Iterator


BASE_DIR = Path(__file__).resolve().parent.parent
DEFAULT_DB_PATH = BASE_DIR / "data" / "contract_review.sqlite3"
DEFAULT_RUN_ROOT = BASE_DIR / "data" / "runs"
DEFAULT_WEB_META_ROOT = BASE_DIR / "data" / "web_meta"

_DB_WRITE_LOCK = threading.RLock()
_INITIALIZED_DB_PATHS: set[str] = set()
_DEFAULT_BUSY_TIMEOUT_MS = int(os.getenv("SQLITE_BUSY_TIMEOUT_MS", "5000"))


def _utc_now() -> str:
    return datetime.utcnow().isoformat() + "Z"


def _json_dumps(payload: Any) -> str:
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


def _json_loads(value: str | None, default: Any = None) -> Any:
    if not value:
        return default
    try:
        return json.loads(value)
    except Exception:
        return default


def get_db_path(db_path: str | Path | None = None) -> Path:
    configured = db_path or os.getenv("SQLITE_DB_PATH") or os.getenv("CONTRACT_REVIEW_DB_PATH")
    path = Path(configured) if configured else DEFAULT_DB_PATH
    if not path.is_absolute():
        path = BASE_DIR / path
    return path


def get_run_root(run_root: str | Path | None = None) -> Path:
    configured = run_root or os.getenv("RUN_ROOT")
    path = Path(configured) if configured else DEFAULT_RUN_ROOT
    if not path.is_absolute():
        path = BASE_DIR / path
    return path


def get_web_meta_root(web_meta_root: str | Path | None = None) -> Path:
    configured = web_meta_root or os.getenv("WEB_META_ROOT")
    path = Path(configured) if configured else DEFAULT_WEB_META_ROOT
    if not path.is_absolute():
        path = BASE_DIR / path
    return path


@contextmanager
def connect(db_path: str | Path | None = None) -> Iterator[sqlite3.Connection]:
    path = get_db_path(db_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path), timeout=max(1, _DEFAULT_BUSY_TIMEOUT_MS // 1000), isolation_level=None)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.execute(f"PRAGMA busy_timeout={_DEFAULT_BUSY_TIMEOUT_MS}")
        conn.execute("PRAGMA foreign_keys=ON")
        yield conn
    finally:
        conn.close()


def init_db(db_path: str | Path | None = None) -> None:
    path = get_db_path(db_path)
    cache_key = str(path.resolve())
    if cache_key in _INITIALIZED_DB_PATHS:
        return
    with _DB_WRITE_LOCK:
        if cache_key in _INITIALIZED_DB_PATHS:
            return
        with connect(path) as conn:
            conn.execute("PRAGMA journal_mode=WAL")
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS schema_migrations (
                    version INTEGER PRIMARY KEY,
                    applied_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS review_runs (
                    run_id TEXT PRIMARY KEY,
                    payload_json TEXT NOT NULL DEFAULT '{}',
                    status TEXT,
                    file_name TEXT,
                    review_side TEXT,
                    contract_type_hint TEXT,
                    analysis_scope TEXT,
                    analysis_scope_label TEXT,
                    step TEXT,
                    progress INTEGER,
                    error TEXT,
                    warning TEXT,
                    run_dir TEXT,
                    document_ready INTEGER,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_review_runs_updated_at
                    ON review_runs(updated_at DESC);

                CREATE INDEX IF NOT EXISTS idx_review_runs_status
                    ON review_runs(status);

                CREATE TABLE IF NOT EXISTS review_json_artifacts (
                    run_id TEXT NOT NULL,
                    artifact_name TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (run_id, artifact_name),
                    FOREIGN KEY (run_id) REFERENCES review_runs(run_id) ON DELETE CASCADE
                );

                CREATE INDEX IF NOT EXISTS idx_review_json_artifacts_run
                    ON review_json_artifacts(run_id);

                CREATE TABLE IF NOT EXISTS review_text_artifacts (
                    run_id TEXT NOT NULL,
                    artifact_name TEXT NOT NULL,
                    content TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (run_id, artifact_name),
                    FOREIGN KEY (run_id) REFERENCES review_runs(run_id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS review_file_assets (
                    run_id TEXT NOT NULL,
                    asset_name TEXT NOT NULL,
                    file_path TEXT NOT NULL,
                    mime_type TEXT,
                    file_size INTEGER,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (run_id, asset_name),
                    FOREIGN KEY (run_id) REFERENCES review_runs(run_id) ON DELETE CASCADE
                );
                """
            )
            conn.execute(
                "INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (?, ?)",
                (1, _utc_now()),
            )
            _INITIALIZED_DB_PATHS.add(cache_key)

def _normalize_bool_int(value: Any) -> int | None:
    if value is None:
        return None
    return 1 if bool(value) else 0


def _normalize_progress(value: Any) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except Exception:
        return None


def upsert_review_meta(run_id: str, payload: dict[str, Any], db_path: str | Path | None = None, *, touch: bool = True) -> dict[str, Any]:
    run_id = str(run_id or payload.get("run_id") or "").strip()
    if not run_id:
        raise ValueError("run_id is required")
    with _DB_WRITE_LOCK:
        init_db(db_path)
        now = _utc_now()
        with connect(db_path) as conn:
            row = conn.execute("SELECT payload_json, created_at FROM review_runs WHERE run_id = ?", (run_id,)).fetchone()
            current = _json_loads(row["payload_json"], {}) if row else {}
            if not isinstance(current, dict):
                current = {}
            merged = dict(current)
            merged.update(dict(payload or {}))
            merged["run_id"] = run_id
            previous_updated_at = str(current.get("updated_at") or "")
            next_updated_at = now if touch else str(merged.get("updated_at") or previous_updated_at or now)
            merged["updated_at"] = next_updated_at
            created_at = row["created_at"] if row else str(merged.get("created_at") or now)
            merged.setdefault("created_at", created_at)
            conn.execute(
                """
                INSERT INTO review_runs(
                    run_id, payload_json, status, file_name, review_side, contract_type_hint,
                    analysis_scope, analysis_scope_label, step, progress, error, warning,
                    run_dir, document_ready, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(run_id) DO UPDATE SET
                    payload_json = excluded.payload_json,
                    status = excluded.status,
                    file_name = excluded.file_name,
                    review_side = excluded.review_side,
                    contract_type_hint = excluded.contract_type_hint,
                    analysis_scope = excluded.analysis_scope,
                    analysis_scope_label = excluded.analysis_scope_label,
                    step = excluded.step,
                    progress = excluded.progress,
                    error = excluded.error,
                    warning = excluded.warning,
                    run_dir = excluded.run_dir,
                    document_ready = excluded.document_ready,
                    updated_at = excluded.updated_at
                """,
                (
                    run_id,
                    _json_dumps(merged),
                    str(merged.get("status") or "") or None,
                    str(merged.get("file_name") or "") or None,
                    str(merged.get("review_side") or "") or None,
                    str(merged.get("contract_type_hint") or "") or None,
                    str(merged.get("analysis_scope") or "") or None,
                    str(merged.get("analysis_scope_label") or "") or None,
                    str(merged.get("step") or "") or None,
                    _normalize_progress(merged.get("progress")),
                    str(merged.get("error") or "") or None,
                    str(merged.get("warning") or "") or None,
                    str(merged.get("run_dir") or "") or None,
                    _normalize_bool_int(merged.get("document_ready")) if "document_ready" in merged else None,
                    created_at,
                    str(merged.get("updated_at") or now),
                ),
            )
            return merged

def get_review_meta(run_id: str, db_path: str | Path | None = None) -> dict[str, Any] | None:
    run_id = str(run_id or "").strip()
    if not run_id:
        return None
    init_db(db_path)
    with connect(db_path) as conn:
        row = conn.execute("SELECT payload_json FROM review_runs WHERE run_id = ?", (run_id,)).fetchone()
    if not row:
        return None
    payload = _json_loads(row["payload_json"], {})
    if not isinstance(payload, dict):
        payload = {}
    payload.setdefault("run_id", run_id)
    return payload


def list_review_meta(limit: int = 200, db_path: str | Path | None = None) -> list[dict[str, Any]]:
    init_db(db_path)
    with connect(db_path) as conn:
        rows = conn.execute(
            "SELECT run_id, payload_json FROM review_runs ORDER BY updated_at DESC LIMIT ?",
            (int(limit),),
        ).fetchall()
    items: list[dict[str, Any]] = []
    for row in rows:
        payload = _json_loads(row["payload_json"], {})
        if not isinstance(payload, dict):
            payload = {}
        payload.setdefault("run_id", row["run_id"])
        items.append(payload)
    return items


def _relative_to(path: Path, root: Path) -> Path | None:
    try:
        return path.resolve().relative_to(root.resolve())
    except Exception:
        return None


def artifact_identity_from_path(path: Path, run_root: str | Path | None = None) -> tuple[str, str] | None:
    root = get_run_root(run_root)
    rel = _relative_to(path, root)
    if rel is None or len(rel.parts) < 2:
        return None
    run_id = rel.parts[0]
    artifact_name = "/".join(rel.parts[1:])
    if not run_id or not artifact_name:
        return None
    return run_id, artifact_name


def ensure_run_placeholder(run_id: str, run_dir: Path | None = None, db_path: str | Path | None = None) -> None:
    existing = get_review_meta(run_id, db_path=db_path)
    if existing is not None:
        return
    payload: dict[str, Any] = {"run_id": run_id}
    if run_dir is not None:
        payload["run_dir"] = str(run_dir)
    upsert_review_meta(run_id, payload, db_path=db_path)


def store_json_artifact(
    run_id: str,
    artifact_name: str,
    payload: Any,
    *,
    db_path: str | Path | None = None,
    run_dir: Path | None = None,
) -> None:
    run_id = str(run_id or "").strip()
    artifact_name = str(artifact_name or "").strip().replace("\\", "/")
    if not run_id or not artifact_name:
        return
    with _DB_WRITE_LOCK:
        init_db(db_path)
        ensure_run_placeholder(run_id, run_dir=run_dir, db_path=db_path)
        now = _utc_now()
        with connect(db_path) as conn:
            conn.execute(
                """
                INSERT INTO review_json_artifacts(run_id, artifact_name, payload_json, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(run_id, artifact_name) DO UPDATE SET
                    payload_json = excluded.payload_json,
                    updated_at = excluded.updated_at
                """,
                (run_id, artifact_name, _json_dumps(payload), now, now),
            )

def load_json_artifact(
    run_id: str,
    artifact_name: str,
    *,
    db_path: str | Path | None = None,
) -> Any | None:
    run_id = str(run_id or "").strip()
    artifact_name = str(artifact_name or "").strip().replace("\\", "/")
    if not run_id or not artifact_name:
        return None
    init_db(db_path)
    with connect(db_path) as conn:
        row = conn.execute(
            "SELECT payload_json FROM review_json_artifacts WHERE run_id = ? AND artifact_name = ?",
            (run_id, artifact_name),
        ).fetchone()
    if not row:
        return None
    return _json_loads(row["payload_json"], None)


def store_json_artifact_by_path(
    path: Path,
    payload: Any,
    *,
    db_path: str | Path | None = None,
    run_root: str | Path | None = None,
) -> None:
    identity = artifact_identity_from_path(path, run_root=run_root)
    if identity is None:
        return
    run_id, artifact_name = identity
    store_json_artifact(run_id, artifact_name, payload, db_path=db_path, run_dir=path.parent)


def load_json_artifact_by_path(
    path: Path,
    *,
    db_path: str | Path | None = None,
    run_root: str | Path | None = None,
) -> Any | None:
    identity = artifact_identity_from_path(path, run_root=run_root)
    if identity is None:
        return None
    run_id, artifact_name = identity
    return load_json_artifact(run_id, artifact_name, db_path=db_path)


def store_text_artifact_by_path(
    path: Path,
    content: str,
    *,
    db_path: str | Path | None = None,
    run_root: str | Path | None = None,
) -> None:
    identity = artifact_identity_from_path(path, run_root=run_root)
    if identity is None:
        return
    run_id, artifact_name = identity
    with _DB_WRITE_LOCK:
        init_db(db_path)
        ensure_run_placeholder(run_id, run_dir=path.parent, db_path=db_path)
        now = _utc_now()
        with connect(db_path) as conn:
            conn.execute(
                """
                INSERT INTO review_text_artifacts(run_id, artifact_name, content, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(run_id, artifact_name) DO UPDATE SET
                    content = excluded.content,
                    updated_at = excluded.updated_at
                """,
                (run_id, artifact_name, str(content or ""), now, now),
            )

def register_file_asset_by_path(
    path: Path,
    *,
    asset_name: str | None = None,
    mime_type: str | None = None,
    db_path: str | Path | None = None,
    run_root: str | Path | None = None,
) -> None:
    identity = artifact_identity_from_path(path, run_root=run_root)
    if identity is None:
        return
    run_id, inferred_name = identity
    name = str(asset_name or inferred_name).replace("\\", "/")
    try:
        size = path.stat().st_size
    except Exception:
        size = None
    with _DB_WRITE_LOCK:
        init_db(db_path)
        ensure_run_placeholder(run_id, run_dir=path.parent, db_path=db_path)
        now = _utc_now()
        with connect(db_path) as conn:
            conn.execute(
                """
                INSERT INTO review_file_assets(run_id, asset_name, file_path, mime_type, file_size, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(run_id, asset_name) DO UPDATE SET
                    file_path = excluded.file_path,
                    mime_type = excluded.mime_type,
                    file_size = excluded.file_size,
                    updated_at = excluded.updated_at
                """,
                (run_id, name, str(path), mime_type, size, now, now),
            )

def import_legacy_meta_files(
    *,
    db_path: str | Path | None = None,
    web_meta_root: str | Path | None = None,
    limit: int | None = None,
) -> int:
    root = get_web_meta_root(web_meta_root)
    if not root.exists():
        init_db(db_path)
        return 0
    count = 0
    files = sorted(root.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
    if limit is not None:
        files = files[: max(0, int(limit))]
    for path in files:
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(payload, dict):
                continue
            run_id = str(payload.get("run_id") or path.stem).strip()
            payload.setdefault("run_id", run_id)
            upsert_review_meta(run_id, payload, db_path=db_path, touch=False)
            count += 1
        except Exception:
            continue
    return count


def import_legacy_run_json_files(
    *,
    db_path: str | Path | None = None,
    run_root: str | Path | None = None,
    limit_runs: int | None = None,
) -> int:
    root = get_run_root(run_root)
    if not root.exists():
        init_db(db_path)
        return 0
    count = 0
    run_dirs = sorted([p for p in root.iterdir() if p.is_dir()], key=lambda p: p.stat().st_mtime, reverse=True)
    if limit_runs is not None:
        run_dirs = run_dirs[: max(0, int(limit_runs))]
    for run_dir in run_dirs:
        run_id = run_dir.name
        ensure_run_placeholder(run_id, run_dir=run_dir, db_path=db_path)
        for path in run_dir.rglob("*.json"):
            try:
                payload = json.loads(path.read_text(encoding="utf-8"))
                store_json_artifact_by_path(path, payload, db_path=db_path, run_root=root)
                count += 1
            except Exception:
                continue
    return count
