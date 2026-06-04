from __future__ import annotations

import json
import logging
import os
import re
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from typing import Any

from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.core.errors import PlatformError
from app.services.pipt_recognition_adapter import desensitize_with_platform_recognizer
from app.services.pipt_redaction_service import apply_current_document_global_redactions
from packages.py_common.db.session import get_engine


logger = logging.getLogger(__name__)


STRONG_PIPT_RE = re.compile(r"@@PIPT:v1:e\d{6}:k[a-f0-9]{8}@@")
LEGACY_PIPT_RE = re.compile(r"\{\{__PIPT_[a-z_]+_\d+__\}\}")
BIDDER_RE = re.compile(r"\{\{__BIDDER_[A-Z_]+__\}\}")
GATEWAY_EVENT_MAX_LIMIT = 500
DEFAULT_TARGET_ENTITIES = ["name", "phone", "id_number", "email", "addr", "bank", "car_id", "ip", "org", "credit_code"]


@dataclass(slots=True)
class PiptGatewayPayload:
    """系统级 PIPT 网关适配结果；默认不包含敏感明文。"""

    text: str
    mapping_table: dict[str, str] = field(default_factory=dict)
    placeholder_manifest: dict[str, dict[str, str]] = field(default_factory=dict)
    placeholder_policy: dict[str, Any] = field(default_factory=dict)
    enabled: bool = False
    mode: str = "compatibility"

    def workflow_fields(self) -> dict[str, Any]:
        return {
            "placeholder_manifest": json.dumps(self.placeholder_manifest, ensure_ascii=False),
            "placeholder_policy": json.dumps(self.placeholder_policy, ensure_ascii=False),
            "pipt_gateway_enabled": "true" if self.enabled else "false",
            "pipt_gateway_mode": self.mode,
        }


def build_placeholder_policy() -> dict[str, Any]:
    """生成跨模块 Dify 工作流可复用的占位符保留策略。"""
    return {
        "protocol": "pipt",
        "version": "v1",
        "preserve_exact": True,
        "supported_formats": [
            "@@PIPT:v1:e000001:k1a2b3c4d@@",
            "{{__PIPT_name_1__}}",
            "{{__BIDDER_ORG__}}",
        ],
        "rules": [
            "占位符是本地脱敏 token，不代表可改写文本。",
            "输出必须逐字保留完整 token。",
            "禁止翻译、缩写、拆分、补全或重新编号 token。",
        ],
    }


def build_manifest_from_mapping(mapping_table: dict[str, Any] | None) -> dict[str, dict[str, str]]:
    manifest: dict[str, dict[str, str]] = {}
    if not isinstance(mapping_table, dict):
        return manifest
    for token in mapping_table:
        key = str(token or "").strip()
        if not key:
            continue
        entity_type = _infer_entity_type(key)
        manifest[key] = {
            "entity_type": entity_type,
            "role": _role_for_entity_type(entity_type),
            "usage_hint": "作为合同文本中的敏感实体使用，必须原样保留 token。",
        }
    return manifest


def build_compatibility_payload(
    text: str,
    *,
    mapping_table: dict[str, Any] | None = None,
    enabled: bool = False,
) -> PiptGatewayPayload:
    """
    构建合同审核等模块可先行接入的 PIPT 网关 payload。
    当前默认兼容模式不改写 text，只暴露 policy/manifest 字段，避免改变合同审查语义。
    """
    mapping = {str(k): str(v) for k, v in (mapping_table or {}).items()} if isinstance(mapping_table, dict) else {}
    return PiptGatewayPayload(
        text=str(text or ""),
        mapping_table=mapping,
        placeholder_manifest=build_manifest_from_mapping(mapping),
        placeholder_policy=build_placeholder_policy(),
        enabled=enabled,
        mode="compatibility",
    )


def contains_supported_placeholder(text: str) -> bool:
    value = str(text or "")
    return bool(STRONG_PIPT_RE.search(value) or LEGACY_PIPT_RE.search(value) or BIDDER_RE.search(value))


def get_gateway_status_payload() -> dict[str, Any]:
    return {
        "service": "pipt-gateway",
        "status": "ok",
        "version": "v1",
        "mode": "compatibility",
        "capabilities": {
            "strong_token": True,
            "legacy_token_compatible": True,
            "placeholder_manifest": True,
            "placeholder_policy": True,
            "preprocess": True,
            "postprocess": True,
            "batch_preprocess": True,
            "batch_postprocess": True,
            "core_event_sink": True,
            "core_mapping_vault": True,
            "admin_summary": True,
            "restore": True,
            "contract_review_adapter": True,
            "superadmin_sink": True,
        },
    }


def build_gateway_payload(data: dict[str, Any]) -> dict[str, Any]:
    """构建底层网关 payload；当前不执行真实脱敏，避免 facade 泄露或改写业务原文。"""
    text = str(data.get("text") or "")
    mapping_table = data.get("mapping_table")
    enabled = bool(data.get("enabled", False))
    payload = build_compatibility_payload(text, mapping_table=mapping_table, enabled=enabled)
    return {
        "text": payload.text,
        "mapping_table_count": len(payload.mapping_table),
        "placeholder_manifest": payload.placeholder_manifest,
        "placeholder_policy": payload.placeholder_policy,
        "workflow_fields": payload.workflow_fields(),
        "enabled": payload.enabled,
        "mode": payload.mode,
        "has_supported_placeholder": contains_supported_placeholder(payload.text),
    }


def preprocess_payload(data: dict[str, Any]) -> dict[str, Any]:
    """
    标准化底层网关预处理契约。
    compatibility 模式不改写原文；strong 模式执行本地识别、脱敏和 vault 落库。
    """
    source_text = str(data.get("text") or "")
    module_code = str(data.get("module_code") or "unknown").strip() or "unknown"
    purpose = str(data.get("purpose") or "llm_external_call").strip() or "llm_external_call"
    request_id = str(data.get("request_id") or uuid.uuid4().hex)
    mapping_table = data.get("mapping_table")
    requested_mode = str(data.get("mode") or "").strip().lower()
    enabled = bool(data.get("enabled", False))
    if requested_mode == "strong" or (enabled and requested_mode != "compatibility"):
        return _preprocess_strong_payload(
            data,
            request_id=request_id,
            module_code=module_code,
            purpose=purpose,
            source_text=source_text,
        )
    payload = build_compatibility_payload(source_text, mapping_table=mapping_table, enabled=enabled)
    validation = validate_placeholders_payload({"text": payload.text})
    result = {
        "request_id": request_id,
        "module_code": module_code,
        "purpose": purpose,
        "mode": payload.mode,
        "enabled": payload.enabled,
        "input_text_hash": _hash_text(source_text),
        "output_text_hash": _hash_text(payload.text),
        "text": payload.text,
        "desensitized_text": payload.text,
        "placeholder_manifest": payload.placeholder_manifest,
        "placeholder_policy": payload.placeholder_policy,
        "workflow_fields": payload.workflow_fields(),
        "validation": validation,
        "audit": _build_audit_stub(
            request_id=request_id,
            module_code=module_code,
            purpose=purpose,
            operation="preprocess",
            status="success" if validation["valid"] else "warning",
            details={
                "mode": payload.mode,
                "enabled": payload.enabled,
                "mapping_table_count": len(payload.mapping_table),
                "unsupported_count": validation["unsupported_count"],
                "unexpected_count": validation["unexpected_count"],
            },
        ),
    }
    result["audit"]["event_persisted"] = _persist_event_from_result(result)
    return result


