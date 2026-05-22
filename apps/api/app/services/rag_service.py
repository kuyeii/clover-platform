from __future__ import annotations

import json
import logging
import uuid
from typing import Any, Literal, Mapping
from uuid import NAMESPACE_URL, UUID, uuid5

from pydantic import BaseModel, ConfigDict, Field, ValidationError as PydanticValidationError
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.core.errors import PlatformError
from packages.py_common.db.session import get_engine

logger = logging.getLogger(__name__)

MAX_CONVERSATIONS_SYNC = 80


class AssistantSnapshotPersist(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    id: str
    content: str = ""
    stopped: bool | None = None


class UserTurnSnapshotPersist(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    userContent: str = Field(alias="userContent")
    assistant: AssistantSnapshotPersist


class AssistantVariantPersist(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    content: str = ""
    stopped: bool | None = None


class ChatMessagePersist(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    id: str
    role: Literal["user", "assistant"]
    content: str = ""
    stopped: bool | None = None
    editHistory: list[UserTurnSnapshotPersist] | None = Field(default=None, alias="editHistory")
    activeVersionIndex: int | None = Field(default=None, alias="activeVersionIndex")
    regenerateVersions: list[AssistantVariantPersist] | None = Field(default=None, alias="regenerateVersions")
    activeRegenerateIndex: int | None = Field(default=None, alias="activeRegenerateIndex")


class ConversationPersist(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    id: str
    title: str = ""
    sessionId: str = Field(alias="sessionId")
    messages: list[ChatMessagePersist] = Field(default_factory=list)
    createdAt: int = Field(alias="createdAt")
    updatedAt: int = Field(alias="updatedAt")
    pinned: bool | None = None
    pinnedAt: int | None = Field(default=None, alias="pinnedAt")

    def dump_json_dict(self) -> dict[str, Any]:
        return self.model_dump(mode="json", by_alias=True)


class ConversationsSyncRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    conversations: list[ConversationPersist]
    activeConversationId: str = Field(alias="activeConversationId")


def _database_error(exc: Exception) -> PlatformError:
    logger.exception("RAG conversations PostgreSQL operation failed")
    return PlatformError(
        code="DATABASE_ERROR",
        message="RAG 会话数据库访问失败。",
        status_code=500,
        details={"module": "rag-web-search", "schema": "rag"},
    )


def _json_dumps(data: Any) -> str:
    return json.dumps(data, ensure_ascii=False, separators=(",", ":"))


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


def _coerce_uuid_string(value: str, field_name: str) -> str:
    text_value = str(value).strip()
    if not text_value:
        raise PlatformError(code="VALIDATION_ERROR", message=f"{field_name} 不能为空", status_code=400)
    try:
        return str(UUID(text_value))
    except ValueError:
        return str(uuid5(NAMESPACE_URL, f"rag:{field_name}:{text_value}"))


def _ensure_rag_storage() -> None:
    try:
        with get_engine().begin() as conn:
            missing = conn.execute(
                text(
                    """
                    SELECT table_name
                    FROM (VALUES
                      ('conversations'),
                      ('chat_turns')
                    ) AS required(table_name)
                    WHERE to_regclass('rag.' || required.table_name) IS NULL
                    """
                )
            ).scalars().all()
    except (SQLAlchemyError, RuntimeError) as exc:
        raise _database_error(exc) from exc

    if missing:
        joined = ", ".join(f"rag.{name}" for name in missing)
        raise PlatformError(
            code="DATABASE_ERROR",
            message="RAG 会话数据库表不存在。",
            status_code=500,
            details={"missing_tables": joined},
        )


def _row_to_conversation(row: Mapping[str, Any]) -> dict[str, Any]:
    conversation = ConversationPersist.model_validate(
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
    return conversation.dump_json_dict()


def create_session_payload() -> dict[str, str]:
    return {"session_id": str(uuid.uuid4())}


def list_conversations_payload() -> dict[str, Any]:
    _ensure_rag_storage()
    try:
        with get_engine().begin() as conn:
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
    except (SQLAlchemyError, RuntimeError) as exc:
        raise _database_error(exc) from exc

    return {
        "conversations": [_row_to_conversation(row) for row in rows],
        "activeConversationId": None,
    }


def _trim_for_sync(conversations: list[ConversationPersist]) -> list[ConversationPersist]:
    pinned = [conversation for conversation in conversations if conversation.pinned]
    unpinned = [conversation for conversation in conversations if not conversation.pinned]
    pinned_sorted = sorted(pinned, key=lambda item: (item.pinnedAt or item.updatedAt), reverse=True)
    if len(pinned_sorted) >= MAX_CONVERSATIONS_SYNC:
        return pinned_sorted[:MAX_CONVERSATIONS_SYNC]

    rest = MAX_CONVERSATIONS_SYNC - len(pinned_sorted)
    unpinned_sorted = sorted(unpinned, key=lambda item: item.updatedAt, reverse=True)
    return pinned_sorted + unpinned_sorted[:rest]


def _messages_to_json(messages: list[ChatMessagePersist]) -> str:
    return _json_dumps([message.model_dump(mode="json", by_alias=True) for message in messages])


def _upsert_params(conversation: ConversationPersist) -> dict[str, Any]:
    return {
        "id": conversation.id,
        "title": conversation.title,
        "session_id": conversation.sessionId,
        "messages": _messages_to_json(conversation.messages),
        "created_at_ms": conversation.createdAt,
        "updated_at_ms": conversation.updatedAt,
        "pinned": True if conversation.pinned else None,
        "pinned_at_ms": conversation.pinnedAt,
    }


def _parse_sync_body(payload: Any) -> ConversationsSyncRequest:
    try:
        return ConversationsSyncRequest.model_validate(payload)
    except PydanticValidationError as exc:
        raise PlatformError(
            code="VALIDATION_ERROR",
            message="请求参数校验失败。",
            status_code=422,
            details={"errors": exc.errors()},
        ) from exc


def sync_conversations(payload: Any) -> None:
    body = _parse_sync_body(payload)
    trimmed = _trim_for_sync(list(body.conversations))

    if not trimmed:
        _ensure_rag_storage()
        try:
            with get_engine().begin() as conn:
                conn.execute(text("DELETE FROM rag.conversations"))
        except (SQLAlchemyError, RuntimeError) as exc:
            raise _database_error(exc) from exc
        return

    normalized = [
        conversation.model_copy(
            update={
                "id": _coerce_uuid_string(conversation.id, "id"),
                "sessionId": _coerce_uuid_string(conversation.sessionId, "sessionId"),
            }
        )
        for conversation in trimmed
    ]
    allowed_ids = {conversation.id for conversation in normalized}

    _ensure_rag_storage()
    try:
        with get_engine().begin() as conn:
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
                [_upsert_params(conversation) for conversation in normalized],
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
    except (SQLAlchemyError, RuntimeError) as exc:
        raise _database_error(exc) from exc
