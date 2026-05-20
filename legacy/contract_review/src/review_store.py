from __future__ import annotations

import json
import os
import sys
import threading
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Any, Iterator, Mapping

from dotenv import load_dotenv
from sqlalchemy import text
from sqlalchemy.engine import Connection, make_url


BASE_DIR = Path(__file__).resolve().parent.parent
DEFAULT_RUN_ROOT = BASE_DIR / "data" / "runs"

_DB_WRITE_LOCK = threading.RLock()
_STORAGE_INITIALIZED = False
def _find_repo_root() -> Path:
    current = Path(__file__).resolve()
    for candidate in (current.parent, *current.parents):
        if (
            (candidate / "config" / "apps.yaml").is_file()
            and (candidate / "packages" / "py_common").is_dir()
            and (candidate / "legacy" / "contract_review").is_dir()
        ):
            return candidate
    raise RuntimeError("Cannot locate clover-platform root for contract-review database access.")


REPO_ROOT = _find_repo_root()
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

load_dotenv(REPO_ROOT / ".env", override=False)
load_dotenv(BASE_DIR / ".env", override=False)

from packages.py_common.config import get_settings  # noqa: E402
from packages.py_common.db.session import get_engine  # noqa: E402


@contextmanager
def _connect() -> Iterator[Connection]:
    with get_engine().begin() as conn:
        yield conn


def _utc_now() -> str:
    return datetime.utcnow().isoformat() + "Z"


def _json_dumps(payload: Any) -> str:
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


def _json_value(value: Any, default: Any = None) -> Any:
    if value is None:
        return default
    if isinstance(value, (dict, list)):
        return value
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return default
    return default


def _safe_database_target() -> str:
    try:
        url = make_url(get_settings().resolved_database_url())
    except Exception as exc:
        return f"unresolved database URL ({exc})"
    return f"host={url.host}, port={url.port or 5432}, db={url.database}, user={url.username}"


def init_storage() -> None:
    global _STORAGE_INITIALIZED
    if _STORAGE_INITIALIZED:
        return
    with _DB_WRITE_LOCK:
        if _STORAGE_INITIALIZED:
            return
        try:
            with _connect() as conn:
                missing = conn.execute(
                    text(
                        """
                        SELECT table_name
                        FROM (VALUES
                          ('review_runs'),
                          ('review_json_artifacts'),
                          ('review_text_artifacts'),
                          ('review_file_assets')
                        ) AS required(table_name)
                        WHERE to_regclass('contract_review.' || required.table_name) IS NULL
                        """
                    )
                ).scalars().all()
        except Exception as exc:
            raise RuntimeError(
                f"Cannot connect to PostgreSQL for contract-review storage ({_safe_database_target()})."
            ) from exc

        if missing:
            joined = ", ".join(f"contract_review.{name}" for name in missing)
            raise RuntimeError(
                f"Missing contract_review PostgreSQL tables: {joined}. "
                "Run: python scripts/init_db.py && alembic upgrade head"
            )
        _STORAGE_INITIALIZED = True


def get_run_root(run_root: str | Path | None = None) -> Path:
    configured = run_root or os.getenv("RUN_ROOT") or str(DEFAULT_RUN_ROOT)
    path = Path(configured)
    if not path.is_absolute():
        path = BASE_DIR / path
    return path


def _normalize_bool(value: Any) -> bool | None:
    if value is None:
        return None
    return bool(value)


def _normalize_progress(value: Any) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except Exception:
        return None


def _payload_from_row(row: Mapping[str, Any] | None, run_id: str) -> dict[str, Any] | None:
    if row is None:
        return None
    payload = _json_value(row.get("payload"), {})
    if not isinstance(payload, dict):
        payload = {}
    payload.setdefault("run_id", run_id)
    return payload