def preprocess_internal_payload(data: dict[str, Any]) -> dict[str, Any]:
    """
    统一后端内部使用的预处理契约。
    在标准 preprocess 返回基础上补充 mapping_table，供需要继续持有可逆映射的业务链路使用。
    该字段不应直接暴露给通用公开网关接口。
    """
    source_text = str(data.get("text") or "")
    module_code = str(data.get("module_code") or "unknown").strip() or "unknown"
    purpose = str(data.get("purpose") or "llm_external_call").strip() or "llm_external_call"
    request_id = str(data.get("request_id") or uuid.uuid4().hex)
    requested_mode = str(data.get("mode") or "").strip().lower()
    enabled = bool(data.get("enabled", False))
    if requested_mode == "strong" or (enabled and requested_mode != "compatibility"):
        result = _preprocess_strong_payload(
            data,
            request_id=request_id,
            module_code=module_code,
            purpose=purpose,
            source_text=source_text,
        )
        if "mapping_table" not in result:
            result["mapping_table"] = {}
        return result
    result = preprocess_payload(data)
    mapping_table = data.get("mapping_table")
    result["mapping_table"] = (
        {str(k): str(v) for k, v in mapping_table.items()}
        if isinstance(mapping_table, dict)
        else {}
    )
    return result


def postprocess_payload(data: dict[str, Any]) -> dict[str, Any]:
    """标准化底层网关后处理契约：先校验完整性，strong 模式可按 request_id 本地恢复。"""
    output_text = str(data.get("text") or "")
    request_id = str(data.get("request_id") or uuid.uuid4().hex)
    module_code = str(data.get("module_code") or "unknown").strip() or "unknown"
    purpose = str(data.get("purpose") or "llm_output_validation").strip() or "llm_output_validation"
    mode = str(data.get("mode") or "compatibility").strip().lower() or "compatibility"
    expected_tokens = _expected_tokens(data.get("placeholder_manifest"))
    validation = validate_placeholders_payload({
        "text": output_text,
        "placeholder_manifest": data.get("placeholder_manifest"),
    })
    present = set(validation["supported"])
    missing = sorted(token for token in expected_tokens if token not in present)
    unexpected = validation.get("unexpected", [])
    status = "success" if validation["valid"] and not missing and not unexpected else "warning"
    restored_text = output_text
    restored_count = 0
    if mode == "strong" and validation["valid"] and not missing and not unexpected:
        restored_text, restored_count = _restore_from_vault(request_id=request_id, text_value=output_text)
        if expected_tokens and restored_count < len(expected_tokens):
            status = "warning"
    result = {
        "request_id": request_id,
        "module_code": module_code,
        "purpose": purpose,
        "mode": mode,
        "text": restored_text,
        "output_text_hash": _hash_text(output_text),
        "restored_text_hash": _hash_text(restored_text),
        "restored_count": restored_count,
        "validation": {
            **validation,
            "expected": expected_tokens,
            "missing": missing,
            "missing_count": len(missing),
            "unexpected": unexpected,
            "unexpected_count": len(unexpected),
        },
        "audit": _build_audit_stub(
            request_id=request_id,
            module_code=module_code,
            purpose=purpose,
            operation="postprocess",
            status=status,
            details={
                "unsupported_count": validation["unsupported_count"],
                "missing_count": len(missing),
                "unexpected_count": len(unexpected),
                "restored_count": restored_count,
            },
        ),
    }
    result["audit"]["event_persisted"] = _persist_event_from_result(result)
    return result


def batch_preprocess_payload(data: dict[str, Any]) -> dict[str, Any]:
    """批量预处理多段文本；每项使用独立 request_id，避免跨字段映射污染。"""
    items = _batch_items(data)
    base_request_id = str(data.get("request_id") or uuid.uuid4().hex).strip() or uuid.uuid4().hex
    module_code = str(data.get("module_code") or "unknown").strip() or "unknown"
    purpose = str(data.get("purpose") or "llm_external_call").strip() or "llm_external_call"
    mode = str(data.get("mode") or "").strip().lower()
    enabled = bool(data.get("enabled", False))
    target_entities = data.get("target_entities")
    llm_mode = data.get("llm_mode")
    results = []
    for index, item in enumerate(items):
        item_request_id = str(item.get("request_id") or f"{base_request_id}:{index}").strip()
        item_payload = {
            "request_id": item_request_id,
            "module_code": str(item.get("module_code") or module_code).strip() or module_code,
            "purpose": str(item.get("purpose") or purpose).strip() or purpose,
            "text": str(item.get("text") or ""),
            "mode": str(item.get("mode") or mode).strip().lower(),
            "enabled": bool(item.get("enabled", enabled)),
            "target_entities": item.get("target_entities", target_entities),
            "llm_mode": item.get("llm_mode", llm_mode),
        }
        mapping_table = item.get("mapping_table")
        if isinstance(mapping_table, dict):
            item_payload["mapping_table"] = mapping_table
        results.append(preprocess_payload(item_payload))
    return {
        "request_id": base_request_id,
        "module_code": module_code,
        "purpose": purpose,
        "mode": mode or "compatibility",
        "items": results,
        "count": len(results),
        "placeholder_count": sum(_safe_count(item, "validation", "supported_count") for item in results),
        "unsupported_count": sum(_safe_count(item, "validation", "unsupported_count") for item in results),
        "unexpected_count": sum(_safe_count(item, "validation", "unexpected_count") for item in results),
    }


