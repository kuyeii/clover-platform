from __future__ import annotations

import tempfile
import unittest
import zipfile
import importlib.util
import sys
from io import BytesIO
from contextlib import contextmanager
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import patch

from fastapi import UploadFile

from packages.patent_disclosure_skill.adapter.cnipa_searcher import CnipaPriorArtSearcher, CnipaSearchError
from packages.patent_disclosure_skill.adapter.generation_pipeline import GenerationPipeline, PipelineOptions
from packages.patent_disclosure_skill.adapter.material_reader import MaterialParseError, validate_zip_safe
from packages.patent_disclosure_skill.adapter.openai_compatible_llm import PatentLlmConfig
from packages.patent_disclosure_skill.adapter.prompt_loader import PromptLoader
from packages.patent_disclosure_skill.adapter.safe_subprocess import ToolResult

API_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = API_ROOT.parents[1]


def _stub_module(name: str, **attrs: object) -> ModuleType:
    module = ModuleType(name)
    for key, value in attrs.items():
        setattr(module, key, value)
    sys.modules[name] = module
    return module


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
        "app",
        "app.core",
        "app.core.config",
        "app.core.errors",
        "packages.py_common.db.session",
    ]
    spec = importlib.util.spec_from_file_location(
        "patent_disclosure_service_for_test",
        API_ROOT / "app" / "services" / "patent_disclosure_service.py",
    )
    if spec is None or spec.loader is None:
        raise RuntimeError("无法加载专利交底书服务模块")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    with _temporary_module_stubs(stub_names):
        _stub_module("app")
        _stub_module("app.core")
        _stub_module("app.core.config", get_api_settings=lambda: SimpleNamespace(repo_root=REPO_ROOT))
        _stub_module(
            "app.core.errors",
            PlatformError=type("PlatformError", (Exception,), {"__init__": lambda self, **kwargs: Exception.__init__(self, kwargs.get("message", ""))}),
        )
        _stub_module("packages.py_common.db.session", get_engine=lambda: None)
        spec.loader.exec_module(module)
    return module


service = _load_service_module()


