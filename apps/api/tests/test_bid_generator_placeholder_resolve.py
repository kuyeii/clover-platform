from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest


REPO_ROOT = Path(__file__).resolve().parents[3]
MODULE_PATH = REPO_ROOT / "legacy" / "bid-generator" / "pipt-flask" / "app" / "api_lite" / "content_placeholder_resolve.py"

try:
    spec = importlib.util.spec_from_file_location("pipt_content_placeholder_resolve", MODULE_PATH)
    if spec is None or spec.loader is None:
        raise ModuleNotFoundError(str(MODULE_PATH))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    resolve_body_placeholders = module.resolve_body_placeholders
except ModuleNotFoundError as exc:  # pragma: no cover - 依赖环境缺失时给出清晰跳过原因
    pytest.skip(f"pipt-lite 测试依赖缺失: {exc}", allow_module_level=True)


def test_illegal_pipt_index_is_not_restored_when_ambiguous() -> None:
    text = "项目由 {{PIPT_1}} 负责。"
    mapping = {
        "{{__PIPT_name_1__}}": "张三",
        "{{__PIPT_phone_1__}}": "13800000000",
    }

    restored, _merged, report = resolve_body_placeholders(text, {}, mapping)

    assert restored == text
    assert report == []


def test_illegal_pipt_index_restores_when_index_is_unique() -> None:
    text = "项目由 {{PIPT_7}} 负责。"
    mapping = {"{{__PIPT_name_7__}}": "张三"}

    restored, _merged, report = resolve_body_placeholders(text, {}, mapping)

    assert restored == "项目由 张三 负责。"
    assert report == [{"placeholder": "{{PIPT_7}}", "original": "张三", "status": "success"}]


def test_malformed_pipt_prefers_type_and_index() -> None:
    text = "联系人 {{ PIPT-name-1 }}，电话 {{ PIPT-phone-1 }}。"
    mapping = {
        "{{__PIPT_name_1__}}": "张三",
        "{{__PIPT_phone_1__}}": "13800000000",
    }

    restored, _merged, report = resolve_body_placeholders(text, {}, mapping)

    assert restored == "联系人 张三，电话 13800000000。"
    assert report == [
        {"placeholder": "{{ PIPT-name-1 }}", "original": "张三", "status": "success"},
        {"placeholder": "{{ PIPT-phone-1 }}", "original": "13800000000", "status": "success"},
    ]
