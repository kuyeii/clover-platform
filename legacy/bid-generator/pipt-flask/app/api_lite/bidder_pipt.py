# -*- coding: utf-8 -*-
"""投标人配置的 PIPT 实体归一化。"""
from __future__ import annotations

import logging
from typing import Any

from sqlalchemy import func, text as sql_text
from sqlalchemy.orm import Session

from .database import EntityRegistry, FernetEncryptor, make_entity_key
from .pipt_protocol import build_placeholder_policy, make_stable_strong_pipt_token

logger = logging.getLogger(__name__)


BIDDER_FIELD_SPECS: tuple[tuple[str, str, str], ...] = (
    ("orgName", "org", "投标单位名称"),
    ("legalRep", "name", "法定代表人"),
    ("projectLead", "name", "项目负责人"),
    ("phone", "phone", "联系电话"),
)

REQUIRED_BIDDER_FIELDS: tuple[tuple[str, str], ...] = (
    ("orgName", "投标单位全称"),
    ("legalRep", "法定代表人"),
    ("projectLead", "项目负责人"),
    ("phone", "联系电话"),
)


class BidderInfoRequiredError(ValueError):
    """正文生成前缺少必填投标人配置。"""

    def __init__(self, missing_fields: list[str]):
        self.missing_fields = missing_fields
        super().__init__(f"正文生成前必须先配置投标人信息：{', '.join(missing_fields)}")


def validate_required_bidder_info(bidder_info: dict[str, Any] | None) -> None:
    """校验正文生成必需的投标人配置字段。"""
    if not isinstance(bidder_info, dict):
        raise BidderInfoRequiredError([label for _, label in REQUIRED_BIDDER_FIELDS])
    missing = [
        label
        for key, label in REQUIRED_BIDDER_FIELDS
        if not _normalize_bidder_value(bidder_info.get(key))
    ]
    if missing:
        raise BidderInfoRequiredError(missing)


def normalize_bidder_info_to_pipt(
    bidder_info: dict[str, Any] | None,
    db: Session,
) -> dict[str, Any]:
    """
    将用户配置的投标人信息登记到全局实体库，并返回可供工作流使用的 token 上下文。

    入参:
    - bidder_info: 前端项目配置中的投标人字段。
    - db: 当前请求数据库会话。

    出参:
    - mapping_table: token 到本地明文的映射，仅用于服务端回填，禁止直接上传外部模型。
    - placeholder_manifest: 发给外部模型的非敏感 token 语义说明。
    - placeholder_hint: 发给 Dify 的占位符使用规则，不包含明文。
    """
    if not isinstance(bidder_info, dict):
        return _empty_result()

    mapping_table: dict[str, str] = {}
    manifest: dict[str, dict[str, str]] = {}
    field_tokens: list[dict[str, str]] = []

    for field_key, entity_type, role in BIDDER_FIELD_SPECS:
        original = _normalize_bidder_value(bidder_info.get(field_key))
        if not original:
            continue
        token = _upsert_bidder_entity(db, original, entity_type)
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

    doc_date = _normalize_bidder_value(bidder_info.get("docDate"))
    if doc_date:
        # 日期不参与实体库匹配，避免把普通编制日期误注册为可跨知识库关联的敏感实体。
        token = "@@PIPT:v1:e900005:kb1d0c005@@"
        mapping_table[token] = doc_date
        manifest[token] = {
            "entity_type": "bidder_field",
            "role": "文件编制日期",
            "usage_hint": "作为文件编制日期使用，必须原样保留 token。",
            "source": "bidder_config",
            "bidder_field": "docDate",
        }
        field_tokens.append({"field": "docDate", "role": "文件编制日期", "token": token})

    return {
        "mapping_table": mapping_table,
        "placeholder_manifest": manifest,
        "placeholder_policy": build_placeholder_policy(),
        "placeholder_hint": build_bidder_placeholder_hint(field_tokens),
        "fields": field_tokens,
    }


def merge_bidder_pipt_context(
    *,
    mapping_table: dict[str, str] | None,
    placeholder_hint: str | None,
    bidder_info: dict[str, Any] | None,
    db: Session,
) -> tuple[dict[str, str], str, dict[str, Any]]:
    """合并请求已有脱敏上下文与投标人归一化上下文。"""
    base_mapping = dict(mapping_table or {})
    base_hint = str(placeholder_hint or "").strip()
    bidder_context = normalize_bidder_info_to_pipt(bidder_info, db)
    bidder_mapping = bidder_context.get("mapping_table") or {}
    if bidder_mapping:
        base_mapping.update({str(k): str(v) for k, v in bidder_mapping.items()})
    bidder_hint = str(bidder_context.get("placeholder_hint") or "").strip()
    merged_hint = "\n\n".join(part for part in (base_hint, bidder_hint) if part)
    return base_mapping, merged_hint, bidder_context


def build_bidder_placeholder_hint(field_tokens: list[dict[str, str]]) -> str:
    """生成给外部模型的投标人 token 使用说明，不包含任何明文。"""
    rows = [
        f"{item['role']}：{item['token']}"
        for item in field_tokens
        if item.get("role") and item.get("token")
    ]
    if not rows:
        return ""
    return "\n".join([
        "【投标人信息占位符使用规则（重要）】",
        "以下 token 来自用户配置的投标人信息，并已和本地脱敏实体库统一匹配。",
        "仅在章节内容自然需要出现投标单位、负责人、联系电话等称谓时引用，不要强行插入。",
        "如果知识库检索内容出现相同 token，可视为同一脱敏实体；输出必须逐字保留 token。",
        *[f"  {row}" for row in rows],
    ])


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


def _upsert_bidder_entity(db: Session, original: str, entity_type: str) -> str:
    ekey = make_entity_key(original, entity_type)
    row = db.query(EntityRegistry).filter(EntityRegistry.entity_key == ekey).first()
    if row:
        row.hit_count = (row.hit_count or 0) + 1
        if not row.strong_placeholder:
            row.strong_placeholder = make_stable_strong_pipt_token(ekey, entity_type)
        db.flush()
        return str(row.strong_placeholder or row.placeholder or "")

    db.execute(
        sql_text("SELECT pg_advisory_xact_lock(hashtext(:lock_key))"),
        {"lock_key": f"bid_generator.entity_registry.{entity_type}"},
    )
    row = db.query(EntityRegistry).filter(EntityRegistry.entity_key == ekey).first()
    if row:
        row.hit_count = (row.hit_count or 0) + 1
        if not row.strong_placeholder:
            row.strong_placeholder = make_stable_strong_pipt_token(ekey, entity_type)
        db.flush()
        return str(row.strong_placeholder or row.placeholder or "")

    next_idx = (
        db.query(func.max(EntityRegistry.global_index))
        .filter(EntityRegistry.entity_type == entity_type)
        .scalar()
        or 0
    ) + 1
    legacy_placeholder = f"{{{{__PIPT_{entity_type}_{next_idx}__}}}}"
    strong_placeholder = make_stable_strong_pipt_token(ekey, entity_type)
    db.add(EntityRegistry(
        entity_key=ekey,
        entity_type=entity_type,
        original_text_enc=FernetEncryptor.get().encrypt(original),
        placeholder=legacy_placeholder,
        strong_placeholder=strong_placeholder,
        global_index=next_idx,
    ))
    db.flush()
    logger.info("投标人配置已登记到 PIPT 实体库: entity_type=%s index=%s", entity_type, next_idx)
    return strong_placeholder
