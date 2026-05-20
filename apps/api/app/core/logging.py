from __future__ import annotations

import logging
import re
from typing import Any

URL_PASSWORD_RE = re.compile(r"([a-z][a-z0-9+.-]*://[^:/@\s]+:)([^@\s]+)(@)", re.IGNORECASE)


def redact(value: Any) -> str:
    text = str(value)
    return URL_PASSWORD_RE.sub(r"\1***\3", text)


def _redact_args(args: Any) -> Any:
    if isinstance(args, dict):
        return {key: redact(value) for key, value in args.items()}
    if isinstance(args, tuple):
        return tuple(redact(arg) for arg in args)
    if isinstance(args, list):
        return [redact(arg) for arg in args]
    return redact(args)


class RedactingFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.msg = redact(record.msg)
        if record.args:
            record.args = _redact_args(record.args)
        return True


def configure_logging(environment: str) -> None:
    level = logging.DEBUG if environment in {"dev", "development", "local"} else logging.INFO
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    )
    root_logger = logging.getLogger()
    redacting_filter = RedactingFilter()
    root_logger.addFilter(redacting_filter)
    for handler in root_logger.handlers:
        handler.addFilter(redacting_filter)
