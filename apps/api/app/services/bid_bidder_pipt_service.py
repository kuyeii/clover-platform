from __future__ import annotations

import hashlib
import hmac
import logging
import os
from typing import Any, Mapping

from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.core.errors import PlatformError
from app.services.pipt_gateway_service import build_placeholder_policy
from packages.py_common.db.session import get_engine


logger = logging.getLogger(__name__)

BIDDER_FIELD_SPECS: tuple[tuple[str, str, str], ...] = (
    ("orgName", "org", "投标单位名称"),
    ("legalRep", "name", "法定代表人"),
    ("projectLead", "name", "项目负责人"),
    ("phone", "phone", "联系电话"),
)
DOC_DATE_TOKEN = "@@PIPT:v1:e900005:kb1d0c005@@"


def normalize_bidder_pipt_payload(body: Mapping[str, Any]) -> dict[str, Any]:
    """投标人配置归一化；入参为 bidder_info，出参保持 legacy normalize-pipt 契约。"""
    bidder_info = body.get("bidder_info") if isinstance(body, Mapping) else {}
    if not isinstance(bidder_info, Mapping):
        return _empty_result()

    mapping_table: dict[str, str] = {}
    manifest: dict[str, dict[str, str]] = {}
    field_tokens: list[dict[str, str]] = []

    try:
        with get_engine().begin() as conn:
            for field_key, entity_type, role in BIDDER_FIELD_SPECS:
                original = _normalize_bidder_value(bidder_info.get(field_key))
                if not original:
                    continue
                token = _upsert_bidder_entity(conn, original, entity_type)
                if not token:
                    continue
                mapping_table[token] = original
                manifest[token] = {
                    "entity_type": entity_type,
                    "role": role,
                    "usage_hint": f"作为{role}使用，必须原样保留 token。",
                    "source": "bidder_config",
                    "bidder_field": field_key,
                }
                field_tokens.append({"field": field_key, "role": role, "token": token})
    except PlatformError:
        raise
    except (RuntimeError, SQLAlchemyError) as exc:
        logger.error("投标人信息 PIPT 归一化失败: %s", exc, exc_info=True)
        raise PlatformError(code="DATABASE_ERROR", message="投标人信息脱敏匹配失败。", status_code=500) from exc

    doc_date = _normalize_bidder_value(bidder_info.get("docDate"))
    if doc_date:
        # 编制日期不是跨知识库敏感实体，不写入全局实体库，保持 legacy 固定 token。
        mapping_table[DOC_DATE_TOKEN] = doc_date
        manifest[DOC_DATE_TOKEN] = {
            "entity_type": "bidder_field",
            "role": "文件编制日期",
            "usage_hint": "作为文件编制日期使用，必须原样保留 token。",
            "source": "bidder_config",
            "bidder_field": "docDate",
        }
        field_tokens.append({"field": "docDate", "role": "文件编制日期", "token": DOC_DATE_TOKEN})

    return {
        "mapping_table": mapping_table,
        "placeholder_manifest": manifest,
        "placeholder_policy": build_placeholder_policy(),
        "placeholder_hint": _build_bidder_placeholder_hint(field_tokens),
        "fields": field_tokens,
    }


def _upsert_bidder_entity(conn: Any, original: str, entity_type: str) -> str:
    entity_key = _make_entity_key(original, entity_type)
    existing = _select_entity_by_key(conn, entity_key)
    if existing:
        strong_placeholder = str(existing.get("strong_placeholder") or "") or _make_stable_strong_pipt_token(
            entity_key,
            entity_type,
        )
        conn.execute(
            text(
                """
                UPDATE bid_generator.entity_registry
                SET hit_count = COALESCE(hit_count, 0) + 1,
                    strong_placeholder = COALESCE(strong_placeholder, :strong_placeholder)
                WHERE entity_key = :entity_key
                """
            ),
            {"entity_key": entity_key, "strong_placeholder": strong_placeholder},
        )
        return strong_placeholder or str(existing.get("placeholder") or "")

    _lock_entity_type(conn, entity_type)
    existing = _select_entity_by_key(conn, entity_key)
    if existing:
        strong_placeholder = str(existing.get("strong_placeholder") or "") or _make_stable_strong_pipt_token(
            entity_key,
            entity_type,
        )
        conn.execute(
            text(
                """
                UPDATE bid_generator.entity_registry
                SET hit_count = COALESCE(hit_count, 0) + 1,
                    strong_placeholder = COALESCE(strong_placeholder, :strong_placeholder)
                WHERE entity_key = :entity_key
                """
            ),
            {"entity_key": entity_key, "strong_placeholder": strong_placeholder},
        )
        return strong_placeholder or str(existing.get("placeholder") or "")

    next_index = int(
        conn.execute(
            text(
                """
                SELECT COALESCE(MAX(global_index), 0) + 1
                FROM bid_generator.entity_registry
                WHERE entity_type = :entity_type
                """
            ),
            {"entity_type": entity_type},
        ).scalar_one()
    )
    legacy_placeholder = f"{{{{__PIPT_{entity_type}_{next_index}__}}}}"
    strong_placeholder = _make_stable_strong_pipt_token(entity_key, entity_type)
    conn.execute(
        text(
            """
            INSERT INTO bid_generator.entity_registry (
                entity_key,
                entity_type,
                original_text_enc,
                placeholder,
                strong_placeholder,
                global_index
            )
            VALUES (
                :entity_key,
                :entity_type,
                :original_text_enc,
                :placeholder,
                :strong_placeholder,
                :global_index
            )
            """
        ),
        {
            "entity_key": entity_key,
            "entity_type": entity_type,
            "original_text_enc": _encrypt_original_text(original),
            "placeholder": legacy_placeholder,
            "strong_placeholder": strong_placeholder,
            "global_index": next_index,
        },
    )
    logger.info("投标人配置已登记到 PIPT 实体库: entity_type=%s index=%s", entity_type, next_index)
    return strong_placeholder


