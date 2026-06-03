from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Mapping

from sqlalchemy import bindparam, text
from sqlalchemy.exc import SQLAlchemyError

from packages.py_common.db.session import get_engine

logger = logging.getLogger(__name__)

LEGACY_PIPT_RE = re.compile(r"\{\{__PIPT_[a-z_]+_\d+__\}\}")
STRONG_PIPT_RE = re.compile(r"@@PIPT:v1:e\d{6}:k[a-f0-9]{8}@@")
LEGACY_BIDDER_RE = re.compile(r"\{\{__BIDDER_[A-Z_]+__\}\}")
SUPPORTED_PLACEHOLDER_RE = re.compile(
    r"(?:\{\{__(?:PIPT_[a-z_]+_\d+|BIDDER_[A-Z_]+)__\}\}|@@PIPT:v1:e\d{6}:k[a-f0-9]{8}@@)"
)
ILLEGAL_PIPT_RE = re.compile(r"\{\{\s*PIPT_(\d+)\s*\}\}", re.IGNORECASE)
ILLEGAL_BIDDER_RE = re.compile(r"\{\{\s*BIDDER_([A-Z_]+)\s*\}\}")
MALFORMED_PIPT_RE = re.compile(
    r"\{\{\s*_*PIPT(?:[_\s-]+([a-z_]+))?[_\s-]+(\d+)_*\s*\}\}",
    re.IGNORECASE,
)
SUSPECT_PLACEHOLDER_RE = re.compile(
    r"\{\{[^{}]*(?:PIPT|BIDDER)[^{}]*\}\}|(?<!\{)\{[^{}]*(?:PIPT|BIDDER)[^{}]*\}(?!\})|@@[^@\s]*(?:PIPT|BIDDER)[^@\s]*@@?",
    re.IGNORECASE,
)
STRONG_BIDDER_FIELD_BY_TOKEN: dict[str, str] = {
    "@@PIPT:v1:e900001:kb1d0c001@@": "ORG",
    "@@PIPT:v1:e900002:kb1d0c002@@": "LEGAL_REP",
    "@@PIPT:v1:e900003:kb1d0c003@@": "LEAD",
    "@@PIPT:v1:e900004:kb1d0c004@@": "PHONE",
    "@@PIPT:v1:e900005:kb1d0c005@@": "DATE",
}


def resolve_body_placeholders_native(
    text_value: str,
    seed_replace_map: Mapping[str, str] | None,
    request_mapping: Mapping[str, Any] | None,
    *,
    audit_source: str = "apps_api.content_placeholder_resolve",
) -> tuple[str, dict[str, str], list[dict[str, str]]]:
    """还原正文中的 PIPT/BIDDER 占位符；入参为正文与请求映射，出参为替换后正文、合并映射和审计报告。"""
    merged: dict[str, str] = {str(key): _normalize_original_text(value) for key, value in dict(seed_replace_map or {}).items()}
    request_mapping_dict = dict(request_mapping or {})
    found = find_supported_placeholders(text_value)
    if found:
        _enrich_replace_map(found, merged, request_mapping_dict)
    out, report = apply_replace_map_to_text(text_value, merged, audit_source=audit_source)
    out, illegal_report = _resolve_illegal_placeholders(out, request_mapping_dict, audit_source=audit_source)
    if illegal_report:
        report.extend(illegal_report)
    unresolved = find_supported_placeholders(out)
    for token in sorted(unresolved):
        _write_resolve_audit(status="miss", source=audit_source, token=token, text_value=out, details={"reason": "supported_placeholder_unresolved"})
        report.append({"placeholder": token, "original": "", "status": "miss"})
    return out, merged, report


def find_illegal_pipt_bidder_placeholders_native(text_value: str) -> list[str]:
    if not text_value:
        return []
    illegal = {
        match.group(0)
        for match in SUSPECT_PLACEHOLDER_RE.finditer(text_value)
        if not SUPPORTED_PLACEHOLDER_RE.fullmatch(match.group(0))
    }
    return sorted(token for token in illegal if token.strip())


