from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path
from tempfile import SpooledTemporaryFile
from typing import Any

from fastapi import UploadFile

from ..config import (
    FEEDBACK_ALLOWED_EXTENSIONS,
    FEEDBACK_MAX_ATTACHMENTS,
    FEEDBACK_MAX_FILE_SIZE_BYTES,
    FEEDBACK_MAX_TOTAL_SIZE_BYTES,
)
from ..deps import api_error

logger = logging.getLogger("portal.feedback")

SPOOL_MAX_SIZE = 5 * 1024 * 1024


@dataclass(frozen=True)
class PreparedAttachment:
    filename: str
    content_type: str
    data: bytes


def _safe_filename(filename: str) -> str:
    return Path(filename or "attachment").name


def _extension(filename: str) -> str:
    return Path(filename).suffix.lower()


async def prepare_attachments(files: list[UploadFile] | None) -> list[PreparedAttachment]:
    if not files:
        return []

    if len(files) > FEEDBACK_MAX_ATTACHMENTS:
        raise api_error(
            400,
            "TOO_MANY_ATTACHMENTS",
            f"最多上传 {FEEDBACK_MAX_ATTACHMENTS} 个附件。",
        )

    prepared: list[PreparedAttachment] = []
    total_size = 0

    for upload in files:
        filename = _safe_filename(upload.filename or "")
        extension = _extension(filename)
        if extension not in FEEDBACK_ALLOWED_EXTENSIONS:
            allowed = ", ".join(sorted(FEEDBACK_ALLOWED_EXTENSIONS))
            raise api_error(
                400,
                "INVALID_ATTACHMENT_TYPE",
                f"不支持的附件类型：{extension or '未知'}。允许的类型：{allowed}",
            )

        spooled = SpooledTemporaryFile(max_size=SPOOL_MAX_SIZE)
        file_size = 0
        while True:
            chunk = await upload.read(1024 * 1024)
            if not chunk:
                break
            file_size += len(chunk)
            if file_size > FEEDBACK_MAX_FILE_SIZE_BYTES:
                raise api_error(
                    400,
                    "ATTACHMENT_TOO_LARGE",
                    f"单个附件不得超过 {FEEDBACK_MAX_FILE_SIZE_BYTES // (1024 * 1024)}MB。",
                )
            spooled.write(chunk)

        total_size += file_size
        if total_size > FEEDBACK_MAX_TOTAL_SIZE_BYTES:
            raise api_error(
                400,
                "ATTACHMENTS_TOO_LARGE",
                f"附件总大小不得超过 {FEEDBACK_MAX_TOTAL_SIZE_BYTES // (1024 * 1024)}MB。",
            )

        spooled.seek(0)
        data = spooled.read()
        spooled.close()
        prepared.append(
            PreparedAttachment(
                filename=filename,
                content_type=upload.content_type or "application/octet-stream",
                data=data,
            )
        )
        logger.info(
            "Prepared attachment filename=%s size=%s content_type=%s",
            filename,
            file_size,
            upload.content_type,
        )

    return prepared
