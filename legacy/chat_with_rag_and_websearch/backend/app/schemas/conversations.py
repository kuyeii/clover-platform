from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

MAX_CONVERSATIONS_SYNC = 80


class AssistantSnapshotPersist(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    id: str
    content: str = ""
    stopped: Optional[bool] = None


class UserTurnSnapshotPersist(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    userContent: str = Field(alias="userContent")
    assistant: AssistantSnapshotPersist


class AssistantVariantPersist(BaseModel):
    """助手「重新回答」产生的多版本之一（仅 content / stopped）"""

    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    content: str = ""
    stopped: Optional[bool] = None


class ChatMessagePersist(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    id: str
    role: Literal["user", "assistant"]
    content: str = ""
    stopped: Optional[bool] = None
    editHistory: Optional[list[UserTurnSnapshotPersist]] = Field(
        default=None,
        alias="editHistory",
    )
    activeVersionIndex: Optional[int] = Field(
        default=None,
        alias="activeVersionIndex",
    )
    regenerateVersions: Optional[list[AssistantVariantPersist]] = Field(
        default=None,
        alias="regenerateVersions",
    )
    activeRegenerateIndex: Optional[int] = Field(
        default=None,
        alias="activeRegenerateIndex",
    )


class ConversationPersist(BaseModel):
    """与前端对话结构一致（camelCase），便于单文件 JSON 与后续迁库。"""

    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    id: str
    title: str = ""
    sessionId: str = Field(alias="sessionId")
    messages: list[ChatMessagePersist] = Field(default_factory=list)
    createdAt: int = Field(alias="createdAt")
    updatedAt: int = Field(alias="updatedAt")
    pinned: Optional[bool] = None
    pinnedAt: Optional[int] = Field(default=None, alias="pinnedAt")

    def dump_json_dict(self) -> dict:
        return self.model_dump(mode="json", by_alias=True)


class ConversationsBootstrapResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    conversations: list[ConversationPersist]
    activeConversationId: Optional[str] = Field(alias="activeConversationId", default=None)


class ConversationsSyncRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    conversations: list[ConversationPersist]
    activeConversationId: str = Field(alias="activeConversationId")