def find_supported_placeholders(text_value: str) -> set[str]:
    if not text_value:
        return set()
    return set(STRONG_PIPT_RE.findall(text_value) + LEGACY_PIPT_RE.findall(text_value) + LEGACY_BIDDER_RE.findall(text_value))


def apply_replace_map_to_text(
    text_value: str,
    replace_map: Mapping[str, str],
    *,
    audit_source: str,
) -> tuple[str, list[dict[str, str]]]:
    if not text_value or not replace_map:
        return text_value or "", []
    out = text_value
    report: list[dict[str, str]] = []
    for placeholder, original in replace_map.items():
        if placeholder not in out:
            continue
        out = out.replace(placeholder, original)
        report.append({"placeholder": placeholder, "original": original, "status": "success"})
        details = {"strategy": "exact_placeholder"}
        if placeholder in STRONG_BIDDER_FIELD_BY_TOKEN:
            details = {"strategy": "bidder_strong_placeholder", "field": STRONG_BIDDER_FIELD_BY_TOKEN[placeholder]}
        _write_resolve_audit(status="success", source=audit_source, token=placeholder, original=original, text_value=out, details=details)
    return out, report


def _enrich_replace_map(found: set[str], replace_map: dict[str, str], request_mapping: Mapping[str, Any]) -> None:
    for placeholder in found:
        if placeholder not in replace_map and placeholder in request_mapping:
            replace_map[placeholder] = _normalize_original_text(request_mapping[placeholder])

    pipt_missing = [
        placeholder
        for placeholder in found
        if (placeholder.startswith("{{__PIPT_") or STRONG_PIPT_RE.fullmatch(placeholder)) and placeholder not in replace_map
    ]
    if not pipt_missing:
        return

    db_mapping = _load_entity_registry_mapping(pipt_missing)
    replace_map.update(db_mapping)


def _load_entity_registry_mapping(placeholders: list[str]) -> dict[str, str]:
    legacy_placeholders = [item for item in placeholders if item.startswith("{{__PIPT_")]
    strong_placeholders = [item for item in placeholders if STRONG_PIPT_RE.fullmatch(item)]
    mapping: dict[str, str] = {}
    try:
        with get_engine().connect() as conn:
            exists = conn.execute(text("SELECT to_regclass('bid_generator.entity_registry') IS NOT NULL")).scalar_one()
            if not exists:
                return {}
            stmt = text(
                """
                SELECT placeholder, strong_placeholder, original_text_enc
                FROM bid_generator.entity_registry
                WHERE placeholder IN :legacy_placeholders
                   OR strong_placeholder IN :strong_placeholders
                """
            ).bindparams(
                bindparam("legacy_placeholders", expanding=True),
                bindparam("strong_placeholders", expanding=True),
            )
            rows = conn.execute(
                stmt,
                {
                    "legacy_placeholders": legacy_placeholders or ["__none__"],
                    "strong_placeholders": strong_placeholders or ["__none__"],
                },
            ).mappings().all()
    except (SQLAlchemyError, RuntimeError) as exc:
        logger.warning("PIPT 实体映射查询失败，保留未解析占位符并交由上层处理: %s", exc)
        return {}

    for row in rows:
        original = _normalize_original_text(_decrypt_original_text(str(row.get("original_text_enc") or "")))
        placeholder = str(row.get("placeholder") or "")
        strong_placeholder = str(row.get("strong_placeholder") or "")
        if placeholder in placeholders:
            mapping[placeholder] = original
        if strong_placeholder in placeholders:
            mapping[strong_placeholder] = original
    return mapping


