from __future__ import annotations

import json
import os
import logging
from pathlib import Path
from typing import Any, Mapping

from app.core.config import get_api_settings
from app.core.errors import PlatformError
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from packages.py_common.db.session import get_engine

logger = logging.getLogger(__name__)

DIAGRAM_GENERATION_ENABLED = False

WORKFLOWS: tuple[tuple[str, str, str, bool, str], ...] = (
    ("structure_generator", "DIFY_WORKFLOW_STRUCTURE_GENERATOR", "大纲生成", True, "managed"),
    ("content_writer", "DIFY_WORKFLOW_CONTENT_WRITER", "单章节内容生成", True, "managed"),
    ("content_group_writer", "DIFY_WORKFLOW_CONTENT_GROUP_WRITER", "H2分组正文生成", True, "managed"),
    ("content_rewrite", "DIFY_WORKFLOW_CONTENT_REWRITE", "单章节重生成", True, "managed"),
    ("response_content_writer", "DIFY_WORKFLOW_RESPONSE_CONTENT_WRITER", "响应情况正文生成", True, "managed"),
    ("diagram_generator", "DIFY_WORKFLOW_DIAGRAM_GENERATOR", "图表生成", True, "managed"),
    ("doc_analysis", "DIFY_WORKFLOW_DOC_ANALYSIS", "文档分析", True, "managed"),
    ("requirement_extractor", "DIFY_WORKFLOW_REQUIREMENT_EXTRACTOR", "需求提取", False, "legacy"),
    ("blueprint_generator", "DIFY_WORKFLOW_BLUEPRINT_GENERATOR", "全局策略蓝图", False, "legacy"),
    ("group_review_writer", "DIFY_WORKFLOW_GROUP_REVIEW_WRITER", "H2章节评估", False, "legacy"),
    ("attachment_generator", "DIFY_WORKFLOW_ATTACHMENT_GENERATOR", "智能附件生成", False, "legacy"),
    ("scoring_assistant", "DIFY_WORKFLOW_SCORING_ASSISTANT", "评分AI助手", False, "legacy"),
)

SUPPORTED_ENTITIES: dict[str, str] = {
    "name": "姓名",
    "phone": "电话号码",
    "id_number": "身份证号",
    "bank": "银行账户",
    "car_id": "车牌号",
    "ip": "IP地址",
    "email": "电子邮箱",
    "addr": "地址",
    "gender": "性别",
    "political_status": "政治面貌",
    "nation": "民族",
    "org": "企业/机构",
}


class BidProjectNotFound(Exception):
    pass


def _repo_root() -> Path:
    return get_api_settings().repo_root


def _bid_generator_root() -> Path:
    return _repo_root() / "legacy" / "bid-generator" / "pipt-flask"


def _read_root_env_value(env_var: str) -> str:
    for env_path in (_repo_root() / ".env", _repo_root() / "legacy" / "bid-generator" / ".env"):
        try:
            if not env_path.exists():
                continue
            with env_path.open("r", encoding="utf-8") as file:
                for raw_line in file:
                    line = raw_line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    key, value = line.split("=", 1)
                    if key.strip() == env_var:
                        return value.strip().strip('"').strip("'")
        except OSError:
            continue
    return ""


def _get_workflow_key_source(workflow_name: str) -> tuple[bool, str]:
    env_var = f"DIFY_WORKFLOW_{workflow_name.upper()}"
    if os.environ.get(env_var, "").strip():
        return True, "process_env"
    if _read_root_env_value(env_var):
        return True, "root_env_file"
    return False, "missing"


def get_health_payload() -> dict[str, str]:
    return {"status": "ok", "service": "pipt-lite"}


def get_workflow_status_payload() -> dict[str, dict[str, str | bool]]:
    status: dict[str, dict[str, str | bool]] = {}
    for name, env_var, label, managed, lifecycle in WORKFLOWS:
        configured, source = _get_workflow_key_source(name)
        source_value = source
        if name == "diagram_generator" and not DIAGRAM_GENERATION_ENABLED:
            configured = False
            source_value = "disabled"
        status[name] = {
            "label": label,
            "env_var": env_var,
            "configured": configured,
            "source": source_value,
            "managed": managed,
            "lifecycle": lifecycle,
        }
    return status


