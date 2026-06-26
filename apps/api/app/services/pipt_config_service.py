from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.core.errors import PlatformError
from packages.py_common.db.session import get_engine


DEFAULT_TARGET_ENTITIES = ["name", "phone", "id_number", "email", "addr", "bank", "car_id", "ip", "org", "credit_code"]

PIPT_TASK_MODULES = [
    {"code": "contract-review", "name": "合同"},
    {"code": "bid-generator", "name": "标书"},
    {"code": "knowledge-base", "name": "知识库"},
]

BUILTIN_ENTITY_TYPES = [
    {"code": "name", "label": "姓名", "builtin": True},
    {"code": "phone", "label": "手机号", "builtin": True},
    {"code": "id_number", "label": "身份证号", "builtin": True},
    {"code": "email", "label": "电子邮箱", "builtin": True},
    {"code": "addr", "label": "地址", "builtin": True},
    {"code": "bank", "label": "银行卡号", "builtin": True},
    {"code": "car_id", "label": "车牌号", "builtin": True},
    {"code": "ip", "label": "IP 地址", "builtin": True},
    {"code": "org", "label": "机构名称", "builtin": True},
    {"code": "credit_code", "label": "统一社会信用代码", "builtin": True},
]

DEFAULT_TASK_CONFIGS = {
    "contract-review": {
        "enabled": True,
        "enabled_entity_types": list(DEFAULT_TARGET_ENTITIES),
    },
    "bid-generator": {
        "enabled": True,
        "enabled_entity_types": ["name", "phone", "email", "id_number"],
    },
    "knowledge-base": {
        "enabled": True,
        "enabled_entity_types": list(DEFAULT_TARGET_ENTITIES),
    },
}


def _database_error(exc: Exception) -> PlatformError:
    return PlatformError(
        code="DATABASE_ERROR",
        message="PIPT 配置数据库访问失败。",
        status_code=500,
        details={"module": "pipt-config", "schema": "core"},
    )


def ensure_pipt_config_storage() -> None:
    try:
        with get_engine().begin() as conn:
            conn.execute(text('CREATE SCHEMA IF NOT EXISTS "core"'))
            conn.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS core.pipt_custom_entity_types (
                      code VARCHAR(100) PRIMARY KEY,
                      label TEXT NOT NULL,
                      description TEXT NOT NULL DEFAULT '',
                      examples JSONB NOT NULL DEFAULT '[]'::jsonb,
                      regex_rules JSONB NOT NULL DEFAULT '[]'::jsonb,
                      enabled BOOLEAN NOT NULL DEFAULT TRUE,
                      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
                    )
                    """
                )
            )
            conn.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS core.pipt_task_configs (
                      module_code VARCHAR(100) PRIMARY KEY,
                      enabled BOOLEAN NOT NULL DEFAULT TRUE,
                      enabled_entity_types JSONB NOT NULL DEFAULT '[]'::jsonb,
                      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
                    )
                    """
                )
            )
            for module_code, config in DEFAULT_TASK_CONFIGS.items():
                conn.execute(
                    text(
                        """
                        INSERT INTO core.pipt_task_configs (module_code, enabled, enabled_entity_types)
                        VALUES (:module_code, :enabled, CAST(:enabled_entity_types AS jsonb))
                        ON CONFLICT (module_code) DO NOTHING
                        """
                    ),
                    {
                        "module_code": module_code,
                        "enabled": bool(config["enabled"]),
                        "enabled_entity_types": _json_array(config["enabled_entity_types"]),
                    },
                )
    except (SQLAlchemyError, RuntimeError) as exc:
        raise _database_error(exc) from exc