def batch_postprocess_payload(data: dict[str, Any]) -> dict[str, Any]:
    """批量后处理多段模型输出；按各自 request_id 校验和恢复。"""
    items = _batch_items(data)
    base_request_id = str(data.get("request_id") or uuid.uuid4().hex).strip() or uuid.uuid4().hex
    module_code = str(data.get("module_code") or "unknown").strip() or "unknown"
    purpose = str(data.get("purpose") or "llm_output_validation").strip() or "llm_output_validation"
    mode = str(data.get("mode") or "compatibility").strip().lower() or "compatibility"
    default_manifest = data.get("placeholder_manifest")
    results = []
    for index, item in enumerate(items):
        item_payload = {
            "request_id": str(item.get("request_id") or f"{base_request_id}:{index}").strip(),
            "module_code": str(item.get("module_code") or module_code).strip() or module_code,
            "purpose": str(item.get("purpose") or purpose).strip() or purpose,
            "mode": str(item.get("mode") or mode).strip().lower() or mode,
            "text": str(item.get("text") or ""),
            "placeholder_manifest": item.get("placeholder_manifest", default_manifest),
        }
        results.append(postprocess_payload(item_payload))
    return {
        "request_id": base_request_id,
        "module_code": module_code,
        "purpose": purpose,
        "mode": mode,
        "items": results,
        "count": len(results),
        "placeholder_count": sum(_safe_count(item, "validation", "supported_count") for item in results),
        "missing_count": sum(_safe_count(item, "validation", "missing_count") for item in results),
        "unsupported_count": sum(_safe_count(item, "validation", "unsupported_count") for item in results),
        "unexpected_count": sum(_safe_count(item, "validation", "unexpected_count") for item in results),
        "restored_count": sum(_non_negative_int(item.get("restored_count")) for item in results if isinstance(item, dict)),
    }


def cleanup_gateway_mappings_payload(*, older_than_seconds: int | None = None) -> dict[str, Any]:
    """清理过期的 PIPT mapping vault；仅删除本地可逆映射，不删除审计事件。"""
    cutoff_seconds = _bounded_cleanup_seconds(older_than_seconds)
    try:
        with get_engine().begin() as conn:
            exists = conn.execute(text("SELECT to_regclass('core.pipt_gateway_mappings') IS NOT NULL")).scalar_one()
            if not exists:
                raise PlatformError(
                    code="DATABASE_ERROR",
                    message="PIPT 网关映射 vault 表不存在，请先执行数据库迁移。",
                    status_code=500,
                    details={"table": "core.pipt_gateway_mappings"},
                )
            result = conn.execute(
                text(
                    """
                    DELETE FROM core.pipt_gateway_mappings
                    WHERE expires_at IS NOT NULL
                      AND expires_at <= now()
                      AND created_at <= now() - (:cutoff_seconds * interval '1 second')
                    """
                ),
                {"cutoff_seconds": cutoff_seconds},
            )
    except PlatformError:
        raise
    except (SQLAlchemyError, RuntimeError) as exc:
        raise _database_error(exc) from exc
    deleted_count = int(getattr(result, "rowcount", 0) or 0)
    return {
        "deleted_count": deleted_count,
        "older_than_seconds": cutoff_seconds,
        "event_logs_preserved": True,
    }


def cleanup_unrestorable_gateway_mappings_payload() -> dict[str, Any]:
    """清理当前 vault 密钥无法解密的 PIPT mapping；保留审计事件。"""
    try:
        with get_engine().begin() as conn:
            exists = conn.execute(text("SELECT to_regclass('core.pipt_gateway_mappings') IS NOT NULL")).scalar_one()
            if not exists:
                raise PlatformError(
                    code="DATABASE_ERROR",
                    message="PIPT 网关映射 vault 表不存在，请先执行数据库迁移。",
                    status_code=500,
                    details={"table": "core.pipt_gateway_mappings"},
                )
            rows = conn.execute(
                text(
                    """
                    SELECT id, original_text_enc, encryption_status
                    FROM core.pipt_gateway_mappings
                    WHERE encryption_status = 'encrypted'
                    """
                )
            ).mappings().all()
            failed_ids = [
                str(row["id"])
                for row in rows
                if _decrypt_mapping_original(
                    str(row.get("original_text_enc") or ""),
                    str(row.get("encryption_status") or "plaintext"),
                )[1]
                == "failed"
            ]
            if failed_ids:
                result = conn.execute(
                    text(
                        """
                        DELETE FROM core.pipt_gateway_mappings
                        WHERE id::text = ANY(:ids)
                        """
                    ),
                    {"ids": failed_ids},
                )
                deleted_count = int(getattr(result, "rowcount", 0) or 0)
            else:
                deleted_count = 0
    except PlatformError:
        raise
    except (SQLAlchemyError, RuntimeError) as exc:
        raise _database_error(exc) from exc
    return {
        "deleted_count": deleted_count,
        "checked_count": len(rows),
        "event_logs_preserved": True,
    }


def get_gateway_admin_summary_payload() -> dict[str, Any]:
    """返回 superadmin 可消费的安全汇总；不包含原文、token 或可逆映射。"""
    try:
        with get_engine().begin() as conn:
            events_exists = conn.execute(text("SELECT to_regclass('core.pipt_gateway_events') IS NOT NULL")).scalar_one()
            mappings_exists = conn.execute(text("SELECT to_regclass('core.pipt_gateway_mappings') IS NOT NULL")).scalar_one()
            if not events_exists or not mappings_exists:
                missing = []
                if not events_exists:
                    missing.append("core.pipt_gateway_events")
                if not mappings_exists:
                    missing.append("core.pipt_gateway_mappings")
                raise PlatformError(
                    code="DATABASE_ERROR",
                    message="PIPT 网关底层表不存在，请先执行数据库迁移。",
                    status_code=500,
                    details={"missing_tables": missing},
                )
            totals = conn.execute(
                text(
                    """
                    SELECT
                      COUNT(*) AS event_count,
                      COALESCE(SUM(placeholder_count), 0) AS placeholder_count,
                      COALESCE(SUM(unsupported_count), 0) AS unsupported_count,
                      COALESCE(SUM(missing_count), 0) AS missing_count,
                      COALESCE(SUM(unexpected_count), 0) AS unexpected_count
                    FROM core.pipt_gateway_events
                    """
                )
            ).mappings().one()
            by_module = conn.execute(
                text(
                    """
                    SELECT module_code, COUNT(*) AS event_count
                    FROM core.pipt_gateway_events
                    GROUP BY module_code
                    ORDER BY event_count DESC, module_code ASC
                    LIMIT 20
                    """
                )
            ).mappings().all()
            by_operation = conn.execute(
                text(
                    """
                    SELECT operation, status, COUNT(*) AS event_count
                    FROM core.pipt_gateway_events
                    GROUP BY operation, status
                    ORDER BY operation ASC, status ASC
                    """
                )
            ).mappings().all()
            vault = conn.execute(
                text(
                    """
                    SELECT
                      COUNT(*) AS mapping_count,
                      COUNT(*) FILTER (WHERE encryption_status = 'plaintext') AS plaintext_count,
                      COUNT(*) FILTER (WHERE encryption_status = 'encrypted') AS encrypted_count,
                      COUNT(*) FILTER (WHERE expires_at IS NOT NULL AND expires_at <= now()) AS expired_count,
                      COUNT(*) FILTER (WHERE expires_at IS NULL OR expires_at > now()) AS active_count
                    FROM core.pipt_gateway_mappings
                    """
                )
            ).mappings().one()
    except PlatformError:
        raise
    except (SQLAlchemyError, RuntimeError) as exc:
        raise _database_error(exc) from exc

    return {
        "events": {
            "event_count": int(totals.get("event_count") or 0),
            "placeholder_count": int(totals.get("placeholder_count") or 0),
            "unsupported_count": int(totals.get("unsupported_count") or 0),
            "missing_count": int(totals.get("missing_count") or 0),
            "unexpected_count": int(totals.get("unexpected_count") or 0),
            "by_module": [
                {
                    "module_code": str(row.get("module_code") or ""),
                    "event_count": int(row.get("event_count") or 0),
                }
                for row in by_module
            ],
            "by_operation": [
                {
                    "operation": str(row.get("operation") or ""),
                    "status": str(row.get("status") or ""),
                    "event_count": int(row.get("event_count") or 0),
                }
                for row in by_operation
            ],
        },
        "vault": {
            "mapping_count": int(vault.get("mapping_count") or 0),
            "active_count": int(vault.get("active_count") or 0),
            "expired_count": int(vault.get("expired_count") or 0),
            "encrypted_count": int(vault.get("encrypted_count") or 0),
            "plaintext_count": int(vault.get("plaintext_count") or 0),
            "contains_plaintext": int(vault.get("plaintext_count") or 0) > 0,
        },
    }