def get_analysis_framework_payload() -> Any:
    config_path = _bid_generator_root() / "config" / "analysis_framework.json"
    if not config_path.exists():
        raise PlatformError(
            code="RESOURCE_NOT_FOUND",
            message="analysis_framework.json 配置文件不存在",
            status_code=404,
        )
    try:
        with config_path.open("r", encoding="utf-8") as file:
            return json.load(file)
    except json.JSONDecodeError as exc:
        raise PlatformError(
            code="BUSINESS_DIRECT_ERROR",
            message="analysis_framework.json 配置文件不是合法 JSON。",
            status_code=500,
        ) from exc


def get_supported_entities_payload() -> dict[str, Any]:
    return {
        "entities": SUPPORTED_ENTITIES,
        "description": "key 为实体标识符，value 为中文名称",
    }


def _database_error(exc: Exception) -> PlatformError:
    logger.exception("Bid-generator PostgreSQL operation failed")
    return PlatformError(
        code="DATABASE_ERROR",
        message="标书生成项目数据库访问失败。",
        status_code=500,
        details={"module": "bid-generator", "schema": "bid_generator"},
    )


def _ensure_project_storage() -> None:
    try:
        with get_engine().begin() as conn:
            exists = conn.execute(text("SELECT to_regclass('bid_generator.projects') IS NOT NULL")).scalar_one()
    except (SQLAlchemyError, RuntimeError) as exc:
        raise _database_error(exc) from exc

    if not exists:
        raise PlatformError(
            code="DATABASE_ERROR",
            message="标书生成项目数据库表不存在。",
            status_code=500,
            details={"table": "bid_generator.projects"},
        )


def _json_value(value: Any) -> Any:
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError as exc:
            raise PlatformError(
                code="BUSINESS_DIRECT_ERROR",
                message="标书生成项目数据不是合法 JSON。",
                status_code=500,
            ) from exc
    return value if value is not None else {}


def _iso_value(value: Any) -> str:
    if value is None:
        return ""
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


def _project_from_row(row: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "id": str(row["id"]),
        "name": str(row["name"]),
        "status": str(row["status"]),
        "data": _json_value(row.get("data")),
        "created_at": _iso_value(row.get("created_at")),
        "updated_at": _iso_value(row.get("updated_at")),
    }


def list_projects_payload() -> list[dict[str, Any]]:
    _ensure_project_storage()
    try:
        with get_engine().begin() as conn:
            rows = conn.execute(
                text(
                    """
                    SELECT id, name, status, data, created_at, updated_at
                    FROM bid_generator.projects
                    ORDER BY created_at DESC
                    """
                )
            ).mappings().all()
    except (SQLAlchemyError, RuntimeError) as exc:
        raise _database_error(exc) from exc
    return [_project_from_row(row) for row in rows]


def get_project_payload(project_id: str) -> dict[str, Any]:
    _ensure_project_storage()
    try:
        with get_engine().begin() as conn:
            row = conn.execute(
                text(
                    """
                    SELECT id, name, status, data, created_at, updated_at
                    FROM bid_generator.projects
                    WHERE id = :project_id
                    """
                ),
                {"project_id": project_id},
            ).mappings().first()
    except (SQLAlchemyError, RuntimeError) as exc:
        raise _database_error(exc) from exc
    if row is None:
        raise BidProjectNotFound()
    return _project_from_row(row)


def get_project_mappings_payload(project_id: str) -> dict[str, Any]:
    project = get_project_payload(project_id)
    data = project.get("data") if isinstance(project, dict) else {}
    if not isinstance(data, dict):
        mapping_table = {}
    else:
        mapping_table = data.get("mappingTable", {})
    try:
        count = len(mapping_table)
    except TypeError:
        count = 0
    return {"mappings": mapping_table, "count": count}
