from __future__ import annotations

import json
import logging
import os
from typing import Any, Mapping

from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.core.errors import PlatformError
from packages.py_common.db.session import get_engine

logger = logging.getLogger(__name__)

DEFAULT_MAX_ITEMS = 200
HISTORY_MAX_ITEMS = int(os.getenv("HISTORY_MAX_ITEMS") or DEFAULT_MAX_ITEMS)


class CompetitorAnalysisBadRequest(Exception):
    def __init__(self, message: str, *, code: str = "BAD_REQUEST", status_code: int = 400) -> None:
        self.message = message
        self.code = code
        self.status_code = status_code
        super().__init__(message)


def _json_dumps(data: Any) -> str:
    return json.dumps(data, ensure_ascii=False, separators=(",", ":"))


def _json_value(value: Any, fallback: Any) -> Any:
    if value is None:
        return fallback
    if isinstance(value, (dict, list)):
        return value
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return fallback
    return fallback


def _database_error(exc: Exception) -> PlatformError:
    logger.exception("Competitor-analysis history PostgreSQL operation failed")
    return PlatformError(
        code="DATABASE_ERROR",
        message="竞对分析历史数据库访问失败。",
        status_code=500,
        details={"module": "competitor-analysis", "schema": "competitor_analysis"},
    )


def _record_from_row(row: Mapping[str, Any] | None) -> dict[str, Any] | None:
    if row is None:
        return None
    record = _json_value(row.get("record_json"), {})
    return record if isinstance(record, dict) else None


def ensure_history_storage() -> None:
    try:
        with get_engine().begin() as conn:
            exists = conn.execute(
                text("SELECT to_regclass('competitor_analysis.history_records') IS NOT NULL")
            ).scalar_one()
    except (SQLAlchemyError, RuntimeError) as exc:
        raise _database_error(exc) from exc

    if not exists:
        raise PlatformError(
            code="DATABASE_ERROR",
            message="竞对分析历史数据库表不存在。",
            status_code=500,
            details={"table": "competitor_analysis.history_records"},
        )


def save_history_record(record: Any, *, max_items: int = HISTORY_MAX_ITEMS) -> dict[str, Any]:
    if not isinstance(record, dict):
        raise CompetitorAnalysisBadRequest("请求体必须为对象")
    if not record.get("id") or not record.get("createdAt"):
        raise CompetitorAnalysisBadRequest("缺少必要字段 id/createdAt")

    input_value = record.get("input") if isinstance(record.get("input"), dict) else {}
    try:
        ensure_history_storage()
        with get_engine().begin() as conn:
            sort_order = int(
                conn.execute(
                    text("SELECT COALESCE(MAX(sort_order), 0) + 1 FROM competitor_analysis.history_records")
                ).scalar_one()
            )
            conn.execute(
                text(
                    """
                    INSERT INTO competitor_analysis.history_records (
                      id, created_at, query_time, title, input_json, record_json, sort_order, updated_at
                    )
                    VALUES (
                      :id, CAST(:created_at AS timestamptz), :query_time, :title,
                      CAST(:input_json AS jsonb), CAST(:record_json AS jsonb), :sort_order, now()
                    )
                    ON CONFLICT (id) DO UPDATE SET
                      created_at = EXCLUDED.created_at,
                      query_time = EXCLUDED.query_time,
                      title = EXCLUDED.title,
                      input_json = EXCLUDED.input_json,
                      record_json = EXCLUDED.record_json,
                      sort_order = EXCLUDED.sort_order,
                      updated_at = EXCLUDED.updated_at
                    """
                ),
                {
                    "id": str(record.get("id") or ""),
                    "created_at": str(record.get("createdAt") or ""),
                    "query_time": str(record.get("queryTime") or ""),
                    "title": str(record.get("title") or ""),
                    "input_json": _json_dumps(input_value),
                    "record_json": _json_dumps(record),
                    "sort_order": sort_order,
                },
            )
            if max_items <= 0:
                conn.execute(text("DELETE FROM competitor_analysis.history_records"))
            else:
                conn.execute(
                    text(
                        """
                        DELETE FROM competitor_analysis.history_records
                        WHERE id IN (
                          SELECT id
                          FROM (
                            SELECT
                              id,
                              row_number() OVER (ORDER BY sort_order DESC, created_at DESC, id DESC) AS row_num
                            FROM competitor_analysis.history_records
                          ) ranked
                          WHERE row_num > :max_items
                        )
                        """
                    ),
                    {"max_items": max_items},
                )
    except PlatformError:
        raise
    except SQLAlchemyError as exc:
        raise _database_error(exc) from exc

    return record


def read_history_records(*, max_items: int = HISTORY_MAX_ITEMS) -> list[dict[str, Any]]:
    limit = max(max_items, 0)
    if limit <= 0:
        return []
    try:
        ensure_history_storage()
        with get_engine().begin() as conn:
            rows = conn.execute(
                text(
                    """
                    SELECT record_json
                    FROM competitor_analysis.history_records
                    ORDER BY sort_order DESC, created_at DESC, id DESC
                    LIMIT :limit
                    """
                ),
                {"limit": limit},
            ).mappings().all()
    except PlatformError:
        raise
    except SQLAlchemyError as exc:
        raise _database_error(exc) from exc
    return [record for row in rows if (record := _record_from_row(row))]


def read_history_record_by_id(record_id: str) -> dict[str, Any] | None:
    try:
        ensure_history_storage()
        with get_engine().begin() as conn:
            row = conn.execute(
                text("SELECT record_json FROM competitor_analysis.history_records WHERE id = :id"),
                {"id": record_id},
            ).mappings().first()
    except PlatformError:
        raise
    except SQLAlchemyError as exc:
        raise _database_error(exc) from exc
    return _record_from_row(row)


def delete_history_record(record_id: str) -> None:
    try:
        ensure_history_storage()
        with get_engine().begin() as conn:
            conn.execute(
                text("DELETE FROM competitor_analysis.history_records WHERE id = :id"),
                {"id": record_id},
            )
    except PlatformError:
        raise
    except SQLAlchemyError as exc:
        raise _database_error(exc) from exc


def clear_history_records() -> None:
    try:
        ensure_history_storage()
        with get_engine().begin() as conn:
            conn.execute(text("DELETE FROM competitor_analysis.history_records"))
    except PlatformError:
        raise
    except SQLAlchemyError as exc:
        raise _database_error(exc) from exc
