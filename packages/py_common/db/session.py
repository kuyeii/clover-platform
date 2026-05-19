from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, sessionmaker

from packages.py_common.config import get_settings


_engine: Engine | None = None
_session_factory: sessionmaker[Session] | None = None


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


def get_session_factory() -> sessionmaker[Session]:
    """Return a sessionmaker bound to the shared engine.

    Future business code should use get_db() or get_session_factory() instead of
    constructing an unbound SQLAlchemy Session directly.
    """
    global _session_factory
    if _session_factory is None:
        _session_factory = sessionmaker(
            bind=get_engine(),
            autocommit=False,
            autoflush=False,
        )
    return _session_factory


def get_db() -> Generator[Session, None, None]:
    session = get_session_factory()()
    try:
        yield session
    except SQLAlchemyError:
        session.rollback()
        raise
    finally:
        session.close()
