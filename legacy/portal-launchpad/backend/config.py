from __future__ import annotations

import os
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]

_env_file = PROJECT_ROOT / ".env"
if _env_file.is_file():
    try:
        from dotenv import load_dotenv

        load_dotenv(_env_file)
    except ImportError:
        pass

DIST_DIR = PROJECT_ROOT / "dist"

API_HOST = os.getenv("PORTAL_API_HOST", "0.0.0.0")
API_PORT = int(os.getenv("PORTAL_API_PORT", os.getenv("PORT", "5210")))
APP_USAGE_TTL_SECONDS = int(os.getenv("PORTAL_USAGE_TTL_SECONDS", "120"))
SESSION_TTL_SECONDS = int(os.getenv("PORTAL_SESSION_TTL_SECONDS", str(12 * 60 * 60)))

APP_IDS = [
    "bid-generator",
    "contract-review",
    "competitor-analysis",
    "rag-web-search",
]

ROLE_VALUES = {"admin", "operator", "viewer"}

# 工单 / 愿望单邮件接收地址默认值（可用 PORTAL_TICKET_EMAIL_TO / PORTAL_FEATURE_REQUEST_EMAIL_TO 覆盖）
DEFAULT_FEEDBACK_EMAIL_TO = "1825937473@qq.com"

SMTP_HOST = os.getenv("PORTAL_SMTP_HOST", "")
SMTP_PORT = int(os.getenv("PORTAL_SMTP_PORT", "587"))
SMTP_USERNAME = os.getenv("PORTAL_SMTP_USERNAME", "")
SMTP_PASSWORD = os.getenv("PORTAL_SMTP_PASSWORD", "")
SMTP_USE_TLS = os.getenv("PORTAL_SMTP_USE_TLS", "true").lower() in {"1", "true", "yes"}
SMTP_FROM = os.getenv("PORTAL_SMTP_FROM", "")
TICKET_EMAIL_TO = os.getenv("PORTAL_TICKET_EMAIL_TO", DEFAULT_FEEDBACK_EMAIL_TO)
FEATURE_REQUEST_EMAIL_TO = os.getenv("PORTAL_FEATURE_REQUEST_EMAIL_TO", DEFAULT_FEEDBACK_EMAIL_TO)
CAPTCHA_SECRET = os.getenv("PORTAL_CAPTCHA_SECRET", "portal-launchpad-captcha-secret")
CORS_ORIGINS = [
    origin.strip()
    for origin in os.getenv(
        "PORTAL_CORS_ORIGINS",
        "http://localhost:5200,http://127.0.0.1:5200",
    ).split(",")
    if origin.strip()
]

FEEDBACK_MAX_ATTACHMENTS = 5
FEEDBACK_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024
FEEDBACK_MAX_TOTAL_SIZE_BYTES = 50 * 1024 * 1024
FEEDBACK_RATE_LIMIT_WINDOW_SECONDS = 24 * 60 * 60
FEEDBACK_CAPTCHA_TTL_SECONDS = 10 * 60
FEEDBACK_CAPTCHA_HINT = "建议将问题汇总后发送"

FEEDBACK_ALLOWED_EXTENSIONS = {
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
