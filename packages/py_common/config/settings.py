from functools import lru_cache
from urllib.parse import quote_plus

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    app_env: str = Field(default="dev", validation_alias="APP_ENV")
    database_url: str | None = Field(default=None, validation_alias="DATABASE_URL")
    postgres_host: str | None = Field(default=None, validation_alias="POSTGRES_HOST")
    postgres_port: int = Field(default=5432, validation_alias="POSTGRES_PORT")
    postgres_db: str | None = Field(default=None, validation_alias="POSTGRES_DB")
    postgres_user: str | None = Field(default=None, validation_alias="POSTGRES_USER")
    postgres_password: str | None = Field(default=None, validation_alias="POSTGRES_PASSWORD")

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
                "Database configuration is incomplete. Set DATABASE_URL or provide "
                f"all POSTGRES_* values. Missing: {joined}"
            )

        user = quote_plus(self.postgres_user or "")
        password = quote_plus(self.postgres_password or "")
        host = self.postgres_host
        port = self.postgres_port
        db = quote_plus(self.postgres_db or "")
        return f"postgresql+psycopg://{user}:{password}@{host}:{port}/{db}"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