def _resolve_illegal_placeholders(
    text_value: str,
    request_mapping: Mapping[str, Any],
    *,
    audit_source: str,
) -> tuple[str, list[dict[str, str]]]:
    if not text_value:
        return "", []

    indexed_mapping = _build_request_mapping_index(request_mapping)
    pipt_by_index, pipt_by_type_index, bidder_by_key, ambiguous_indexes = _build_request_mapping_suffix_index(request_mapping)
    report: list[dict[str, str]] = []

    def replace_illegal_pipt(match: re.Match[str]) -> str:
        token = match.group(0)
        index = match.group(1)
        if index in ambiguous_indexes:
            _write_resolve_audit(status="ambiguous", source=audit_source, token=token, text_value=text_value, details={"reason": "pipt_index_without_type", "index": index})
            return token
        original = pipt_by_index.get(index, "")
        if original:
            report.append({"placeholder": token, "original": original, "status": "success"})
            _write_resolve_audit(status="success", source=audit_source, token=token, original=original, text_value=text_value, details={"strategy": "unique_index", "index": index})
            return original
        _write_resolve_audit(status="miss", source=audit_source, token=token, text_value=text_value, details={"reason": "index_not_found", "index": index})
        return token

    def replace_malformed_pipt(match: re.Match[str]) -> str:
        token = match.group(0)
        if SUPPORTED_PLACEHOLDER_RE.fullmatch(token):
            return token
        entity_type = str(match.group(1) or "").lower()
        index = match.group(2)
        original = pipt_by_type_index.get(f"{entity_type}:{index}", "") if entity_type else ""
        strategy = "type_index" if original else "unique_index"
        if not original and not entity_type and index in ambiguous_indexes:
            _write_resolve_audit(status="ambiguous", source=audit_source, token=token, text_value=text_value, details={"reason": "malformed_pipt_index_without_type", "index": index})
            return token
        original = original or pipt_by_index.get(index, "")
        if original:
            report.append({"placeholder": token, "original": original, "status": "success"})
            _write_resolve_audit(status="success", source=audit_source, token=token, original=original, text_value=text_value, details={"strategy": strategy, "entity_type": entity_type, "index": index})
            return original
        _write_resolve_audit(status="miss", source=audit_source, token=token, text_value=text_value, details={"reason": "malformed_pipt_not_found", "entity_type": entity_type, "index": index})
        return token

    def replace_illegal_bidder(match: re.Match[str]) -> str:
        token = match.group(0)
        suffix = match.group(1)
        normalized = _normalize_placeholder_key(f"{{{{__BIDDER_{suffix}__}}}}")
        original = bidder_by_key.get(suffix, indexed_mapping.get(normalized, ""))
        if original:
            report.append({"placeholder": token, "original": original, "status": "success"})
            _write_resolve_audit(status="success", source=audit_source, token=token, original=original, text_value=text_value, details={"strategy": "bidder_key", "suffix": suffix})
            return original
        _write_resolve_audit(status="miss", source=audit_source, token=token, text_value=text_value, details={"reason": "bidder_key_not_found", "suffix": suffix})
        return token

    out = MALFORMED_PIPT_RE.sub(replace_malformed_pipt, text_value)
    out = ILLEGAL_PIPT_RE.sub(replace_illegal_pipt, out)
    out = ILLEGAL_BIDDER_RE.sub(replace_illegal_bidder, out)
    out = re.sub(r"[ \t]{2,}", " ", out)
    out = re.sub(r"\n{3,}", "\n\n", out).strip()
    return out, report


def _build_request_mapping_index(request_mapping: Mapping[str, Any]) -> dict[str, str]:
    indexed: dict[str, str] = {}
    for placeholder, original in dict(request_mapping or {}).items():
        normalized = _normalize_placeholder_key(str(placeholder))
        if normalized and normalized not in indexed:
            indexed[normalized] = _normalize_original_text(original)
    return indexed