def get_pipt_config_payload() -> dict[str, Any]:
    ensure_pipt_config_storage()
    custom_types = list_custom_entity_types_payload()["items"]
    task_rows = _task_config_rows()
    all_types = [*BUILTIN_ENTITY_TYPES, *custom_types]
    return {
        "modules": PIPT_TASK_MODULES,
        "entity_types": all_types,
        "builtin_entity_types": BUILTIN_ENTITY_TYPES,
        "custom_entity_types": custom_types,
        "task_configs": [
            _task_config_payload(module["code"], task_rows.get(module["code"]), all_types)
            for module in PIPT_TASK_MODULES
        ],
    }


def update_task_configs_payload(items: Any) -> dict[str, Any]:
    ensure_pipt_config_storage()
    if not isinstance(items, list):
        raise PlatformError(code="VALIDATION_ERROR", message="任务配置必须是数组。", status_code=422)
    valid_modules = {item["code"] for item in PIPT_TASK_MODULES}
    allowed_entities = {item["code"] for item in [*BUILTIN_ENTITY_TYPES, *list_custom_entity_types_payload()["items"]]}
    normalized: list[dict[str, Any]] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        module_code = str(item.get("module_code") or item.get("code") or "").strip()
        if module_code not in valid_modules:
            continue
        requested = item.get("enabled_entity_types")
        entities = [
            str(entity).strip()
            for entity in requested
            if str(entity or "").strip() in allowed_entities
        ] if isinstance(requested, list) else []
        normalized.append(
            {
                "module_code": module_code,
                "enabled": bool(item.get("enabled")),
                "enabled_entity_types": _dedupe(entities),
            }
        )
    try:
        with get_engine().begin() as conn:
            for item in normalized:
                conn.execute(
                    text(
                        """
                        INSERT INTO core.pipt_task_configs (module_code, enabled, enabled_entity_types, updated_at)
                        VALUES (:module_code, :enabled, CAST(:enabled_entity_types AS jsonb), now())
                        ON CONFLICT (module_code) DO UPDATE
                        SET enabled = EXCLUDED.enabled,
                            enabled_entity_types = EXCLUDED.enabled_entity_types,
                            updated_at = now()
                        """
                    ),
                    {
                        "module_code": item["module_code"],
                        "enabled": item["enabled"],
                        "enabled_entity_types": _json_array(item["enabled_entity_types"]),
                    },
                )
    except (SQLAlchemyError, RuntimeError) as exc:
        raise _database_error(exc) from exc
    return get_pipt_config_payload()


def list_custom_entity_types_payload() -> dict[str, Any]:
    ensure_pipt_config_storage()
    try:
        with get_engine().begin() as conn:
            rows = conn.execute(
                text(
                    """
                    SELECT code, label, description, examples, regex_rules, enabled, created_at, updated_at
                    FROM core.pipt_custom_entity_types
                    ORDER BY updated_at DESC, code ASC
                    """
                )
            ).mappings().all()
    except (SQLAlchemyError, RuntimeError) as exc:
        raise _database_error(exc) from exc
    items = [_custom_entity_payload(row) for row in rows]
    return {"items": items, "count": len(items)}


def upsert_custom_entity_type_payload(data: dict[str, Any]) -> dict[str, Any]:
    ensure_pipt_config_storage()
    code = _normalize_code(data.get("code"))
    label = str(data.get("label") or "").strip()
    if not code or code in {item["code"] for item in BUILTIN_ENTITY_TYPES}:
        raise PlatformError(code="VALIDATION_ERROR", message="自定义类型编码无效或与内置类型冲突。", status_code=422)
    if not label:
        raise PlatformError(code="VALIDATION_ERROR", message="自定义类型名称不能为空。", status_code=422)
    regex_rules = _normalize_regex_rules(data.get("regex_rules"))
    for rule in regex_rules:
        _compile_regex(str(rule.get("pattern") or ""))
    examples = [str(item).strip() for item in data.get("examples", []) if str(item or "").strip()] if isinstance(data.get("examples"), list) else []
    try:
        with get_engine().begin() as conn:
            row = conn.execute(
                text(
                    """
                    INSERT INTO core.pipt_custom_entity_types
                      (code, label, description, examples, regex_rules, enabled, updated_at)
                    VALUES
                      (:code, :label, :description, CAST(:examples AS jsonb), CAST(:regex_rules AS jsonb), :enabled, now())
                    ON CONFLICT (code) DO UPDATE
                    SET label = EXCLUDED.label,
                        description = EXCLUDED.description,
                        examples = EXCLUDED.examples,
                        regex_rules = EXCLUDED.regex_rules,
                        enabled = EXCLUDED.enabled,
                        updated_at = now()
                    RETURNING code, label, description, examples, regex_rules, enabled, created_at, updated_at
                    """
                ),
                {
                    "code": code,
                    "label": label,
                    "description": str(data.get("description") or "").strip(),
                    "examples": _json_array(examples[:20]),
                    "regex_rules": _json_array(regex_rules),
                    "enabled": bool(data.get("enabled", True)),
                },
            ).mappings().one()
    except (SQLAlchemyError, RuntimeError) as exc:
        raise _database_error(exc) from exc
    return {"item": _custom_entity_payload(row), "config": get_pipt_config_payload()}


