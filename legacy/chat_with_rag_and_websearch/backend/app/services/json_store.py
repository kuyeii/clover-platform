import json
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from app.config import Settings


def _ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def resolve_data_dir(settings: Settings) -> Path:
    root = settings.data_dir
    if not root.is_absolute():
        root = (Path(__file__).resolve().parent.parent.parent / root).resolve()
    return root


def save_turn(
    settings: Settings,
    *,
    user_id: str,
    session_id: str,
    user_message: str,
    assistant_message: str,
    extra: dict[str, Any] | None = None,
) -> Path:
    """
    Persist one user/assistant pair as a single JSON file.
    Layout: {DATA_DIR}/users/{user_id}/sessions/{session_id}/{record_id}.json
    """
    base = resolve_data_dir(settings)
    record_id = str(uuid.uuid4())
    out_dir = base / "users" / user_id / "sessions" / session_id
    _ensure_dir(out_dir)
    path = out_dir / f"{record_id}.json"
    payload: dict[str, Any] = {
        "id": record_id,
        "user_id": user_id,
        "session_id": session_id,
        "created_at": datetime.now(tz=UTC).isoformat(),
        "user_message": user_message,
        "assistant_message": assistant_message,
        "meta": extra or {},
    }
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return path
