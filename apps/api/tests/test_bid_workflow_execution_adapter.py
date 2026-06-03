from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import patch

import pytest

API_ROOT = Path(__file__).resolve().parents[1]
API_ROOT_VALUE = str(API_ROOT)
if API_ROOT_VALUE not in sys.path:
    sys.path.insert(0, API_ROOT_VALUE)

from app.core.errors import PlatformError
from app.services import bid_workflow_execution_adapter as adapter


def test_generate_template_architecture_payload_uses_native_structure_workflow() -> None:
    captured: dict[str, object] = {}

    async def fake_call_dify_workflow(api_key, inputs):
        captured["api_key"] = api_key
        captured["inputs"] = inputs
        return {
            "data": {
                "outputs": {
                    "text": "```yaml\nid: custom\nblocks:\n  - id: sec_1\n    title: 第一章\n```",
                }
            }
        }

    with (
        patch("app.services.bid_generator_service._get_workflow_key", return_value="workflow-key"),
        patch("app.services.bid_generator_service._call_dify_workflow", side_effect=fake_call_dify_workflow),
    ):
        payload = _run_async(
            adapter.generate_template_architecture_payload(
                {
                    "project_name": "项目一",
                    "blueprint": "蓝图",
                    "structured_data": "{\"requirements\": []}",
                }
            )
        )

    assert captured["api_key"] == "workflow-key"
    inputs = captured["inputs"]
    assert isinstance(inputs, dict)
    assert "项目一" in str(inputs["system_prompt"])
    assert "蓝图" in str(inputs["system_prompt"])
    assert inputs["structured_data"] == "{\"requirements\": []}"
    assert inputs["knowledge_query"] == "项目一 目录架构搭建"
    assert inputs["requires_search"] == "false"
    assert payload == {"structure_dict": {"id": "custom", "blocks": [{"id": "sec_1", "title": "第一章"}]}}


def test_generate_template_architecture_payload_wraps_list_output_like_legacy() -> None:
    async def fake_call_dify_workflow(_api_key, _inputs):
        return {"data": {"outputs": {"result": "- id: sec_1\n  title: 第一章\n"}}}

    with (
        patch("app.services.bid_generator_service._get_workflow_key", return_value="workflow-key"),
        patch("app.services.bid_generator_service._call_dify_workflow", side_effect=fake_call_dify_workflow),
    ):
        payload = _run_async(adapter.generate_template_architecture_payload({"project_name": "项目一"}))

    assert payload == {
        "structure_dict": {
            "name": "项目一专属架构",
            "id": "dynamic_struct_01",
            "blocks": [{"id": "sec_1", "title": "第一章"}],
        }
    }


def test_generate_template_architecture_payload_requires_native_workflow_key() -> None:
    with patch("app.services.bid_generator_service._get_workflow_key", return_value=""):
        with pytest.raises(PlatformError) as exc_info:
            _run_async(adapter.generate_template_architecture_payload({"project_name": "项目一"}))

    error = exc_info.value
    assert error.code == "BID_TEMPLATE_GENERATE_FAILED"
    assert error.status_code == 500
    assert "DIFY_WORKFLOW_STRUCTURE_GENERATOR" in error.message


def test_template_adapter_has_no_legacy_route_import_boundary() -> None:
    assert not hasattr(adapter, "_ensure_legacy_imported")


def _run_async(awaitable):
    import asyncio

    return asyncio.run(awaitable)
