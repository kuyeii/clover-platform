from __future__ import annotations

import json
import re
from typing import Any, Mapping

import yaml

from app.core.errors import PlatformError


async def generate_template_architecture_payload(body: Mapping[str, Any]) -> dict[str, Any]:
    """使用统一后端 Dify structure_generator 生成项目专属模板结构。"""
    payload = dict(body or {})
    project_name = str(payload.get("project_name") or payload.get("projectName") or "").strip()
    blueprint = str(payload.get("blueprint") or "")
    structured_data = str(payload.get("structured_data") or payload.get("structuredData") or "")
    if not project_name:
        raise PlatformError(code="BID_TEMPLATE_GENERATE_FAILED", message="项目名称不能为空。", status_code=400)

    from app.services import bid_generator_service as bid_service

    dify_key = bid_service._get_workflow_key("structure_generator")
    if not dify_key:
        raise PlatformError(
            code="BID_TEMPLATE_GENERATE_FAILED",
            message="模板结构生成工作流 API Key 未配置，请在 .env 中设置 DIFY_WORKFLOW_STRUCTURE_GENERATOR",
            status_code=500,
        )

    prompt = (
        f"你是一个资深售前解决方案架构师。请针对当前项目【{project_name}】，"
        "结合蓝图与需求，生成一份专属的标书结构目录YAML配置。"
        "产出格式必须符合系统标准的 blocks 数组结构，只输出合法的YAML。"
    )
    inputs = {
        "system_prompt": f"{prompt}\n\n{blueprint}".strip(),
        "structured_data": structured_data,
        "knowledge_query": f"{project_name} 目录架构搭建",
        "requires_search": "false",
    }
    try:
        dify_res = await bid_service._call_dify_workflow(dify_key, inputs)
    except Exception as exc:
        raise PlatformError(
            code="BID_TEMPLATE_GENERATE_FAILED",
            message=bid_service._format_dify_runtime_error(exc),
            status_code=500,
        ) from exc

    structure_dict = _normalize_structure_dict(_extract_dify_structure_raw(dify_res), project_name=project_name)
    return {"structure_dict": structure_dict}


def _extract_dify_structure_raw(dify_res: Mapping[str, Any]) -> Any:
    outputs = dify_res.get("data", {}).get("outputs", {}) if isinstance(dify_res, Mapping) else {}
    if not isinstance(outputs, Mapping):
        return outputs
    return (
        outputs.get("structured_output")
        or outputs.get("structure_dict")
        or outputs.get("result")
        or outputs.get("text")
        or outputs
    )


def _normalize_structure_dict(raw: Any, *, project_name: str) -> dict[str, Any]:
    parsed = _parse_structure_value(raw)
    if isinstance(parsed, dict) and isinstance(parsed.get("blocks"), list):
        return parsed
    blocks = parsed if isinstance(parsed, list) else []
    return {
        "name": f"{project_name}专属架构",
        "id": "dynamic_struct_01",
        "blocks": blocks,
    }


def _parse_structure_value(raw: Any) -> Any:
    if isinstance(raw, (dict, list)):
        return raw
    if not isinstance(raw, str):
        return {}
    text = _extract_fenced_yaml(raw.strip())
    if not text:
        return {}
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    try:
        return yaml.safe_load(text)
    except yaml.YAMLError:
        return {}


def _extract_fenced_yaml(text: str) -> str:
    match = re.search(r"```(?:yaml|yml|json)?\s*(.*?)```", text, flags=re.DOTALL | re.IGNORECASE)
    return match.group(1).strip() if match else text
