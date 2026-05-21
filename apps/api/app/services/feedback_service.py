from __future__ import annotations

import hashlib
import hmac
import logging
import mimetypes
import re
import secrets
import smtplib
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from pathlib import Path
from tempfile import SpooledTemporaryFile
from typing import Any

from fastapi import Response, UploadFile

from app.core.config import get_api_settings
from app.core.errors import PlatformError
from app.core.security import now_iso
from app.schemas.feedback import FeedbackKind
from app.services import portal_store as store

logger = logging.getLogger(__name__)

EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
SPOOL_MAX_SIZE = 5 * 1024 * 1024


@dataclass(frozen=True)
class PreparedAttachment:
    filename: str
    content_type: str
    data: bytes


def captcha_cookie_name(kind: FeedbackKind) -> str:
    return f"portal_feedback_captcha_{kind}"


def default_contact_email(user: dict[str, Any]) -> str:
    account = str(user.get("account") or "").strip()
    if "@" in account and EMAIL_PATTERN.match(account):
        return account
    return ""


def _rate_limit_cutoff() -> datetime:
    settings = get_api_settings()
    return datetime.now(timezone.utc) - timedelta(seconds=settings.feedback_rate_limit_window_seconds)


def is_captcha_required(user_id: str, kind: FeedbackKind) -> bool:
    with store.connect() as conn:
        recent_count = store.count_recent_feedback_submissions(
            conn,
            kind=kind,
            user_id=user_id,
            submitted_after=_rate_limit_cutoff(),
        )
    return recent_count >= 1


def build_submission_context(user: dict[str, Any], kind: FeedbackKind) -> dict[str, Any]:
    settings = get_api_settings()
    captcha_required = is_captcha_required(user["id"], kind)
    return {
        "defaultContactEmail": default_contact_email(user),
        "captchaRequired": captcha_required,
        "captchaHint": settings.feedback_captcha_hint if captcha_required else "",
    }