class PatentDisclosureServiceTests(unittest.TestCase):
    def test_file_store_rejects_path_outside_data_root(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            settings = _settings(Path(td))
            store = service.PatentFileStore(settings)

            with self.assertRaises(Exception):
                store.ensure_within_root(Path(td).parent / "outside.md")

    def test_validate_zip_safe_rejects_zip_slip(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            archive = Path(td) / "bad.zip"
            with zipfile.ZipFile(archive, "w") as zf:
                zf.writestr("../escape.txt", "bad")

            with self.assertRaises(MaterialParseError):
                validate_zip_safe(archive)

    def test_file_store_rejects_mismatched_mime_type(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            settings = _settings(Path(td))
            store = service.PatentFileStore(settings)
            upload = _upload_file("notes.md", b"# patent notes\n", "application/pdf")

            with self.assertRaises(Exception):
                store.save_upload(case_id="case-1", upload=upload)

    def test_file_store_rejects_binary_content_for_text_extension(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            settings = _settings(Path(td))
            store = service.PatentFileStore(settings)
            upload = _upload_file("notes.md", b"\x00\x01\x02", "text/markdown")

            with self.assertRaises(Exception):
                store.save_upload(case_id="case-1", upload=upload)

    def test_sse_broker_publish_and_close(self) -> None:
        broker = service.PatentSseBroker()
        queue = broker.subscribe("job-1")

        broker.publish("job-1", {"status": "running"})
        broker.close("job-1")

        self.assertEqual(queue.get(timeout=1), {"status": "running"})
        self.assertIsNone(queue.get(timeout=1))

    def test_prior_art_prompt_is_cnipa_only_at_runtime(self) -> None:
        prompt = PromptLoader(REPO_ROOT / "packages" / "patent_disclosure_skill" / "upstream").load("prior_art")
        forbidden_terms = [
            "Web" + "Search",
            "Google " + "学术",
            "Google " + "Patents",
            "降级",
            "其它来源",
        ]

        for term in forbidden_terms:
            self.assertNotIn(term, prompt)
        self.assertIn("国家知识产权局", prompt)
        self.assertIn("国知局", prompt)

    def test_cnipa_search_empty_hits_fail_generation_path(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            skill_dir = Path(td) / "skill"
            tools_dir = skill_dir / "tools"
            tools_dir.mkdir(parents=True)
            (tools_dir / "cnipa_epub_search.py").write_text("# stub", encoding="utf-8")
            searcher = CnipaPriorArtSearcher(skill_dir=skill_dir)

            with patch(
                "packages.patent_disclosure_skill.adapter.cnipa_searcher.run_python_tool",
                return_value=ToolResult(returncode=0, stdout="EPUB_HITS_JSON: []", stderr=""),
            ):
                with self.assertRaises(CnipaSearchError):
                    searcher.search(["检索增强"], work_dir=Path(td) / "work")

    def test_pipeline_skip_prior_art_writes_placeholder_without_cnipa_search(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            pipeline = GenerationPipeline(
                skill_dir=REPO_ROOT / "packages" / "patent_disclosure_skill" / "upstream",
                material_reader=_FakeMaterialReader(),
                llm=_FakeLlm(),
                cnipa_searcher=_FailingCnipaSearcher(),
                docx_exporter=_FakeDocxExporter(),
            )

            result = pipeline.run(
                case={"id": "case-1", "title": "测试案件", "technical_topic": "检索增强"},
                materials=[{"id": "material-1", "filename": "notes.md", "storage_path": str(root / "notes.md")}],
                output_dir=root / "outputs",
                parsed_dir=root / "parsed",
                tmp_dir=root / "tmp",
                safe_case_title="测试案件",
                timestamp="20260602000000",
                options=PipelineOptions(
                    output_formats=["md", "docx"],
                    include_mermaid=True,
                    render_mermaid_png=True,
                    anonymize=False,
                    skip_prior_art=True,
                    extra_instruction="",
                ),
                emit=lambda progress: None,
            )

            prior_art_notes = result.prior_art_md.read_text(encoding="utf-8")
            self.assertIn("本次按临时配置跳过国知局查新", prior_art_notes)
            self.assertFalse(pipeline.cnipa_searcher.called)
            self.assertTrue(result.disclosure_md.is_file())
            self.assertTrue(result.disclosure_docx.is_file())


def _settings(root: Path) -> PatentDisclosureSettings:
    return service.PatentDisclosureSettings(
        repo_root=root,
        data_dir=root / "data",
        skill_dir=root / "skill",
        max_file_size_bytes=1024,
        max_case_size_bytes=4096,
        allowed_extensions={".md", ".zip"},
        cnipa_enabled=True,
        skip_prior_art=False,
        cnipa_timeout_seconds=1,
        cnipa_max_results=1,
        enable_mermaid_render=False,
        tool_timeout_seconds=1,
        llm=PatentLlmConfig(base_url="", api_key="", model=""),
    )


def _upload_file(filename: str, content: bytes, content_type: str) -> UploadFile:
    return UploadFile(file=BytesIO(content), filename=filename, headers={"content-type": content_type})


class _FakeMaterialReader:
    def parse(self, *, source_path: Path, parsed_dir: Path, work_dir: Path):
        parsed_dir.mkdir(parents=True, exist_ok=True)
        parsed_path = parsed_dir / "notes.md"
        parsed_path.write_text("项目材料", encoding="utf-8")
        return SimpleNamespace(source_path=source_path, text="项目材料", status="parsed", parsed_path=parsed_path)


class _FakeLlm:
    def chat(self, messages: list[dict[str, str]], **kwargs) -> str:
        _ = messages, kwargs
        return "LLM 输出"


class _FailingCnipaSearcher:
    called = False

    def search(self, terms: list[str], *, work_dir: Path):
        _ = terms, work_dir
        self.called = True
        raise AssertionError("CNIPA search should be skipped")


class _FakeDocxExporter:
    def export(self, *, input_md: Path, output_docx: Path, work_dir: Path) -> list[str]:
        _ = input_md, work_dir
        output_docx.parent.mkdir(parents=True, exist_ok=True)
        output_docx.write_bytes(b"fake docx")
        return []


if __name__ == "__main__":
    unittest.main()
