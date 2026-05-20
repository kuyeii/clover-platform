from __future__ import annotations

import json
from typing import Any

from sqlalchemy import text

from app.config import Settings
from app.services.repository import ensure_rag_storage, transaction


def _json_dumps(data: Any) -> str:
    return json.dumps(data, ensure_ascii=False, separators=(",", ":"))


def save_turn(
    settings: Settings,
    *,
    user_id: str,
    session_id: str,
    user_message: str,
    assistant_message: str,
    extra: dict[str, Any] | None = None,
) -> str:
    ensure_rag_storage(settings)
    with transaction(settings) as conn:
        record_id = conn.execute(
            text(
                """
                INSERT INTO rag.chat_turns (
                  user_id, session_id, user_message, assistant_message, meta
                )
                VALUES (
                  :user_id, CAST(:session_id AS uuid), :user_message, :assistant_message,
                  CAST(:meta AS jsonb)
                )
                RETURNING id
                """
            ),
            {
                "user_id": user_id,
                "session_id": session_id,
                "user_message": user_message,
                "assistant_message": assistant_message,
                "meta": _json_dumps(extra or {}),
            },
        ).scalar_one()
    return str(record_id)
