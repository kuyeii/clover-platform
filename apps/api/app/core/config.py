from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
import os
from pathlib import Path
import sys

REPO_ROOT = Path(__file__).resolve().parents[4]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from packages.py_common.config import get_settings
from packages.py_common.config.loader import find_repo_root

SERVICE_TITLE = "Clover Platform API"
SERVICE_NAME = "clover-platform-api"
SERVICE_VERSION = "0.6.0"
API_PREFIX = "/api/v1/core"


@dataclass(frozen=True)
class ApiSettings:
    repo_root: Path
    environment: str
    service_name: str = SERVICE_NAME
    version: str = SERVICE_VERSION
    smtp_host: str = os.getenv("PORTAL_SMTP_HOST", "")
    smtp_port: int = int(os.getenv("PORTAL_SMTP_PORT", "587"))
    smtp_username: str = os.getenv("PORTAL_SMTP_USERNAME", "")
    smtp_password: str = os.getenv("PORTAL_SMTP_PASSWORD", "")
    smtp_use_tls: bool = os.getenv("PORTAL_SMTP_USE_TLS", "true").lower() in {"1", "true", "yes"}
    smtp_from: str = os.getenv("PORTAL_SMTP_FROM", "")
    ticket_email_to: str = os.getenv("PORTAL_TICKET_EMAIL_TO", "1825937473@qq.com")
    feature_request_email_to: str = os.getenv("PORTAL_FEATURE_REQUEST_EMAIL_TO", "1825937473@qq.com")
    captcha_secret: str = os.getenv("PORTAL_CAPTCHA_SECRET", "portal-launchpad-captcha-secret")
    feedback_max_attachments: int = 5
    feedback_max_file_size_bytes: int = 10 * 1024 * 1024
    feedback_max_total_size_bytes: int = 50 * 1024 * 1024
    feedback_rate_limit_window_seconds: int = 24 * 60 * 60
    feedback_captcha_ttl_seconds: int = 10 * 60
    feedback_captcha_hint: str = "建议将问题汇总后发送"
    feedback_allowed_extensions: frozenset[str] = frozenset(
        {
            ".png",
            ".jpg",
            ".jpeg",
            ".txt",
            ".rar",
            ".doc",
            ".docx",
            ".xls",
            ".xlsx",
            ".pdf",
            ".zip",
            ".7z",
            ".mp4",
        }
    )


@lru_cache(maxsize=1)
def get_api_settings() -> ApiSettings:
    repo_root = find_repo_root(Path(__file__))
    settings = get_settings()
    return ApiSettings(repo_root=repo_root, environment=settings.app_env or "dev")
