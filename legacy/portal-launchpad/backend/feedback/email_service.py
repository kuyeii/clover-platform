from __future__ import annotations

import logging
import mimetypes
import smtplib
from email.message import EmailMessage
from typing import Literal

from ..config import (
    FEATURE_REQUEST_EMAIL_TO,
    SMTP_FROM,
    SMTP_HOST,
    SMTP_PASSWORD,
    SMTP_PORT,
    SMTP_USE_TLS,
    SMTP_USERNAME,
    TICKET_EMAIL_TO,
)
from ..deps import api_error
from .attachments import PreparedAttachment

logger = logging.getLogger("portal.feedback")

FeedbackKind = Literal["ticket", "feature_request"]


def _recipient_for_kind(kind: FeedbackKind) -> str:
    if kind == "ticket":
        return TICKET_EMAIL_TO.strip()
    return FEATURE_REQUEST_EMAIL_TO.strip()


def _subject_prefix(kind: FeedbackKind) -> str:
    if kind == "ticket":
        return "[工单]"
    return "[新功能愿望单]"


def _ensure_smtp_configured(recipient: str) -> None:
    if not SMTP_HOST or not SMTP_FROM or not recipient:
        raise api_error(
            503,
            "SMTP_NOT_CONFIGURED",
            "邮件服务尚未配置，请联系管理员设置 SMTP 与收件邮箱。",
        )


def build_email_body(
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


def send_feedback_email(
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
    recipient = _recipient_for_kind(kind)
    _ensure_smtp_configured(recipient)

    message = EmailMessage()
    message["Subject"] = f"{_subject_prefix(kind)} {overview}"
    message["From"] = SMTP_FROM
    message["To"] = recipient
    message["Reply-To"] = contact_email
    message.set_content(
        build_email_body(
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
        "Sending %s email user_id=%s recipient=%s attachment_count=%s",
        kind,
        user_id,
        recipient,
        len(attachments),
    )

    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=60) as smtp:
            if SMTP_USE_TLS:
                smtp.starttls()
            if SMTP_USERNAME:
                smtp.login(SMTP_USERNAME, SMTP_PASSWORD)
            smtp.send_message(message)
    except smtplib.SMTPException as exc:
        logger.exception("SMTP send failed kind=%s user_id=%s", kind, user_id)
        raise api_error(502, "SMTP_SEND_FAILED", "邮件发送失败，请稍后重试。") from exc