def delete_custom_entity_type_payload(code: str) -> dict[str, Any]:
    ensure_pipt_config_storage()
    normalized_code = _normalize_code(code)
    if not normalized_code:
        raise PlatformError(code="VALIDATION_ERROR", message="自定义类型编码不能为空。", status_code=422)
    try:
        with get_engine().begin() as conn:
            conn.execute(
                text("DELETE FROM core.pipt_custom_entity_types WHERE code = :code"),
                {"code": normalized_code},
            )
            rows = conn.execute(
                text("SELECT module_code, enabled_entity_types FROM core.pipt_task_configs")
            ).mappings().all()
            for row in rows:
                entities = [item for item in _json_list(row.get("enabled_entity_types")) if item != normalized_code]
                conn.execute(
                    text(
                        """
                        UPDATE core.pipt_task_configs
                        SET enabled_entity_types = CAST(:enabled_entity_types AS jsonb), updated_at = now()
                        WHERE module_code = :module_code
                        """
                    ),
                    {
                        "module_code": row["module_code"],
                        "enabled_entity_types": _json_array(entities),
                    },
                )
    except (SQLAlchemyError, RuntimeError) as exc:
        raise _database_error(exc) from exc
    return get_pipt_config_payload()


def test_custom_regex_payload(data: dict[str, Any]) -> dict[str, Any]:
    text_value = str(data.get("text") or "")
    regex_rules = _normalize_regex_rules(data.get("regex_rules"))
    matches: list[dict[str, Any]] = []
    for index, rule in enumerate(regex_rules):
        pattern = str(rule.get("pattern") or "")
        compiled = _compile_regex(pattern)
        for match in compiled.finditer(text_value):
            matches.append(
                {
                    "text": match.group(0),
                    "start": match.start(),
                    "end": match.end(),
                    "rule_index": index,
                    "rule_name": rule.get("name") or f"规则 {index + 1}",
                }
            )
            if len(matches) >= 100:
                break
        if len(matches) >= 100:
            break
    return {"matches": matches, "count": len(matches), "truncated": len(matches) >= 100}


def get_module_pipt_runtime_config(module_code: str) -> dict[str, Any]:
    ensure_pipt_config_storage()
    code = str(module_code or "").strip()
    row = _task_config_rows().get(code)
    default = DEFAULT_TASK_CONFIGS.get(code, {"enabled": False, "enabled_entity_types": []})
    enabled = bool(row.get("enabled")) if row else bool(default["enabled"])
    entities = _json_list(row.get("enabled_entity_types")) if row else list(default["enabled_entity_types"])
    allowed = {item["code"] for item in [*BUILTIN_ENTITY_TYPES, *list_custom_entity_types_payload()["items"]]}
    return {
        "module_code": code,
        "enabled": enabled,
        "target_entities": [item for item in entities if item in allowed],
    }