def list_gateway_mappings_payload(
    *,
    request_id: str | None = None,
    module_code: str | None = None,
    purpose: str | None = None,
    entity_type: str | None = None,
    limit: int = 100,
) -> dict[str, Any]:
    """
    查询 PIPT mapping vault 明细；该接口会返回敏感原文，仅允许管理员后台使用。
    不读取事件 details，不把原文写回事件日志。
    """
    bounded_limit = _bounded_limit(limit)
    filters = []
    params: dict[str, Any] = {"limit": bounded_limit}
    for key, value in (
        ("request_id", request_id),
        ("module_code", module_code),
        ("purpose", purpose),
        ("entity_type", entity_type),
    ):
        normalized = str(value or "").strip()
        if not normalized:
            continue
        filters.append(f"{key} = :{key}")
        params[key] = normalized
    where_sql = f"WHERE {' AND '.join(filters)}" if filters else ""
    try:
        with get_engine().begin() as conn:
            exists = conn.execute(text("SELECT to_regclass('core.pipt_gateway_mappings') IS NOT NULL")).scalar_one()
            if not exists:
                raise PlatformError(
                    code="DATABASE_ERROR",
                    message="PIPT 网关映射 vault 表不存在，请先执行数据库迁移。",
                    status_code=500,
                    details={"table": "core.pipt_gateway_mappings"},
                )
            rows = conn.execute(
                text(
                    f"""
                    SELECT id, request_id, module_code, purpose, placeholder, entity_type,
                           original_text_enc, original_text_hash, placeholder_protocol,
                           encryption_status, expires_at, created_at,
                           (expires_at IS NOT NULL AND expires_at <= now()) AS expired
                    FROM core.pipt_gateway_mappings
                    {where_sql}
                    ORDER BY created_at DESC
                    LIMIT :limit
                    """
                ),
                params,
            ).mappings().all()
    except PlatformError:
        raise
    except (SQLAlchemyError, RuntimeError) as exc:
        raise _database_error(exc) from exc

    items = []
    decrypted_count = 0
    failed_count = 0
    for row in rows:
        original_text, decrypt_status = _decrypt_mapping_original(
            str(row.get("original_text_enc") or ""),
            str(row.get("encryption_status") or "plaintext"),
        )
        if decrypt_status in {"plaintext", "decrypted"}:
            decrypted_count += 1
        elif decrypt_status == "failed":
            failed_count += 1
        items.append(
            {
                "id": str(row["id"]),
                "request_id": str(row["request_id"]),
                "module_code": str(row["module_code"]),
                "purpose": str(row["purpose"]),
                "placeholder": str(row["placeholder"]),
                "entity_type": str(row["entity_type"]),
                "original_text": original_text,
                "original_text_hash": row.get("original_text_hash"),
                "placeholder_protocol": str(row.get("placeholder_protocol") or ""),
                "encryption_status": str(row.get("encryption_status") or "plaintext"),
                "decrypt_status": decrypt_status,
                "expired": bool(row.get("expired")),
                "expires_at": _iso_value(row.get("expires_at")),
                "created_at": _iso_value(row.get("created_at")),
            }
        )
    return {
        "items": items,
        "count": len(items),
        "limit": bounded_limit,
        "decrypted_count": decrypted_count,
        "failed_count": failed_count,
        "contains_plaintext": any(item["encryption_status"] == "plaintext" for item in items),
    }


def validate_placeholders_payload(data: dict[str, Any]) -> dict[str, Any]:
    text = str(data.get("text") or "")
    request_id = str(data.get("request_id") or "").strip()
    module_code = str(data.get("module_code") or "").strip()
    purpose = str(data.get("purpose") or "").strip()
    supported = sorted(set(STRONG_PIPT_RE.findall(text) + LEGACY_PIPT_RE.findall(text) + BIDDER_RE.findall(text)))
    suspect = _find_suspect_placeholders(text)
    expected = _expected_tokens(data.get("placeholder_manifest"))
    unexpected = sorted(token for token in supported if expected and token not in expected)
    result = {
        "valid": not suspect and not unexpected,
        "supported": supported,
        "unsupported": suspect,
        "expected": expected,
        "unexpected": unexpected,
        "supported_count": len(supported),
        "unsupported_count": len(suspect),
        "unexpected_count": len(unexpected),
    }
    if request_id or module_code or purpose:
        event = {
            "request_id": request_id or uuid.uuid4().hex,
            "module_code": module_code or "unknown",
            "purpose": purpose or "placeholder_validation",
            "operation": "validate",
            "status": "success" if result["valid"] else "warning",
            "mode": str(data.get("mode") or "compatibility"),
            "input_text_hash": _hash_text(text),
            "output_text_hash": _hash_text(text),
            "placeholder_count": result["supported_count"],
            "unsupported_count": result["unsupported_count"],
            "missing_count": 0,
            "unexpected_count": result["unexpected_count"],
            "details": {
                "contains_plaintext": False,
                "supported_count": result["supported_count"],
                "unsupported_count": result["unsupported_count"],
                "unexpected_count": result["unexpected_count"],
            },
        }
        result["event_persisted"] = record_gateway_event(event)
    return result