def upsert_review_meta(run_id: str, payload: dict[str, Any], *, touch: bool = True) -> dict[str, Any]:
    init_storage()
    payload = dict(payload or {})
    run_id = str(run_id or payload.get("run_id") or "").strip()
    if not run_id:
        raise ValueError("run_id is required")

    with _DB_WRITE_LOCK:
        now = _utc_now()
        with _connect() as conn:
            row = conn.execute(
                text("SELECT payload, created_at FROM contract_review.review_runs WHERE run_id = :run_id"),
                {"run_id": run_id},
            ).mappings().first()
            current = _payload_from_row(row, run_id) or {}
            merged = dict(current)
            merged.update(payload)
            merged["run_id"] = run_id

            previous_updated_at = str(current.get("updated_at") or "")
            next_updated_at = now if touch else str(merged.get("updated_at") or previous_updated_at or now)
            merged["updated_at"] = next_updated_at
            created_at = str(row["created_at"]) if row else str(merged.get("created_at") or now)
            merged.setdefault("created_at", created_at)

            conn.execute(
                text(
                    """
                    INSERT INTO contract_review.review_runs(
                      run_id, payload, status, file_name, review_side, contract_type_hint,
                      analysis_scope, analysis_scope_label, step, progress, error, warning,
                      run_dir, document_ready, created_at, updated_at
                    ) VALUES (
                      :run_id, CAST(:payload AS jsonb), :status, :file_name, :review_side,
                      :contract_type_hint, :analysis_scope, :analysis_scope_label, :step,
                      :progress, :error, :warning, :run_dir, :document_ready,
                      :created_at, :updated_at
                    )
                    ON CONFLICT (run_id) DO UPDATE SET
                      payload = EXCLUDED.payload,
                      status = EXCLUDED.status,
                      file_name = EXCLUDED.file_name,
                      review_side = EXCLUDED.review_side,
                      contract_type_hint = EXCLUDED.contract_type_hint,
                      analysis_scope = EXCLUDED.analysis_scope,
                      analysis_scope_label = EXCLUDED.analysis_scope_label,
                      step = EXCLUDED.step,
                      progress = EXCLUDED.progress,
                      error = EXCLUDED.error,
                      warning = EXCLUDED.warning,
                      run_dir = EXCLUDED.run_dir,
                      document_ready = EXCLUDED.document_ready,
                      updated_at = EXCLUDED.updated_at
                    """
                ),
                {
                    "run_id": run_id,
                    "payload": _json_dumps(merged),
                    "status": str(merged.get("status") or "") or None,
                    "file_name": str(merged.get("file_name") or "") or None,
                    "review_side": str(merged.get("review_side") or "") or None,
                    "contract_type_hint": str(merged.get("contract_type_hint") or "") or None,
                    "analysis_scope": str(merged.get("analysis_scope") or "") or None,
                    "analysis_scope_label": str(merged.get("analysis_scope_label") or "") or None,
                    "step": str(merged.get("step") or "") or None,
                    "progress": _normalize_progress(merged.get("progress")),
                    "error": str(merged.get("error") or "") or None,
                    "warning": str(merged.get("warning") or "") or None,
                    "run_dir": str(merged.get("run_dir") or "") or None,
                    "document_ready": _normalize_bool(merged.get("document_ready"))
                    if "document_ready" in merged
                    else None,
                    "created_at": created_at,
                    "updated_at": str(merged.get("updated_at") or now),
                },
            )
    return merged


def get_review_meta(run_id: str) -> dict[str, Any] | None:
    init_storage()
    run_id = str(run_id or "").strip()
    if not run_id:
        return None
    with _connect() as conn:
        row = conn.execute(
            text("SELECT payload FROM contract_review.review_runs WHERE run_id = :run_id"),
            {"run_id": run_id},
        ).mappings().first()
    return _payload_from_row(row, run_id)


