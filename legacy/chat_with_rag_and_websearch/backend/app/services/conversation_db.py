"""前端对话列表：PostgreSQL 持久化。"""

from __future__ import annotations

import json
from typing import Any, Mapping

from sqlalchemy import text

from app.config import Settings
from app.schemas.conversations import ChatMessagePersist, ConversationPersist
from app.services.repository import ensure_rag_storage, transaction


def init_database(settings: Settings) -> None:
    ensure_rag_storage(settings)


def _messages_to_json(messages: list[ChatMessagePersist]) -> str:
    return json.dumps(
        [m.model_dump(mode="json", by_alias=True) for m in messages],
        ensure_ascii=False,
        separators=(",", ":"),
    )


def _json_value(value: Any, fallback: Any) -> Any:
    if value is None:
        return fallback
    if isinstance(value, (dict, list)):
        return value
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return fallback
    return fallback


def _row_to_conversation(row: Mapping[str, Any]) -> ConversationPersist:
    return ConversationPersist.model_validate(
        {
            "id": str(row["id"]),
            "title": row["title"],
            "sessionId": str(row["session_id"]),
            "messages": _json_value(row["messages"], []),
            "createdAt": row["created_at_ms"],
            "updatedAt": row["updated_at_ms"],
            "pinned": True if row["pinned"] is True else None,
            "pinnedAt": row["pinned_at_ms"],
        }
    )


def _upsert_params(conv: ConversationPersist) -> dict[str, Any]:
    return {
        "id": conv.id,
        "title": conv.title,
        "session_id": conv.sessionId,
        "messages": _messages_to_json(conv.messages),
        "created_at_ms": conv.createdAt,
        "updated_at_ms": conv.updatedAt,
        "pinned": True if conv.pinned else None,
        "pinned_at_ms": conv.pinnedAt,
    }


def list_conversations(settings: Settings) -> list[ConversationPersist]:
    init_database(settings)
    with transaction(settings) as conn:
        rows = conn.execute(
            text(
                """
                SELECT
                  id, title, session_id, messages,
                  created_at_ms, updated_at_ms, pinned, pinned_at_ms
                FROM rag.conversations
                ORDER BY updated_at_ms DESC
                """
            )
        ).mappings().all()
    return [_row_to_conversation(row) for row in rows]


def sync_conversations(
    settings: Settings,
    conversations: list[ConversationPersist],
    allowed_ids: set[str],
) -> None:
    init_database(settings)
    if not allowed_ids:
        with transaction(settings) as conn:
            conn.execute(text("DELETE FROM rag.conversations"))
        return

    with transaction(settings) as conn:
        conn.execute(
            text(
                """
                INSERT INTO rag.conversations (
                  id, title, session_id, messages,
                  created_at_ms, updated_at_ms, pinned, pinned_at_ms
                )
                VALUES (
                  CAST(:id AS uuid), :title, CAST(:session_id AS uuid), CAST(:messages AS jsonb),
                  :created_at_ms, :updated_at_ms, :pinned, :pinned_at_ms
                )
                ON CONFLICT (id) DO UPDATE SET
                  title = EXCLUDED.title,
                  session_id = EXCLUDED.session_id,
                  messages = EXCLUDED.messages,
                  created_at_ms = EXCLUDED.created_at_ms,
                  updated_at_ms = EXCLUDED.updated_at_ms,
                  pinned = EXCLUDED.pinned,
                  pinned_at_ms = EXCLUDED.pinned_at_ms
                """
            ),
            [_upsert_params(conv) for conv in conversations],
        )
        conn.execute(
            text(
                """
                DELETE FROM rag.conversations
                WHERE NOT (id = ANY(CAST(:allowed_ids AS uuid[])))
                """
            ),
            {"allowed_ids": list(allowed_ids)},
        )