def record_gateway_event(event: dict[str, Any]) -> bool:
    """最佳努力记录 PIPT 网关事件；只允许落 hash、计数和结构化状态，不存敏感明文。"""
    safe_event = _normalize_gateway_event(event)
    try:
        with get_engine().begin() as conn:
            exists = conn.execute(text("SELECT to_regclass('core.pipt_gateway_events') IS NOT NULL")).scalar_one()
            if not exists:
                logger.warning("PIPT gateway event table is missing; event skipped")
                return False
            conn.execute(
                text(
                    """
                    INSERT INTO core.pipt_gateway_events (
                      request_id, module_code, purpose, operation, status, mode,
                      input_text_hash, output_text_hash, placeholder_count,
                      unsupported_count, missing_count, unexpected_count, details
                    )
                    VALUES (
                      :request_id, :module_code, :purpose, :operation, :status, :mode,
                      :input_text_hash, :output_text_hash, :placeholder_count,
                      :unsupported_count, :missing_count, :unexpected_count, CAST(:details AS jsonb)
                    )
                    """
                ),
                {
                    **safe_event,
                    "details": json.dumps(safe_event["details"], ensure_ascii=False),
                },
            )
            return True
    except (SQLAlchemyError, RuntimeError) as exc:
        logger.warning("PIPT gateway event persistence skipped: %s", exc)
        return False


def list_gateway_events_payload(
    *,
    request_id: str | None = None,
    module_code: str | None = None,
    purpose: str | None = None,
    operation: str | None = None,
    status: str | None = None,
    limit: int = 100,
) -> dict[str, Any]:
    """查询底层 PIPT 网关事件；返回值不包含敏感明文或本地映射明文。"""
    bounded_limit = _bounded_limit(limit)
    filters = []
    params: dict[str, Any] = {"limit": bounded_limit}
    for key, value in (
        ("request_id", request_id),
        ("module_code", module_code),
        ("purpose", purpose),
        ("operation", operation),
        ("status", status),
    ):
        normalized = str(value or "").strip()
        if not normalized:
            continue
        filters.append(f"{key} = :{key}")
        params[key] = normalized
    where_sql = f"WHERE {' AND '.join(filters)}" if filters else ""
    try:
        with get_engine().begin() as conn:
            exists = conn.execute(text("SELECT to_regclass('core.pipt_gateway_events') IS NOT NULL")).scalar_one()
            if not exists:
                raise PlatformError(
                    code="DATABASE_ERROR",
                    message="PIPT 网关事件表不存在，请先执行数据库迁移。",
                    status_code=500,
                    details={"table": "core.pipt_gateway_events"},
                )
            rows = conn.execute(
                text(
                    f"""
                    SELECT id, request_id, module_code, purpose, operation, status, mode,
                           input_text_hash, output_text_hash, placeholder_count,
                           unsupported_count, missing_count, unexpected_count, details, created_at
                    FROM core.pipt_gateway_events
                    {where_sql}
                    ORDER BY created_at DESC
                    LIMIT :limit
                    """
                ),
                params,
            ).mappings().all()
    except PlatformError:
        raise
    except (SQLAlchemyError, RuntimeError) as exc:
        raise _database_error(exc) from exc

    items = [
        {
            "id": str(row["id"]),
            "request_id": str(row["request_id"]),
            "module_code": str(row["module_code"]),
            "purpose": str(row["purpose"]),
            "operation": str(row["operation"]),
            "status": str(row["status"]),
            "mode": str(row["mode"]),
            "input_text_hash": row.get("input_text_hash"),
            "output_text_hash": row.get("output_text_hash"),
            "placeholder_count": int(row.get("placeholder_count") or 0),
            "unsupported_count": int(row.get("unsupported_count") or 0),
            "missing_count": int(row.get("missing_count") or 0),
            "unexpected_count": int(row.get("unexpected_count") or 0),
            "details": _safe_event_details(_json_value(row.get("details"))),
            "created_at": _iso_value(row.get("created_at")),
        }
        for row in rows
    ]
    return {"items": items, "count": len(items), "limit": bounded_limit}


def _preprocess_strong_payload(
    data: dict[str, Any],
    *,
    request_id: str,
    module_code: str,
    purpose: str,
    source_text: str,
) -> dict[str, Any]:
    target_entities = _target_entities(data.get("target_entities"))
    llm_mode = _llm_mode(data.get("llm_mode"))
    result = desensitize_with_platform_recognizer(
        text=source_text,
        target_entities=target_entities,
        method="placeholder",
        placeholder_protocol="strong",
        llm_mode=llm_mode,
        audit_context={"source": "core.pipt_gateway", "session_id": request_id},
    )
    desensitized_text = str(result.desensitized_text or "")
    mapping_table = result.mapping_table if isinstance(result.mapping_table, dict) else {}
    placeholder_manifest = (
        result.placeholder_manifest
        if isinstance(result.placeholder_manifest, dict)
        else build_manifest_from_mapping(mapping_table)
    )
    placeholder_policy = (
        result.placeholder_policy
        if isinstance(result.placeholder_policy, dict) and result.placeholder_policy
        else build_placeholder_policy()
    )
    desensitized_text, mapping_table, placeholder_manifest, historical_reuse_count = _reuse_historical_mappings(
        module_code=module_code,
        purpose=purpose,
        source_text=source_text,
        desensitized_text=desensitized_text,
        mapping_table=mapping_table,
        placeholder_manifest=placeholder_manifest,
    )
    global_redaction = apply_current_document_global_redactions(
        source_text=source_text,
        redacted_text=desensitized_text,
        mapping_table=mapping_table,
        replacement_mode="placeholder",
    )
    desensitized_text = global_redaction.text
    current_document_global_replace_count = global_redaction.replacement_count
    vault_persisted = _persist_mapping_vault(
        request_id=request_id,
        module_code=module_code,
        purpose=purpose,
        mapping_table=mapping_table,
        placeholder_manifest=placeholder_manifest,
    )
    if mapping_table and not vault_persisted:
        raise PlatformError(
            code="DATABASE_ERROR",
            message="PIPT 网关映射 vault 写入失败，已拒绝外发不可恢复的脱敏文本。",
            status_code=500,
            details={"table": "core.pipt_gateway_mappings"},
        )
    validation = validate_placeholders_payload({"text": desensitized_text})
    status = "success" if validation["valid"] else "warning"
    workflow_fields = {
        "placeholder_manifest": json.dumps(placeholder_manifest, ensure_ascii=False),
        "placeholder_policy": json.dumps(placeholder_policy, ensure_ascii=False),
        "pipt_gateway_enabled": "true",
        "pipt_gateway_mode": "strong",
    }
    result_payload = {
        "request_id": request_id,
        "module_code": module_code,
        "purpose": purpose,
        "mode": "strong",
        "enabled": True,
        "input_text_hash": _hash_text(source_text),
        "output_text_hash": _hash_text(desensitized_text),
        "text": desensitized_text,
        "desensitized_text": desensitized_text,
        "mapping_table_count": len(mapping_table),
        "mapping_vault_persisted": vault_persisted,
        "placeholder_manifest": placeholder_manifest,
        "placeholder_policy": placeholder_policy,
        "workflow_fields": workflow_fields,
        "validation": validation,
        "audit": _build_audit_stub(
            request_id=request_id,
            module_code=module_code,
            purpose=purpose,
            operation="preprocess",
            status=status,
            details={
                "mode": "strong",
                "enabled": True,
                "mapping_table_count": len(mapping_table),
                "historical_reuse_count": historical_reuse_count,
                "current_document_global_replace_count": current_document_global_replace_count,
                "placeholder_count": validation["supported_count"],
                "unsupported_count": validation["unsupported_count"],
                "unexpected_count": validation["unexpected_count"],
            },
        ),
    }
    result_payload["audit"]["event_persisted"] = _persist_event_from_result(result_payload)
    return result_payload