def list_review_meta(limit: int = 200) -> list[dict[str, Any]]:
    init_storage()
    with _connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT run_id, payload
                FROM contract_review.review_runs
                ORDER BY updated_at DESC
                LIMIT :limit
                """
            ),
            {"limit": max(0, int(limit))},
        ).mappings().all()

    items: list[dict[str, Any]] = []
    for row in rows:
        payload = _payload_from_row(row, str(row["run_id"]))
        if payload is not None:
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


def _ensure_run_placeholder(run_id: str, run_dir: Path | None = None) -> None:
    existing = get_review_meta(run_id)
    if existing is not None:
        return
    payload: dict[str, Any] = {"run_id": run_id}
    if run_dir is not None:
        payload["run_dir"] = str(run_dir)
    upsert_review_meta(run_id, payload)


def store_json_artifact(
    run_id: str,
    artifact_name: str,
    payload: Any,
    *,
    run_dir: Path | None = None,
) -> None:
    init_storage()
    run_id = str(run_id or "").strip()
    artifact_name = str(artifact_name or "").strip().replace("\\", "/")
    if not run_id or not artifact_name:
        return
    with _DB_WRITE_LOCK:
        _ensure_run_placeholder(run_id, run_dir=run_dir)
        now = _utc_now()
        with _connect() as conn:
            conn.execute(
                text(
                    """
                    INSERT INTO contract_review.review_json_artifacts(
                      run_id, artifact_name, payload, created_at, updated_at
                    ) VALUES (:run_id, :artifact_name, CAST(:payload AS jsonb), :created_at, :updated_at)
                    ON CONFLICT (run_id, artifact_name) DO UPDATE SET
                      payload = EXCLUDED.payload,
                      updated_at = EXCLUDED.updated_at
                    """
                ),
                {
                    "run_id": run_id,
                    "artifact_name": artifact_name,
                    "payload": _json_dumps(payload),
                    "created_at": now,
                    "updated_at": now,
                },
            )


def load_json_artifact(run_id: str, artifact_name: str) -> Any | None:
    init_storage()
    run_id = str(run_id or "").strip()
    artifact_name = str(artifact_name or "").strip().replace("\\", "/")
    if not run_id or not artifact_name:
        return None
    with _connect() as conn:
        row = conn.execute(
            text(
                """
                SELECT payload
                FROM contract_review.review_json_artifacts
                WHERE run_id = :run_id AND artifact_name = :artifact_name
                """
            ),
            {"run_id": run_id, "artifact_name": artifact_name},
        ).mappings().first()
    if not row:
        return None
    return _json_value(row.get("payload"), None)


def store_json_artifact_by_path(
    path: Path,
    payload: Any,
    *,
    run_root: str | Path | None = None,
) -> None:
    identity = artifact_identity_from_path(path, run_root=run_root)
    if identity is None:
        return
    run_id, artifact_name = identity
    store_json_artifact(run_id, artifact_name, payload, run_dir=path.parent)


def load_json_artifact_by_path(
    path: Path,
    *,
    run_root: str | Path | None = None,
) -> Any | None:
    identity = artifact_identity_from_path(path, run_root=run_root)
    if identity is None:
        return None
    run_id, artifact_name = identity
    return load_json_artifact(run_id, artifact_name)


def store_text_artifact_by_path(
    path: Path,
    content: str,
    *,
    run_root: str | Path | None = None,
) -> None:
    init_storage()
    identity = artifact_identity_from_path(path, run_root=run_root)
    if identity is None:
        return
    run_id, artifact_name = identity
    with _DB_WRITE_LOCK:
        _ensure_run_placeholder(run_id, run_dir=path.parent)
        now = _utc_now()
        with _connect() as conn:
            conn.execute(
                text(
                    """
                    INSERT INTO contract_review.review_text_artifacts(
                      run_id, artifact_name, content, created_at, updated_at
                    ) VALUES (:run_id, :artifact_name, :content, :created_at, :updated_at)
                    ON CONFLICT (run_id, artifact_name) DO UPDATE SET
                      content = EXCLUDED.content,
                      updated_at = EXCLUDED.updated_at
                    """
                ),
                {
                    "run_id": run_id,
                    "artifact_name": artifact_name,
                    "content": str(content or ""),
                    "created_at": now,
                    "updated_at": now,
                },
            )


def register_file_asset_by_path(
    path: Path,
    *,
    asset_name: str | None = None,
    mime_type: str | None = None,
    run_root: str | Path | None = None,
) -> None:
    init_storage()
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
        _ensure_run_placeholder(run_id, run_dir=path.parent)
        now = _utc_now()
        with _connect() as conn:
            conn.execute(
                text(
                    """
                    INSERT INTO contract_review.review_file_assets(
                      run_id, asset_name, file_path, mime_type, file_size, created_at, updated_at
                    ) VALUES (
                      :run_id, :asset_name, :file_path, :mime_type, :file_size, :created_at, :updated_at
                    )
                    ON CONFLICT (run_id, asset_name) DO UPDATE SET
                      file_path = EXCLUDED.file_path,
                      mime_type = EXCLUDED.mime_type,
                      file_size = EXCLUDED.file_size,
                      updated_at = EXCLUDED.updated_at
                    """
                ),
                {
                    "run_id": run_id,
                    "asset_name": name,
                    "file_path": str(path),
                    "mime_type": mime_type,
                    "file_size": size,
                    "created_at": now,
                    "updated_at": now,
                },
            )
