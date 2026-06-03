from __future__ import annotations

import unittest
import importlib.util
from pathlib import Path
from contextlib import contextmanager
from types import ModuleType, SimpleNamespace
import sys

API_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = API_ROOT.parents[1]


def _stub_module(name: str, **attrs: object) -> ModuleType:
    module = ModuleType(name)
    for key, value in attrs.items():
        setattr(module, key, value)
    sys.modules[name] = module
    return module


class _PlatformError(Exception):
    pass


@contextmanager
def _temporary_module_stubs(names: list[str]):
    previous = {name: sys.modules.get(name) for name in names}
    try:
        yield
    finally:
        for name, module in previous.items():
            if module is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = module


def _load_service_module() -> ModuleType:
    stub_names = [
        "sqlalchemy",
        "sqlalchemy.engine",
        "sqlalchemy.exc",
        "app",
        "app.core",
        "app.core.config",
        "app.core.errors",
        "packages",
        "packages.py_common",
        "packages.py_common.config",
        "packages.py_common.config.loader",
        "packages.py_common.db",
        "packages.py_common.db.session",
    ]
    spec = importlib.util.spec_from_file_location(
        "competitor_analysis_service_for_test",
        API_ROOT / "app" / "services" / "competitor_analysis_service.py",
    )
    if spec is None or spec.loader is None:
        raise RuntimeError("无法加载竞对分析服务模块")
    module = importlib.util.module_from_spec(spec)
    with _temporary_module_stubs(stub_names):
        _stub_module("sqlalchemy", text=lambda value: value)
        _stub_module("sqlalchemy.engine", Connection=object)
        _stub_module("sqlalchemy.exc", SQLAlchemyError=Exception)
        _stub_module("app")
        _stub_module("app.core")
        _stub_module("app.core.config", get_api_settings=lambda: SimpleNamespace(repo_root=REPO_ROOT))
        _stub_module("app.core.errors", PlatformError=_PlatformError)
        _stub_module("packages")
        _stub_module("packages.py_common")
        _stub_module("packages.py_common.config")
        _stub_module("packages.py_common.config.loader", load_yaml=lambda _path: {})
        _stub_module("packages.py_common.db")
        _stub_module("packages.py_common.db.session", get_engine=lambda: None)
        spec.loader.exec_module(module)
    return module


service = _load_service_module()


class CompetitorAnalysisServiceTests(unittest.TestCase):
    def test_normalize_lately_empty_dify_news_dict_returns_empty_state(self) -> None:
        result = service.normalize_lately({"动态整理说明": "未检索到公开动态", "企业动态": []})

        self.assertEqual(result, {"summary": "暂无近期动态", "items": []})

    def test_normalize_lately_empty_dify_news_json_returns_empty_state(self) -> None:
        result = service.normalize_lately('{"动态整理说明":"未检索到公开动态","企业动态":[]}')

        self.assertEqual(result, {"summary": "暂无近期动态", "items": []})

    def test_demo_history_record_is_filtered_from_rows(self) -> None:
        row = {"record_json": '{"id":"history-demo","mode":"demo"}'}

        self.assertIsNone(service._record_from_row(row))

    def test_demo_history_record_cannot_be_saved(self) -> None:
        record = {"id": "history-demo", "createdAt": "2026-05-28T00:00:00Z", "mode": "demo"}

        with self.assertRaises(service.CompetitorAnalysisBadRequest) as ctx:
            service.save_history_record(record)

        self.assertEqual(ctx.exception.code, "DEMO_HISTORY_DISABLED")

    def test_company_name_validation_force_refresh_bypasses_cache(self) -> None:
        calls: list[str] = []
        original_read_query_cache = service.read_company_validation_query_cache
        original_read_profile_cache = service.read_company_profile_cache
        original_post_workflow = service.post_dify_workflow
        original_write_cache = service.write_company_validation_cache
        try:
            service.read_company_validation_query_cache = lambda _name: {
                "company": {"name": "缓存企业", "intro": "旧介绍", "business": "旧业务"},
                "candidateItems": [],
                "cacheHit": True,
            }
            service.read_company_profile_cache = lambda _name: None

            def fake_post_workflow(**_kwargs: object) -> dict:
                calls.append("workflow")
                return {
                    "data": {
                        "outputs": {
                            "text": '{"企业名称":"联网企业","企业介绍":"新介绍","主营业务":"新业务","搜索结果":"联网命中"}'
                        }
                    }
                }

            service.post_dify_workflow = fake_post_workflow
            service.write_company_validation_cache = lambda _name, _response: calls.append("write_cache")

            cached = service.run_company_name_validation_workflow(companyName="测试企业")
            refreshed = service.run_company_name_validation_workflow(companyName="测试企业", forceRefresh=True)

            self.assertEqual(cached["company"]["name"], "缓存企业")
            self.assertEqual(refreshed["company"]["name"], "联网企业")
            self.assertEqual(calls, ["workflow", "write_cache"])
        finally:
            service.read_company_validation_query_cache = original_read_query_cache
            service.read_company_profile_cache = original_read_profile_cache
            service.post_dify_workflow = original_post_workflow
            service.write_company_validation_cache = original_write_cache


if __name__ == "__main__":
    unittest.main()
