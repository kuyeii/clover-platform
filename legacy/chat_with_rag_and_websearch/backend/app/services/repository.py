from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Connection, Engine, make_url

from app.config import Settings

_engine: Engine | None = None
_engine_url: str | None = None


def _safe_database_target(settings: Settings) -> str:
    try:
        url = make_url(settings.resolved_database_url())
    except Exception:
        return "unresolved database URL"
    return f"host={url.host}, port={url.port or 5432}, db={url.database}, user={url.username}"


def get_engine(settings: Settings) -> Engine:
    global _engine, _engine_url
    url = settings.resolved_database_url()
    if _engine is None or _engine_url != url:
        try:
            _engine = create_engine(
                url,
                pool_pre_ping=True,
                pool_size=5,
                max_overflow=5,
                echo=False,
            )
            _engine_url = url
        except Exception as exc:
            raise RuntimeError(
                "Failed to create PostgreSQL engine for RAG storage "
                f"({_safe_database_target(settings)}). Check DATABASE_URL or POSTGRES_* settings."
            ) from exc
    return _engine


@contextmanager
def transaction(settings: Settings) -> Iterator[Connection]:
    with get_engine(settings).begin() as conn:
        yield conn


def ensure_rag_storage(settings: Settings) -> None:
    with transaction(settings) as conn:
        missing = conn.execute(
            text(
                """
                SELECT table_name
                FROM (VALUES
                  ('conversations'),
                  ('chat_turns')
                ) AS required(table_name)
                WHERE to_regclass('rag.' || required.table_name) IS NULL
                """
            )
        ).scalars().all()

    if missing:
        joined = ", ".join(f"rag.{name}" for name in missing)
        raise RuntimeError(
            f"Missing RAG PostgreSQL tables: {joined}. "
            "Run: python scripts/init_db.py && alembic upgrade head"
        )
