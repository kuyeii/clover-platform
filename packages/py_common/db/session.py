from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, sessionmaker

from packages.py_common.config import get_settings


_engine: Engine | None = None


def get_engine() -> Engine:
    global _engine
    if _engine is None:
        try:
            _engine = create_engine(
                get_settings().resolved_database_url(),
                pool_pre_ping=True,
                pool_size=5,
                max_overflow=5,
                echo=False,
            )
        except Exception as exc:
            raise RuntimeError(f"Failed to create PostgreSQL engine: {exc}") from exc
    return _engine


SessionLocal = sessionmaker(autocommit=False, autoflush=False)


def get_db() -> Generator[Session, None, None]:
    session = SessionLocal(bind=get_engine())
    try:
        yield session
    except SQLAlchemyError:
        session.rollback()
        raise
    finally:
        session.close()