def _build_request_mapping_suffix_index(request_mapping: Mapping[str, Any]) -> tuple[dict[str, str], dict[str, str], dict[str, str], set[str]]:
    pipt_index_candidates: dict[str, set[str]] = {}
    pipt_by_type_index: dict[str, str] = {}
    bidder_by_key: dict[str, str] = {}
    for placeholder, original in dict(request_mapping or {}).items():
        key = str(placeholder or "").strip()
        normalized = _normalize_original_text(original)
        pipt_match = re.search(r"\{\{__PIPT_([a-z_]+)_(\d+)__\}\}", key, flags=re.IGNORECASE)
        if pipt_match:
            entity_type = pipt_match.group(1).lower()
            index = pipt_match.group(2)
            pipt_by_type_index.setdefault(f"{entity_type}:{index}", normalized)
            pipt_index_candidates.setdefault(index, set()).add(normalized)
            continue
        bidder_match = re.search(r"\{\{__BIDDER_([A-Z_]+)__\}\}", key)
        if bidder_match and bidder_match.group(1) not in bidder_by_key:
            bidder_by_key[bidder_match.group(1)] = normalized
            continue
        strong_bidder_key = STRONG_BIDDER_FIELD_BY_TOKEN.get(key)
        if strong_bidder_key and strong_bidder_key not in bidder_by_key:
            bidder_by_key[strong_bidder_key] = normalized
    unique_by_index = {index: next(iter(values)) for index, values in pipt_index_candidates.items() if len(values) == 1}
    ambiguous_indexes = {index for index, values in pipt_index_candidates.items() if len(values) > 1}
    return unique_by_index, pipt_by_type_index, bidder_by_key, ambiguous_indexes


def _write_resolve_audit(
    *,
    status: str,
    source: str,
    token: str,
    original: str = "",
    text_value: str = "",
    details: Mapping[str, Any] | None = None,
) -> None:
    try:
        with get_engine().begin() as conn:
            exists = conn.execute(text("SELECT to_regclass('bid_generator.pipt_audit_logs') IS NOT NULL")).scalar_one()
            if not exists:
                return
            conn.execute(
                text(
                    """
                    INSERT INTO bid_generator.pipt_audit_logs (
                        id, operation, status, source, placeholder,
                        original_hash, text_hash, details, created_at
                    )
                    VALUES (
                        :id, 'resolve', :status, :source, :placeholder,
                        :original_hash, :text_hash, CAST(:details AS jsonb), :created_at
                    )
                    """
                ),
                {
                    "id": uuid.uuid4().hex,
                    "status": str(status or "unknown")[:100],
                    "source": str(source or "")[:200],
                    "placeholder": token or None,
                    "original_hash": _hash_audit_text(original) or None,
                    "text_hash": _hash_audit_text(text_value) or None,
                    "details": json.dumps(dict(details or {}), ensure_ascii=False),
                    "created_at": datetime.now(timezone.utc),
                },
            )
    except (SQLAlchemyError, RuntimeError) as exc:
        logger.warning("PIPT resolve 审计日志写入失败: %s", exc)


def _normalize_original_text(value: Any) -> str:
    text_value = str(value or "").strip()
    if text_value.startswith("**") and text_value.endswith("**") and len(text_value) > 4:
        text_value = text_value[2:-2].strip()
    text_value = re.sub(r"[ \t\r\f\v]+", " ", text_value)
    return text_value.strip()


def _normalize_placeholder_key(value: str) -> str:
    return re.sub(r"[^A-Z0-9_]+", "", str(value or "").strip().upper())


def _decrypt_original_text(value: str) -> str:
    raw_key = os.environ.get("PIPT_DB_KEY", "")
    if not raw_key:
        return value
    try:
        from cryptography.fernet import Fernet

        return Fernet(raw_key.encode() if isinstance(raw_key, str) else raw_key).decrypt(value.encode("ascii")).decode("utf-8")
    except Exception:
        return value


def _hash_audit_text(value: Any) -> str:
    text_value = str(value or "")
    return hashlib.sha256(text_value.encode("utf-8")).hexdigest() if text_value else ""