def _reuse_historical_mappings(
    *,
    module_code: str,
    purpose: str,
    source_text: str,
    desensitized_text: str,
    mapping_table: dict[str, Any],
    placeholder_manifest: dict[str, Any],
) -> tuple[str, dict[str, Any], dict[str, Any], int]:
    """
    复用同模块同用途的历史映射，补偿本次识别器漏识别的既有实体。
    只在 strong 模式内使用；复用后的映射会重新写入当前 request vault。
    """
    text_value = str(desensitized_text or "")
    if not text_value:
        return text_value, mapping_table, placeholder_manifest, 0

    merged_mapping = dict(mapping_table or {})
    merged_manifest = dict(placeholder_manifest or {})
    reused_count = 0
    seen_originals = {str(value or "") for value in merged_mapping.values() if str(value or "")}

    for item in _load_historical_mapping_candidates(module_code=module_code, purpose=purpose):
        token = str(item.get("placeholder") or "").strip()
        original = str(item.get("original_text") or "").strip()
        entity_type = str(item.get("entity_type") or "unknown").strip() or "unknown"
        if not token or not original:
            continue
        if token in merged_mapping and str(merged_mapping.get(token) or "") != original:
            continue
        if original in seen_originals:
            continue
        if original not in source_text or original not in text_value:
            continue

        next_text = text_value.replace(original, token)
        if next_text == text_value:
            continue
        text_value = next_text
        merged_mapping[token] = original
        merged_manifest.setdefault(token, _build_reused_manifest_row(token=token, entity_type=entity_type))
        seen_originals.add(original)
        reused_count += 1

    return text_value, merged_mapping, merged_manifest, reused_count


def _load_historical_mapping_candidates(*, module_code: str, purpose: str) -> list[dict[str, str]]:
    limit = _historical_mapping_reuse_limit()
    permanent = purpose in _permanent_mapping_purposes()
    try:
        with get_engine().begin() as conn:
            exists = conn.execute(text("SELECT to_regclass('core.pipt_gateway_mappings') IS NOT NULL")).scalar_one()
            if not exists:
                return []
            rows = conn.execute(
                text(
                    """
                    SELECT placeholder, entity_type, original_text_enc, encryption_status, created_at
                    FROM core.pipt_gateway_mappings
                    WHERE module_code = :module_code
                      AND purpose = :purpose
                      AND (:permanent OR expires_at IS NULL OR expires_at > now())
                    ORDER BY created_at DESC
                    LIMIT :limit
                    """
                ),
                {"module_code": module_code[:100], "purpose": purpose[:100], "permanent": permanent, "limit": limit},
            ).mappings().all()
    except PlatformError:
        raise
    except (SQLAlchemyError, RuntimeError) as exc:
        logger.warning("PIPT gateway historical mapping reuse skipped: %s", exc)
        return []

    candidates: list[dict[str, str]] = []
    seen_originals: set[str] = set()
    for row in rows:
        original, decrypt_status = _decrypt_mapping_original(
            str(row.get("original_text_enc") or ""),
            str(row.get("encryption_status") or "plaintext"),
        )
        original = str(original or "").strip()
        token = str(row.get("placeholder") or "").strip()
        if decrypt_status == "failed" or not original or not token:
            continue
        if original in seen_originals:
            continue
        seen_originals.add(original)
        candidates.append(
            {
                "placeholder": token,
                "original_text": original,
                "entity_type": str(row.get("entity_type") or "unknown")[:100],
            }
        )

    candidates.sort(key=lambda item: len(item["original_text"]), reverse=True)
    return candidates


def _build_reused_manifest_row(*, token: str, entity_type: str) -> dict[str, str]:
    normalized_type = str(entity_type or "").strip() or _infer_entity_type(token)
    return {
        "entity_type": normalized_type,
        "role": _role_for_entity_type(normalized_type),
        "usage_hint": "历史映射复用的敏感实体 token，必须原样保留。",
    }


def _batch_items(data: dict[str, Any]) -> list[dict[str, Any]]:
    raw_items = data.get("items")
    if isinstance(raw_items, list):
        items = [item for item in raw_items if isinstance(item, dict)]
        return items
    raw_texts = data.get("texts")
    if isinstance(raw_texts, list):
        return [{"text": str(item or "")} for item in raw_texts]
    return [{"text": str(data.get("text") or "")}]


def _safe_count(item: dict[str, Any], parent_key: str, child_key: str) -> int:
    parent = item.get(parent_key) if isinstance(item, dict) else {}
    if not isinstance(parent, dict):
        return 0
    return _non_negative_int(parent.get(child_key))


def _persist_mapping_vault(
    *,
    request_id: str,
    module_code: str,
    purpose: str,
    mapping_table: dict[str, Any],
    placeholder_manifest: dict[str, Any],
) -> bool:
    if not mapping_table:
        return True
    try:
        with get_engine().begin() as conn:
            exists = conn.execute(text("SELECT to_regclass('core.pipt_gateway_mappings') IS NOT NULL")).scalar_one()
            if not exists:
                logger.warning("PIPT gateway mapping table is missing; vault skipped")
                return False
            for placeholder, original in mapping_table.items():
                ttl_seconds = _vault_ttl_seconds(module_code=module_code, purpose=purpose)
                token = str(placeholder or "").strip()
                original_text = str(original or "")
                if not token or not original_text:
                    continue
                entity_meta = placeholder_manifest.get(token) if isinstance(placeholder_manifest, dict) else {}
                entity_type = "unknown"
                if isinstance(entity_meta, dict):
                    entity_type = str(entity_meta.get("entity_type") or "unknown")[:100]
                conn.execute(
                    text(
                        """
                        INSERT INTO core.pipt_gateway_mappings (
                          request_id, module_code, purpose, placeholder, entity_type,
                          original_text_enc, original_text_hash, placeholder_protocol,
                          encryption_status, expires_at
                        )
                        VALUES (
                          :request_id, :module_code, :purpose, :placeholder, :entity_type,
                          :original_text_enc, :original_text_hash, :placeholder_protocol,
                          :encryption_status, :expires_at
                        )
                        ON CONFLICT (request_id, placeholder) DO UPDATE SET
                          original_text_enc = EXCLUDED.original_text_enc,
                          original_text_hash = EXCLUDED.original_text_hash,
                          entity_type = EXCLUDED.entity_type,
                          encryption_status = EXCLUDED.encryption_status,
                          expires_at = EXCLUDED.expires_at
                        """
                    ),
                    {
                        "request_id": request_id[:200],
                        "module_code": module_code[:100],
                        "purpose": purpose[:100],
                        "placeholder": token,
                        "entity_type": entity_type,
                        "original_text_enc": _vault_encrypt(original_text),
                        "original_text_hash": _hash_text(original_text),
                        "placeholder_protocol": "strong" if STRONG_PIPT_RE.fullmatch(token) else "legacy",
                        "encryption_status": _vault_encryption_status(),
                        "expires_at": _vault_expires_at(ttl_seconds),
                    },
                )
            return True
    except PlatformError:
        raise
    except (SQLAlchemyError, RuntimeError) as exc:
        logger.warning("PIPT gateway mapping vault persistence skipped: %s", exc)
        return False


