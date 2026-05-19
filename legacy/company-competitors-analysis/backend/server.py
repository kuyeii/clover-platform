#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Python backend for the competitor-analysis app.

This file replaces the previous Express implementation while preserving the same
HTTP API surface used by the React frontend.
"""

from __future__ import annotations

import json
import ast
import argparse
from contextlib import contextmanager
import mimetypes
import os
import random
import re
import sqlite3
import sys
import threading
import time
import traceback
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Optional, Tuple
from urllib import error as urllib_error
from urllib import request as urllib_request
from urllib.parse import unquote, urlparse

ROOT_DIR = Path(__file__).resolve().parent.parent
BACKEND_DIR = Path(__file__).resolve().parent
DATA_DIR = BACKEND_DIR / "data"
LEGACY_DATA_FILE = DATA_DIR / "history.json"
LEGACY_INDEX_FILE = DATA_DIR / "index.json"
LEGACY_RECORDS_DIR = DATA_DIR / "history"
DEFAULT_WORKFLOW_URL = "http://localhost/v1/workflows/run"
RETRY_HTTP_STATUS = {408, 425, 429, 500, 502, 503, 504}
MAX_COMPETITOR_COUNT = 5
MAX_BODY_BYTES = 20 * 1024 * 1024
DEFAULT_DIFY_TIMEOUT_SECONDS = 600
DEFAULT_COMPANY_DETAIL_TIMEOUT_SECONDS = 900
MAX_DETAIL_WORKFLOW_WORKERS = MAX_COMPETITOR_COUNT + 1


def load_env_file(file_path: Path) -> None:
    """Load simple KEY=VALUE lines without overriding existing env vars."""
    try:
        text = file_path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return
    except OSError:
        return

    for line in text.splitlines():
        trimmed = line.strip()
        if not trimmed or trimmed.startswith("#"):
            continue
        if "=" not in trimmed:
            continue
        key, value = trimmed.split("=", 1)
        key = key.strip()
        value = value.strip()
        if (value.startswith('"') and value.endswith('"')) or (value.startswith("'") and value.endswith("'")):
            value = value[1:-1]
        if key and key not in os.environ:
            os.environ[key] = value


def parse_server_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Start competitor-analysis backend server.")
    parser.add_argument(
        "--host",
        default=os.environ.get("HISTORY_SERVER_HOST") or os.environ.get("BACKEND_HOST") or "0.0.0.0",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=int(os.environ.get("HISTORY_SERVER_PORT") or os.environ.get("BACKEND_PORT") or 8788),
    )
    args, _ = parser.parse_known_args()
    return args


load_env_file(ROOT_DIR / ".env")
load_env_file(ROOT_DIR / ".env.local")

SERVER_ARGS = parse_server_args()
PORT = SERVER_ARGS.port
HOST = SERVER_ARGS.host
MAX_ITEMS = int(os.environ.get("HISTORY_MAX_ITEMS") or 200)


def resolve_local_path(value: str, fallback: Path) -> Path:
    if not value:
        return fallback
    path = Path(value).expanduser()
    return path if path.is_absolute() else ROOT_DIR / path


DB_FILE = resolve_local_path(os.environ.get("HISTORY_DB_PATH") or os.environ.get("SQLITE_DB_PATH") or "", DATA_DIR / "history.sqlite3")
STATIC_DIR = resolve_local_path(os.environ.get("STATIC_DIR") or "", ROOT_DIR / "dist")
MAX_COMPANY_MEMORY_CACHE_SIZE = int(os.environ.get("COMPANY_MEMORY_CACHE_SIZE") or 5000)

_STORAGE_READY = False
_STORAGE_READY_LOCK = threading.Lock()
_DB_CONNECTION: Optional[sqlite3.Connection] = None
_DB_CONNECTION_LOCK = threading.RLock()
_COMPANY_CACHE_LOCK = threading.Lock()
_COMPANY_QUERY_MEMORY_CACHE: Dict[str, Dict[str, Any]] = {}
_COMPANY_PROFILE_MEMORY_CACHE: Dict[str, Dict[str, str]] = {}


class AppError(Exception):
    def __init__(
        self,
        message: str,
        *,
        status_code: int = 500,
        code: str = "ERROR",
        http_status: Optional[int] = None,
        payload: Any = None,
        workflow_status: Optional[str] = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.code = code
        self.http_status = http_status
        self.payload = payload
        self.workflow_status = workflow_status


def get_env(names: Iterable[str] | str, fallback: str = "") -> str:
    keys = [names] if isinstance(names, str) else list(names)
    for key in keys:
        value = os.environ.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return fallback


def get_timeout_seconds(names: Iterable[str] | str, fallback: int = DEFAULT_DIFY_TIMEOUT_SECONDS) -> int:
    value = get_env(names, str(fallback))
    try:
        timeout = int(float(value))
    except (TypeError, ValueError):
        return fallback
    return max(1, timeout)


def safe_record_file_name(record_id: Any) -> str:
    return f"{re.sub(r'[^a-zA-Z0-9_-]', '_', str(record_id))}.json"


@contextmanager
def connect_db(read_only: bool = False) -> sqlite3.Connection:
    global _DB_CONNECTION
    DB_FILE.parent.mkdir(parents=True, exist_ok=True)
    with _DB_CONNECTION_LOCK:
        if _DB_CONNECTION is None:
            _DB_CONNECTION = sqlite3.connect(DB_FILE, timeout=30, check_same_thread=False)
            _DB_CONNECTION.row_factory = sqlite3.Row
            _DB_CONNECTION.execute("PRAGMA foreign_keys = ON")
            _DB_CONNECTION.execute("PRAGMA busy_timeout = 30000")
        try:
            yield _DB_CONNECTION
            if not read_only:
                _DB_CONNECTION.commit()
        except Exception:
            if not read_only:
                _DB_CONNECTION.rollback()
            raise


def close_db_connection() -> None:
    global _DB_CONNECTION
    with _DB_CONNECTION_LOCK:
        if _DB_CONNECTION is not None:
            _DB_CONNECTION.close()
            _DB_CONNECTION = None


def ensure_storage() -> None:
    global _STORAGE_READY
    if _STORAGE_READY:
        return
    with _STORAGE_READY_LOCK:
        if _STORAGE_READY:
            return
        with connect_db() as conn:
            conn.execute("PRAGMA journal_mode = WAL")
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS history_records (
                    id TEXT PRIMARY KEY,
                    created_at TEXT NOT NULL,
                    query_time TEXT NOT NULL,
                    title TEXT NOT NULL,
                    input_json TEXT NOT NULL,
                    record_json TEXT NOT NULL,
                    sort_order INTEGER NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS storage_meta (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS company_profiles (
                    normalized_name TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    intro TEXT NOT NULL DEFAULT '',
                    business TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS company_validation_queries (
                    normalized_query TEXT PRIMARY KEY,
                    query TEXT NOT NULL,
                    candidate_items_json TEXT NOT NULL DEFAULT '[]',
                    response_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )
            conn.execute("CREATE INDEX IF NOT EXISTS idx_history_records_sort_order ON history_records(sort_order DESC)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_history_records_created_at ON history_records(created_at DESC)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_company_profiles_updated_at ON company_profiles(updated_at DESC)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_company_validation_queries_updated_at ON company_validation_queries(updated_at DESC)")
        _STORAGE_READY = True


def read_json_file(file_path: Path) -> Any:
    return json.loads(file_path.read_text(encoding="utf-8"))


def json_dumps(data: Any) -> str:
    return json.dumps(data, ensure_ascii=False, separators=(",", ":"))


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def row_to_record(row: sqlite3.Row) -> Optional[Dict[str, Any]]:
    try:
        parsed = json.loads(row["record_json"])
    except (json.JSONDecodeError, TypeError):
        return None
    return parsed if isinstance(parsed, dict) else None


def get_record_fields(record: Dict[str, Any]) -> Dict[str, str]:
    input_value = record.get("input") if isinstance(record.get("input"), dict) else {}
    return {
        "id": str(record.get("id") or ""),
        "created_at": str(record.get("createdAt") or ""),
        "query_time": str(record.get("queryTime") or ""),
        "title": str(record.get("title") or ""),
        "input_json": json_dumps(input_value),
        "record_json": json_dumps(record),
    }


def upsert_history_record(conn: sqlite3.Connection, record: Dict[str, Any], sort_order: int) -> None:
    fields = get_record_fields(record)
    conn.execute(
        """
        INSERT INTO history_records (
            id, created_at, query_time, title, input_json, record_json, sort_order, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            created_at = excluded.created_at,
            query_time = excluded.query_time,
            title = excluded.title,
            input_json = excluded.input_json,
            record_json = excluded.record_json,
            sort_order = excluded.sort_order,
            updated_at = excluded.updated_at
        """,
        (
            fields["id"],
            fields["created_at"],
            fields["query_time"],
            fields["title"],
            fields["input_json"],
            fields["record_json"],
            sort_order,
            utc_now_iso(),
        ),
    )


def trim_overflow(conn: sqlite3.Connection) -> None:
    if MAX_ITEMS <= 0:
        conn.execute("DELETE FROM history_records")
        return
    conn.execute(
        """
        DELETE FROM history_records
        WHERE id IN (
            SELECT id
            FROM history_records
            ORDER BY sort_order DESC, created_at DESC, id DESC
            LIMIT -1 OFFSET ?
        )
        """,
        (MAX_ITEMS,),
    )


def save_history_record(record: Any) -> Dict[str, Any]:
    if not isinstance(record, dict):
        raise AppError("请求体必须为对象", status_code=400, code="BAD_REQUEST")
    if not record.get("id") or not record.get("createdAt"):
        raise AppError("缺少必要字段 id/createdAt", status_code=400, code="BAD_REQUEST")

    ensure_storage()
    with connect_db() as conn:
        next_sort_order = int(conn.execute("SELECT COALESCE(MAX(sort_order), 0) + 1 FROM history_records").fetchone()[0])
        upsert_history_record(conn, record, next_sort_order)
        trim_overflow(conn)
    return record


def read_legacy_index_records() -> List[Dict[str, Any]]:
    try:
        index_items = read_json_file(LEGACY_INDEX_FILE)
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        index_items = []
    if not isinstance(index_items, list):
        index_items = []

    records: List[Dict[str, Any]] = []
    for meta in index_items:
        record_id = meta.get("id") if isinstance(meta, dict) else ""
        if not record_id:
            continue
        try:
            parsed = read_json_file(LEGACY_RECORDS_DIR / safe_record_file_name(record_id))
        except (FileNotFoundError, json.JSONDecodeError, OSError):
            continue
        if isinstance(parsed, dict) and parsed.get("id"):
            records.append(parsed)
    return records


def read_legacy_flat_records() -> List[Dict[str, Any]]:
    try:
        parsed = read_json_file(LEGACY_DATA_FILE)
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return []
    if not isinstance(parsed, list):
        return []
    return [item for item in parsed if isinstance(item, dict) and item.get("id")]


def read_legacy_directory_records() -> List[Dict[str, Any]]:
    if not LEGACY_RECORDS_DIR.exists():
        return []
    records: List[Dict[str, Any]] = []
    files = sorted(LEGACY_RECORDS_DIR.glob("*.json"), key=lambda item: item.stat().st_mtime, reverse=True)
    for file_path in files:
        try:
            parsed = read_json_file(file_path)
        except (json.JSONDecodeError, OSError):
            continue
        if isinstance(parsed, dict) and parsed.get("id"):
            records.append(parsed)
    return records


def load_legacy_json_records() -> List[Dict[str, Any]]:
    records = read_legacy_index_records() or read_legacy_flat_records() or read_legacy_directory_records()
    deduped: Dict[str, Dict[str, Any]] = {}
    ordered: List[Dict[str, Any]] = []
    for record in records:
        record_id = str(record.get("id") or "")
        if not record_id or record_id in deduped:
            continue
        deduped[record_id] = record
        ordered.append(record)
    return ordered[:MAX_ITEMS] if MAX_ITEMS > 0 else []


def get_storage_meta(conn: sqlite3.Connection, key: str) -> str:
    row = conn.execute("SELECT value FROM storage_meta WHERE key = ?", (key,)).fetchone()
    return str(row["value"]) if row else ""


def set_storage_meta(conn: sqlite3.Connection, key: str, value: str) -> None:
    conn.execute(
        """
        INSERT INTO storage_meta (key, value)
        VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
        """,
        (key, value),
    )


def migrate_legacy_if_needed() -> None:
    ensure_storage()
    try:
        with connect_db() as conn:
            if get_storage_meta(conn, "json_migrated") == "1":
                return
            row_count = int(conn.execute("SELECT COUNT(*) FROM history_records").fetchone()[0])
            if row_count > 0:
                set_storage_meta(conn, "json_migrated", "1")
                return
            records = load_legacy_json_records()
            total = len(records)
            for index, record in enumerate(records):
                upsert_history_record(conn, record, total - index)
            set_storage_meta(conn, "json_migrated", "1")
    except Exception:
        # Ignore migration errors to avoid blocking startup.
        return


def read_records() -> List[Dict[str, Any]]:
    ensure_storage()
    records: List[Dict[str, Any]] = []
    with connect_db() as conn:
        rows = conn.execute(
            """
            SELECT record_json
            FROM history_records
            ORDER BY sort_order DESC, created_at DESC, id DESC
            LIMIT ?
            """,
            (max(MAX_ITEMS, 0),),
        ).fetchall()
    for row in rows:
        record = row_to_record(row)
        if record:
            records.append(record)
    return records


def read_record_by_id(record_id: str) -> Optional[Dict[str, Any]]:
    ensure_storage()
    with connect_db() as conn:
        row = conn.execute("SELECT record_json FROM history_records WHERE id = ?", (record_id,)).fetchone()
    return row_to_record(row) if row else None


def delete_history_record(record_id: str) -> None:
    ensure_storage()
    with connect_db() as conn:
        conn.execute("DELETE FROM history_records WHERE id = ?", (record_id,))


def clear_history_records() -> None:
    ensure_storage()
    with connect_db() as conn:
        conn.execute("DELETE FROM history_records")


def get_error_message(payload: Any, fallback: str = "请求失败：未识别的错误响应") -> str:
    if not payload:
        return "请求失败：服务返回为空"
    if isinstance(payload, dict):
        for key in ("message", "error", "msg"):
            value = payload.get(key)
            if isinstance(value, str) and value.strip():
                return value
        nested_error = (payload.get("data") or {}).get("error") if isinstance(payload.get("data"), dict) else None
        if isinstance(nested_error, str) and nested_error.strip():
            return nested_error
    return fallback


def try_parse_json_object_from_text(text: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(text, str):
        return None
    trimmed = text.strip()
    if not trimmed:
        return None
    try:
        parsed = json.loads(trimmed)
        return parsed if isinstance(parsed, dict) else None
    except json.JSONDecodeError:
        pass

    first_brace = trimmed.find("{")
    last_brace = trimmed.rfind("}")
    if first_brace == -1 or last_brace == -1 or first_brace >= last_brace:
        return None
    try:
        parsed = json.loads(trimmed[first_brace : last_brace + 1])
        return parsed if isinstance(parsed, dict) else None
    except json.JSONDecodeError:
        return None


def strip_think_blocks(text: str) -> str:
    return re.sub(r"<think>[\s\S]*?</think>", "", text, flags=re.IGNORECASE).strip()


def repair_unescaped_quotes_in_json_strings(value: str) -> str:
    """Best-effort repair for model text that looks like JSON but has raw quotes in string values.

    Dify / LLM outputs sometimes return snippets such as:
    {"竞争分析小结": "品牌定位"天然健康"契合消费升级趋势"}
    The inner quotes make the JSON invalid. A quote inside a JSON string is only treated
    as a closing quote when the next non-space char is a JSON delimiter. Otherwise it is
    escaped and kept as content.
    """
    repaired: List[str] = []
    in_string = False
    escaped = False

    for index, char in enumerate(value):
        if not in_string:
            repaired.append(char)
            if char == '"':
                in_string = True
                escaped = False
            continue

        if escaped:
            repaired.append(char)
            escaped = False
            continue

        if char == "\\":
            repaired.append(char)
            escaped = True
            continue

        if char == '"':
            next_index = index + 1
            while next_index < len(value) and value[next_index].isspace():
                next_index += 1
            next_char = value[next_index] if next_index < len(value) else ""
            if next_char in {"", ":", ",", "}", "]"}:
                repaired.append(char)
                in_string = False
            else:
                repaired.append('\\"')
            continue

        repaired.append(char)

    return "".join(repaired)


def parse_json_candidate(value: Any) -> Any:
    if isinstance(value, (dict, list)):
        return value
    if not isinstance(value, str):
        return None
    candidate = value.strip()
    if not candidate:
        return None
    candidate_without_trailing_commas = re.sub(r",\s*([}\]])", r"\1", candidate)
    candidates_to_try: List[str] = []
    seen_candidates = set()
    for item in [candidate, candidate_without_trailing_commas]:
        for candidate_item in [item, repair_unescaped_quotes_in_json_strings(item)]:
            if candidate_item and candidate_item not in seen_candidates:
                seen_candidates.add(candidate_item)
                candidates_to_try.append(candidate_item)

    for item in candidates_to_try:
        try:
            return json.loads(item)
        except json.JSONDecodeError:
            pass
        try:
            parsed = ast.literal_eval(item)
            if isinstance(parsed, (dict, list)):
                return parsed
        except (ValueError, SyntaxError):
            pass
    return None


def iter_balanced_json_fragments(text: str) -> Iterable[str]:
    pairs = {"{": "}", "[": "]"}
    for start, opener in ((index, char) for index, char in enumerate(text) if char in pairs):
        stack = [pairs[opener]]
        quote = ""
        escaped = False
        for index in range(start + 1, len(text)):
            char = text[index]
            if quote:
                if escaped:
                    escaped = False
                elif char == "\\":
                    escaped = True
                elif char == quote:
                    quote = ""
                continue
            if char in {'"', "'"}:
                quote = char
                continue
            if char in pairs:
                stack.append(pairs[char])
                continue
            if stack and char == stack[-1]:
                stack.pop()
                if not stack:
                    yield text[start : index + 1]
                    break


def parse_json_from_text(text: Any) -> Any:
    if not isinstance(text, str):
        return None
    clean = strip_think_blocks(text).strip()
    if not clean:
        return None
    fenced_blocks = re.findall(r"```(?:json|javascript|js)?\s*([\s\S]*?)\s*```", clean, flags=re.IGNORECASE)
    candidates = [
        *fenced_blocks,
        re.sub(r"```(?:json|javascript|js)?|```", "", clean, flags=re.IGNORECASE).strip(),
        clean,
    ]
    seen = set()
    ordered_candidates: List[str] = []
    for candidate in candidates:
        if not candidate or candidate in seen:
            continue
        seen.add(candidate)
        ordered_candidates.append(candidate)
        parsed = parse_json_candidate(candidate)
        if parsed is not None:
            return parsed

    for candidate in ordered_candidates:
        decoder = json.JSONDecoder()
        for match in re.finditer(r"[\[{]", candidate):
            try:
                parsed, _ = decoder.raw_decode(candidate[match.start() :])
                if isinstance(parsed, (dict, list)):
                    return parsed
            except json.JSONDecodeError:
                continue

        for fragment in iter_balanced_json_fragments(candidate):
            parsed = parse_json_candidate(fragment)
            if parsed is not None:
                return parsed
    return None


def stringify_value(value: Any) -> str:
    return value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)


def format_output_text(raw_text: Any) -> Dict[str, Any]:
    parsed = try_parse_json_object_from_text(raw_text)
    if not parsed:
        return {"formattedText": raw_text, "parsedFields": []}
    parsed_fields = [{"key": key, "value": stringify_value(value)} for key, value in parsed.items()]
    return {
        "formattedText": "\n".join(f"{item['key']}：{item['value']}" for item in parsed_fields),
        "parsedFields": parsed_fields,
    }


def normalize_object_fields(data: Dict[str, Any]) -> List[Dict[str, str]]:
    return [{"key": key, "value": stringify_value(value)} for key, value in data.items()]


def normalize_competitors(raw_competitors: Any) -> List[Dict[str, Any]]:
    if not isinstance(raw_competitors, list):
        return []
    items = []
    for index, item in enumerate(raw_competitors):
        item = item if isinstance(item, dict) else {}
        name = item.get("企业名称") or item.get("name") or f"竞争对手 {index + 1}"
        normalized = {
            "id": f"competitor-{index + 1}",
            "name": name,
            "intro": item.get("简介") or item.get("intro") or "暂无简介",
            "threatScore": item.get("竞争威胁分数") or item.get("threatScore"),
            "sourceTag": "自动搜索结果",
        }
        if normalized["name"]:
            items.append(normalized)
    return items


def build_competitor_judgement_fields(raw_judgement_text: str) -> List[Dict[str, str]]:
    judgement = format_output_text(raw_judgement_text)
    parsed_fields = judgement.get("parsedFields") or []
    if parsed_fields:
        return [{"key": f"指定竞争对手校验-{item['key']}", "value": item["value"]} for item in parsed_fields]
    return [{"key": "指定竞争对手校验", "value": raw_judgement_text}] if raw_judgement_text else []


def parse_pre_assessment(raw_pre_assessment_text: Any) -> Optional[Dict[str, str]]:
    normalized_text = raw_pre_assessment_text.strip() if isinstance(raw_pre_assessment_text, str) else ""
    if not normalized_text:
        return None
    code_block_match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", normalized_text, flags=re.IGNORECASE)
    candidate = code_block_match.group(1) if code_block_match else normalized_text
    parsed = try_parse_json_object_from_text(candidate)
    if not parsed:
        return {"level": "", "summary": normalized_text, "rawText": normalized_text}
    return {
        "level": parsed.get("竞争关系分级") or parsed.get("level") or "",
        "summary": parsed.get("简要说明") or parsed.get("summary") or "",
        "rawText": normalized_text,
    }


def http_post_json(workflow_url: str, body: Dict[str, Any], headers: Dict[str, str], timeout_seconds: Optional[int] = None) -> Tuple[int, str]:
    encoded = json.dumps(body, ensure_ascii=False).encode("utf-8")
    req = urllib_request.Request(workflow_url, data=encoded, headers=headers, method="POST")
    timeout = timeout_seconds or get_timeout_seconds(["DIFY_WORKFLOW_TIMEOUT_SECONDS", "WORKFLOW_TIMEOUT_SECONDS"], DEFAULT_DIFY_TIMEOUT_SECONDS)
    try:
        with urllib_request.urlopen(req, timeout=timeout) as response:
            raw = response.read().decode("utf-8", errors="replace")
            return int(response.status), raw
    except urllib_error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        return int(exc.code), raw
    except TimeoutError as exc:
        raise AppError(f"工作流网络请求超时（{timeout} 秒）", code="NETWORK_TIMEOUT") from exc
    except urllib_error.URLError as exc:
        reason = getattr(exc, "reason", exc)
        reason_text = str(reason)
        if "timed out" in reason_text.lower():
            raise AppError(f"工作流网络请求超时（{timeout} 秒）", code="NETWORK_TIMEOUT") from exc
        raise AppError(f"工作流网络请求失败：{reason}", code="NETWORK_ERROR") from exc


def is_placeholder_api_key(value: str) -> bool:
    normalized = (value or "").strip().lower()
    return (
        not normalized
        or normalized.startswith("replace_with")
        or normalized in {"your_api_key", "api_key", "xxx", "xxxx"}
    )


def post_dify_workflow(
    *,
    workflow_url: str,
    api_key: str,
    workflow_user: str,
    inputs: Dict[str, Any],
    step_label: str,
    require_text: bool = False,
    timeout_seconds: Optional[int] = None,
) -> Any:
    if is_placeholder_api_key(api_key):
        raise AppError(f"未配置 {step_label} API Key，请在 .env.local 中填写。", code="MISSING_API_KEY")

    status, raw_text = http_post_json(
        workflow_url,
        {"inputs": inputs, "response_mode": "blocking", "user": workflow_user},
        {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        timeout_seconds=timeout_seconds,
    )

    payload = None
    if raw_text:
        try:
            payload = json.loads(raw_text)
        except json.JSONDecodeError as exc:
            raise AppError(f"{step_label} 响应不是合法 JSON", code="INVALID_RESPONSE_BODY", http_status=status) from exc

    if status < 200 or status >= 300:
        raise AppError(
            get_error_message(payload, f"{step_label} 接口请求失败（HTTP {status}）"),
            code="HTTP_ERROR",
            http_status=status,
            payload=payload,
        )

    data = payload.get("data") if isinstance(payload, dict) else None
    workflow_status = data.get("status") if isinstance(data, dict) else None
    if workflow_status and workflow_status != "succeeded":
        message = data.get("error") or f"{step_label} 工作流执行失败（status={workflow_status}）"
        raise AppError(message, code="WORKFLOW_NOT_SUCCEEDED", workflow_status=workflow_status)

    if payload is None:
        raise AppError(f"{step_label} 返回格式异常：不是有效 JSON。", code="INVALID_RESPONSE_BODY", http_status=status)

    if require_text:
        outputs = data.get("outputs") if isinstance(data, dict) else None
        text = outputs.get("text") if isinstance(outputs, dict) else None
        if not isinstance(text, str) or not text.strip():
            raise AppError(f"{step_label} 未返回有效文本（outputs.text）。", code="INVALID_OUTPUT")
        return {"text": text.strip(), "payload": payload}

    return payload


def should_retry_once(err: Exception, extra_codes: Optional[List[str]] = None) -> bool:
    extra_codes = extra_codes or []
    code = getattr(err, "code", None)
    if code in ["INVALID_RESPONSE_BODY", "WORKFLOW_NOT_SUCCEEDED", *extra_codes]:
        return True
    http_status = getattr(err, "http_status", None)
    return http_status is not None and http_status in RETRY_HTTP_STATUS


def post_dify_workflow_once_or_retry(args: Dict[str, Any], extra_retry_codes: Optional[List[str]] = None) -> Any:
    try:
        return post_dify_workflow(**args)
    except Exception as first:
        if not should_retry_once(first, extra_retry_codes):
            raise
        return post_dify_workflow(**args)


def run_input_validation_workflow(
    targetCompanyName: str = "",
    targetCompanyIntro: str = "",
    targetCompanyBusiness: str = "",
    province: str = "",
    competitorCompanyName: str = "",
    **_: Any,
) -> Dict[str, Any]:
    workflow_url = get_env(["WORKFLOW_URL", "VITE_WORKFLOW_URL"], DEFAULT_WORKFLOW_URL)
    api_key = get_env(["WORKFLOW_API_KEY", "VITE_WORKFLOW_API_KEY"])
    workflow_user = get_env(["WORKFLOW_USER", "VITE_WORKFLOW_USER"], "admin")
    normalized_province = normalize_text_value(province)
    normalized_competitor = normalize_text_value(competitorCompanyName)
    normalized_intro = normalize_text_value(targetCompanyIntro)
    normalized_business = normalize_text_value(targetCompanyBusiness)

    inputs: Dict[str, Any] = {
        "target_company_name": normalize_text_value(targetCompanyName),
        "target_company_intro": normalized_intro,
        "target_company_business": normalized_business,
    }
    if normalized_province:
        inputs["province"] = normalized_province
    if normalized_competitor:
        inputs["competitor_name"] = normalized_competitor

    payload = post_dify_workflow(
        workflow_url=workflow_url,
        api_key=api_key,
        workflow_user=workflow_user,
        step_label="输入校验工作流",
        inputs=inputs,
    )

    outputs = (((payload or {}).get("data") or {}).get("outputs") or {}) if isinstance(payload, dict) else {}
    output_text = outputs.get("text")
    competitor_judgement = outputs.get("competitor_judgement")
    pre_assessment = parse_pre_assessment(outputs.get("pre_assessment"))

    if isinstance(output_text, str) and output_text.strip():
        normalized_output_text = output_text.strip()
        formatted = format_output_text(normalized_output_text)
        return {
            "raw": payload,
            "outputText": normalized_output_text,
            "formattedText": formatted["formattedText"],
            "parsedFields": formatted["parsedFields"],
            "targetCompanyInfo": None,
            "competitors": [],
            "specifiedCompetitor": None,
        }

    target_company_info = merge_company_info(
        normalize_validation_company(outputs, targetCompanyName),
        {"intro": outputs.get("intro") or "", "business": outputs.get("business") or ""},
        fallback_name=targetCompanyName,
    )
    competitors = normalize_competitors(outputs.get("competitors"))
    specified_competitor = None
    if normalized_competitor and (outputs.get("competitor_intro") or outputs.get("competitor_business")):
        specified_competitor = {
            "id": "specified-competitor",
            "name": normalized_competitor,
            "intro": "；".join([item for item in [outputs.get("competitor_business"), outputs.get("competitor_intro")] if item]),
            "threatScore": None,
            "sourceTag": "指定竞争对手",
        }
    competitor_count = len(competitors) + (1 if specified_competitor else 0)
    output_fields = [
        *normalize_object_fields({"搜索结果": "输入信息有效", "目标企业名称": targetCompanyName, "竞争对手数量": competitor_count}),
        *(
            normalize_object_fields(
                {"竞争关系分级": pre_assessment.get("level") or "-", "竞争关系说明": pre_assessment.get("summary") or "-"}
            )
            if pre_assessment
            else []
        ),
        *build_competitor_judgement_fields(competitor_judgement.strip() if isinstance(competitor_judgement, str) else ""),
    ]

    return {
        "raw": payload,
        "outputText": "输入信息有效",
        "formattedText": "输入信息有效",
        "parsedFields": output_fields,
        "targetCompanyInfo": target_company_info,
        "competitors": competitors,
        "preAssessment": pre_assessment,
        "specifiedCompetitor": specified_competitor,
    }


COMPANY_NAME_KEYS = (
    "企业名称",
    "公司名称",
    "名称",
    "name",
    "companyName",
    "company_name",
    "targetCompanyName",
    "target_company_name",
)

COMPANY_INTRO_KEYS = (
    "企业介绍",
    "企业简介",
    "公司介绍",
    "公司简介",
    "简介",
    "企业概况",
    "公司概况",
    "介绍",
    "intro",
    "introduction",
    "description",
    "companyIntro",
    "company_intro",
    "targetCompanyIntro",
    "target_company_intro",
)

COMPANY_BUSINESS_KEYS = (
    "企业主营业务",
    "公司主营业务",
    "主营业务",
    "企业主要业务",
    "公司主要业务",
    "主要业务",
    "业务介绍",
    "业务范围",
    "经营范围",
    "核心业务",
    "主营产品",
    "产品服务",
    "产品与服务",
    "business",
    "mainBusiness",
    "main_business",
    "businessScope",
    "business_scope",
    "primaryBusiness",
    "companyBusiness",
    "company_business",
    "companyMainBusiness",
    "company_main_business",
    "targetCompanyBusiness",
    "target_company_business",
    "targetCompanyMainBusiness",
    "target_company_main_business",
)


def normalize_candidate_names(value: Any) -> List[str]:
    if isinstance(value, list):
        names: List[str] = []
        for item in value:
            if isinstance(item, str):
                name = item.strip()
            elif isinstance(item, dict):
                name = pick_text(item, *COMPANY_NAME_KEYS)
            else:
                name = ""
            if name:
                names.append(name)
        return names
    if isinstance(value, str):
        parsed = parse_json_from_text(value)
        if isinstance(parsed, list):
            return normalize_candidate_names(parsed)
        return [item.strip() for item in re.split(r"[,，;；、\n]", value) if item.strip()]
    return []


def normalize_candidate_companies(value: Any) -> List[Dict[str, str]]:
    if isinstance(value, list):
        companies: List[Dict[str, str]] = []
        for item in value:
            if isinstance(item, str):
                company = {"name": item.strip(), "intro": "", "business": ""}
            elif isinstance(item, dict):
                company = normalize_validation_company(item) or {
                    "name": pick_text(item, *COMPANY_NAME_KEYS),
                    "intro": pick_text(item, *COMPANY_INTRO_KEYS),
                    "business": pick_text(item, *COMPANY_BUSINESS_KEYS),
                }
            else:
                company = {"name": "", "intro": "", "business": ""}
            if company.get("name"):
                companies.append(company)
        return companies
    if isinstance(value, str):
        parsed = parse_json_from_text(value)
        if isinstance(parsed, list):
            return normalize_candidate_companies(parsed)
        return [{"name": item.strip(), "intro": "", "business": ""} for item in re.split(r"[,，;；、\n]", value) if item.strip()]
    return []


def normalize_company_name_for_match(value: Any) -> str:
    name = str(value or "").strip().lower()
    return re.sub(r"(有限责任公司|股份有限公司|有限公司|公司|实验室|研究院)$", "", name)


def same_company_name(left: Any, right: Any) -> bool:
    left_name = str(left or "").strip().lower()
    right_name = str(right or "").strip().lower()
    if not left_name or not right_name:
        return False
    normalized_left = normalize_company_name_for_match(left_name)
    normalized_right = normalize_company_name_for_match(right_name)
    return left_name == right_name or bool(normalized_left and normalized_right and normalized_left == normalized_right)


def normalize_text_value(value: Any) -> str:
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, list):
        return "、".join(item for item in (normalize_text_value(item) for item in value) if item)
    if isinstance(value, dict):
        return "、".join(item for item in (normalize_text_value(item) for item in value.values()) if item)
    return ""


def pick_text(data: Any, *keys: str) -> str:
    if not isinstance(data, dict):
        return ""
    for key in keys:
        value = normalize_text_value(data.get(key))
        if value:
            return value
    return ""


def pick_workflow_output_text(outputs: Any) -> str:
    return pick_text(outputs, "text", "result", "output", "answer")


def normalize_validation_company(value: Any, fallback_name: str = "") -> Optional[Dict[str, str]]:
    source = parse_json_from_text(value) if isinstance(value, str) else value
    if not isinstance(source, dict):
        return None

    name = pick_text(source, *COMPANY_NAME_KEYS)
    intro = pick_text(source, *COMPANY_INTRO_KEYS)
    business = pick_text(source, *COMPANY_BUSINESS_KEYS)
    if not any([name, intro, business]):
        return None
    return {"name": name or fallback_name, "intro": intro, "business": business}


def merge_company_info(*companies: Optional[Dict[str, Any]], fallback_name: str = "") -> Dict[str, str]:
    merged = {"name": "", "intro": "", "business": ""}
    for company in companies:
        if not isinstance(company, dict):
            continue
        for key in ("name", "intro", "business"):
            value = company.get(key)
            if not isinstance(value, str) or not value.strip():
                continue
            normalized_value = value.strip()
            if key == "name":
                if not merged.get(key) or (merged.get(key) == fallback_name and normalized_value != fallback_name):
                    merged[key] = normalized_value
            elif not merged.get(key):
                merged[key] = normalized_value
    if not merged.get("name") and fallback_name and (merged.get("intro") or merged.get("business")):
        merged["name"] = fallback_name
    return merged


def extract_company_from_validation_payload(payload: Any, fallback_name: str = "") -> Optional[Dict[str, str]]:
    outputs = (((payload or {}).get("data") or {}).get("outputs") or {}) if isinstance(payload, dict) else {}
    output_text = pick_workflow_output_text(outputs)
    parsed_value = parse_json_from_text(output_text) if isinstance(output_text, str) else None
    parsed_output = parsed_value if isinstance(parsed_value, dict) else None
    sources: List[Any] = []
    if isinstance(payload, dict):
        sources.append(payload.get("company"))
    if isinstance(parsed_output, dict):
        sources.append(parsed_output.get("company"))
        sources.append(parsed_output)
    if isinstance(outputs, dict):
        sources.append(outputs.get("company"))
        sources.append(outputs)

    companies = [normalize_validation_company(source, fallback_name) for source in sources]
    company = merge_company_info(*companies, fallback_name=fallback_name)
    if any([company.get("name"), company.get("intro"), company.get("business")]):
        return company
    return None


def normalize_company_cache_key(value: Any) -> str:
    return str(value or "").strip().lower()


def remember_company_query_cache(normalized_query: str, response: Dict[str, Any]) -> None:
    if not normalized_query or not isinstance(response, dict):
        return
    with _COMPANY_CACHE_LOCK:
        if normalized_query not in _COMPANY_QUERY_MEMORY_CACHE and len(_COMPANY_QUERY_MEMORY_CACHE) >= MAX_COMPANY_MEMORY_CACHE_SIZE:
            _COMPANY_QUERY_MEMORY_CACHE.pop(next(iter(_COMPANY_QUERY_MEMORY_CACHE)), None)
        _COMPANY_QUERY_MEMORY_CACHE[normalized_query] = response


def get_company_query_memory_cache(normalized_query: str) -> Optional[Dict[str, Any]]:
    if not normalized_query:
        return None
    with _COMPANY_CACHE_LOCK:
        return _COMPANY_QUERY_MEMORY_CACHE.get(normalized_query)


def remember_company_profile_cache(company: Dict[str, str]) -> None:
    normalized_company = normalize_complete_company(company)
    if not normalized_company:
        return
    normalized_name = normalize_company_cache_key(normalized_company.get("name"))
    if not normalized_name:
        return
    with _COMPANY_CACHE_LOCK:
        if normalized_name not in _COMPANY_PROFILE_MEMORY_CACHE and len(_COMPANY_PROFILE_MEMORY_CACHE) >= MAX_COMPANY_MEMORY_CACHE_SIZE:
            _COMPANY_PROFILE_MEMORY_CACHE.pop(next(iter(_COMPANY_PROFILE_MEMORY_CACHE)), None)
        _COMPANY_PROFILE_MEMORY_CACHE[normalized_name] = normalized_company


def get_company_profile_memory_cache(normalized_name: str) -> Optional[Dict[str, str]]:
    if not normalized_name:
        return None
    with _COMPANY_CACHE_LOCK:
        return _COMPANY_PROFILE_MEMORY_CACHE.get(normalized_name)


def normalize_complete_company(company: Any) -> Optional[Dict[str, str]]:
    normalized_company = normalize_validation_company(company)
    if not normalized_company:
        return None
    complete_company = {
        "name": normalize_text_value(normalized_company.get("name")),
        "intro": normalize_text_value(normalized_company.get("intro")),
        "business": normalize_text_value(normalized_company.get("business")),
    }
    return complete_company if all(complete_company.values()) else None


def normalize_complete_company_items(value: Any) -> List[Dict[str, str]]:
    companies_by_key: Dict[str, Dict[str, str]] = {}
    for company in normalize_candidate_companies(value):
        complete_company = normalize_complete_company(company)
        if not complete_company:
            continue
        normalized_key = normalize_company_cache_key(complete_company.get("name"))
        if normalized_key and normalized_key not in companies_by_key:
            companies_by_key[normalized_key] = complete_company
    return list(companies_by_key.values())


def merge_complete_company_items(*company_groups: Any) -> List[Dict[str, str]]:
    companies_by_key: Dict[str, Dict[str, str]] = {}
    for group in company_groups:
        items = group if isinstance(group, list) else [group]
        for item in items:
            complete_company = normalize_complete_company(item)
            if not complete_company:
                continue
            normalized_key = normalize_company_cache_key(complete_company.get("name"))
            if normalized_key and normalized_key not in companies_by_key:
                companies_by_key[normalized_key] = complete_company
    return list(companies_by_key.values())


def build_company_validation_response(payload: Any, company_name: str, cache_hit: bool = False) -> Dict[str, Any]:
    outputs = (((payload or {}).get("data") or {}).get("outputs") or {}) if isinstance(payload, dict) else {}
    output_text = pick_workflow_output_text(outputs)
    parsed_value = parse_json_from_text(output_text) if isinstance(output_text, str) else None
    parsed_output = parsed_value if isinstance(parsed_value, dict) else None
    source = parsed_output if parsed_output else outputs
    company_sources = []
    if isinstance(source, dict):
        company_sources.extend([source.get("company"), source])
        candidate_source = source.get("候选企业") or source.get("candidateCompanies") or source.get("candidates")
        search_result = source.get("搜索结果") or source.get("searchResult") or ""
        note = source.get("说明") or source.get("note") or source.get("description") or ""
    else:
        candidate_source = None
        search_result = ""
        note = ""
    if isinstance(outputs, dict):
        company_sources.extend([outputs.get("company"), outputs])
        if not candidate_source:
            candidate_source = outputs.get("候选企业") or outputs.get("candidateCompanies") or outputs.get("candidates")
    candidate_companies = normalize_candidate_companies(candidate_source)
    candidates = [item.get("name", "") for item in candidate_companies if item.get("name")]
    companies = [normalize_validation_company(source, company_name) for source in company_sources]
    company = merge_company_info(*companies, fallback_name=company_name)
    matched_candidate = next(
        (
            item
            for item in candidate_companies
            if same_company_name(item.get("name"), company.get("name")) or same_company_name(item.get("name"), company_name)
        ),
        None,
    )
    company = merge_company_info(company, matched_candidate, fallback_name=company_name)
    if not any([company.get("name"), company.get("intro"), company.get("business")]):
        company = None

    return {
        "raw": payload,
        "outputText": output_text.strip() if isinstance(output_text, str) else "",
        "searchResult": search_result,
        "candidates": candidates,
        "candidateItems": candidate_companies,
        "company": company,
        "note": note,
        "cacheHit": cache_hit,
        "parsedFields": normalize_object_fields(
            {
                "搜索结果": search_result,
                "企业名称": company.get("name") if company else "",
                "企业介绍": company.get("intro") if company else "",
                "企业主营业务": company.get("business") if company else "",
                "候选企业": candidates,
                "说明": note,
            }
        ),
    }


def has_company_validation_content(response: Any) -> bool:
    if not isinstance(response, dict):
        return False
    company = normalize_complete_company(response.get("company"))
    candidate_items = normalize_complete_company_items(response.get("candidateItems") or response.get("candidates") or [])
    return bool(company or candidate_items)


def build_cacheable_company_validation_response(response: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    company = normalize_complete_company(response.get("company"))
    candidate_items = merge_complete_company_items(company, normalize_complete_company_items(response.get("candidateItems") or response.get("candidates") or []))
    if not company and not candidate_items:
        return None
    candidates = [item.get("name", "") for item in candidate_items if item.get("name")]
    search_result = normalize_text_value(response.get("searchResult")) or "检索完成"
    note = normalize_text_value(response.get("note"))
    return {
        "raw": {"data": {"outputs": {"company": company or {}, "候选企业": candidate_items}}},
        "outputText": "",
        "searchResult": search_result,
        "candidates": candidates,
        "candidateItems": candidate_items,
        "company": company,
        "note": note,
        "cacheHit": False,
        "parsedFields": normalize_object_fields(
            {
                "搜索结果": search_result,
                "企业名称": company.get("name") if company else "",
                "企业介绍": company.get("intro") if company else "",
                "企业主营业务": company.get("business") if company else "",
                "候选企业": candidates,
                "说明": note,
            }
        ),
    }


def normalize_cached_validation_response(response: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(response, dict):
        return None
    cache_response = build_cacheable_company_validation_response(response)
    if not cache_response:
        return None
    cache_response["cacheHit"] = True
    cache_response["cacheSource"] = "validation_query"
    return cache_response


def read_company_validation_query_cache(company_name: str) -> Optional[Dict[str, Any]]:
    normalized_query = normalize_company_cache_key(company_name)
    if not normalized_query:
        return None
    memory_response = get_company_query_memory_cache(normalized_query)
    if memory_response:
        return memory_response
    ensure_storage()
    with connect_db() as conn:
        row = conn.execute(
            "SELECT response_json FROM company_validation_queries WHERE normalized_query = ?",
            (normalized_query,),
        ).fetchone()
    if not row:
        return None
    try:
        response = json.loads(row["response_json"])
    except (json.JSONDecodeError, TypeError):
        return None
    cache_response = normalize_cached_validation_response(response)
    if cache_response:
        remember_company_query_cache(normalized_query, cache_response)
    return cache_response


def read_company_profile_cache(company_name: str) -> Optional[Dict[str, str]]:
    normalized_name = normalize_company_cache_key(company_name)
    if not normalized_name:
        return None
    memory_company = get_company_profile_memory_cache(normalized_name)
    if memory_company:
        return memory_company
    ensure_storage()
    with connect_db() as conn:
        row = conn.execute(
            """
            SELECT name, intro, business
            FROM company_profiles
            WHERE normalized_name = ?
            """,
            (normalized_name,),
        ).fetchone()
    if not row:
        return None
    company = {"name": row["name"], "intro": row["intro"] or "", "business": row["business"] or ""}
    if company["intro"].strip() and company["business"].strip():
        remember_company_profile_cache(company)
        return company
    return None


def build_company_profile_cache_response(company: Dict[str, str]) -> Dict[str, Any]:
    candidate_items = [company]
    candidates = [company["name"]]
    return {
        "raw": {"data": {"outputs": {"company": company, "候选企业": candidate_items}}},
        "outputText": "",
        "searchResult": "已从企业缓存获取",
        "candidates": candidates,
        "candidateItems": candidate_items,
        "company": company,
        "note": "",
        "cacheHit": True,
        "cacheSource": "company_profile",
        "parsedFields": normalize_object_fields(
            {
                "搜索结果": "已从企业缓存获取",
                "企业名称": company.get("name", ""),
                "企业介绍": company.get("intro", ""),
                "企业主营业务": company.get("business", ""),
                "候选企业": candidates,
                "说明": "",
            }
        ),
    }


def upsert_company_profile(conn: sqlite3.Connection, company: Any) -> None:
    normalized_company = normalize_complete_company(company)
    if not normalized_company:
        return
    name = normalized_company["name"]
    normalized_name = normalize_company_cache_key(name)
    now = utc_now_iso()
    conn.execute(
        """
        INSERT INTO company_profiles (
            normalized_name, name, intro, business, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(normalized_name) DO UPDATE SET
            name = excluded.name,
            intro = excluded.intro,
            business = excluded.business,
            updated_at = excluded.updated_at
        """,
        (
            normalized_name,
            name,
            normalized_company["intro"],
            normalized_company["business"],
            now,
            now,
        ),
    )
    remember_company_profile_cache(normalized_company)


def write_company_validation_cache(company_name: str, response: Dict[str, Any]) -> None:
    normalized_query = normalize_company_cache_key(company_name)
    if not normalized_query or not has_company_validation_content(response):
        return

    cache_response = build_cacheable_company_validation_response(response)
    if not cache_response:
        return
    candidate_items = cache_response["candidateItems"]
    now = utc_now_iso()
    ensure_storage()
    with connect_db() as conn:
        conn.execute(
            """
            INSERT INTO company_validation_queries (
                normalized_query, query, candidate_items_json, response_json, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(normalized_query) DO UPDATE SET
                query = excluded.query,
                candidate_items_json = excluded.candidate_items_json,
                response_json = excluded.response_json,
                updated_at = excluded.updated_at
            """,
            (
                normalized_query,
                company_name,
                json_dumps(candidate_items),
                json_dumps(cache_response),
                now,
                now,
            ),
        )
        upsert_company_profile(conn, cache_response.get("company"))
        for item in candidate_items:
            upsert_company_profile(conn, item)
    remembered_response = dict(cache_response)
    remembered_response["cacheHit"] = True
    remembered_response["cacheSource"] = "validation_query"
    remember_company_query_cache(normalized_query, remembered_response)


def build_company_cache_miss_response(company_name: str) -> Dict[str, Any]:
    return {
        "raw": {"data": {"outputs": {}}},
        "outputText": "",
        "searchResult": "未命中企业缓存",
        "candidates": [],
        "candidateItems": [],
        "company": None,
        "note": "",
        "cacheHit": False,
        "cacheMiss": True,
        "cacheSource": "none",
        "parsedFields": normalize_object_fields({"搜索结果": "未命中企业缓存", "企业名称": company_name}),
    }


def write_company_candidate_to_query_cache(query: str, company: Any) -> None:
    normalized_query = normalize_company_cache_key(query)
    complete_company = normalize_complete_company(company)
    if not normalized_query or not complete_company:
        return

    now = utc_now_iso()
    ensure_storage()
    with connect_db() as conn:
        row = conn.execute(
            "SELECT response_json FROM company_validation_queries WHERE normalized_query = ?",
            (normalized_query,),
        ).fetchone()
        existing_response: Dict[str, Any] = {}
        if row:
            try:
                parsed_response = json.loads(row["response_json"])
                if isinstance(parsed_response, dict):
                    existing_response = parsed_response
            except (json.JSONDecodeError, TypeError):
                existing_response = {}

        existing_company = normalize_complete_company(existing_response.get("company"))
        candidate_items = merge_complete_company_items(
            existing_response.get("candidateItems") or existing_response.get("candidates") or [],
            complete_company,
        )
        candidates = [item.get("name", "") for item in candidate_items if item.get("name")]
        cache_response = build_cacheable_company_validation_response(
            {
                "raw": {"data": {"outputs": {"候选企业": candidate_items}}},
                "outputText": "",
                "searchResult": normalize_text_value(existing_response.get("searchResult")) or "已从企业缓存获取候选企业",
                "candidates": candidates,
                "candidateItems": candidate_items,
                "company": existing_company,
                "note": normalize_text_value(existing_response.get("note")),
            }
        )
        if not cache_response:
            return

        conn.execute(
            """
            INSERT INTO company_validation_queries (
                normalized_query, query, candidate_items_json, response_json, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(normalized_query) DO UPDATE SET
                query = excluded.query,
                candidate_items_json = excluded.candidate_items_json,
                response_json = excluded.response_json,
                updated_at = excluded.updated_at
            """,
            (
                normalized_query,
                query,
                json_dumps(cache_response["candidateItems"]),
                json_dumps(cache_response),
                now,
                now,
            ),
        )
        upsert_company_profile(conn, complete_company)
    remembered_response = dict(cache_response)
    remembered_response["cacheHit"] = True
    remembered_response["cacheSource"] = "validation_query"
    remember_company_query_cache(normalized_query, remembered_response)


def run_company_name_validation_workflow(
    companyName: str = "",
    targetCompanyName: str = "",
    competitorCompanyName: str = "",
    cacheOnly: bool = False,
    sourceQuery: str = "",
    **_: Any,
) -> Dict[str, Any]:
    company_name = str(companyName or targetCompanyName or competitorCompanyName or "").strip()
    if not company_name:
        raise AppError("请先输入企业名称。", status_code=400, code="BAD_REQUEST")

    cached_response = read_company_validation_query_cache(company_name)
    if cached_response:
        return cached_response

    cached_company = read_company_profile_cache(company_name)
    if cached_company:
        return build_company_profile_cache_response(cached_company)

    if cacheOnly:
        return build_company_cache_miss_response(company_name)

    workflow_url = get_env(
        [
            "COMPANY_NAME_VALIDATION_URL",
            "VITE_COMPANY_NAME_VALIDATION_URL",
            "WORKFLOW_URL",
            "VITE_WORKFLOW_URL",
        ],
        DEFAULT_WORKFLOW_URL,
    )
    api_key = get_env(["COMPANY_NAME_VALIDATION_API_KEY", "VITE_COMPANY_NAME_VALIDATION_API_KEY"])
    workflow_user = get_env(["COMPANY_NAME_VALIDATION_USER", "VITE_COMPANY_NAME_VALIDATION_USER", "WORKFLOW_USER", "VITE_WORKFLOW_USER"], "admin")

    payload = post_dify_workflow(
        workflow_url=workflow_url,
        api_key=api_key,
        workflow_user=workflow_user,
        step_label="企业名称输入校验工作流",
        inputs={"target_company_name": company_name},
    )

    response = build_company_validation_response(payload, company_name)
    write_company_validation_cache(company_name, response)
    if sourceQuery and normalize_company_cache_key(sourceQuery) != normalize_company_cache_key(company_name):
        write_company_candidate_to_query_cache(sourceQuery, response.get("company"))
    return response


NO_RECENT_NEWS = "未检索到企业近期信息"


def normalize_lately(raw_lately: Any) -> Dict[str, Any]:
    parsed = raw_lately if isinstance(raw_lately, dict) else parse_json_from_text(raw_lately if isinstance(raw_lately, str) else "")
    items: List[Dict[str, Any]] = []
    if isinstance(parsed, dict) and isinstance(parsed.get("企业动态"), list):
        for index, item in enumerate(parsed.get("企业动态") or []):
            item = item if isinstance(item, dict) else {}
            items.append(
                {
                    "id": f"news-{index + 1}",
                    "title": item.get("标题") or f"动态 {index + 1}",
                    "type": item.get("类型") or "",
                    "content": item.get("内容") or item.get("content") or "",
                    "impact": item.get("影响") or "",
                    "source": item.get("来源") or "",
                    "time": item.get("时间") or "",
                    "link": item.get("链接") or "",
                }
            )
    if items:
        return {"summary": parsed.get("动态整理说明") or "已整理近期企业动态", "items": items}
    if isinstance(parsed, dict):
        return {"summary": NO_RECENT_NEWS, "items": []}
    return {"summary": raw_lately.strip() if isinstance(raw_lately, str) and raw_lately.strip() else "暂无近期动态", "items": []}


def run_company_detail_workflow(companyName: str = "", companyIntro: str = "", includeRaw: bool = False, **_: Any) -> Any:
    workflow_url = get_env(["COMPANY_DETAIL_URL", "VITE_COMPANY_DETAIL_URL"], DEFAULT_WORKFLOW_URL)
    api_key = get_env(["COMPANY_DETAIL_API_KEY", "VITE_COMPANY_DETAIL_API_KEY"])
    workflow_user = get_env(["COMPANY_DETAIL_USER", "VITE_COMPANY_DETAIL_USER"], "admin")
    timeout_seconds = get_timeout_seconds(
        [
            "COMPANY_DETAIL_TIMEOUT_SECONDS",
            "VITE_COMPANY_DETAIL_TIMEOUT_SECONDS",
            "DIFY_WORKFLOW_TIMEOUT_SECONDS",
            "WORKFLOW_TIMEOUT_SECONDS",
        ],
        DEFAULT_COMPANY_DETAIL_TIMEOUT_SECONDS,
    )

    payload = post_dify_workflow(
        workflow_url=workflow_url,
        api_key=api_key,
        workflow_user=workflow_user,
        step_label="企业详情工作流",
        inputs={"company_name": companyName, "company_intro": companyIntro},
        timeout_seconds=timeout_seconds,
    )

    outputs = (((payload or {}).get("data") or {}).get("outputs") or {}) if isinstance(payload, dict) else {}
    parsed = None
    if isinstance(outputs.get("text"), str) and outputs["text"].strip():
        parsed = parse_json_from_text(outputs["text"])
    elif any(key in outputs for key in ["lately", "product", "tech"]):
        parsed = outputs

    if not parsed:
        data = (payload.get("data") or {}) if isinstance(payload, dict) else {}
        raise AppError(data.get("error") or "企业详情接口返回格式异常，未识别到 text 或 lately/product/tech。", code="INVALID_OUTPUT")

    lately = normalize_lately(parsed.get("lately") if isinstance(parsed, dict) else None)
    result = {
        "lately": lately["summary"],
        "latelyItems": lately["items"],
        "product": parsed.get("product").strip() if isinstance(parsed.get("product"), str) and parsed.get("product").strip() else "暂无产品/服务信息",
        "tech": parsed.get("tech").strip() if isinstance(parsed.get("tech"), str) and parsed.get("tech").strip() else "暂无技术能力分析",
    }
    return {"data": result, "raw": payload} if includeRaw else result


def get_compare_workflow_key(step_key: str) -> str:
    upper = step_key.upper()
    specific = get_env([f"COMPARE_REPORT_{upper}_API_KEY", f"VITE_COMPARE_REPORT_{upper}_API_KEY"])
    legacy = get_env(["COMPARE_REPORT_API_KEY", "VITE_COMPARE_REPORT_API_KEY"])
    return specific or legacy


def get_compare_workflow_url(step_key: str) -> str:
    upper = step_key.upper()
    return get_env(
        [f"COMPARE_REPORT_{upper}_URL", f"VITE_COMPARE_REPORT_{upper}_URL", "COMPARE_REPORT_URL", "VITE_COMPARE_REPORT_URL"],
        DEFAULT_WORKFLOW_URL,
    )


def run_compare_report_workflow(
    targetCompanyName: str = "",
    targetCompanyIntro: str = "",
    targetCompanyBusiness: str = "",
    competitorName: str = "",
    competitorIntro: str = "",
    targetCompanyStatus: Optional[Dict[str, Any]] = None,
    competitorStatus: Optional[Dict[str, Any]] = None,
    includeRaw: bool = False,
    **_: Any,
) -> Any:
    workflow_user = get_env(["COMPARE_REPORT_USER", "VITE_COMPARE_REPORT_USER"], "admin")
    base_inputs = {
        "target_company_name": targetCompanyName,
        "target_company_intro": targetCompanyIntro,
        "target_company_business": targetCompanyBusiness,
        "competitor": competitorName,
        "competitor_intro": competitorIntro,
        "target_company_status": targetCompanyStatus or {},
        "competitor_status": competitorStatus or {},
    }

    def run_step(step_key: str, step_label: str) -> Any:
        return post_dify_workflow_once_or_retry(
            {
                "workflow_url": get_compare_workflow_url(step_key),
                "api_key": get_compare_workflow_key(step_key),
                "workflow_user": workflow_user,
                "inputs": base_inputs,
                "step_label": step_label,
                "require_text": True,
            },
            ["INVALID_OUTPUT"],
        )

    step_specs = [
        ("product", "企业对比-产品/服务"),
        ("tech", "企业对比-技术力"),
        ("lately", "企业对比-近期动态"),
    ]
    step_results: Dict[str, Any] = {}
    with ThreadPoolExecutor(max_workers=3) as executor:
        future_to_key = {executor.submit(run_step, key, label): key for key, label in step_specs}
        for future in as_completed(future_to_key):
            step_results[future_to_key[future]] = future.result()

    product_result = step_results["product"]
    tech_result = step_results["tech"]
    lately_result = step_results["lately"]
    summary_inputs = {
        "target_company_name": targetCompanyName,
        "target_company_intro": targetCompanyIntro,
        "target_company_business": targetCompanyBusiness,
        "competitor": competitorName,
        "competitor_intro": competitorIntro,
        "product_analysis": product_result["text"],
        "tech_analysis": tech_result["text"],
        "lately_analysis": lately_result["text"],
    }
    summary_result = post_dify_workflow_once_or_retry(
        {
            "workflow_url": get_compare_workflow_url("summary"),
            "api_key": get_compare_workflow_key("summary"),
            "workflow_user": workflow_user,
            "inputs": summary_inputs,
            "step_label": "企业对比-汇总",
            "require_text": True,
        },
        ["INVALID_OUTPUT"],
    )

    if includeRaw:
        return {
            "data": summary_result["text"],
            "raw": {
                "data": {"status": "succeeded", "outputs": {"text": summary_result["text"]}},
                "steps": {
                    "product": product_result["payload"],
                    "tech": tech_result["payload"],
                    "lately": lately_result["payload"],
                    "summary": summary_result["payload"],
                },
            },
        }
    return summary_result["text"]


SCORE_RESULT_KEYS = {
    "评分维度介绍",
    "竞争对手分析与打分",
    "整体结论",
    "scoreResult",
    "scores",
    "score",
    "ranking",
}
SCORE_OUTPUT_KEYS = [
    "text",
    "result",
    "answer",
    "json",
    "data",
    "output",
    "scoreResult",
    "score",
    "scores",
    "评分结果",
    "评分报告",
    "评分",
]


def looks_like_score_result(value: Any) -> bool:
    if isinstance(value, dict):
        return any(key in value for key in SCORE_RESULT_KEYS)
    if isinstance(value, list):
        return any(
            isinstance(item, dict)
            and any(key in item for key in ["竞争对手企业", "企业名称", "name", "威胁分数", "score", "threatScore"])
            for item in value
        )
    return False


def normalize_score_result(value: Any) -> Optional[Dict[str, Any]]:
    if isinstance(value, dict) and looks_like_score_result(value):
        return value
    if isinstance(value, list) and looks_like_score_result(value):
        return {
            "评分维度介绍": {},
            "竞争对手分析与打分": value,
            "整体结论": {},
        }
    return None


def extract_score_result(value: Any, depth: int = 0) -> Optional[Dict[str, Any]]:
    if depth > 6:
        return None
    if isinstance(value, str):
        parsed = parse_json_from_text(value)
        return extract_score_result(parsed, depth + 1) if parsed is not None else None
    if looks_like_score_result(value):
        return normalize_score_result(value)
    if isinstance(value, dict):
        for key in SCORE_OUTPUT_KEYS:
            if key in value:
                parsed = extract_score_result(value.get(key), depth + 1)
                if parsed is not None:
                    return parsed
        for nested_value in value.values():
            parsed = extract_score_result(nested_value, depth + 1)
            if parsed is not None:
                return parsed
    if isinstance(value, list):
        for item in value:
            parsed = extract_score_result(item, depth + 1)
            if parsed is not None:
                return parsed
    return None


def extract_score_result_from_payload(payload: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(payload, dict):
        return None

    # Dify blocking responses usually place workflow output in data.outputs, but tests
    # and proxy backends may return the score JSON directly, or nest it as outputs.text.
    # Try the specific Dify locations first, then broaden the search to data / payload.
    data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
    output_candidates = []
    if isinstance(data, dict):
        output_candidates.append(data.get("outputs"))
    output_candidates.extend([data, payload])

    for candidate in output_candidates:
        parsed = extract_score_result(candidate)
        if parsed is not None:
            return parsed
    return None


def run_score_workflow(targetCompany: str = "", reportText: str = "", includeRaw: bool = False, **_: Any) -> Any:
    # 兼容已有 .env.local：老项目里评分工作流使用 VITE_SCORE_API_KEY。
    # 后端会优先读取更安全的 SCORE_API_KEY；未配置时回退到 VITE_SCORE_API_KEY，避免现有环境不运行。
    workflow_url = get_env(["SCORE_URL", "VITE_SCORE_URL"], DEFAULT_WORKFLOW_URL)
    api_key = get_env(["SCORE_API_KEY", "VITE_SCORE_API_KEY"])
    workflow_user = get_env(["SCORE_USER", "VITE_SCORE_USER"], "admin")
    inputs = {"target_company": targetCompany, "report": reportText}
    last_error: Optional[Exception] = None

    for attempt in range(2):
        try:
            payload = post_dify_workflow(
                workflow_url=workflow_url,
                api_key=api_key,
                workflow_user=workflow_user,
                inputs=inputs,
                step_label="评分工作流",
            )
            parsed = extract_score_result_from_payload(payload)
            if parsed is not None:
                return {"data": parsed, "raw": payload} if includeRaw else parsed
            err = AppError("评分接口返回解析失败，未识别到 JSON。", code="INVALID_SCORE_OUTPUT")
            last_error = err
            if attempt == 0 and should_retry_once(err, ["INVALID_SCORE_OUTPUT"]):
                continue
            raise err
        except Exception as error:
            last_error = error
            if attempt == 0 and should_retry_once(error, ["INVALID_SCORE_OUTPUT"]):
                continue
            raise
    raise last_error or AppError("评分请求失败。")


def split_competitor_names(value: Any) -> List[str]:
    return [item.strip() for item in re.split(r"[,，;；、\n]", str(value or "")) if item.strip()][:MAX_COMPETITOR_COUNT]


def has_duplicate_company_names(names: List[str]) -> bool:
    for index, name in enumerate(names):
        if any(same_company_name(name, other_name) for other_name in names[index + 1 :]):
            return True
    return False


def should_use_demo(error: Exception) -> bool:
    message = str(getattr(error, "message", error) or "")
    return getattr(error, "code", None) == "MISSING_API_KEY" or "未配置" in message or "API_KEY" in message or "API Key" in message


def format_date_time(date: Optional[datetime] = None) -> str:
    date = date or datetime.now()
    return date.strftime("%Y-%m-%d %H:%M")


def build_target_company_info(
    target_name: str,
    target_intro: str = "",
    target_business: str = "",
    validation: Optional[Dict[str, Any]] = None,
) -> Dict[str, str]:
    validation = validation if isinstance(validation, dict) else {}
    validation_info = validation.get("targetCompanyInfo") if isinstance(validation.get("targetCompanyInfo"), dict) else None
    validation_company = validation.get("company") if isinstance(validation.get("company"), dict) else None
    return merge_company_info(
        {"name": target_name, "intro": target_intro, "business": target_business},
        validation_company,
        validation_info,
        fallback_name=target_name,
    )


def ensure_target_company_info(target_name: str, current_info: Dict[str, str], warnings: List[str]) -> Dict[str, str]:
    if current_info.get("intro") and current_info.get("business"):
        return current_info
    try:
        validation = run_company_name_validation_workflow(targetCompanyName=target_name)
        company = validation.get("company") if isinstance(validation, dict) and isinstance(validation.get("company"), dict) else None
        return merge_company_info(current_info, company, fallback_name=target_name)
    except Exception as error:
        warnings.append(f"我方企业信息补齐失败：{getattr(error, 'message', str(error))}")
        return current_info


def unwrap_workflow_data(payload: Any) -> Any:
    return payload.get("data") if isinstance(payload, dict) and "data" in payload else payload


def load_analysis_company_details(
    *,
    target_name: str,
    current_target_info: Dict[str, str],
    current_competitors: List[Dict[str, Any]],
    on_target_detail: Optional[Callable[[Any, str], None]] = None,
    on_competitor_detail: Optional[Callable[[str, Dict[str, Any]], None]] = None,
) -> Tuple[Any, Dict[str, Any], str]:
    def load_target_detail() -> Tuple[str, str, Any]:
        try:
            payload = run_company_detail_workflow(
                companyName=target_name,
                companyIntro=current_target_info.get("intro") or current_target_info.get("business") or target_name,
                includeRaw=True,
            )
            return "", "target", {"data": unwrap_workflow_data(payload), "error": ""}
        except Exception as error:
            return "", "target", {"data": None, "error": getattr(error, "message", str(error))}

    def load_competitor_detail(item: Dict[str, Any]) -> Tuple[str, str, Dict[str, Any]]:
        try:
            payload = run_company_detail_workflow(
                companyName=item.get("name", ""),
                companyIntro=item.get("intro") or item.get("name", ""),
                includeRaw=True,
            )
            return item["id"], "competitor", {"status": "success", "data": unwrap_workflow_data(payload), "error": ""}
        except Exception as error:
            return item["id"], "competitor", {"status": "error", "data": None, "error": getattr(error, "message", str(error))}

    current_target_detail = None
    target_error = ""
    current_competitor_details: Dict[str, Any] = {}
    pending_competitor_callbacks: List[Tuple[str, Dict[str, Any]]] = []
    target_callback_emitted = False
    worker_count = min(MAX_DETAIL_WORKFLOW_WORKERS, max(1, len(current_competitors) + 1))

    with ThreadPoolExecutor(max_workers=worker_count) as executor:
        futures = [executor.submit(load_target_detail)]
        futures.extend(executor.submit(load_competitor_detail, item) for item in current_competitors)
        for future in as_completed(futures):
            key, detail_type, value = future.result()
            if detail_type == "target":
                current_target_detail = value.get("data")
                target_error = value.get("error") or ""
                if on_target_detail:
                    on_target_detail(current_target_detail, target_error)
                target_callback_emitted = True
                if on_competitor_detail:
                    for competitor_id, competitor_value in pending_competitor_callbacks:
                        on_competitor_detail(competitor_id, competitor_value)
                    pending_competitor_callbacks.clear()
                continue
            current_competitor_details[key] = value
            if on_competitor_detail and target_callback_emitted:
                on_competitor_detail(key, value)
            elif on_competitor_detail:
                pending_competitor_callbacks.append((key, value))

    return current_target_detail, current_competitor_details, target_error


def is_pending_competitor_intro(value: Any) -> bool:
    text = normalize_text_value(value)
    return bool(text and "正在" in text)


def compact_summary_text(value: Any, limit: int = 260) -> str:
    text = normalize_text_value(value)
    if not text:
        return ""
    text = re.sub(r"[#*_`>~-]+", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) <= limit:
        return text
    return f"{text[:limit].rstrip()}..."


def pick_competitor_detail_summary(detail: Any) -> str:
    if not isinstance(detail, dict):
        return ""
    for key in ("product", "lately", "tech"):
        summary = compact_summary_text(detail.get(key))
        if summary:
            return summary
    return ""


def pick_score_summary_for_competitor(score_result: Any, competitor_name: Any) -> str:
    if not isinstance(score_result, dict):
        return ""
    score_items = score_result.get("竞争对手分析与打分")
    if not isinstance(score_items, list):
        return ""
    for item in score_items:
        if not isinstance(item, dict):
            continue
        if same_company_name(item.get("竞争对手企业"), competitor_name):
            return compact_summary_text(item.get("竞争分析小结"))
    return ""


def hydrate_competitor_intros(
    current_competitors: List[Dict[str, Any]],
    current_competitor_details: Optional[Dict[str, Any]] = None,
    current_score_result: Any = None,
) -> List[Dict[str, Any]]:
    hydrated: List[Dict[str, Any]] = []
    for item in current_competitors:
        next_item = dict(item)
        if is_pending_competitor_intro(next_item.get("intro")):
            detail_entry = (current_competitor_details or {}).get(next_item.get("id")) or {}
            detail_summary = pick_competitor_detail_summary(detail_entry.get("data"))
            score_summary = pick_score_summary_for_competitor(current_score_result, next_item.get("name"))
            replacement = score_summary or detail_summary
            if replacement:
                next_item["intro"] = replacement
        hydrated.append(next_item)
    return hydrated


DEMO_COMPETITORS = [
    {
        "id": "competitor-1",
        "name": "之江实验室",
        "intro": "浙江省政府与浙江大学、阿里巴巴等共建，聚焦人工智能、网络空间安全、云计算与新型实验室方向。",
        "threatScore": 94,
        "sourceTag": "自动搜索结果",
    },
    {
        "id": "competitor-2",
        "name": "鹏城实验室",
        "intro": "深圳市政府主导建设，聚焦人工智能、通信网络、网络安全、低空经济等前沿领域。",
        "threatScore": 89,
        "sourceTag": "自动搜索结果",
    },
    {
        "id": "competitor-3",
        "name": "紫金山实验室",
        "intro": "江苏省与南京市共建，聚焦 6G、内生安全、安全计算等技术攻关。",
        "threatScore": 78,
        "sourceTag": "自动搜索结果",
    },
    {
        "id": "competitor-4",
        "name": "北京智源人工智能研究院",
        "intro": "围绕 AI 基础研究与大模型，推动前沿技术和开放合作。",
        "threatScore": 72,
        "sourceTag": "自动搜索结果",
    },
    {
        "id": "competitor-5",
        "name": "上海人工智能实验室",
        "intro": "由上海市支持，聚焦大模型与基础研究，推进 AI 技术应用创新。",
        "threatScore": 66,
        "sourceTag": "自动搜索结果",
    },
]

DEMO_TARGET_DETAIL = {
    "lately": "近三个月围绕新一代智能计算平台、科研合作与产业化项目持续更新。",
    "latelyItems": [
        {
            "id": "news-1",
            "title": "发布新一代数据智能平台 v3.0",
            "time": "2025-04",
            "content": "平台强化多源数据汇聚、智能分析与安全协同能力。",
            "source": "公开信息",
        },
        {
            "id": "news-2",
            "title": "与多家头部机构共建联合实验室",
            "time": "2025-03",
            "content": "围绕人工智能、量子计算和安全可信方向推进联合研发。",
            "source": "公开信息",
        },
        {
            "id": "news-3",
            "title": "参与国家级重点项目合作",
            "time": "2025-02",
            "content": "在关键技术攻关与产业协同创新方面形成阶段成果。",
            "source": "公开信息",
        },
    ],
    "product": "数据智能平台、智能计算平台、科研协同工具、数据要素治理与行业生态软件。",
    "tech": "大模型技术、异构安全防护、云计算平台、可信数据流通、知识图谱与多模态分析。",
}


def build_demo_competitor_detail(name: str) -> Dict[str, Any]:
    return {
        "lately": f"{name}近期在技术平台、产业合作和科研项目上保持活跃。",
        "latelyItems": [
            {
                "id": "news-1",
                "title": "强化重点方向技术攻关",
                "time": "2025-04",
                "content": "围绕核心科研方向推进平台建设与能力升级。",
                "source": "公开信息",
            },
            {
                "id": "news-2",
                "title": "推进开放合作生态",
                "time": "2025-03",
                "content": "与高校、企业及行业机构开展联合验证与项目合作。",
                "source": "公开信息",
            },
        ],
        "product": "科研平台、行业解决方案、开放工具链、联合实验室服务。",
        "tech": "大模型、网络安全、云计算、边缘智能、数据工程与工程化落地。",
    }


def build_demo_score_result(competitors: List[Dict[str, Any]]) -> Dict[str, Any]:
    return {
        "评分维度介绍": {
            "技术力": "技术路线、人才梯队和工程化能力，权重 35 分",
            "产品服务": "平台化产品、行业方案与客户适配能力，权重 25 分",
            "市场与合作": "生态伙伴、项目资源与区域影响力，权重 25 分",
            "近期动向": "最近公开进展的活跃度和战略指向，权重 15 分",
        },
        "竞争对手分析与打分": [
            {
                "竞争对手企业": item.get("name"),
                "威胁分数": item.get("threatScore") or max(58, 92 - index * 7),
                "各维度得分详情": {
                    "技术力": max(56, 92 - index * 5),
                    "产品服务": max(54, 86 - index * 4),
                    "市场与合作": max(52, 84 - index * 4),
                    "近期动向": max(50, 82 - index * 5),
                },
                "竞争分析小结": f"{item.get('name')}在技术储备、合作生态与公开项目活跃度上具备较强竞争信号，建议持续跟踪其平台化产品和产业协同进展。",
            }
            for index, item in enumerate(competitors)
        ],
        "整体结论": {
            "威胁度排名": [item.get("name") for item in competitors],
            "整体小结": "头部实验室在基础研究、平台工具与生态合作上形成组合优势；我方可围绕差异化场景、产品化节奏和区域生态合作建立持续优势。",
        },
    }


def build_record(
    *,
    currentForm: Dict[str, Any],
    currentQueryTime: str,
    currentTargetInfo: Dict[str, Any],
    currentTargetDetail: Any,
    currentCompetitors: List[Dict[str, Any]],
    currentCompetitorDetails: Dict[str, Any],
    currentCompareReports: Dict[str, Any],
    currentScoreResult: Any,
    currentSingleMode: bool,
    warnings: Optional[List[str]] = None,
    mode: str = "live",
    recordId: str = "",
    createdAt: str = "",
    targetDetailStatus: str = "",
    targetDetailError: str = "",
    scoreStatus: str = "",
    scoreError: str = "",
    finalizing: bool = False,
    analysisMessage: str = "",
    isLoading: bool = False,
) -> Dict[str, Any]:
    now_ms = int(time.time() * 1000)
    suffix = "".join(random.choices("abcdefghijklmnopqrstuvwxyz0123456789", k=6))
    record_id = str(recordId or "").strip() or f"history-{now_ms}-{suffix}"
    created_at = str(createdAt or "").strip() or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    return {
        "id": record_id,
        "createdAt": created_at,
        "queryTime": currentQueryTime,
        "title": f"目标分析企业：{currentForm.get('targetCompanyName')}",
        "input": currentForm,
        "mode": mode,
        "warnings": warnings or [],
        "stateSnapshot": {
            "phase": "results",
            "form": currentForm,
            "queryTime": currentQueryTime,
            "targetCompanyInfo": currentTargetInfo,
            "targetDetail": currentTargetDetail,
            "competitors": currentCompetitors,
            "competitorDetails": currentCompetitorDetails,
            "compareReports": currentCompareReports,
            "scoreResult": currentScoreResult,
            "selectedCompetitorId": currentCompetitors[0].get("id") if currentSingleMode and currentCompetitors else None,
            "activeTab": "总体信息",
            "singleMode": currentSingleMode,
            "targetDetailStatus": targetDetailStatus,
            "targetDetailError": targetDetailError,
            "scoreStatus": scoreStatus,
            "scoreError": scoreError,
            "finalizing": finalizing,
            "analysisMessage": analysisMessage,
            "isLoading": isLoading,
        },
    }


def build_demo_record(
    current_form: Dict[str, Any],
    current_query_time: str,
    manual_names: List[str],
    warning: str,
    record_id: str = "",
    created_at: str = "",
) -> Dict[str, Any]:
    current_competitors = (
        [
            {
                "id": f"manual-{index + 1}",
                "name": name,
                "intro": f"{name}是本次指定分析对象，重点关注其技术路线、产品服务、客户生态与近期动态。",
                "threatScore": max(62, 88 - index * 6),
                "sourceTag": "指定竞争对手",
            }
            for index, name in enumerate(manual_names)
        ]
        if manual_names
        else DEMO_COMPETITORS
    )
    current_single_mode = len(manual_names) == 1
    current_target_info = {
        "intro": "由浙江省政府发起设立的新型研发机构，聚焦人工智能、量子计算、空天信息、先进芯片等国家战略科技方向。",
        "business": "人工智能 / 量子计算 / 数据智能平台建设",
    }
    current_competitor_details = {
        item["id"]: {"status": "success", "data": build_demo_competitor_detail(item["name"]), "error": ""}
        for item in current_competitors
    }
    target_company_name = current_form.get("targetCompanyName") or "我方企业"
    current_compare_reports = {
        item["id"]: {
            "status": "success",
            "text": f"# {target_company_name} vs {item['name']}\n\n## 产品/服务\n我方更强调数据智能平台与科研协同能力，{item['name']}在细分技术方向和开放合作生态方面具备优势。\n\n## 技术力\n双方均具备基础研究与工程化能力，建议重点跟踪大模型、云计算、网络安全与行业化落地。\n\n## 近期动态\n{item['name']}近期公开动作较活跃，可能在重点项目和生态合作上形成竞争压力。\n\n## 结论\n建议以差异化场景、产品化速度和联合生态作为下一阶段竞争策略。",
            "error": "",
        }
        for item in current_competitors
    }
    return build_record(
        currentForm=current_form,
        currentQueryTime=current_query_time,
        currentTargetInfo=current_target_info,
        currentTargetDetail=DEMO_TARGET_DETAIL,
        currentCompetitors=current_competitors,
        currentCompetitorDetails=current_competitor_details,
        currentCompareReports=current_compare_reports,
        currentScoreResult=build_demo_score_result(current_competitors),
        currentSingleMode=current_single_mode,
        warnings=[warning] if warning else [],
        mode="demo",
        recordId=record_id,
        createdAt=created_at,
        targetDetailStatus="success",
        scoreStatus="success",
        isLoading=False,
    )


def run_full_analysis(
    targetCompanyName: str = "",
    targetCompanyIntro: str = "",
    targetCompanyBusiness: str = "",
    targetCompanyConfirmed: bool = False,
    province: str = "",
    competitorCompanyName: str = "",
    matchMode: str = "",
    **_: Any,
) -> Dict[str, Any]:
    target_name = str(targetCompanyName or "").strip()
    normalized_province = str(province or "").strip()
    manual_names = split_competitor_names(competitorCompanyName)
    requested_match_mode = "exact" if str(matchMode or "").strip().lower() == "exact" else "auto"
    current_form = {
        "targetCompanyName": target_name,
        "targetCompanyIntro": str(targetCompanyIntro or "").strip(),
        "targetCompanyBusiness": str(targetCompanyBusiness or "").strip(),
        "targetCompanyConfirmed": bool(targetCompanyConfirmed),
        "province": normalized_province,
        "competitorCompanyName": "、".join(manual_names),
        "matchMode": requested_match_mode,
    }
    if not target_name:
        raise AppError("请先输入我方企业名称。", status_code=400, code="BAD_REQUEST")
    if requested_match_mode == "exact":
        if not manual_names:
            raise AppError("精确匹配模式下请至少输入一家竞争对手企业名称。", status_code=400, code="BAD_REQUEST")
        if any(same_company_name(name, target_name) for name in manual_names):
            raise AppError("竞争对手名称不能与我方企业名称相同。", status_code=400, code="BAD_REQUEST")
        if has_duplicate_company_names(manual_names):
            raise AppError("竞争对手名称不能重复。", status_code=400, code="BAD_REQUEST")

    current_query_time = format_date_time()
    warnings: List[str] = []

    try:
        current_target_info = build_target_company_info(
            target_name,
            current_form.get("targetCompanyIntro") or "",
            current_form.get("targetCompanyBusiness") or "",
        )
        current_target_info = ensure_target_company_info(target_name, current_target_info, warnings)
        target_name = current_target_info.get("name") or target_name
        current_form["targetCompanyName"] = target_name
        current_form["targetCompanyIntro"] = current_target_info.get("intro") or ""
        current_form["targetCompanyBusiness"] = current_target_info.get("business") or ""

        if requested_match_mode == "exact":
            if not manual_names:
                raise AppError("精确匹配模式下请至少输入一家竞争对手企业名称。", status_code=400, code="BAD_REQUEST")
            if any(same_company_name(name, target_name) for name in manual_names):
                raise AppError("竞争对手名称不能与我方企业名称相同。", status_code=400, code="BAD_REQUEST")
            if has_duplicate_company_names(manual_names):
                raise AppError("竞争对手名称不能重复。", status_code=400, code="BAD_REQUEST")
            current_competitors = [
                {
                    "id": f"manual-{index + 1}",
                    "name": name,
                    "intro": "指定竞争对手，正在补全详情。",
                    "threatScore": None,
                    "sourceTag": "指定竞争对手",
                }
                for index, name in enumerate(manual_names)
            ]
        else:
            validation = run_input_validation_workflow(
                targetCompanyName=target_name,
                targetCompanyIntro=current_target_info.get("intro") or "",
                targetCompanyBusiness=current_target_info.get("business") or "",
                province=normalized_province,
                competitorCompanyName="、".join(manual_names),
            )
            validation_competitors = validation.get("competitors") if isinstance(validation.get("competitors"), list) else []
            if manual_names:
                current_competitors = []
                for index, name in enumerate(manual_names):
                    matched = next((item for item in validation_competitors if item.get("name") == name), None)
                    specified = validation.get("specifiedCompetitor") if isinstance(validation.get("specifiedCompetitor"), dict) else None
                    current_competitors.append(
                        {
                            "id": f"manual-{index + 1}",
                            "name": name,
                            "intro": specified.get("intro") if specified and specified.get("name") == name else (matched or {}).get("intro") or "指定竞争对手，正在补全详情。",
                            "threatScore": (matched or {}).get("threatScore"),
                            "sourceTag": "指定竞争对手",
                        }
                    )
            else:
                current_competitors = validation_competitors[:MAX_COMPETITOR_COUNT]
            current_target_info = build_target_company_info(
                target_name,
                current_form.get("targetCompanyIntro") or "",
                current_form.get("targetCompanyBusiness") or "",
                validation,
            )

        current_target_info = ensure_target_company_info(target_name, current_target_info, warnings)
        target_name = current_target_info.get("name") or target_name
        current_form["targetCompanyName"] = target_name
        current_form["targetCompanyIntro"] = current_target_info.get("intro") or ""
        current_form["targetCompanyBusiness"] = current_target_info.get("business") or ""

        if not current_competitors:
            raise AppError("未获得竞争对手列表，请补充竞争对手名称后再试。")

        current_single_mode = len(manual_names) == 1

        current_target_detail, current_competitor_details, target_detail_error = load_analysis_company_details(
            target_name=target_name,
            current_target_info=current_target_info,
            current_competitors=current_competitors,
        )
        if target_detail_error:
            warnings.append(f"我方企业详情加载失败：{target_detail_error}")
        current_competitors = hydrate_competitor_intros(current_competitors, current_competitor_details)

        def load_compare_report(item: Dict[str, Any]) -> Tuple[str, Dict[str, Any]]:
            detail = (current_competitor_details.get(item["id"]) or {}).get("data")
            try:
                report_payload = run_compare_report_workflow(
                    targetCompanyName=target_name,
                    targetCompanyIntro=current_target_info.get("intro") or target_name,
                    targetCompanyBusiness=current_target_info.get("business") or "",
                    competitorName=item.get("name", ""),
                    competitorIntro=item.get("intro") or "",
                    targetCompanyStatus=current_target_detail or {},
                    competitorStatus=detail or {},
                    includeRaw=True,
                )
                text = report_payload.get("data") if isinstance(report_payload, dict) and "data" in report_payload else report_payload
                return item["id"], {"status": "success", "text": text, "error": ""}
            except Exception as error:
                return item["id"], {"status": "error", "text": "", "error": getattr(error, "message", str(error))}

        current_compare_reports: Dict[str, Any] = {}
        with ThreadPoolExecutor(max_workers=min(5, max(1, len(current_competitors)))) as executor:
            for future in as_completed([executor.submit(load_compare_report, item) for item in current_competitors]):
                key, value = future.result()
                current_compare_reports[key] = value

        current_score_result = None
        merged_report_text = "\n\n".join(
            f"## {item.get('name')}\n{(current_compare_reports.get(item['id']) or {}).get('text') or (current_compare_reports.get(item['id']) or {}).get('error') or ''}"
            for item in current_competitors
        )
        if merged_report_text.strip():
            try:
                score_payload = run_score_workflow(targetCompany=target_name, reportText=merged_report_text, includeRaw=True)
                current_score_result = score_payload.get("data") if isinstance(score_payload, dict) and "data" in score_payload else score_payload
            except Exception as error:
                warnings.append(f"评分报告生成失败：{getattr(error, 'message', str(error))}")
        current_competitors = hydrate_competitor_intros(current_competitors, current_competitor_details, current_score_result)

        return build_record(
            currentForm=current_form,
            currentQueryTime=current_query_time,
            currentTargetInfo=current_target_info,
            currentTargetDetail=current_target_detail,
            currentCompetitors=current_competitors,
            currentCompetitorDetails=current_competitor_details,
            currentCompareReports=current_compare_reports,
            currentScoreResult=current_score_result,
            currentSingleMode=current_single_mode,
            warnings=warnings,
            mode="live",
        )
    except Exception as error:
        if should_use_demo(error):
            return build_demo_record(
                current_form,
                current_query_time,
                manual_names,
                "未检测到完整接口密钥，后端已切换为演示数据。配置 .env.local 后会调用真实工作流。",
            )
        raise


def emit_demo_analysis_events(
    *,
    current_form: Dict[str, Any],
    current_query_time: str,
    manual_names: List[str],
    warning: str,
    emit: Any,
    record_id: str = "",
    created_at: str = "",
) -> Dict[str, Any]:
    """Emit a complete demo analysis sequence for the NDJSON endpoint."""
    record = build_demo_record(current_form, current_query_time, manual_names, warning, record_id=record_id, created_at=created_at)
    snap = record.get("stateSnapshot") or {}
    demo_competitors = snap.get("competitors") if isinstance(snap.get("competitors"), list) else []
    emit("competitors_ready", demo_competitors)
    emit(
        "target_detail_ready",
        {
            "status": "success",
            "data": snap.get("targetDetail") or {},
            "targetCompanyInfo": snap.get("targetCompanyInfo") or {},
        },
    )
    for item in demo_competitors:
        competitor_id = item.get("id")
        detail = (snap.get("competitorDetails") or {}).get(competitor_id) or {}
        emit(
            "competitor_detail_ready",
            {
                "competitorId": competitor_id,
                "status": detail.get("status") or "success",
                "data": detail.get("data") or {},
                "error": detail.get("error") or "",
            },
        )
    for item in demo_competitors:
        competitor_id = item.get("id")
        report = (snap.get("compareReports") or {}).get(competitor_id) or {}
        emit(
            "compare_report_ready",
            {
                "competitorId": competitor_id,
                "status": report.get("status") or "success",
                "text": report.get("text") or "",
                "error": report.get("error") or "",
            },
        )
    emit("score_ready", {"status": "success", "data": snap.get("scoreResult") or {}})
    save_history_record(record)
    emit("analysis_finished", {"record": record})
    return record


def run_full_analysis_stream(
    emit: Any,
    targetCompanyName: str = "",
    targetCompanyIntro: str = "",
    targetCompanyBusiness: str = "",
    targetCompanyConfirmed: bool = False,
    province: str = "",
    competitorCompanyName: str = "",
    matchMode: str = "",
    resultId: str = "",
    **_: Any,
) -> Dict[str, Any]:
    """Run the same analysis as /api/analysis, but emit NDJSON progress events.

    Dify calls remain blocking. The backend streams each finished stage to the
    browser immediately, then saves and emits the final record with the same
    structure used by the legacy /api/analysis endpoint.
    """
    target_name = str(targetCompanyName or "").strip()
    normalized_province = str(province or "").strip()
    manual_names = split_competitor_names(competitorCompanyName)
    requested_match_mode = "exact" if str(matchMode or "").strip().lower() == "exact" else "auto"
    current_form = {
        "targetCompanyName": target_name,
        "targetCompanyIntro": str(targetCompanyIntro or "").strip(),
        "targetCompanyBusiness": str(targetCompanyBusiness or "").strip(),
        "targetCompanyConfirmed": bool(targetCompanyConfirmed),
        "province": normalized_province,
        "competitorCompanyName": "、".join(manual_names),
        "matchMode": requested_match_mode,
    }
    if not target_name:
        raise AppError("请先输入我方企业名称。", status_code=400, code="BAD_REQUEST")
    if requested_match_mode == "exact":
        if not manual_names:
            raise AppError("精确匹配模式下请至少输入一家竞争对手企业名称。", status_code=400, code="BAD_REQUEST")
        if any(same_company_name(name, target_name) for name in manual_names):
            raise AppError("竞争对手名称不能与我方企业名称相同。", status_code=400, code="BAD_REQUEST")
        if has_duplicate_company_names(manual_names):
            raise AppError("竞争对手名称不能重复。", status_code=400, code="BAD_REQUEST")

    current_query_time = format_date_time()
    record_id = str(resultId or "").strip()
    record_created_at = ""
    warnings: List[str] = []
    stream_active = True

    def safe_emit(event_type: str, data: Any) -> None:
        nonlocal stream_active
        if not stream_active:
            return
        try:
            emit(event_type, data)
        except (BrokenPipeError, ConnectionResetError, OSError):
            stream_active = False

    initial_record = build_record(
        currentForm=current_form,
        currentQueryTime=current_query_time,
        currentTargetInfo=build_target_company_info(
            target_name,
            current_form.get("targetCompanyIntro") or "",
            current_form.get("targetCompanyBusiness") or "",
        ),
        currentTargetDetail=None,
        currentCompetitors=[],
        currentCompetitorDetails={},
        currentCompareReports={},
        currentScoreResult=None,
        currentSingleMode=False,
        warnings=[],
        mode="running",
        recordId=record_id,
        targetDetailStatus="loading",
        scoreStatus="idle",
        analysisMessage="分析已开始",
        isLoading=True,
    )
    record_id = initial_record["id"]
    record_created_at = initial_record["createdAt"]
    save_history_record(initial_record)
    safe_emit("analysis_started", {"message": "分析已开始", "resultId": record_id})

    try:
        current_target_info = build_target_company_info(
            target_name,
            current_form.get("targetCompanyIntro") or "",
            current_form.get("targetCompanyBusiness") or "",
        )
        current_target_info = ensure_target_company_info(target_name, current_target_info, warnings)
        target_name = current_target_info.get("name") or target_name
        current_form["targetCompanyName"] = target_name
        current_form["targetCompanyIntro"] = current_target_info.get("intro") or ""
        current_form["targetCompanyBusiness"] = current_target_info.get("business") or ""

        if requested_match_mode == "exact":
            if not manual_names:
                raise AppError("精确匹配模式下请至少输入一家竞争对手企业名称。", status_code=400, code="BAD_REQUEST")
            if any(same_company_name(name, target_name) for name in manual_names):
                raise AppError("竞争对手名称不能与我方企业名称相同。", status_code=400, code="BAD_REQUEST")
            if has_duplicate_company_names(manual_names):
                raise AppError("竞争对手名称不能重复。", status_code=400, code="BAD_REQUEST")
            current_competitors = [
                {
                    "id": f"manual-{index + 1}",
                    "name": name,
                    "intro": "指定竞争对手，正在补全详情。",
                    "threatScore": None,
                    "sourceTag": "指定竞争对手",
                }
                for index, name in enumerate(manual_names)
            ]
        else:
            validation = run_input_validation_workflow(
                targetCompanyName=target_name,
                targetCompanyIntro=current_target_info.get("intro") or "",
                targetCompanyBusiness=current_target_info.get("business") or "",
                province=normalized_province,
                competitorCompanyName="、".join(manual_names),
            )
            validation_competitors = validation.get("competitors") if isinstance(validation.get("competitors"), list) else []
            if manual_names:
                current_competitors = []
                for index, name in enumerate(manual_names):
                    matched = next((item for item in validation_competitors if item.get("name") == name), None)
                    specified = validation.get("specifiedCompetitor") if isinstance(validation.get("specifiedCompetitor"), dict) else None
                    current_competitors.append(
                        {
                            "id": f"manual-{index + 1}",
                            "name": name,
                            "intro": specified.get("intro") if specified and specified.get("name") == name else (matched or {}).get("intro") or "指定竞争对手，正在补全详情。",
                            "threatScore": (matched or {}).get("threatScore"),
                            "sourceTag": "指定竞争对手",
                        }
                    )
            else:
                current_competitors = validation_competitors[:MAX_COMPETITOR_COUNT]
            current_target_info = build_target_company_info(
                target_name,
                current_form.get("targetCompanyIntro") or "",
                current_form.get("targetCompanyBusiness") or "",
                validation,
            )

        current_target_info = ensure_target_company_info(target_name, current_target_info, warnings)
        target_name = current_target_info.get("name") or target_name
        current_form["targetCompanyName"] = target_name
        current_form["targetCompanyIntro"] = current_target_info.get("intro") or ""
        current_form["targetCompanyBusiness"] = current_target_info.get("business") or ""

        if not current_competitors:
            raise AppError("未获得竞争对手列表，请补充竞争对手名称后再试。")

        current_single_mode = len(manual_names) == 1
        competitor_stage_record = build_record(
            currentForm=current_form,
            currentQueryTime=current_query_time,
            currentTargetInfo=current_target_info,
            currentTargetDetail=None,
            currentCompetitors=current_competitors,
            currentCompetitorDetails={
                item["id"]: {"status": "loading", "data": None, "error": ""}
                for item in current_competitors
            },
            currentCompareReports={
                item["id"]: {"status": "loading", "text": "", "error": ""}
                for item in current_competitors
            },
            currentScoreResult=None,
            currentSingleMode=current_single_mode,
            warnings=warnings,
            mode="running",
            recordId=record_id,
            createdAt=record_created_at,
            targetDetailStatus="loading",
            scoreStatus="loading",
            analysisMessage="竞争对手已生成，分析进行中",
            isLoading=True,
        )
        save_history_record(competitor_stage_record)
        safe_emit("competitors_ready", current_competitors)

        def emit_target_detail(detail: Any, error: str) -> None:
            if error:
                safe_emit("target_detail_ready", {"status": "error", "error": error, "targetCompanyInfo": current_target_info})
                return
            safe_emit(
                "target_detail_ready",
                {
                    "status": "success",
                    "data": detail or {},
                    "targetCompanyInfo": current_target_info,
                },
            )

        def emit_competitor_detail(competitor_id: str, detail: Dict[str, Any]) -> None:
            if detail.get("status") == "success":
                safe_emit("competitor_detail_ready", {"competitorId": competitor_id, "status": "success", "data": detail.get("data") or {}})
            else:
                safe_emit("competitor_detail_ready", {"competitorId": competitor_id, "status": "error", "error": detail.get("error") or "企业详情加载失败"})

        current_target_detail, current_competitor_details, target_detail_error = load_analysis_company_details(
            target_name=target_name,
            current_target_info=current_target_info,
            current_competitors=current_competitors,
            on_target_detail=emit_target_detail,
            on_competitor_detail=emit_competitor_detail,
        )
        if target_detail_error:
            warnings.append(f"我方企业详情加载失败：{target_detail_error}")
        current_competitors = hydrate_competitor_intros(current_competitors, current_competitor_details)

        detail_stage_record = build_record(
            currentForm=current_form,
            currentQueryTime=current_query_time,
            currentTargetInfo=current_target_info,
            currentTargetDetail=current_target_detail,
            currentCompetitors=current_competitors,
            currentCompetitorDetails=current_competitor_details,
            currentCompareReports={
                item["id"]: {"status": "loading", "text": "", "error": ""}
                for item in current_competitors
            },
            currentScoreResult=None,
            currentSingleMode=current_single_mode,
            warnings=warnings,
            mode="running",
            recordId=record_id,
            createdAt=record_created_at,
            targetDetailStatus="success" if current_target_detail else "error",
            scoreStatus="loading",
            analysisMessage="企业信息已获取，对比报告生成中",
            isLoading=True,
        )
        save_history_record(detail_stage_record)

        def load_compare_report(item: Dict[str, Any]) -> Tuple[str, Dict[str, Any]]:
            detail = (current_competitor_details.get(item["id"]) or {}).get("data")
            try:
                report_payload = run_compare_report_workflow(
                    targetCompanyName=target_name,
                    targetCompanyIntro=current_target_info.get("intro") or target_name,
                    targetCompanyBusiness=current_target_info.get("business") or "",
                    competitorName=item.get("name", ""),
                    competitorIntro=item.get("intro") or "",
                    targetCompanyStatus=current_target_detail or {},
                    competitorStatus=detail or {},
                    includeRaw=True,
                )
                text = report_payload.get("data") if isinstance(report_payload, dict) and "data" in report_payload else report_payload
                return item["id"], {"status": "success", "text": text, "error": ""}
            except Exception as error:
                return item["id"], {"status": "error", "text": "", "error": getattr(error, "message", str(error))}

        current_compare_reports: Dict[str, Any] = {}
        max_workers = min(5, max(1, len(current_competitors)))
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            future_to_item = {executor.submit(load_compare_report, item): item for item in current_competitors}
            for future in as_completed(future_to_item):
                key, value = future.result()
                current_compare_reports[key] = value
                if value.get("status") == "success":
                    safe_emit("compare_report_ready", {"competitorId": key, "status": "success", "text": value.get("text") or ""})
                else:
                    safe_emit("compare_report_ready", {"competitorId": key, "status": "error", "error": value.get("error") or "对比报告生成失败"})

        report_stage_record = build_record(
            currentForm=current_form,
            currentQueryTime=current_query_time,
            currentTargetInfo=current_target_info,
            currentTargetDetail=current_target_detail,
            currentCompetitors=current_competitors,
            currentCompetitorDetails=current_competitor_details,
            currentCompareReports=current_compare_reports,
            currentScoreResult=None,
            currentSingleMode=current_single_mode,
            warnings=warnings,
            mode="running",
            recordId=record_id,
            createdAt=record_created_at,
            targetDetailStatus="success" if current_target_detail else "error",
            scoreStatus="loading",
            analysisMessage="对比报告已生成，正在打分",
            isLoading=True,
        )
        save_history_record(report_stage_record)

        current_score_result = None
        merged_report_text = "\n\n".join(
            f"## {item.get('name')}\n{(current_compare_reports.get(item['id']) or {}).get('text') or (current_compare_reports.get(item['id']) or {}).get('error') or ''}"
            for item in current_competitors
        )
        if merged_report_text.strip():
            try:
                score_payload = run_score_workflow(targetCompany=target_name, reportText=merged_report_text, includeRaw=True)
                current_score_result = score_payload.get("data") if isinstance(score_payload, dict) and "data" in score_payload else score_payload
                safe_emit("score_ready", {"status": "success", "data": current_score_result or {}})
            except Exception as error:
                message = getattr(error, "message", str(error))
                warnings.append(f"评分报告生成失败：{message}")
                safe_emit("score_ready", {"status": "error", "error": message})
        else:
            message = "暂无可用于评分的报告内容。"
            warnings.append(f"评分报告生成失败：{message}")
            safe_emit("score_ready", {"status": "error", "error": message})
        current_competitors = hydrate_competitor_intros(current_competitors, current_competitor_details, current_score_result)

        record = build_record(
            currentForm=current_form,
            currentQueryTime=current_query_time,
            currentTargetInfo=current_target_info,
            currentTargetDetail=current_target_detail,
            currentCompetitors=current_competitors,
            currentCompetitorDetails=current_competitor_details,
            currentCompareReports=current_compare_reports,
            currentScoreResult=current_score_result,
            currentSingleMode=current_single_mode,
            warnings=warnings,
            mode="live",
            recordId=record_id,
            createdAt=record_created_at,
            targetDetailStatus="success" if current_target_detail else "error",
            scoreStatus="success" if current_score_result else "error",
            finalizing=False,
            analysisMessage="分析完成",
            isLoading=False,
        )
        save_history_record(record)
        safe_emit("analysis_finished", {"record": record})
        return record
    except Exception as error:
        if should_use_demo(error):
            return emit_demo_analysis_events(
                current_form=current_form,
                current_query_time=current_query_time,
                manual_names=manual_names,
                warning="未检测到完整接口密钥，后端已切换为演示数据。配置 .env.local 后会调用真实工作流。",
                emit=safe_emit,
                record_id=record_id,
                created_at=record_created_at,
            )
        error_message = getattr(error, "message", str(error))
        error_record = build_record(
            currentForm=current_form,
            currentQueryTime=current_query_time,
            currentTargetInfo=build_target_company_info(
                target_name,
                current_form.get("targetCompanyIntro") or "",
                current_form.get("targetCompanyBusiness") or "",
            ),
            currentTargetDetail=None,
            currentCompetitors=[],
            currentCompetitorDetails={},
            currentCompareReports={},
            currentScoreResult=None,
            currentSingleMode=False,
            warnings=[error_message],
            mode="error",
            recordId=record_id,
            createdAt=record_created_at,
            targetDetailStatus="error",
            targetDetailError=error_message,
            scoreStatus="error",
            scoreError=error_message,
            analysisMessage="分析失败",
            isLoading=False,
        )
        save_history_record(error_record)
        raise


class ApiHandler(BaseHTTPRequestHandler):
    server_version = "CompetitorAnalysisPythonBackend/1.0"

    def log_message(self, fmt: str, *args: Any) -> None:
        sys.stderr.write("%s - - [%s] %s\n" % (self.address_string(), self.log_date_time_string(), fmt % args))

    def _cors_origin(self) -> str:
        origin = self.headers.get("Origin") or ""
        if re.fullmatch(r"https?://(localhost|127\.0\.0\.1):\d+", origin):
            return origin
        return os.environ.get("CORS_ORIGIN") or "http://localhost:5174"

    def _send_json(self, payload: Any, status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", self._cors_origin())
        self.send_header("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()
        self.wfile.write(body)

    def _send_ndjson_headers(self, status: int = 200) -> None:
        self.send_response(status)
        self.send_header("Content-Type", "application/x-ndjson; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Accel-Buffering", "no")
        self.send_header("Access-Control-Allow-Origin", self._cors_origin())
        self.send_header("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def _emit_ndjson_event(self, event_type: str, data: Any) -> None:
        line = json.dumps({"type": event_type, "data": data}, ensure_ascii=False) + "\n"
        self.wfile.write(line.encode("utf-8"))
        self.wfile.flush()

    def _send_error(self, error: Exception, fallback_message: str) -> None:
        status_code = int(getattr(error, "status_code", 500) or 500)
        message = getattr(error, "message", None) or str(error) or fallback_message
        code = getattr(error, "code", "ERROR") or "ERROR"
        self._send_json({"message": message, "code": code}, status_code)

    def _read_json_body(self) -> Any:
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY_BYTES:
            raise AppError("请求体过大", status_code=413, code="PAYLOAD_TOO_LARGE")
        raw = self.rfile.read(length) if length else b""
        if not raw:
            return {}
        try:
            return json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError as exc:
            raise AppError("请求体不是合法 JSON", status_code=400, code="INVALID_JSON") from exc

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Access-Control-Allow-Origin", self._cors_origin())
        self.send_header("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def _send_static_file(self, file_path: Path) -> None:
        try:
            body = file_path.read_bytes()
        except OSError:
            self._send_json({"message": "Not Found"}, status=404)
            return

        content_type = mimetypes.guess_type(str(file_path))[0] or "application/octet-stream"
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache" if file_path.name == "index.html" else "public, max-age=31536000, immutable")
        self.end_headers()
        self.wfile.write(body)

    def _serve_static_asset(self, path: str) -> bool:
        if path.startswith("/api"):
            return False
        if not STATIC_DIR.exists():
            return False

        static_root = STATIC_DIR.resolve()
        requested = unquote(path).split("?", 1)[0].lstrip("/")
        if not requested or requested.endswith("/"):
            requested = "index.html"

        candidate = (static_root / requested).resolve()
        try:
            candidate.relative_to(static_root)
        except ValueError:
            self._send_json({"message": "Not Found"}, status=404)
            return True

        if not candidate.is_file():
            candidate = static_root / "index.html"
        if not candidate.is_file():
            return False

        self._send_static_file(candidate)
        return True

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        path = parsed.path
        try:
            if path == "/api/health":
                self._send_json({"ok": True, "service": "competitor-analysis-backend"})
                return
            if path == "/api/history":
                self._send_json({"items": read_records()})
                return
            match = re.fullmatch(r"/api/history/([^/]+)", path)
            if match:
                record_id = unquote(match.group(1))
                try:
                    record = read_record_by_id(record_id)
                except FileNotFoundError:
                    self._send_json({"message": "未找到历史记录"}, status=404)
                    return
                if not record:
                    self._send_json({"message": "未找到历史记录"}, status=404)
                    return
                self._send_json({"item": record})
                return
            if self._serve_static_asset(path):
                return
            self._send_json({"message": "Not Found"}, status=404)
        except Exception as error:
            self._send_error(error, "读取请求失败")

    def do_POST(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        path = parsed.path
        try:
            body = self._read_json_body()
            if path == "/api/analysis/stream":
                self._send_ndjson_headers()
                try:
                    run_full_analysis_stream(self._emit_ndjson_event, **(body or {}))
                except BrokenPipeError:
                    return
                except Exception as error:
                    self._emit_ndjson_event("analysis_error", {"message": getattr(error, "message", str(error)) or "分析失败"})
                return
            if path == "/api/analysis":
                record = run_full_analysis(**(body or {}))
                save_history_record(record)
                self._send_json({"ok": True, "item": record, "warnings": record.get("warnings") or []}, status=201)
                return
            if path == "/api/workflows/validate":
                self._send_json(run_input_validation_workflow(**(body or {})))
                return
            if path == "/api/workflows/company-name-validate":
                self._send_json(run_company_name_validation_workflow(**(body or {})))
                return
            if path == "/api/workflows/company-detail":
                self._send_json(run_company_detail_workflow(**(body or {})))
                return
            if path == "/api/workflows/compare-report":
                self._send_json(run_compare_report_workflow(**(body or {})))
                return
            if path == "/api/workflows/score":
                self._send_json(run_score_workflow(**(body or {})))
                return
            if path == "/api/history":
                record = save_history_record(body)
                self._send_json({"ok": True, "item": record}, status=201)
                return
            self._send_json({"message": "Not Found"}, status=404)
        except Exception as error:
            fallback = {
                "/api/analysis": "分析失败",
                "/api/workflows/validate": "输入校验失败",
                "/api/workflows/company-name-validate": "企业名称输入校验失败",
                "/api/workflows/company-detail": "企业详情请求失败",
                "/api/workflows/compare-report": "对比报告请求失败",
                "/api/workflows/score": "评分请求失败",
                "/api/history": "保存历史记录失败",
            }.get(path, "请求失败")
            self._send_error(error, fallback)

    def do_DELETE(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        path = parsed.path
        try:
            if path == "/api/history":
                clear_history_records()
                self._send_json({"ok": True})
                return
            match = re.fullmatch(r"/api/history/([^/]+)", path)
            if match:
                record_id = unquote(match.group(1))
                delete_history_record(record_id)
                self._send_json({"ok": True})
                return
            self._send_json({"message": "Not Found"}, status=404)
        except Exception as error:
            self._send_error(error, "删除历史记录失败")


def start() -> None:
    migrate_legacy_if_needed()
    httpd = ThreadingHTTPServer((HOST, PORT), ApiHandler)
    print(f"Backend server is running at http://{HOST}:{PORT}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()
        close_db_connection()


if __name__ == "__main__":
    try:
        start()
    except Exception as exc:
        print("Failed to start backend server:", exc, file=sys.stderr)
        traceback.print_exc()
        sys.exit(1)
