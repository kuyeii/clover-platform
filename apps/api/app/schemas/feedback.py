from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

FeedbackKind = Literal["ticket", "feature_request"]


class FeedbackSubmissionContext(BaseModel):
    defaultContactEmail: str
    captchaRequired: bool
    captchaHint: str


class FeedbackCaptchaChallenge(BaseModel):
    code: str
    hint: str


class FeedbackSubmitResult(BaseModel):
    ok: bool
    submittedAt: str
    attachmentCount: int
