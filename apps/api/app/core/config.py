from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
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


@lru_cache(maxsize=1)
def get_api_settings() -> ApiSettings:
    repo_root = find_repo_root(Path(__file__))
    settings = get_settings()
    return ApiSettings(repo_root=repo_root, environment=settings.app_env or "dev")