def get_custom_regex_patterns() -> dict[str, list[dict[str, str]]]:
    patterns: dict[str, list[dict[str, str]]] = {}
    for item in list_custom_entity_types_payload()["items"]:
        if not item.get("enabled"):
            continue
        rules = []
        for rule in item.get("regex_rules") or []:
            if isinstance(rule, dict) and str(rule.get("pattern") or "").strip():
                rules.append({"name": str(rule.get("name") or ""), "pattern": str(rule.get("pattern") or "")})
        if rules:
            patterns[str(item["code"])] = rules
    return patterns


def _task_config_rows() -> dict[str, dict[str, Any]]:
    try:
        with get_engine().begin() as conn:
            rows = conn.execute(
                text("SELECT module_code, enabled, enabled_entity_types, updated_at FROM core.pipt_task_configs")
            ).mappings().all()
    except (SQLAlchemyError, RuntimeError) as exc:
        raise _database_error(exc) from exc
    return {str(row["module_code"]): dict(row) for row in rows}


def _task_config_payload(module_code: str, row: dict[str, Any] | None, all_types: list[dict[str, Any]]) -> dict[str, Any]:
    default = DEFAULT_TASK_CONFIGS[module_code]
    allowed = {item["code"] for item in all_types}
    entities = _json_list(row.get("enabled_entity_types")) if row else list(default["enabled_entity_types"])
    return {
        "module_code": module_code,
        "enabled": bool(row.get("enabled")) if row else bool(default["enabled"]),
        "enabled_entity_types": [item for item in entities if item in allowed],
        "updated_at": _iso(row.get("updated_at")) if row else "",
    }


def _custom_entity_payload(row: Any) -> dict[str, Any]:
    return {
        "code": str(row.get("code") or ""),
        "label": str(row.get("label") or ""),
        "description": str(row.get("description") or ""),
        "examples": _json_list(row.get("examples")),
        "regex_rules": _json_list(row.get("regex_rules")),
        "enabled": bool(row.get("enabled")),
        "builtin": False,
        "created_at": _iso(row.get("created_at")),
        "updated_at": _iso(row.get("updated_at")),
    }


def _normalize_code(value: Any) -> str:
    text_value = str(value or "").strip().lower().replace("-", "_")
    if not re.fullmatch(r"[a-z][a-z0-9_]{1,63}", text_value):
        return ""
    return text_value


def _normalize_regex_rules(value: Any) -> list[dict[str, str]]:
    raw_items = value if isinstance(value, list) else []
    rules: list[dict[str, str]] = []
    for index, item in enumerate(raw_items):
        if isinstance(item, str):
            pattern = item.strip()
            name = f"规则 {index + 1}"
        elif isinstance(item, dict):
            pattern = str(item.get("pattern") or "").strip()
            name = str(item.get("name") or f"规则 {index + 1}").strip()
        else:
            continue
        if pattern:
            rules.append({"name": name or f"规则 {index + 1}", "pattern": pattern})
    if not rules:
        raise PlatformError(code="VALIDATION_ERROR", message="至少需要一条有效正则。", status_code=422)
    return rules[:20]


def _compile_regex(pattern: str) -> re.Pattern[str]:
    try:
        return re.compile(pattern)
    except re.error as exc:
        raise PlatformError(
            code="VALIDATION_ERROR",
            message=f"正则表达式无效：{exc}",
            status_code=422,
            details={"pattern": pattern},
        ) from exc


def _json_array(items: Any) -> str:
    import json

    return json.dumps(items if isinstance(items, list) else [], ensure_ascii=False)


def _json_list(value: Any) -> list[Any]:
    import json

    if isinstance(value, list):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, list) else []
        except json.JSONDecodeError:
            return []
    return []


def _dedupe(items: list[str]) -> list[str]:
    selected: list[str] = []
    seen: set[str] = set()
    for item in items:
        if item in seen:
            continue
        selected.append(item)
        seen.add(item)
    return selected


def _iso(value: Any) -> str:
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc).isoformat()
    return str(value or "")
