from __future__ import annotations

import asyncio
import importlib
import json
from pathlib import Path
from types import SimpleNamespace
import sys

import pytest


REPO_ROOT = Path(__file__).resolve().parents[3]
PIPT_ROOT = REPO_ROOT / "legacy" / "bid-generator" / "pipt-flask"
PIPT_ROOT_VALUE = str(PIPT_ROOT)
if PIPT_ROOT_VALUE not in sys.path:
    sys.path.insert(0, PIPT_ROOT_VALUE)

try:
    task_routes = importlib.import_module("app.api_lite.task_routes")
    legacy_routes = importlib.import_module("app.api_lite.routes")
    writing_hint_builder = importlib.import_module("app.api_lite.writing_hint_builder")
except ModuleNotFoundError as exc:  # pragma: no cover - 依赖环境缺失时给出清晰跳过原因
    pytest.skip(f"pipt-lite 测试依赖缺失: {exc}", allow_module_level=True)


def test_runtime_writing_hint_forbids_model_made_structural_headings() -> None:
    hint = writing_hint_builder.compose_runtime_writing_hint(
        "围绕业务场景展开",
        "1.2 核心业务场景与技术功能映射",
        1200,
        "可信数据空间",
        section_outline_slice="1 对本项目的理解\n  [当前] 1.2 核心业务场景与技术功能映射",
    )

    assert "只输出本节标题下面应出现的正文内容" in hint
    assert "不得输出" in hint
    assert "一、/二、/三、" in hint
    assert "1.1/1.2/1.1.1" in hint


def test_generated_body_does_not_delete_numbered_body_lines() -> None:
    raw = "**一、GDPR长臂管辖与域外执法风险**\n\n欧盟法规要求建立评估机制。\n\n**二、跨法域合规冲突**\n\n需要建立规则库。"

    assert "**一、GDPR长臂管辖与域外执法风险**" in task_routes._finalize_generated_body(
        raw,
        "2.1 跨境数据合规复杂性分析",
    )
    assert "**二、跨法域合规冲突**" in legacy_routes._finalize_legacy_body(
        raw,
        "2.1 跨境数据合规复杂性分析",
    )


def test_generated_body_does_not_delete_repeated_current_section_title() -> None:
    raw = "1.2 核心业务场景与技术功能映射\n\n本节围绕业务场景展开。"

    task_content = task_routes._finalize_generated_body(raw, "1.2 核心业务场景与技术功能映射")
    legacy_content = legacy_routes._finalize_legacy_body(raw, "1.2 核心业务场景与技术功能映射")

    assert "1.2 核心业务场景与技术功能映射" in task_content
    assert "本节围绕业务场景展开。" in task_content
    assert "1.2 核心业务场景与技术功能映射" in legacy_content
    assert "本节围绕业务场景展开。" in legacy_content


def test_group_result_reports_missing_child_section(monkeypatch: pytest.MonkeyPatch) -> None:
    children = [
        {"section_id": "1.1", "section_title": "1.1 政策环境"},
        {"section_id": "1.2", "section_title": "1.2 核心业务场景"},
        {"section_id": "1.3", "section_title": "1.3 里程碑"},
    ]

    def fake_finalize(section_title: str, outputs: dict, request_mapping_flat: dict, **_kwargs: object) -> dict:
        return {
            "content": outputs["text"],
            "word_count": len(outputs["text"]),
            "replace_report": [],
            "placeholder_issues": [],
        }

    monkeypatch.setattr(task_routes, "_finalize_single_content_result", fake_finalize)
    parsed = task_routes._parse_group_content_results(
        {
            "sections": [
                {"section_id": "1.1", "content": "政策正文"},
                {"section_id": "1.3", "content": "里程碑正文"},
            ]
        },
        children,
        {},
    )

    assert [row["section_id"] for row in parsed["sections"]] == ["1.1", "1.3"]
    assert parsed["failed_sections"] == [
        {"section_id": "1.2", "section_title": "1.2 核心业务场景", "error": "批量正文结果缺失子章节"}
    ]
    assert parsed["parse_error"] == "批量正文结果存在缺失子章节"


