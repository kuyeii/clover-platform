from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any, Mapping

import yaml

from app.core.config import get_api_settings


def _manifest_path() -> Path:
    return get_api_settings().repo_root / "apps" / "api" / "app" / "resources" / "bid_generator" / "model_manifest.yaml"


@lru_cache(maxsize=1)
def load_bid_model_manifest() -> dict[str, Any]:
    """读取标书模型 manifest；出参为 DSL 转 Python 的模型节点配置。"""
    try:
        with _manifest_path().open("r", encoding="utf-8") as file:
            data = yaml.safe_load(file) or {}
    except OSError:
        return {}
    return data if isinstance(data, dict) else {}


def get_bid_model_node(workflow: str, node_key: str) -> dict[str, Any]:
    """按 workflow/node_key 读取模型节点；缺失时返回空字典。"""
    manifest = load_bid_model_manifest()
    workflows = manifest.get("workflows") if isinstance(manifest.get("workflows"), dict) else {}
    workflow_config = workflows.get(workflow) if isinstance(workflows.get(workflow), dict) else {}
    nodes = workflow_config.get("nodes") if isinstance(workflow_config.get("nodes"), dict) else {}
    node = nodes.get(node_key) if isinstance(nodes.get(node_key), dict) else {}
    return dict(node)


def get_bid_model_completion_params(workflow: str, node_key: str) -> dict[str, Any]:
    """读取节点 completion 参数；用于保持 Python 调用与 DSL 参数等价。"""
    node = get_bid_model_node(workflow, node_key)
    params = node.get("completion_params") if isinstance(node.get("completion_params"), Mapping) else {}
    return dict(params)
