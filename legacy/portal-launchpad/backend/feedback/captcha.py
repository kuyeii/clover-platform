from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import Response

from ..config import CAPTCHA_SECRET, FEEDBACK_CAPTCHA_TTL_SECONDS

FeedbackKind = Literal["ticket", "feature_request"]


def captcha_cookie_name(kind: FeedbackKind) -> str:
    return f"portal_feedback_captcha_{kind}"


def _sign_payload(payload: str) -> str:
    return hmac.new(
        CAPTCHA_SECRET.encode("utf-8"),
        payload.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def generate_captcha_code() -> str:
    return f"{secrets.randbelow(100000):05d}"


def issue_captcha(response: Response, kind: FeedbackKind, user_id: str, code: str) -> None:
    expires_at = int(
        (datetime.now(timezone.utc) + timedelta(seconds=FEEDBACK_CAPTCHA_TTL_SECONDS)).timestamp()
    )
    code_hash = hashlib.sha256(code.encode("utf-8")).hexdigest()
    payload = f"{kind}:{user_id}:{code_hash}:{expires_at}"
    signature = _sign_payload(payload)
    cookie_value = f"{expires_at}.{signature}"
    response.set_cookie(
        key=captcha_cookie_name(kind),
        value=cookie_value,
        httponly=True,
        samesite="lax",
        max_age=FEEDBACK_CAPTCHA_TTL_SECONDS,
        path="/",
    )


def verify_captcha(
    kind: FeedbackKind,
    user_id: str,
    submitted_code: str | None,
    cookie_value: str | None,
) -> bool:
    if not submitted_code or not cookie_value:
        return False

    try:
        expires_at_str, signature = cookie_value.split(".", 1)
        expires_at = int(expires_at_str)
    except ValueError:
        return False

    if datetime.now(timezone.utc).timestamp() > expires_at:
        return False

    normalized_code = submitted_code.strip()
    if len(normalized_code) != 5 or not normalized_code.isdigit():
        return False

    code_hash = hashlib.sha256(normalized_code.encode("utf-8")).hexdigest()
    payload = f"{kind}:{user_id}:{code_hash}:{expires_at}"
    expected_signature = _sign_payload(payload)
    if not hmac.compare_digest(signature, expected_signature):
        return False
    return True


def clear_captcha(response: Response, kind: FeedbackKind) -> None:
    response.delete_cookie(key=captcha_cookie_name(kind), path="/")