def _sign_payload(payload: str) -> str:
    settings = get_api_settings()
    return hmac.new(
        settings.captcha_secret.encode("utf-8"),
        payload.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def _generate_captcha_code() -> str:
    return f"{secrets.randbelow(100000):05d}"


def _issue_captcha(response: Response, kind: FeedbackKind, user_id: str, code: str) -> None:
    settings = get_api_settings()
    expires_at = int(
        (datetime.now(timezone.utc) + timedelta(seconds=settings.feedback_captcha_ttl_seconds)).timestamp()
    )
    code_hash = hashlib.sha256(code.encode("utf-8")).hexdigest()
    payload = f"{kind}:{user_id}:{code_hash}:{expires_at}"
    response.set_cookie(
        key=captcha_cookie_name(kind),
        value=f"{expires_at}.{_sign_payload(payload)}",
        httponly=True,
        samesite="lax",
        max_age=settings.feedback_captcha_ttl_seconds,
        path="/",
    )


def create_captcha_challenge(response: Response, user: dict[str, Any], kind: FeedbackKind) -> dict[str, str]:
    settings = get_api_settings()
    code = _generate_captcha_code()
    _issue_captcha(response, kind, user["id"], code)
    logger.info("Issued feedback captcha kind=%s user_id=%s", kind, user["id"])
    return {"code": code, "hint": settings.feedback_captcha_hint}


def _verify_captcha(
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
    return hmac.compare_digest(signature, _sign_payload(payload))


def _clear_captcha(response: Response, kind: FeedbackKind) -> None:
    response.delete_cookie(key=captcha_cookie_name(kind), path="/")


def _safe_filename(filename: str) -> str:
    return Path(filename or "attachment").name


def _extension(filename: str) -> str:
    return Path(filename).suffix.lower()


async def _prepare_attachments(files: list[UploadFile] | None) -> list[PreparedAttachment]:
    settings = get_api_settings()
    if not files:
        return []

    if len(files) > settings.feedback_max_attachments:
        raise PlatformError(
            code="TOO_MANY_ATTACHMENTS",
            message=f"最多上传 {settings.feedback_max_attachments} 个附件。",
            status_code=400,
        )

    prepared: list[PreparedAttachment] = []
    total_size = 0

    for upload in files:
        filename = _safe_filename(upload.filename or "")
        extension = _extension(filename)
        if extension not in settings.feedback_allowed_extensions:
            allowed = ", ".join(sorted(settings.feedback_allowed_extensions))
            raise PlatformError(
                code="INVALID_ATTACHMENT_TYPE",
                message=f"不支持的附件类型：{extension or '未知'}。允许的类型：{allowed}",
                status_code=400,
            )

        spooled = SpooledTemporaryFile(max_size=SPOOL_MAX_SIZE)
        file_size = 0
        try:
            while True:
                chunk = await upload.read(1024 * 1024)
                if not chunk:
                    break
                file_size += len(chunk)
                if file_size > settings.feedback_max_file_size_bytes:
                    raise PlatformError(
                        code="ATTACHMENT_TOO_LARGE",
                        message=f"单个附件不得超过 {settings.feedback_max_file_size_bytes // (1024 * 1024)}MB。",
                        status_code=400,
                    )
                spooled.write(chunk)

            total_size += file_size
            if total_size > settings.feedback_max_total_size_bytes:
                raise PlatformError(
                    code="ATTACHMENTS_TOO_LARGE",
                    message=f"附件总大小不得超过 {settings.feedback_max_total_size_bytes // (1024 * 1024)}MB。",
                    status_code=400,
                )

            spooled.seek(0)
            prepared.append(
                PreparedAttachment(
                    filename=filename,
                    content_type=upload.content_type or "application/octet-stream",
                    data=spooled.read(),
                )
            )
            logger.info(
                "Prepared feedback attachment filename=%s size=%s content_type=%s",
                filename,
                file_size,
                upload.content_type,
            )
        finally:
            spooled.close()

    return prepared


def _validate_contact_email(contact_email: str) -> str:
    normalized = contact_email.strip()
    if not normalized:
        raise PlatformError(code="CONTACT_EMAIL_REQUIRED", message="联系方式（邮箱）不能为空。", status_code=400)
    if not EMAIL_PATTERN.match(normalized):
        raise PlatformError(code="INVALID_CONTACT_EMAIL", message="联系方式（邮箱）格式不正确。", status_code=400)
    return normalized


def _validate_text_field(value: str, field_name: str, code: str) -> str:
    normalized = value.strip()
    if not normalized:
        raise PlatformError(code=code, message=f"{field_name}不能为空。", status_code=400)
    return normalized


def _recipient_for_kind(kind: FeedbackKind) -> str:
    settings = get_api_settings()
    if kind == "ticket":
        return settings.ticket_email_to.strip()
    return settings.feature_request_email_to.strip()


def _subject_prefix(kind: FeedbackKind) -> str:
    return "[工单]" if kind == "ticket" else "[新功能愿望单]"


def _ensure_smtp_configured(recipient: str) -> None:
    settings = get_api_settings()
    if not settings.smtp_host or not settings.smtp_from or not recipient:
        raise PlatformError(
            code="SMTP_NOT_CONFIGURED",
            message="邮件服务尚未配置，请联系管理员设置 SMTP 与收件邮箱。",
            status_code=503,
        )


def _build_email_body(
    *,
    kind: FeedbackKind,
    overview: str,
    description: str,
    contact_email: str,
    user_id: str,
    user_name: str,
    user_account: str,
    submitted_at: str,
) -> str:
    kind_label = "工单" if kind == "ticket" else "新功能愿望单"
    lines = [
        f"类型：{kind_label}",
        f"提交时间：{submitted_at}",
        f"用户 ID：{user_id}",
        f"用户姓名：{user_name}",
        f"用户账号：{user_account}",
        f"联系方式（邮箱）：{contact_email}",
        "",
        f"{'问题概述' if kind == 'ticket' else '新功能概述'}：",
        overview,
        "",
        f"{'问题描述' if kind == 'ticket' else '新功能具体描述'}：",
        description,
    ]
    return "\n".join(lines)


def _send_feedback_email(
    *,
    kind: FeedbackKind,
    overview: str,
    description: str,
    contact_email: str,
    user_id: str,
    user_name: str,
    user_account: str,
    submitted_at: str,
    attachments: list[PreparedAttachment],
) -> None:
    settings = get_api_settings()
    recipient = _recipient_for_kind(kind)
    _ensure_smtp_configured(recipient)

    message = EmailMessage()
    message["Subject"] = f"{_subject_prefix(kind)} {overview}"
    message["From"] = settings.smtp_from
    message["To"] = recipient
    message["Reply-To"] = contact_email
    message.set_content(
        _build_email_body(
            kind=kind,
            overview=overview,
            description=description,
            contact_email=contact_email,
            user_id=user_id,
            user_name=user_name,
            user_account=user_account,
            submitted_at=submitted_at,
        )
    )

    for attachment in attachments:
        guessed_type, _ = mimetypes.guess_type(attachment.filename)
        content_type = attachment.content_type if attachment.content_type else guessed_type
        if content_type and "/" in content_type:
            maintype, subtype = content_type.split("/", 1)
        else:
            maintype, subtype = "application", "octet-stream"
        message.add_attachment(
            attachment.data,
            maintype=maintype,
            subtype=subtype,
            filename=attachment.filename,
        )

    logger.info(
        "Sending feedback email kind=%s user_id=%s recipient=%s attachment_count=%s",
        kind,
        user_id,
        recipient,
        len(attachments),
    )

    try:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=60) as smtp:
            if settings.smtp_use_tls:
                smtp.starttls()
            if settings.smtp_username:
                smtp.login(settings.smtp_username, settings.smtp_password)
            smtp.send_message(message)
    except smtplib.SMTPException as exc:
        logger.exception("SMTP send failed kind=%s user_id=%s", kind, user_id)
        raise PlatformError(code="SMTP_SEND_FAILED", message="邮件发送失败，请稍后重试。", status_code=502) from exc


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
    if captcha_required and not _verify_captcha(kind, user["id"], captcha, captcha_cookie):
        raise PlatformError(
            code="INVALID_CAPTCHA",
            message="验证码不正确或已过期，请重新获取。",
            status_code=400,
        )

    prepared_attachments = await _prepare_attachments(attachments)
    submitted_at = now_iso()

    _send_feedback_email(
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

    with store.connect() as conn:
        store.record_feedback_submission(conn, kind=kind, user_id=user["id"], submitted_at=submitted_at)

    if captcha_required:
        _clear_captcha(response, kind)

    logger.info(
        "Feedback submitted kind=%s user_id=%s attachment_count=%s",
        kind,
        user["id"],
        len(prepared_attachments),
    )
    return {"ok": True, "submittedAt": submitted_at, "attachmentCount": len(prepared_attachments)}