def _restore_from_vault(*, request_id: str, text_value: str) -> tuple[str, int]:
    tokens = sorted(set(STRONG_PIPT_RE.findall(text_value) + LEGACY_PIPT_RE.findall(text_value) + BIDDER_RE.findall(text_value)))
    if not request_id or not tokens:
        return text_value, 0
    try:
        with get_engine().begin() as conn:
            exists = conn.execute(text("SELECT to_regclass('core.pipt_gateway_mappings') IS NOT NULL")).scalar_one()
            if not exists:
                logger.warning("PIPT gateway mapping table is missing; restore skipped")
                return text_value, 0
            rows = conn.execute(
                text(
                    """
                    SELECT placeholder, original_text_enc
                    FROM core.pipt_gateway_mappings
                    WHERE request_id = :request_id
                      AND placeholder = ANY(:tokens)
                      AND (expires_at IS NULL OR expires_at > now())
                    """
                ),
                {"request_id": request_id, "tokens": tokens},
            ).mappings().all()
    except PlatformError:
        raise
    except (SQLAlchemyError, RuntimeError) as exc:
        logger.warning("PIPT gateway mapping vault restore skipped: %s", exc)
        return text_value, 0

    restored = text_value
    restored_count = 0
    for row in rows:
        token = str(row.get("placeholder") or "")
        original = _vault_decrypt(str(row.get("original_text_enc") or ""))
        if not token or not original or token not in restored:
            continue
        restored = restored.replace(token, original)
        restored_count += 1
    return restored, restored_count


def _target_entities(value: Any) -> list[str]:
    if not isinstance(value, list):
        return DEFAULT_TARGET_ENTITIES
    allowed = set(DEFAULT_TARGET_ENTITIES)
    entities = [str(item).strip() for item in value if str(item or "").strip() in allowed]
    return entities or DEFAULT_TARGET_ENTITIES


def _llm_mode(value: Any) -> str | None:
    mode = str(value or "").strip().lower()
    return mode if mode in {"verify_only", "augment", "full"} else None


def _historical_mapping_reuse_limit() -> int:
    try:
        return max(1, min(int(os.environ.get("PIPT_GATEWAY_HISTORICAL_REUSE_LIMIT", "5000")), 50000))
    except ValueError:
        return 5000


def _permanent_mapping_purposes() -> set[str]:
    raw = os.environ.get("PIPT_GATEWAY_PERMANENT_PURPOSES", "knowledge_sync")
    return {item.strip() for item in raw.split(",") if item.strip()}


def _vault_ttl_seconds(*, module_code: str, purpose: str) -> int | None:
    _ = module_code
    if purpose in _permanent_mapping_purposes():
        return None
    try:
        return max(60, int(os.environ.get("PIPT_GATEWAY_VAULT_TTL_SECONDS", "86400")))
    except ValueError:
        return 86400


def _vault_expires_at(ttl_seconds: int | None) -> datetime | None:
    if ttl_seconds is None:
        return None
    return datetime.now(timezone.utc) + timedelta(seconds=ttl_seconds)


def _vault_encryption_status() -> str:
    return "encrypted" if (os.environ.get("PIPT_GATEWAY_VAULT_KEY") or os.environ.get("PIPT_DB_KEY") or "").strip() else "plaintext"


def _vault_encrypt(value: str) -> str:
    text_value = str(value or "")
    fernet = _vault_fernet()
    if fernet is None:
        return text_value
    return fernet.encrypt(text_value.encode("utf-8")).decode("ascii")


def _vault_decrypt(value: str) -> str:
    token = str(value or "")
    fernet = _vault_fernet()
    if fernet is None:
        return token
    try:
        return fernet.decrypt(token.encode("ascii")).decode("utf-8")
    except Exception:
        return ""


def _decrypt_mapping_original(value: str, encryption_status: str) -> tuple[str, str]:
    status = str(encryption_status or "plaintext").strip().lower()
    if status != "encrypted":
        return str(value or ""), "plaintext"
    fernet = _vault_fernet()
    if fernet is None:
        return "", "failed"
    try:
        return fernet.decrypt(str(value or "").encode("ascii")).decode("utf-8"), "decrypted"
    except Exception:
        return "", "failed"


@lru_cache(maxsize=1)
def _vault_fernet() -> Any:
    raw_key = os.environ.get("PIPT_GATEWAY_VAULT_KEY") or os.environ.get("PIPT_DB_KEY") or ""
    env = os.environ.get("PIPT_ENV", "").strip().lower()
    if not raw_key:
        if env in {"prod", "production"}:
            raise PlatformError(
                code="CONFIGURATION_ERROR",
                message="生产环境必须配置 PIPT_GATEWAY_VAULT_KEY 或 PIPT_DB_KEY。",
                status_code=500,
                details={"env": "PIPT_GATEWAY_VAULT_KEY", "fallback_env": "PIPT_DB_KEY"},
            )
        logger.warning("PIPT_GATEWAY_VAULT_KEY 未配置，core mapping vault 将以明文开发模式存储")
        return None
    from cryptography.fernet import Fernet

    try:
        return Fernet(raw_key.encode() if isinstance(raw_key, str) else raw_key)
    except Exception as exc:
        raise PlatformError(
            code="CONFIGURATION_ERROR",
            message="PIPT 网关 vault 密钥不是合法 Fernet key。",
            status_code=500,
            details={"env": "PIPT_GATEWAY_VAULT_KEY", "fallback_env": "PIPT_DB_KEY"},
        ) from exc


def _hash_text(value: str) -> str:
    import hashlib

    text = str(value or "")
    return hashlib.sha256(text.encode("utf-8")).hexdigest() if text else ""


