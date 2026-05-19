from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

from fastapi import Response, UploadFile

from ..config import FEEDBACK_CAPTCHA_HINT, FEEDBACK_RATE_LIMIT_WINDOW_SECONDS
from ..database import connect, count_recent_feedback_submissions, record_feedback_submission
from ..deps import api_error
from ..security import now_iso
from .attachments import prepare_attachments
from .captcha import clear_captcha, generate_captcha_code, issue_captcha, verify_captcha
from .email_service import send_feedback_email

logger = logging.getLogger("portal.feedback")

FeedbackKind = Literal["ticket", "feature_request"]
EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def default_contact_email(user: dict[str, Any]) -> str:
    account = str(user.get("account") or "").strip()
    if "@" in account and EMAIL_PATTERN.match(account):
        return account
    return ""


def _rate_limit_cutoff_iso() -> str:
    cutoff = datetime.now(timezone.utc) - timedelta(seconds=FEEDBACK_RATE_LIMIT_WINDOW_SECONDS)
    return cutoff.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def is_captcha_required(user_id: str, kind: FeedbackKind) -> bool:
    with connect() as conn:
        recent_count = count_recent_feedback_submissions(
            conn,
            kind=kind,
            user_id=user_id,
            since_iso=_rate_limit_cutoff_iso(),
        )
    return recent_count >= 1


def build_submission_context(user: dict[str, Any], kind: FeedbackKind) -> dict[str, Any]:
    captcha_required = is_captcha_required(user["id"], kind)
    return {
        "defaultContactEmail": default_contact_email(user),
        "captchaRequired": captcha_required,
        "captchaHint": FEEDBACK_CAPTCHA_HINT if captcha_required else "",
    }


def create_captcha_challenge(
    response: Response,
    user: dict[str, Any],
    kind: FeedbackKind,
) -> dict[str, str]:
    code = generate_captcha_code()
    issue_captcha(response, kind, user["id"], code)
    logger.info("Issued captcha kind=%s user_id=%s", kind, user["id"])
    return {
        "code": code,
        "hint": FEEDBACK_CAPTCHA_HINT,
    }


def _validate_contact_email(contact_email: str) -> str:
    normalized = contact_email.strip()
    if not normalized:
        raise api_error(400, "CONTACT_EMAIL_REQUIRED", "联系方式（邮箱）不能为空。")
    if not EMAIL_PATTERN.match(normalized):
        raise api_error(400, "INVALID_CONTACT_EMAIL", "联系方式（邮箱）格式不正确。")
    return normalized


def _validate_text_field(value: str, field_name: str, code: str) -> str:
    normalized = value.strip()
    if not normalized:
        raise api_error(400, code, f"{field_name}不能为空。")
    return normalized


async def submit_feedback(
    *,
    kind: FeedbackKind,
    user: dict[str, Any],
    overview: str,
    description: str,
    contact_email: str,
    captcha: str | None,
    attachments: list[UploadFile] | None,
    response: Response,
    captcha_cookie: str | None,
) -> dict[str, Any]:
    overview_value = _validate_text_field(
        overview,
        "问题概述" if kind == "ticket" else "新功能概述",
        "OVERVIEW_REQUIRED",
    )
    description_value = _validate_text_field(
        description,
        "问题描述" if kind == "ticket" else "新功能具体描述",
        "DESCRIPTION_REQUIRED",
    )
    contact_email_value = _validate_contact_email(contact_email)

    captcha_required = is_captcha_required(user["id"], kind)
    if captcha_required:
        if not verify_captcha(kind, user["id"], captcha, captcha_cookie):
            raise api_error(400, "INVALID_CAPTCHA", "验证码不正确或已过期，请重新获取。")

    prepared_attachments = await prepare_attachments(attachments)
    submitted_at = now_iso()

    send_feedback_email(
        kind=kind,
        overview=overview_value,
        description=description_value,
        contact_email=contact_email_value,
        user_id=user["id"],
        user_name=str(user.get("name") or ""),
        user_account=str(user.get("account") or ""),
        submitted_at=submitted_at,
        attachments=prepared_attachments,
    )

    with connect() as conn:
        record_feedback_submission(conn, kind=kind, user_id=user["id"], submitted_at=submitted_at)

    if captcha_required:
        clear_captcha(response, kind)

    logger.info(
        "Feedback submitted kind=%s user_id=%s attachment_count=%s",
        kind,
        user["id"],
        len(prepared_attachments),
    )
    return {
        "ok": True,
        "submittedAt": submitted_at,
        "attachmentCount": len(prepared_attachments),
    }
