from __future__ import annotations

import re
import os
from typing import Any, Mapping

from app.core.errors import PlatformError
from app.services.pipt_recognition_adapter import desensitize_with_platform_recognizer
from packages.py_common.db.session import get_engine
from sqlalchemy import bindparam, text

DEFAULT_TARGET_ENTITIES = ["name", "phone", "id_number", "email", "addr", "bank", "car_id", "ip", "org", "credit_code"]
STRONG_PIPT_RE = re.compile(r"@@PIPT:v1:e\d{6}:k[a-f0-9]{8}@@")
LEGACY_PIPT_RE = re.compile(r"\{\{__PIPT_[a-z_]+_\d+__\}\}")


def recognize_payload(body: Mapping[str, Any]) -> dict[str, Any]:
    """标书 PIPT 识别兼容接口；入参为 text/target_entities，出参保持 legacy recognize 结构。"""
    text_value = _required_text(body)
    target_entities = _target_entities(body.get("target_entities"))
    result = desensitize_with_platform_recognizer(
        text=text_value,
        target_entities=target_entities,
        method="placeholder",
        placeholder_protocol=str(body.get("placeholder_protocol") or "strong"),
        llm_mode=_optional_string(body.get("llm_mode")),
        audit_context={"source": "apps_api.bid_pipt.recognize", "session_id": _optional_string(body.get("session_id"))},
    )
    entities = _entity_items(getattr(result, "entities", []) or [])
    return {"entities": entities, "entity_count": len(entities)}


def desensitize_payload(body: Mapping[str, Any]) -> dict[str, Any]:
    """标书 PIPT 脱敏兼容接口；入参兼容 legacy desensitize，出参保持 legacy 字段。"""
    return _desensitize_single(body, source="apps_api.bid_pipt.desensitize")


def batch_desensitize_payload(body: Mapping[str, Any]) -> dict[str, Any]:
    """标书 PIPT 批量脱敏兼容接口；入参兼容 legacy desensitize/batch，出参保持 legacy 字段。"""
    texts = body.get("texts")
    if not isinstance(texts, list):
        raise PlatformError(code="INVALID_REQUEST", message="texts 必须是数组。", status_code=400)
    results = [
        _desensitize_single({**dict(body), "text": str(text or "")}, source="apps_api.bid_pipt.desensitize_batch")
        for text in texts
    ]
    return {
        "results": results,
        "total_entity_count": sum(int(item.get("entity_count") or 0) for item in results),
    }


def restore_payload(body: Mapping[str, Any]) -> dict[str, Any]:
    """标书 PIPT 还原兼容接口；入参为 session_id/text，出参保持 legacy restore 结构。"""
    text_value = _required_text(body)
    session_id = str(body.get("session_id") or "").strip()
    if not session_id:
        raise PlatformError(code="INVALID_REQUEST", message="session_id 不能为空。", status_code=400)

    placeholders = _find_supported_placeholders(text_value)
    if not placeholders:
        return {"restored_text": text_value, "restored_count": 0}

    mapping = _load_restore_mapping(session_id=session_id, placeholders=placeholders)

    restored_text = text_value
    restored_count = 0
    for placeholder, original in mapping.items():
        if placeholder in restored_text:
            restored_text = restored_text.replace(placeholder, original)
            restored_count += 1
    return {"restored_text": restored_text, "restored_count": restored_count}


def _find_supported_placeholders(text_value: str) -> list[str]:
    seen: set[str] = set()
    placeholders: list[str] = []
    for pattern in (STRONG_PIPT_RE, LEGACY_PIPT_RE):
        for match in pattern.finditer(text_value):
            token = match.group(0)
            if token not in seen:
                seen.add(token)
                placeholders.append(token)
    return placeholders


