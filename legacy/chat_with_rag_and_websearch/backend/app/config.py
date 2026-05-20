from functools import lru_cache
import sys
from pathlib import Path
from urllib.parse import quote_plus

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


BACKEND_ROOT = Path(__file__).resolve().parents[1]


def _find_monorepo_root(start: Path) -> Path:
    for candidate in (start, *start.parents):
        if (
            (candidate / "config" / "apps.yaml").is_file()
            and (candidate / "packages" / "py_common").is_dir()
            and (candidate / "legacy" / "chat_with_rag_and_websearch").is_dir()
        ):
            return candidate
    return start


MONOREPO_ROOT = _find_monorepo_root(BACKEND_ROOT)
if str(MONOREPO_ROOT) not in sys.path:
    sys.path.insert(0, str(MONOREPO_ROOT))


def _load_env_files() -> None:
    try:
        from dotenv import load_dotenv
    except ImportError:
        return

    for env_file in (MONOREPO_ROOT / ".env", BACKEND_ROOT / ".env"):
        if env_file.is_file():
            load_dotenv(env_file, override=False)


_load_env_files()


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=None,
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_host: str = Field(default="0.0.0.0", alias="APP_HOST")
    app_port: int = Field(default=8000, alias="APP_PORT")
    cors_origins: str = Field(
        default="http://localhost:5175",
        alias="CORS_ORIGINS",
        description="Comma-separated list of allowed origins.",
    )

    # Workflow / Dify-style: POST JSON + SSE (data: {...}) with text_chunk events
    upstream_url: str = Field(default="", alias="UPSTREAM_URL")
    upstream_bearer_token: str = Field(default="", alias="UPSTREAM_BEARER_TOKEN")
    upstream_timeout_seconds: float = Field(default=120.0, alias="UPSTREAM_TIMEOUT_SECONDS")

    workflow_remote_user: str = Field(
        default="admin",
        alias="WORKFLOW_REMOTE_USER",
        description='Payload field "user" sent to the workflow API.',
    )
    workflow_question_input_key: str = Field(
        default="question",
        alias="WORKFLOW_QUESTION_INPUT_KEY",
        description='Key inside payload["inputs"] for the user message.',
    )
    workflow_allow_search_input_key: str = Field(
        default="allow_search",
        alias="WORKFLOW_ALLOW_SEARCH_INPUT_KEY",
        description='Key inside payload["inputs"]; value "1" or "0".',
    )
    workflow_history_input_key: str = Field(
        default="history",
        alias="WORKFLOW_HISTORY_INPUT_KEY",
        description='Key inside payload["inputs"] for JSON-string chat history.',
    )

    # Dify HTTP API 根路径（datasets、workflows 等均为其下路径，如 …/v1/datasets）
    dify_api_base_url: str = Field(
        default="http://localhost/v1",
        alias="DIFY_API_BASE_URL",
        description='Dify API base URL without trailing slash (e.g. "http://localhost/v1").',
    )

    # Dify 知识库 API（datasets / documents / upload 等；与工作流 App Key 通常为不同密钥）
    dify_dataset_api_key: str = Field(
        default="",
        alias="DIFY_DATASET_API_KEY",
        description=(
            'Bearer token body for Dataset/Knowledge APIs (e.g. "dataset-xxxx"). '
            'Do not include the "Bearer " prefix.'
        ),
    )

    # 知识库管理（文档列表/删除等）默认操作的知识库 UUID
    dify_default_dataset_id: str = Field(
        default="",
        alias="DIFY_DEFAULT_DATASET_ID",
        description="Default dataset (knowledge base) UUID for server-side document APIs.",
    )

    database_url: str | None = Field(default=None, alias="DATABASE_URL")
    postgres_host: str | None = Field(default=None, alias="POSTGRES_HOST")
    postgres_port: int = Field(default=5432, alias="POSTGRES_PORT")
    postgres_db: str | None = Field(default=None, alias="POSTGRES_DB")
    postgres_user: str | None = Field(default=None, alias="POSTGRES_USER")
    postgres_password: str | None = Field(default=None, alias="POSTGRES_PASSWORD")

    @field_validator("dify_api_base_url", mode="before")
    @classmethod
    def normalize_dify_api_base_url(cls, v: object) -> str:
        default = "http://localhost/v1"
        if v is None:
            return default
        if isinstance(v, str):
            s = v.strip().removesuffix("/")
            return s if s else default
        return default

    default_user_id: str = Field(default="user", alias="DEFAULT_USER_ID")

    def resolved_database_url(self) -> str:
        if self.database_url:
            return self.database_url

        missing = [
            name
            for name, value in (
                ("POSTGRES_HOST", self.postgres_host),
                ("POSTGRES_DB", self.postgres_db),
                ("POSTGRES_USER", self.postgres_user),
                ("POSTGRES_PASSWORD", self.postgres_password),
            )
            if not value
        ]
        if missing:
            joined = ", ".join(missing)
            raise ValueError(
                "DATABASE_URL is missing and PostgreSQL connection settings are incomplete. "
                f"Missing: {joined}"
            )

        user = quote_plus(self.postgres_user or "")
        password = quote_plus(self.postgres_password or "")
        db = quote_plus(self.postgres_db or "")
        return f"postgresql+psycopg://{user}:{password}@{self.postgres_host}:{self.postgres_port}/{db}"


@lru_cache
def get_settings() -> Settings:
    return Settings()
