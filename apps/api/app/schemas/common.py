from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class ErrorBody(BaseModel):
    code: str
    message: str
    details: dict[str, Any] = Field(default_factory=dict)


class SuccessEnvelope(BaseModel):
    success: bool = True
    data: dict[str, Any] = Field(default_factory=dict)
    message: str = "ok"
    request_id: str


class ErrorEnvelope(BaseModel):
    success: bool = False
    error: ErrorBody
    request_id: str