def _select_entity_by_key(conn: Any, entity_key: str) -> Mapping[str, Any] | None:
    row = conn.execute(
        text(
            """
            SELECT placeholder, strong_placeholder
            FROM bid_generator.entity_registry
            WHERE entity_key = :entity_key
            """
        ),
        {"entity_key": entity_key},
    ).mappings().first()
    return row if isinstance(row, Mapping) else None


def _lock_entity_type(conn: Any, entity_type: str) -> None:
    conn.execute(
        text("SELECT pg_advisory_xact_lock(hashtext(:lock_key))"),
        {"lock_key": f"bid_generator.entity_registry.{entity_type}"},
    )


def _build_bidder_placeholder_hint(field_tokens: list[dict[str, str]]) -> str:
    rows = [f"{item['role']}：{item['token']}" for item in field_tokens if item.get("role") and item.get("token")]
    if not rows:
        return ""
    return "\n".join(
        [
            "【投标人信息占位符使用规则（重要）】",
            "以下 token 来自用户配置的投标人信息，并已和本地脱敏实体库统一匹配。",
            "仅在章节内容自然需要出现投标单位、负责人、联系电话等称谓时引用，不要强行插入。",
            "如果知识库检索内容出现相同 token，可视为同一脱敏实体；输出必须逐字保留 token。",
            *[f"  {row}" for row in rows],
        ]
    )


def _normalize_bidder_value(value: Any) -> str:
    return str(value or "").strip()


def _empty_result() -> dict[str, Any]:
    return {
        "mapping_table": {},
        "placeholder_manifest": {},
        "placeholder_policy": build_placeholder_policy(),
        "placeholder_hint": "",
        "fields": [],
    }


def _make_entity_key(original_text: str, entity_type: str) -> str:
    raw = f"{original_text}|{entity_type}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _pipt_token_secret() -> str:
    return os.environ.get("PIPT_TOKEN_SECRET") or os.environ.get("PIPT_DB_KEY") or "pipt-dev-token-secret"


def _stable_entity_index(entity_key: str, entity_type: str) -> int:
    raw = f"v1|entity-index|{entity_type}|{entity_key}".encode("utf-8")
    digest = hmac.new(_pipt_token_secret().encode("utf-8"), raw, hashlib.sha256).hexdigest()
    return int(digest[:12], 16) % 999999 + 1


def _make_stable_strong_pipt_token(entity_key: str, entity_type: str) -> str:
    index = _stable_entity_index(entity_key, entity_type)
    raw = f"v1|stable|{index:06d}|{entity_key}|{entity_type}||".encode("utf-8")
    digest = hmac.new(_pipt_token_secret().encode("utf-8"), raw, hashlib.sha256).hexdigest()[:8]
    return f"@@PIPT:v1:e{index:06d}:k{digest}@@"


def _encrypt_original_text(value: str) -> str:
    raw_key = os.environ.get("PIPT_DB_KEY", "")
    env = os.environ.get("PIPT_ENV", "").strip().lower()
    if env in {"prod", "production"} and not raw_key:
        raise PlatformError(
            code="CONFIGURATION_ERROR",
            message="生产环境必须配置 PIPT_DB_KEY，禁止投标人实体明文落库。",
            status_code=500,
            details={"env": "PIPT_DB_KEY"},
        )
    if not raw_key:
        return value
    from cryptography.fernet import Fernet

    return Fernet(raw_key.encode() if isinstance(raw_key, str) else raw_key).encrypt(value.encode("utf-8")).decode("ascii")
