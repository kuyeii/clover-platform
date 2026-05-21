"""前端对话列表：读写 PostgreSQL（见 conversation_db）。"""

from __future__ import annotations

from uuid import NAMESPACE_URL, UUID, uuid5

from app.config import Settings
from app.schemas.conversations import (
    MAX_CONVERSATIONS_SYNC,
    ConversationPersist,
    ConversationsBootstrapResponse,
    ConversationsSyncRequest,
)
from app.services import conversation_db


def _coerce_uuid_string(value: str, field_name: str) -> str:
    text = str(value).strip()
    if not text:
        raise ValueError(f"{field_name} 不能为空")
    try:
        return str(UUID(text))
    except ValueError:
        return str(uuid5(NAMESPACE_URL, f"rag:{field_name}:{text}"))


def read_bootstrap(settings: Settings) -> ConversationsBootstrapResponse:
    conversation_db.init_database(settings)
    conversations = conversation_db.list_conversations(settings)
    return ConversationsBootstrapResponse(
        conversations=conversations,
        activeConversationId=None,
    )


def _trim_for_sync(
    body: ConversationsSyncRequest,
) -> tuple[list[ConversationPersist], set[str]]:
    convs = list(body.conversations)
    pinned = [c for c in convs if c.pinned]
    unpinned = [c for c in convs if not c.pinned]
    pinned_sorted = sorted(
        pinned,
        key=lambda c: (c.pinnedAt or c.updatedAt),
        reverse=True,
    )
    if len(pinned_sorted) >= MAX_CONVERSATIONS_SYNC:
        trimmed = pinned_sorted[:MAX_CONVERSATIONS_SYNC]
    else:
        unpinned_sorted = sorted(unpinned, key=lambda c: c.updatedAt, reverse=True)
        rest = MAX_CONVERSATIONS_SYNC - len(pinned_sorted)
        trimmed = pinned_sorted + unpinned_sorted[:rest]
    return trimmed, {c.id for c in trimmed}


def apply_sync(settings: Settings, body: ConversationsSyncRequest) -> None:
    trimmed, _allowed_ids = _trim_for_sync(body)

    if not trimmed:
        conversation_db.sync_conversations(settings, [], set())
        return

    normalized = [
        c.model_copy(
            update={
                "id": _coerce_uuid_string(c.id, "id"),
                "sessionId": _coerce_uuid_string(c.sessionId, "sessionId"),
            }
        )
        for c in trimmed
    ]
    allowed_ids = {c.id for c in normalized}

    conversation_db.sync_conversations(settings, normalized, allowed_ids)