def _load_restore_mapping(*, session_id: str, placeholders: list[str]) -> dict[str, str]:
    legacy_placeholders = [item for item in placeholders if item.startswith("{{__PIPT_")]
    strong_placeholders = [item for item in placeholders if STRONG_PIPT_RE.fullmatch(item)]
    mapping: dict[str, str] = {}
    engine = get_engine()
    with engine.connect() as conn:
        if legacy_placeholders or strong_placeholders:
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
            for row in rows:
                original = _decrypt_original_text(str(row.get("original_text_enc") or ""))
                placeholder = str(row.get("placeholder") or "")
                strong_placeholder = str(row.get("strong_placeholder") or "")
                if placeholder in placeholders:
                    mapping[placeholder] = original
                if strong_placeholder in placeholders:
                    mapping[strong_placeholder] = original

        missing = [placeholder for placeholder in placeholders if placeholder not in mapping]
        if missing:
            stmt = text(
                """
                SELECT placeholder, original_text
                FROM bid_generator.mapping_records
                WHERE session_id = :session_id
                  AND placeholder IN :placeholders
                """
            ).bindparams(bindparam("placeholders", expanding=True))
            rows = conn.execute(
                stmt,
                {"session_id": session_id, "placeholders": missing},
            ).mappings().all()
            for row in rows:
                mapping[str(row.get("placeholder") or "")] = str(row.get("original_text") or "")
    return mapping


def _decrypt_original_text(value: str) -> str:
    raw_key = os.environ.get("PIPT_DB_KEY", "")
    if not raw_key:
        return value
    try:
        from cryptography.fernet import Fernet

        return Fernet(raw_key.encode() if isinstance(raw_key, str) else raw_key).decrypt(value.encode("ascii")).decode("utf-8")
    except Exception:
        return value


def _desensitize_single(body: Mapping[str, Any], *, source: str) -> dict[str, Any]:
    text_value = _required_text(body)
    target_entities = _target_entities(body.get("target_entities"))
    method = str(body.get("method") or "placeholder")
    placeholder_protocol = str(body.get("placeholder_protocol") or "strong")
    result = desensitize_with_platform_recognizer(
        text=text_value,
        target_entities=target_entities,
        method=method,
        placeholder_protocol=placeholder_protocol,
        llm_mode=_optional_string(body.get("llm_mode")),
        audit_context={"source": source, "session_id": _optional_string(body.get("session_id"))},
    )
    return {
        "desensitized_text": str(getattr(result, "desensitized_text", "") or ""),
        "mapping_table": dict(getattr(result, "mapping_table", {}) or {}),
        "entities": _entity_items(getattr(result, "entities", []) or []),
        "entity_count": int(getattr(result, "entity_count", 0) or 0),
        "placeholder_manifest": dict(getattr(result, "placeholder_manifest", {}) or {}),
        "placeholder_policy": dict(getattr(result, "placeholder_policy", {}) or {}),
    }


def _required_text(body: Mapping[str, Any]) -> str:
    text_value = str(body.get("text") or "")
    if not text_value:
        raise PlatformError(code="INVALID_REQUEST", message="text 不能为空。", status_code=400)
    return text_value


def _target_entities(value: Any) -> list[str]:
    if not isinstance(value, list):
        return DEFAULT_TARGET_ENTITIES
    items = [str(item).strip() for item in value if str(item).strip()]
    return items or DEFAULT_TARGET_ENTITIES


def _optional_string(value: Any) -> str | None:
    if value is None:
        return None
    text_value = str(value).strip()
    return text_value or None


def _entity_items(entities: Any) -> list[dict[str, Any]]:
    if not isinstance(entities, list):
        return []
    items: list[dict[str, Any]] = []
    for entity in entities:
        if isinstance(entity, Mapping):
            raw = dict(entity)
        else:
            raw = {
                "text": getattr(entity, "text", ""),
                "entity_type": getattr(entity, "entity_type", ""),
                "start": getattr(entity, "start", 0),
                "end": getattr(entity, "end", 0),
                "source": getattr(entity, "source", "unknown"),
                "confidence": getattr(entity, "confidence", 0.0),
                "reason": getattr(entity, "reason", ""),
            }
        text_value = str(raw.get("text") or "")
        items.append({
            "text": text_value,
            "entity_type": str(raw.get("entity_type") or _infer_entity_type(raw) or "unknown"),
            "start": _int_value(raw.get("start")),
            "end": _int_value(raw.get("end"), default=len(text_value)),
            "source": str(raw.get("source") or "unknown"),
            "confidence": _float_value(raw.get("confidence")),
            "reason": str(raw.get("reason") or ""),
        })
    return items


def _infer_entity_type(raw: Mapping[str, Any]) -> str:
    placeholder = str(raw.get("placeholder") or "")
    match = re.search(r"__PIPT_([a-z_]+)_", placeholder)
    return match.group(1) if match else ""


def _int_value(value: Any, *, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _float_value(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0
