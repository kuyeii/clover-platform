from __future__ import annotations

import json
import sys
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator, Mapping

from dotenv import load_dotenv
from sqlalchemy import text
from sqlalchemy.engine import Connection


def _find_repo_root() -> Path:
    current = Path(__file__).resolve()
    for candidate in (current.parent, *current.parents):
        if (
            (candidate / "config" / "apps.yaml").is_file()
            and (candidate / "packages" / "py_common").is_dir()
            and (candidate / "legacy" / "company-competitors-analysis").is_dir()
        ):
            return candidate
    raise RuntimeError("Cannot locate clover-platform root for competitor-analysis database access.")


REPO_ROOT = _find_repo_root()
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

load_dotenv(REPO_ROOT / ".env")

from packages.py_common.db.session import get_engine  # noqa: E402


@contextmanager
def _connect() -> Iterator[Connection]:
    with get_engine().begin() as conn:
        yield conn


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


def _record_from_row(row: Mapping[str, Any] | None) -> dict[str, Any] | None:
    if row is None:
        return None
    record = _json_value(row.get("record_json"), {})
    return record if isinstance(record, dict) else None


def ensure_storage() -> None:
    try:
        with _connect() as conn:
            missing = conn.execute(
                text(
                    """
                    SELECT table_name
                    FROM (VALUES
                      ('history_records'),
                      ('company_profiles'),
                      ('company_validation_queries')
                    ) AS required(table_name)
                    WHERE to_regclass('competitor_analysis.' || required.table_name) IS NULL
                    """
                )
            ).scalars().all()
    except Exception as exc:
        raise RuntimeError("Cannot connect to PostgreSQL for competitor-analysis storage.") from exc

    if missing:
        joined = ", ".join(f"competitor_analysis.{name}" for name in missing)
        raise RuntimeError(
            f"Missing competitor_analysis PostgreSQL tables: {joined}. "
            "Run: python scripts/init_db.py && alembic upgrade head"
        )


def save_history_record(record: dict[str, Any], *, max_items: int) -> dict[str, Any]:
    ensure_storage()
    input_value = record.get("input") if isinstance(record.get("input"), dict) else {}
    with _connect() as conn:
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
    return record


def read_records(*, max_items: int) -> list[dict[str, Any]]:
    ensure_storage()
    limit = max(max_items, 0)
    if limit <= 0:
        return []
    with _connect() as conn:
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
    return [record for row in rows if (record := _record_from_row(row))]


def read_record_by_id(record_id: str) -> dict[str, Any] | None:
    ensure_storage()
    with _connect() as conn:
        row = conn.execute(
            text("SELECT record_json FROM competitor_analysis.history_records WHERE id = :id"),
            {"id": record_id},
        ).mappings().first()
    return _record_from_row(row)


def delete_history_record(record_id: str) -> None:
    ensure_storage()
    with _connect() as conn:
        conn.execute(
            text("DELETE FROM competitor_analysis.history_records WHERE id = :id"),
            {"id": record_id},
        )


def clear_history_records() -> None:
    ensure_storage()
    with _connect() as conn:
        conn.execute(text("DELETE FROM competitor_analysis.history_records"))


def read_company_validation_query_cache(normalized_query: str) -> dict[str, Any] | None:
    ensure_storage()
    with _connect() as conn:
        row = conn.execute(
            text(
                """
                SELECT response_json
                FROM competitor_analysis.company_validation_queries
                WHERE normalized_query = :normalized_query
                """
            ),
            {"normalized_query": normalized_query},
        ).mappings().first()
    if not row:
        return None
    response = _json_value(row.get("response_json"), {})
    return response if isinstance(response, dict) else None


def read_company_profile_cache(normalized_name: str) -> dict[str, str] | None:
    ensure_storage()
    with _connect() as conn:
        row = conn.execute(
            text(
                """
                SELECT name, intro, business
                FROM competitor_analysis.company_profiles
                WHERE normalized_name = :normalized_name
                """
            ),
            {"normalized_name": normalized_name},
        ).mappings().first()
    if not row:
        return None
    return {
        "name": str(row["name"]),
        "intro": str(row["intro"] or ""),
        "business": str(row["business"] or ""),
    }


def upsert_company_profile(company: dict[str, str], *, normalized_name: str, now_iso: str) -> None:
    ensure_storage()
    with _connect() as conn:
        upsert_company_profile_in_connection(conn, company, normalized_name=normalized_name, now_iso=now_iso)


def upsert_company_profile_in_connection(
    conn: Connection,
    company: dict[str, str],
    *,
    normalized_name: str,
    now_iso: str,
) -> None:
    conn.execute(
        text(
            """
            INSERT INTO competitor_analysis.company_profiles (
              normalized_name, name, intro, business, created_at, updated_at
            )
            VALUES (
              :normalized_name, :name, :intro, :business,
              CAST(:created_at AS timestamptz), CAST(:updated_at AS timestamptz)
            )
            ON CONFLICT (normalized_name) DO UPDATE SET
              name = EXCLUDED.name,
              intro = EXCLUDED.intro,
              business = EXCLUDED.business,
              updated_at = EXCLUDED.updated_at
            """
        ),
        {
            "normalized_name": normalized_name,
            "name": company["name"],
            "intro": company.get("intro") or "",
            "business": company.get("business") or "",
            "created_at": now_iso,
            "updated_at": now_iso,
        },
    )


def read_validation_response(normalized_query: str) -> dict[str, Any]:
    ensure_storage()
    with _connect() as conn:
        row = conn.execute(
            text(
                """
                SELECT response_json
                FROM competitor_analysis.company_validation_queries
                WHERE normalized_query = :normalized_query
                """
            ),
            {"normalized_query": normalized_query},
        ).mappings().first()
    if not row:
        return {}
    response = _json_value(row.get("response_json"), {})
    return response if isinstance(response, dict) else {}


def write_company_validation_cache(
    *,
    normalized_query: str,
    query: str,
    candidate_items: list[Any],
    response: dict[str, Any],
    now_iso: str,
    profiles: list[tuple[dict[str, str], str]],
) -> None:
    ensure_storage()
    with _connect() as conn:
        conn.execute(
            text(
                """
                INSERT INTO competitor_analysis.company_validation_queries (
                  normalized_query, query, candidate_items_json, response_json, created_at, updated_at
                )
                VALUES (
                  :normalized_query, :query, CAST(:candidate_items_json AS jsonb),
                  CAST(:response_json AS jsonb), CAST(:created_at AS timestamptz),
                  CAST(:updated_at AS timestamptz)
                )
                ON CONFLICT (normalized_query) DO UPDATE SET
                  query = EXCLUDED.query,
                  candidate_items_json = EXCLUDED.candidate_items_json,
                  response_json = EXCLUDED.response_json,
                  updated_at = EXCLUDED.updated_at
                """
            ),
            {
                "normalized_query": normalized_query,
                "query": query,
                "candidate_items_json": _json_dumps(candidate_items),
                "response_json": _json_dumps(response),
                "created_at": now_iso,
                "updated_at": now_iso,
            },
        )
        for company, normalized_name in profiles:
            upsert_company_profile_in_connection(
                conn,
                company,
                normalized_name=normalized_name,
                now_iso=now_iso,
            )


def close_db_connection() -> None:
    get_engine().dispose()