def test_repair_group_failed_sections_uses_single_content_workflow(monkeypatch: pytest.MonkeyPatch) -> None:
    children = [
        {
            "section_id": "1.2",
            "section_title": "1.2 核心业务场景",
            "writing_hint": "围绕业务场景写正文",
            "keywords": "数据可用不可见",
            "expected_words": 1200,
            "requires_search": True,
            "generation_strategy": "general",
        }
    ]
    fake_routes = SimpleNamespace(
        _resolve_content_workflow_name=lambda _strategy: "content_writer",
        _get_workflow_key=lambda _name: "app-test-key",
    )
    captured_inputs: dict[str, object] = {}

    async def fake_collect(task_id: str, dify_key: str, inputs: dict, **_kwargs: object) -> dict:
        captured_inputs.update({"task_id": task_id, "dify_key": dify_key, **inputs})
        return {"text": "补偿生成正文", "quality_score": "88"}

    def fake_finalize(section_title: str, outputs: dict, request_mapping_flat: dict, **_kwargs: object) -> dict:
        return {
            "content": outputs["text"],
            "word_count": len(outputs["text"]),
            "quality_score": int(outputs["quality_score"]),
            "replace_report": [],
            "placeholder_issues": [],
        }

    monkeypatch.setattr(task_routes, "_collect_workflow_outputs", fake_collect)
    monkeypatch.setattr(task_routes, "_finalize_single_content_result", fake_finalize)
    monkeypatch.setattr(task_routes.task_manager, "update_stage", lambda *_args, **_kwargs: None)

    repaired, failed = asyncio.run(
        task_routes._repair_group_failed_sections(
            task_id="task-1",
            _r=fake_routes,
            children=children,
            failed_sections=[
                {"section_id": "1.2", "section_title": "1.2 核心业务场景", "error": "批量正文结果缺失子章节"}
            ],
            request={"project_summary": "项目摘要", "image_map_hint": "图片清单"},
            request_mapping_flat={},
            group_placeholder_hint="占位符提示",
            group_outline_slice="1 对本项目的理解\n  [当前] 1.2 核心业务场景",
        )
    )

    assert failed == []
    assert repaired[0]["section_id"] == "1.2"
    assert repaired[0]["content"] == "补偿生成正文"
    assert repaired[0]["quality_score"] == 88
    assert repaired[0]["repaired"] is True
    assert captured_inputs["dify_key"] == "app-test-key"
    assert captured_inputs["requires_search"] == "true"
    assert captured_inputs["section_title"] == "1.2 核心业务场景"
    assert "只输出本节标题下面应出现的正文内容" in str(captured_inputs["writing_hint"])


def test_group_children_runtime_hint_contains_output_boundary() -> None:
    children = task_routes._build_group_writing_children([
        {
            "section_id": "1.2",
            "section_title": "1.2 核心业务场景与技术功能映射",
            "writing_hint": "围绕业务场景展开",
            "keywords": "可信数据空间",
            "expected_words": 1200,
            "section_outline_slice": "1 对本项目的理解\n  [当前] 1.2 核心业务场景与技术功能映射",
        }
    ])

    assert children[0]["section_id"] == "1.2"
    assert "只输出本节标题下面应出现的正文内容" in children[0]["writing_hint"]
    assert "禁止输出“一、/二、/三、”" in children[0]["writing_hint"]


def test_mermaid_fallback_svg_is_safe_and_non_blank() -> None:
    svg = task_routes._mermaid_to_fallback_svg('flowchart TD\nA["<数据源>"] --> B[合规审查]', "数据流图")

    assert svg.startswith("<svg")
    assert "&lt;数据源&gt;" in svg
    assert "Mermaid 源码预览" in svg


def test_content_result_persists_generated_content_without_frontend_poll(monkeypatch: pytest.MonkeyPatch) -> None:
    record = SimpleNamespace(
        id="proj-test",
        data=json.dumps({
            "id": "proj-test",
            "generatedContent": {
                "1.2": {"status": "idle", "content": "", "wordCount": 0}
            },
        }, ensure_ascii=False),
        updated_at=None,
    )

    class FakeQuery:
        def filter(self, *_args: object, **_kwargs: object) -> "FakeQuery":
            return self

        def first(self) -> object:
            return record

    class FakeSession:
        def query(self, *_args: object, **_kwargs: object) -> FakeQuery:
            return FakeQuery()

        def commit(self) -> None:
            pass

        def rollback(self) -> None:
            pass

        def close(self) -> None:
            pass

    monkeypatch.setattr(task_routes, "SessionLocal", lambda: FakeSession())

    task_routes._persist_content_result_to_project(
        "proj-test",
        "1.2",
        {"content": "补齐正文", "word_count": 4, "quality_score": 88, "feedback": "ok"},
        status="done",
    )

    data = json.loads(record.data)
    state = data["generatedContent"]["1.2"]
    assert state["status"] == "done"
    assert state["content"] == "补齐正文"
    assert state["wordCount"] == 4
    assert state["qualityScore"] == 88


def test_content_error_persists_generated_content_error(monkeypatch: pytest.MonkeyPatch) -> None:
    record = SimpleNamespace(
        id="proj-test",
        data=json.dumps({"id": "proj-test", "generatedContent": {}}, ensure_ascii=False),
        updated_at=None,
    )

    class FakeQuery:
        def filter(self, *_args: object, **_kwargs: object) -> "FakeQuery":
            return self

        def first(self) -> object:
            return record

    class FakeSession:
        def query(self, *_args: object, **_kwargs: object) -> FakeQuery:
            return FakeQuery()

        def commit(self) -> None:
            pass

        def rollback(self) -> None:
            pass

        def close(self) -> None:
            pass

    monkeypatch.setattr(task_routes, "SessionLocal", lambda: FakeSession())

    task_routes._persist_content_result_to_project(
        "proj-test",
        "1.2",
        {},
        status="error",
        error="工作流异常",
    )

    state = json.loads(record.data)["generatedContent"]["1.2"]
    assert state["status"] == "error"
    assert state["error"] == "工作流异常"
