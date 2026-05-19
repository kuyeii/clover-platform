"""前端对话列表：SQLite 持久化（每条会话一行，messages 存 JSON 列）。"""

from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from app.config import Settings
from app.schemas.conversations import ChatMessagePersist, ConversationPersist
from app.services.json_store import resolve_data_dir

_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    session_id TEXT NOT NULL,
    messages_json TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    pinned INTEGER,
    pinned_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_conversations_updated_at
    ON conversations(updated_at DESC);
"""


def database_path(settings: Settings) -> Path:
    return resolve_data_dir(settings) / "conversations.sqlite"


@contextmanager
def _connect(settings: Settings) -> Iterator[sqlite3.Connection]:
    path = database_path(settings)
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_database(settings: Settings) -> None:
    with _connect(settings) as conn:
        conn.executescript(_SCHEMA_SQL)


def _messages_to_json(messages: list[ChatMessagePersist]) -> str:
    return json.dumps(
        [m.model_dump(mode="json", by_alias=True) for m in messages],
        ensure_ascii=False,
    )


def _row_to_conversation(row: sqlite3.Row) -> ConversationPersist:
    pinned_raw = row["pinned"]
    return ConversationPersist.model_validate(
        {
            "id": row["id"],
            "title": row["title"],
            "sessionId": row["session_id"],
            "messages": json.loads(row["messages_json"]),
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
            "pinned": True if pinned_raw == 1 else None,
            "pinnedAt": row["pinned_at"],
        }
    )


def _upsert(conn: sqlite3.Connection, conv: ConversationPersist) -> None:
    pinned_val = 1 if conv.pinned else None
    conn.execute(
        """
        INSERT INTO conversations (
            id, title, session_id, messages_json,
            created_at, updated_at, pinned, pinned_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            title = excluded.title,
            session_id = excluded.session_id,
            messages_json = excluded.messages_json,
            created_at = excluded.created_at,
            updated_at = excluded.updated_at,
            pinned = excluded.pinned,
            pinned_at = excluded.pinned_at
        """,
        (
            conv.id,
            conv.title,
            conv.sessionId,
            _messages_to_json(conv.messages),
            conv.createdAt,
            conv.updatedAt,
            pinned_val,
            conv.pinnedAt,
        ),
    )


def list_conversations(settings: Settings) -> list[ConversationPersist]:
    with _connect(settings) as conn:
        conn.executescript(_SCHEMA_SQL)
        rows = conn.execute(
            "SELECT * FROM conversations ORDER BY updated_at DESC"
        ).fetchall()
    return [_row_to_conversation(r) for r in rows]


def sync_conversations(
    settings: Settings,
    conversations: list[ConversationPersist],
    allowed_ids: set[str],
) -> None:
    with _connect(settings) as conn:
        conn.executescript(_SCHEMA_SQL)
        if not allowed_ids:
            conn.execute("DELETE FROM conversations")
            return
        for conv in conversations:
            _upsert(conn, conv)
        placeholders = ",".join("?" * len(allowed_ids))
        conn.execute(
            f"DELETE FROM conversations WHERE id NOT IN ({placeholders})",
            list(allowed_ids),
        )
