from pydantic import BaseModel, Field


class ChatStreamRequest(BaseModel):
    message: str = Field(..., min_length=1, description="User text for this turn.")
    allow_search: bool = Field(
        default=False,
        description='Maps to upstream inputs.allow_search as "1" (on) or "0" (off).',
    )
    session_id: str | None = Field(
        default=None,
        description="Client-owned session id; generated if omitted.",
    )
    history: str = Field(
        default="[]",
        description='JSON string of prior turns, e.g. \'[{"role":"system","content":"..."},...]\' or "[]".',
    )
    user_id: str | None = Field(
        default=None,
        description="Reserved for future multi-user auth; defaults to configured default user.",
    )


class SessionCreateResponse(BaseModel):
    session_id: str
