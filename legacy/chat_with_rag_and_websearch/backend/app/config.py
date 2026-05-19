from functools import lru_cache
from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
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

    data_dir: Path = Field(default=Path("../data"), alias="DATA_DIR")
    default_user_id: str = Field(default="user", alias="DEFAULT_USER_ID")


@lru_cache
def get_settings() -> Settings:
    return Settings()