def _persist_event_from_result(result: dict[str, Any]) -> bool:
    audit = result.get("audit") if isinstance(result.get("audit"), dict) else {}
    validation = result.get("validation") if isinstance(result.get("validation"), dict) else {}
    event = {
        "request_id": result.get("request_id") or audit.get("request_id"),
        "module_code": result.get("module_code") or audit.get("module_code"),
        "purpose": result.get("purpose") or audit.get("purpose"),
        "operation": audit.get("operation"),
        "status": audit.get("status"),
        "mode": result.get("mode") or "compatibility",
        "input_text_hash": result.get("input_text_hash"),
        "output_text_hash": result.get("output_text_hash"),
        "placeholder_count": validation.get("supported_count"),
        "unsupported_count": validation.get("unsupported_count"),
        "missing_count": validation.get("missing_count"),
        "unexpected_count": validation.get("unexpected_count"),
        "details": audit.get("details"),
    }
    return record_gateway_event(event)


def _normalize_gateway_event(event: dict[str, Any]) -> dict[str, Any]:
    request_id = str(event.get("request_id") or uuid.uuid4().hex).strip() or uuid.uuid4().hex
    module_code = str(event.get("module_code") or "unknown").strip() or "unknown"
    purpose = str(event.get("purpose") or "llm_external_call").strip() or "llm_external_call"
    operation = _bounded_enum(event.get("operation"), {"preprocess", "postprocess", "validate"}, "validate")
    status = _bounded_enum(event.get("status"), {"success", "warning", "error", "skipped"}, "success")
    mode = _bounded_enum(event.get("mode"), {"compatibility", "strong", "legacy"}, "compatibility")
    return {
        "request_id": request_id[:200],
        "module_code": module_code[:100],
        "purpose": purpose[:100],
        "operation": operation,
        "status": status,
        "mode": mode,
        "input_text_hash": _hash_or_empty(event.get("input_text_hash")),
        "output_text_hash": _hash_or_empty(event.get("output_text_hash")),
        "placeholder_count": _non_negative_int(event.get("placeholder_count")),
        "unsupported_count": _non_negative_int(event.get("unsupported_count")),
        "missing_count": _non_negative_int(event.get("missing_count")),
        "unexpected_count": _non_negative_int(event.get("unexpected_count")),
        "details": _safe_event_details(event.get("details")),
    }


def _bounded_enum(value: Any, allowed: set[str], fallback: str) -> str:
    normalized = str(value or "").strip().lower()
    return normalized if normalized in allowed else fallback


def _hash_or_empty(value: Any) -> str:
    normalized = str(value or "").strip()
    if not normalized:
        return ""
    if re.fullmatch(r"[a-f0-9]{64}", normalized):
        return normalized
    return _hash_text(normalized)


def _non_negative_int(value: Any) -> int:
    try:
        return max(0, int(value or 0))
    except (TypeError, ValueError):
        return 0


def _safe_event_details(raw_details: Any) -> dict[str, Any]:
    if not isinstance(raw_details, dict):
        return {}
    allowed_bool = {"enabled", "contains_plaintext"}
    allowed_int = {
        "mapping_table_count",
        "supported_count",
        "unsupported_count",
        "missing_count",
        "unexpected_count",
        "placeholder_count",
        "entity_count",
        "restored_count",
        "historical_reuse_count",
        "current_document_global_replace_count",
    }
    safe: dict[str, Any] = {}
    for key, value in raw_details.items():
        normalized_key = str(key or "").strip()
        if normalized_key in allowed_bool:
            safe[normalized_key] = bool(value)
        elif normalized_key in allowed_int:
            safe[normalized_key] = _non_negative_int(value)
        elif normalized_key == "mode":
            safe[normalized_key] = _bounded_enum(value, {"compatibility", "strong", "legacy"}, "compatibility")
    return safe


def _bounded_limit(value: Any) -> int:
    try:
        raw_limit = int(value or 100)
    except (TypeError, ValueError):
        raw_limit = 100
    return max(1, min(raw_limit, GATEWAY_EVENT_MAX_LIMIT))


def _bounded_cleanup_seconds(value: Any) -> int:
    try:
        raw_value = int(value if value is not None else 0)
    except (TypeError, ValueError):
        raw_value = 0
    return max(0, min(raw_value, 30 * 24 * 60 * 60))


def _json_value(value: Any) -> Any:
    if value is None:
        return {}
    if isinstance(value, (dict, list)):
        return value
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return {}
    return {}


def _iso_value(value: Any) -> str:
    if value is None:
        return ""
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


def _database_error(exc: Exception) -> PlatformError:
    logger.exception("PIPT gateway PostgreSQL operation failed")
    return PlatformError(
        code="DATABASE_ERROR",
        message="PIPT 网关数据库访问失败。",
        status_code=500,
        details={"module": "pipt-gateway", "schema": "core"},
    )


def _build_audit_stub(
    *,
    request_id: str,
    module_code: str,
    purpose: str,
    operation: str,
    status: str,
    details: dict[str, Any],
) -> dict[str, Any]:
    return {
        "request_id": request_id,
        "module_code": module_code,
        "purpose": purpose,
        "operation": operation,
        "status": status,
        "details": details,
        "contains_plaintext": False,
    }


def _expected_tokens(raw_manifest: Any) -> list[str]:
    if isinstance(raw_manifest, str):
        try:
            raw_manifest = json.loads(raw_manifest)
        except json.JSONDecodeError:
            return []
    if not isinstance(raw_manifest, dict):
        return []
    return sorted(str(token) for token in raw_manifest if str(token or "").strip())


def _infer_entity_type(token: str) -> str:
    legacy_match = re.search(r"\{\{__PIPT_([a-z_]+)_\d+__\}\}", token)
    if legacy_match:
        return legacy_match.group(1)
    if STRONG_PIPT_RE.fullmatch(token):
        return "sensitive_entity"
    if BIDDER_RE.fullmatch(token):
        return "bidder_field"
    return "unknown"


def _find_suspect_placeholders(text: str) -> list[str]:
    pattern = re.compile(
        r"\{\{[^{}]*(?:PIPT|BIDDER)[^{}]*\}\}|(?<!\{)\{[^{}]*(?:PIPT|BIDDER)[^{}]*\}(?!\})|@@[^@\s]*(?:PIPT|BIDDER)[^@\s]*@@?",
        re.IGNORECASE,
    )
    issues: list[str] = []
    for match in pattern.finditer(str(text or "")):
        token = match.group(0)
        if STRONG_PIPT_RE.fullmatch(token) or LEGACY_PIPT_RE.fullmatch(token) or BIDDER_RE.fullmatch(token):
            continue
        if token not in issues:
            issues.append(token)
    return issues


def _role_for_entity_type(entity_type: str) -> str:
    return {
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
        "bidder_field": "投标人字段",
        "sensitive_entity": "敏感实体",
    }.get(str(entity_type or ""), "敏感实体")
