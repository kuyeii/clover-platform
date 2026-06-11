"""PIPT 占位符协议工具：兼容旧 token，并提供强 token / manifest / policy。"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
from typing import Any


LEGACY_PIPT_PATTERN = r"\{\{__PIPT_[a-z_]+_\d+__\}\}"
BIDDER_PATTERN = r"\{\{__BIDDER_[A-Z_]+__\}\}"
STRONG_PIPT_PATTERN = r"@@PIPT:v1:e\d{6}:k[a-f0-9]{8}@@"

LEGACY_PIPT_RE = re.compile(LEGACY_PIPT_PATTERN)
BIDDER_RE = re.compile(BIDDER_PATTERN)
STRONG_PIPT_RE = re.compile(STRONG_PIPT_PATTERN)
SUPPORTED_PLACEHOLDER_RE = re.compile(
    rf"(?:{LEGACY_PIPT_PATTERN}|{BIDDER_PATTERN}|{STRONG_PIPT_PATTERN})"
)

ENTITY_ROLE_LABELS = {
    "name": "自然人姓名",
    "phone": "联系电话",
    "id_number": "身份证件号",
    "email": "邮箱地址",
    "addr": "地址",
    "bank": "银行卡号",
    "car_id": "车牌号",
    "ip": "IP 地址",
    "org": "机构名称",
    "credit_code": "统一社会信用代码",
    "bidder_field": "投标人信息",
}

STRONG_BIDDER_TOKENS = {
    "@@PIPT:v1:e900001:kb1d0c001@@",
    "@@PIPT:v1:e900002:kb1d0c002@@",
    "@@PIPT:v1:e900003:kb1d0c003@@",
    "@@PIPT:v1:e900004:kb1d0c004@@",
    "@@PIPT:v1:e900005:kb1d0c005@@",
}


def pipt_token_secret() -> str:
    """返回 strong token 派生密钥；未配置时退化为开发密钥，不参与明文泄露。"""
    return os.environ.get("PIPT_TOKEN_SECRET") or os.environ.get("PIPT_DB_KEY") or "pipt-dev-token-secret"


def _stable_entity_index(entity_key: str, entity_type: str) -> int:
    """从实体指纹派生 6 位稳定索引，避免无状态脱敏时同一实体被重复编号。"""
    raw = f"v1|entity-index|{entity_type}|{entity_key}".encode("utf-8")
    digest = hmac.new(pipt_token_secret().encode("utf-8"), raw, hashlib.sha256).hexdigest()
    return int(digest[:12], 16) % 999999 + 1


def make_strong_pipt_token(entity_index: int, entity_key: str, entity_type: str) -> str:
    """生成不携带实体类型和明文的 PIPT strong token。"""
    idx = max(0, int(entity_index or 0))
    raw = f"v1|{idx:06d}|{entity_key}|{entity_type}".encode("utf-8")
    digest = hmac.new(pipt_token_secret().encode("utf-8"), raw, hashlib.sha256).hexdigest()[:8]
    return f"@@PIPT:v1:e{idx:06d}:k{digest}@@"


def make_stable_strong_pipt_token(
    entity_key: str,
    entity_type: str,
    *,
    text_hash: str = "",
    salt: str = "",
) -> str:
    """按实体稳定派生 strong token；签名段额外绑定文本 hash 和可选盐。"""
    idx = _stable_entity_index(entity_key, entity_type)
    raw = f"v1|stable|{idx:06d}|{entity_key}|{entity_type}|{text_hash}|{salt}".encode("utf-8")
    digest = hmac.new(pipt_token_secret().encode("utf-8"), raw, hashlib.sha256).hexdigest()[:8]
    return f"@@PIPT:v1:e{idx:06d}:k{digest}@@"


def is_strong_pipt_token(value: str) -> bool:
    return bool(STRONG_PIPT_RE.fullmatch(str(value or "").strip()))


def find_supported_placeholders(text: str) -> set[str]:
    if not text:
        return set()
    return set(SUPPORTED_PLACEHOLDER_RE.findall(text))


def build_placeholder_policy() -> dict[str, Any]:
    """生成给外部工作流的非敏感占位符策略。"""
    return {
        "protocol": "pipt",
        "version": "v1",
        "preserve_exact": True,
        "supported_formats": [
            "@@PIPT:v1:e000001:k1a2b3c4d@@",
            "{{__PIPT_name_1__}}",
        ],
        "rules": [
            "占位符是本地脱敏 token，不代表可改写文本。",
            "输出时必须逐字保留完整 token。",
            "禁止翻译、缩写、拆分、补全或重新编号 token。",
            "禁止把 token 改成 {{PIPT_1}}、{PIPT_1} 或其他近似格式。",
        ],
    }


def build_placeholder_manifest(
    mapping_table: dict[str, Any] | None,
    entity_types: dict[str, str] | None = None,
    entity_contexts: dict[str, dict[str, str]] | None = None,
) -> dict[str, dict[str, str]]:
    """从 mapping_table 生成占位符 manifest；正文生成链路允许携带 token 对齐的原文上下文。"""
    manifest: dict[str, dict[str, str]] = {}
    if not isinstance(mapping_table, dict):
        return manifest
    entity_types = entity_types if isinstance(entity_types, dict) else {}
    entity_contexts = entity_contexts if isinstance(entity_contexts, dict) else {}
    for placeholder in mapping_table:
        token = str(placeholder or "").strip()
        if not token:
            continue
        entity_type = str(entity_types.get(token) or "").strip().lower() or "unknown"
        legacy_match = re.search(r"\{\{__PIPT_([a-z_]+)_\d+__\}\}", token, flags=re.IGNORECASE)
        if legacy_match:
            entity_type = legacy_match.group(1).lower()
        elif token in STRONG_BIDDER_TOKENS:
            entity_type = "bidder_field"
        elif is_strong_pipt_token(token) and entity_type == "unknown":
            entity_type = "sensitive_entity"
        elif token.startswith("{{__BIDDER_"):
            entity_type = "bidder_field"
        role = ENTITY_ROLE_LABELS.get(entity_type, "敏感实体")
        row = {
            "entity_type": entity_type,
            "role": role,
            "usage_hint": f"作为{role}使用，必须原样保留 token。",
        }
        context_meta = entity_contexts.get(token) or {}
        for key in ("source_context", "source_context_with_token"):
            value = str(context_meta.get(key) or "").strip()
            if value:
                row[key] = value
        manifest[token] = row
    return manifest


def build_placeholder_hint(mapping_table: dict[str, Any] | None) -> str:
    """生成 Dify 可读的占位符说明；禁止携带明文 original。"""
    manifest = build_placeholder_manifest(mapping_table)
    if not manifest:
        return ""
    tokens = list(manifest.keys())
    sample = "、".join(tokens[:8])
    suffix = " ..." if len(tokens) > 8 else ""
    context_rows = [
        {
            key: value
            for key, value in {
                "token": token,
                "entity_type": manifest.get(token, {}).get("entity_type", ""),
                "role": manifest.get(token, {}).get("role", ""),
            }.items()
            if str(value or "").strip()
        }
        for token in tokens[:80]
    ]
    return (
        f"文中含 {len(tokens)} 个本地脱敏占位符，统一使用 @@PIPT:v1:e000001:kxxxxxxxx@@ 强 token 样式，"
        "兼容历史 {{__PIPT_类型_序号__}} 格式。"
        "这些 token 只代表安全语义，不包含真实敏感值；输出必须逐字原样保留，禁止改写、缩写、翻译、拆分或重新编号。"
        "可以参考 PIPT_TOKEN_CONTEXT_JSON 理解每个 token 的实体类型；引用时必须输出 token 本身。"
        f"\nPIPT_ALLOWED_PLACEHOLDERS_JSON:{json.dumps(tokens, ensure_ascii=False)}\n"
        f"PIPT_TOKEN_CONTEXT_JSON:{json.dumps(context_rows, ensure_ascii=False)}\n"
        f"当前 token 示例：{sample}{suffix}"
    )
