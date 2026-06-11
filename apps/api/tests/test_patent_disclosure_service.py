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
from packages.patent_disclosure_skill.adapter.docx_exporter import DocxExporter, _validate_rendered_docx
from packages.patent_disclosure_skill.adapter.fallback_searcher import (
    FallbackPriorArtSearchError,
    FallbackPriorArtSearcher,
    _parse_google_patents_payload,
)
from packages.patent_disclosure_skill.adapter.generation_pipeline import GenerationPipeline, PipelineOptions
from packages.patent_disclosure_skill.adapter.material_reader import MaterialParseError, validate_zip_safe
from packages.patent_disclosure_skill.adapter.openai_compatible_llm import PatentLlmConfig
from packages.patent_disclosure_skill.adapter.prompt_loader import PromptLoader
from packages.patent_disclosure_skill.adapter.revision_pipeline import (
    RevisionOptions,
    RevisionPipeline,
    classify_revision_kind,
    prepare_revision_disclosure_assets,
)
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

    def test_prior_art_prompt_keeps_fallback_rules_at_runtime(self) -> None:
        prompt = PromptLoader(REPO_ROOT / "packages" / "patent_disclosure_skill" / "upstream").load("prior_art")

        self.assertIn("国家知识产权局", prompt)
        self.assertIn("国知局", prompt)
        self.assertIn("Web" + "Search", prompt)
        self.assertIn("Google " + "Patents", prompt)
        self.assertIn("降级", prompt)

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

    def test_google_patents_fallback_parses_xhr_payload(self) -> None:
        payload = {
            "results": {
                "cluster": [
                    {
                        "result": [
                            {
                                "id": "patent/CN118643134B/zh",
                                "patent": {
                                    "title": " 基于知识图谱的<b>检索增强</b>生成系统与方法 ",
                                    "publication_number": "CN118643134B",
                                    "snippet": "本发明公开了一种<b>检索增强</b>生成系统。",
                                },
                            }
                        ]
                    }
                ]
            }
        }

        hits = _parse_google_patents_payload(payload)

        self.assertEqual(hits[0]["pub_number"], "CN118643134B")
        self.assertEqual(hits[0]["title"], "基于知识图谱的检索增强生成系统与方法")
        self.assertEqual(hits[0]["link"], "https://patents.google.com/patent/CN118643134B/zh")
        self.assertEqual(hits[0]["snippet"], "本发明公开了一种检索增强生成系统。")

    def test_pipeline_falls_back_when_cnipa_fails(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            pipeline = GenerationPipeline(
                skill_dir=REPO_ROOT / "packages" / "patent_disclosure_skill" / "upstream",
                material_reader=_FakeMaterialReader(),
                llm=_PriorArtCaptureLlm(),
                cnipa_searcher=_ErrorCnipaSearcher("国知局超时"),
                fallback_searcher=_FakeFallbackSearcher(),
                docx_exporter=_FakeDocxExporter(),
            )

            result = _run_pipeline(pipeline, root)

            prior_art_notes = result.prior_art_md.read_text(encoding="utf-8")
            self.assertIn("查新分析", prior_art_notes)
            self.assertTrue(pipeline.fallback_searcher.called)
            self.assertIn("# 降级检索结果 JSON", pipeline.llm.prior_art_prompt)
            self.assertIn("CNFALLBACK1", pipeline.llm.prior_art_prompt)
            self.assertTrue(result.disclosure_md.is_file())
            self.assertTrue(result.disclosure_docx.is_file())
            self.assertEqual(result.disclosure_md.name, "公式测试_v1.md")
            self.assertEqual(result.disclosure_docx.name, "公式测试_v1.docx")

    def test_pipeline_fails_when_cnipa_and_fallback_fail(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            pipeline = GenerationPipeline(
                skill_dir=REPO_ROOT / "packages" / "patent_disclosure_skill" / "upstream",
                material_reader=_FakeMaterialReader(),
                llm=_ScriptedPatentLlm(),
                cnipa_searcher=_ErrorCnipaSearcher("国知局工具不可用"),
                fallback_searcher=_FailingFallbackSearcher("Google Patents 无结果"),
                docx_exporter=_FakeDocxExporter(),
            )

            with self.assertRaises(CnipaSearchError) as ctx:
                _run_pipeline(pipeline, root)

            message = str(ctx.exception)
            self.assertIn("国知局查新失败且降级查新未返回可用结果", message)
            self.assertIn("国知局工具不可用", message)
            self.assertIn("Google Patents 无结果", message)

    def test_pipeline_uses_revised_disclosure_from_self_check(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            pipeline = GenerationPipeline(
                skill_dir=REPO_ROOT / "packages" / "patent_disclosure_skill" / "upstream",
                material_reader=_FakeMaterialReader(),
                llm=_SelfCheckRevisionLlm(),
                cnipa_searcher=_FakeCnipaSearcher(),
                docx_exporter=_FakeDocxExporter(),
            )

            result = _run_pipeline(pipeline, root)

            final_md = result.disclosure_md.read_text(encoding="utf-8")
            self.assertIn("修订稿专属步骤", final_md)
            self.assertNotIn("符号先行坏稿", final_md)
            self.assertFalse(final_md.lstrip().startswith("```"))

    def test_pipeline_strips_markdown_fence_from_revised_disclosure(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            pipeline = GenerationPipeline(
                skill_dir=REPO_ROOT / "packages" / "patent_disclosure_skill" / "upstream",
                material_reader=_FakeMaterialReader(),
                llm=_FencedSelfCheckRevisionLlm(),
                cnipa_searcher=_FakeCnipaSearcher(),
                docx_exporter=_FakeDocxExporter(),
            )

            result = _run_pipeline(pipeline, root)

            final_md = result.disclosure_md.read_text(encoding="utf-8")
            self.assertTrue(final_md.startswith("# 技术交底书"))
            self.assertIn("代码块包装修订稿", final_md)
            self.assertNotIn("```markdown", final_md)

    def test_pipeline_repairs_missing_flow_steps(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            pipeline = GenerationPipeline(
                skill_dir=REPO_ROOT / "packages" / "patent_disclosure_skill" / "upstream",
                material_reader=_FakeMaterialReader(),
                llm=_FlowRepairLlm(),
                cnipa_searcher=_FakeCnipaSearcher(),
                docx_exporter=_FakeDocxExporter(),
            )

            result = _run_pipeline(pipeline, root)

            final_md = result.disclosure_md.read_text(encoding="utf-8")
            self.assertIn("```mermaid", final_md)
            self.assertIn("S1：接收输入。", final_md)
            self.assertIn("检测到 3.4 系统流程说明结构不完整，已自动定向修复。", result.warnings)

    def test_pipeline_warns_when_self_check_has_no_revised_body(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            pipeline = GenerationPipeline(
                skill_dir=REPO_ROOT / "packages" / "patent_disclosure_skill" / "upstream",
                material_reader=_FakeMaterialReader(),
                llm=_NoRevisionLlm(),
                cnipa_searcher=_FakeCnipaSearcher(),
                docx_exporter=_FakeDocxExporter(),
            )

            result = _run_pipeline(pipeline, root)

            final_md = result.disclosure_md.read_text(encoding="utf-8")
            self.assertIn("原始合格稿", final_md)
            self.assertIn("自检未返回可提取的修订后交底书正文，已保留生成稿。", result.warnings)

    def test_pipeline_warns_when_flow_repair_fails(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            pipeline = GenerationPipeline(
                skill_dir=REPO_ROOT / "packages" / "patent_disclosure_skill" / "upstream",
                material_reader=_FakeMaterialReader(),
                llm=_FailedFlowRepairLlm(),
                cnipa_searcher=_FakeCnipaSearcher(),
                docx_exporter=_FakeDocxExporter(),
            )

            result = _run_pipeline(pipeline, root)

            final_md = result.disclosure_md.read_text(encoding="utf-8")
            self.assertIn("修复失败坏稿", final_md)
            self.assertIn("3.4 系统流程说明结构校验未通过，定向修复失败，已保留原稿。", result.warnings)

    def test_docx_exporter_falls_back_when_mermaid_docx_is_invalid(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            skill_dir = root / "skill"
            tools_dir = skill_dir / "tools"
            tools_dir.mkdir(parents=True)
            (tools_dir / "md_to_docx.py").write_text("# stub", encoding="utf-8")
            (tools_dir / "mermaid_render.py").write_text("# stub", encoding="utf-8")
            input_md = root / "input.md"
            input_md.write_text("# 技术交底书\n\n**案件名称**：测试", encoding="utf-8")
            output_docx = root / "out.docx"
            calls: list[str] = []

            def fake_run_python_tool(*, tool_name: str, args: list[str], **kwargs):
                _ = args, kwargs
                calls.append(tool_name)
                if tool_name == "mermaid_render.py":
                    output_docx.write_text("# markdown but named docx", encoding="utf-8")
                else:
                    _write_minimal_docx(output_docx)
                return ToolResult(returncode=0, stdout="", stderr="")

            with patch(
                "packages.patent_disclosure_skill.adapter.docx_exporter.run_python_tool",
                side_effect=fake_run_python_tool,
            ):
                warnings = DocxExporter(skill_dir=skill_dir, enable_mermaid_render=True).export(
                    input_md=input_md,
                    output_docx=output_docx,
                    work_dir=root / "work",
                )

            self.assertEqual(calls, ["mermaid_render.py", "md_to_docx.py"])
            self.assertIn("不是有效 Word 文件", "\n".join(warnings))
            with zipfile.ZipFile(output_docx) as docx:
                self.assertIn("word/document.xml", docx.namelist())

    def test_docx_validation_reports_missing_image_files(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            input_md = root / "input.md"
            output_docx = root / "out.docx"
            input_md.write_text(
                "\n".join(
                    [
                        "# 技术交底书",
                        "",
                        "**案件名称**：测试",
                        "",
                        "```mermaid",
                        "flowchart TD",
                        "A --> B",
                        "```",
                        "<!-- ![图示 1](mermaid_figures/fig_001.png) -->",
                        "",
                        "![公式](math_figures/eq_001.png)",
                    ]
                ),
                encoding="utf-8",
            )
            _write_minimal_docx(output_docx)

            warnings = _validate_rendered_docx(input_md, output_docx)

            self.assertIn("Markdown 图片引用缺少对应文件", "\n".join(warnings))
            self.assertIn("mermaid_figures/fig_001.png", "\n".join(warnings))

    def test_docx_validation_reports_missing_image_placeholders(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            input_md = root / "input.md"
            output_docx = root / "out.docx"
            input_md.write_text("# 技术交底书\n", encoding="utf-8")
            _write_minimal_docx(output_docx, text="[图片缺失: 公式]")

            warnings = _validate_rendered_docx(input_md, output_docx)

            self.assertIn("DOCX 正文包含图片缺失占位符", "\n".join(warnings))

    def test_prepare_revision_disclosure_assets_removes_stale_mermaid_comment(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            disclosure = "\n".join(
                [
                    "# 技术交底书",
                    "",
                    "**案件名称**：测试",
                    "",
                    "```mermaid",
                    "flowchart TD",
                    "A --> B",
                    "```",
                    "<!-- ![图示 1](mermaid_figures/fig_001.png) -->",
                    "",
                    "正文。",
                ]
            )

            cleaned = prepare_revision_disclosure_assets(disclosure, output_dir=root)

            self.assertIn("```mermaid", cleaned)
            self.assertNotIn("mermaid_figures/fig_001.png", cleaned)

    def test_prepare_revision_disclosure_assets_copies_visible_formula_reference(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            base_dir = root / "base"
            output_dir = root / "outputs"
            (base_dir / "math_figures").mkdir(parents=True)
            (base_dir / "math_figures" / "eq_001.png").write_bytes(_tiny_png())
            disclosure = "\n".join(
                [
                    "# 技术交底书",
                    "",
                    "**案件名称**：测试",
                    "",
                    "公式见 ![公式](math_figures/eq_001.png)。",
                    "<!-- ![公式](math_figures/missing_hidden.png) -->",
                ]
            )

            cleaned = prepare_revision_disclosure_assets(disclosure, output_dir=output_dir, base_dir=base_dir)

            self.assertIn("![公式](math_figures/eq_001.png)", cleaned)
            self.assertNotIn("missing_hidden.png", cleaned)
            self.assertTrue((output_dir / "math_figures" / "eq_001.png").is_file())

    def test_revision_kind_detects_correction_keywords(self) -> None:
        self.assertEqual(classify_revision_kind("第三章流程这里不对，改成先灰度再全量"), "correct")
        self.assertEqual(classify_revision_kind("请补充一个金融场景实施例"), "merge")

    def test_revision_pipeline_writes_new_disclosure_docx_without_log(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            base_md = root / "base.md"
            base_md.write_text(_valid_disclosure("基准稿"), encoding="utf-8")
            pipeline = RevisionPipeline(
                skill_dir=REPO_ROOT / "packages" / "patent_disclosure_skill" / "upstream",
                llm=_RevisionLlm(),
                docx_exporter=_FakeDocxExporter(),
            )

            result = pipeline.run(
                case={"id": "case-1", "title": "测试案件", "technical_topic": "检索增强"},
                base_disclosure_md=base_md,
                output_dir=root / "outputs",
                tmp_dir=root / "tmp",
                safe_case_title="公式测试",
                timestamp="v2",
                revision_instruction="第三章流程这里不对，改成先灰度再全量",
                options=RevisionOptions(render_mermaid_png=True),
                emit=lambda progress: None,
            )

            self.assertEqual(result.revision_kind, "correct")
            self.assertTrue(result.disclosure_md.is_file())
            self.assertTrue(result.disclosure_docx.is_file())
            self.assertEqual(result.disclosure_md.name, "公式测试_v2.md")
            self.assertEqual(result.disclosure_docx.name, "公式测试_v2.docx")
            self.assertFalse((root / "outputs" / "交底书修订对话记录.md").exists())
            final_md = result.disclosure_md.read_text(encoding="utf-8")
            self.assertTrue(final_md.startswith("# 技术交底书"))
            self.assertIn("修订后流程", final_md)
            self.assertNotIn("纠正摘要", final_md)

    def test_list_artifacts_returns_latest_disclosure_md_and_docx_only(self) -> None:
        case_id = "11111111-1111-4111-8111-111111111111"
        rows = [
            _artifact_row("22222222-2222-4222-8222-222222222222", case_id, "disclosure_md", 2, "公式测试_v2.md"),
            _artifact_row("33333333-3333-4333-8333-333333333333", case_id, "disclosure_docx", 2, "公式测试_v2.docx"),
        ]
        fake_engine = _FakeEngine(
            [
                [_case_row(case_id)],
                rows,
            ]
        )
        svc = service.PatentDisclosureService(settings=_settings(Path(tempfile.gettempdir())))

        with patch.object(service, "get_engine", return_value=fake_engine):
            result = svc.list_artifacts({"id": "44444444-4444-4444-8444-444444444444", "role": "admin"}, case_id)

        self.assertEqual([item["filename"] for item in result["items"]], ["公式测试_v2.md", "公式测试_v2.docx"])
        self.assertEqual({item["artifactType"] for item in result["items"]}, {"disclosure_md", "disclosure_docx"})
        self.assertEqual({item["versionNo"] for item in result["items"]}, {2})
        list_sql = fake_engine.connections[1].statements[0]
        self.assertIn("artifact_type IN ('disclosure_md', 'disclosure_docx')", list_sql)
        self.assertIn("MAX(version_no)", list_sql)

    def test_list_artifacts_can_return_all_versions_and_auxiliary_files(self) -> None:
        case_id = "11111111-1111-4111-8111-111111111111"
        rows = [
            _artifact_row("33333333-3333-4333-8333-333333333333", case_id, "disclosure_docx", 2, "公式测试_v2.docx"),
            _artifact_row("22222222-2222-4222-8222-222222222222", case_id, "disclosure_md", 2, "公式测试_v2.md"),
            _artifact_row("66666666-6666-4666-8666-666666666666", case_id, "revision_log", 2, "修订记录_v2.md"),
            _artifact_row("77777777-7777-4777-8777-777777777777", case_id, "disclosure_docx", 1, "公式测试_v1.docx"),
        ]
        fake_engine = _FakeEngine(
            [
                [_case_row(case_id)],
                rows,
            ]
        )
        svc = service.PatentDisclosureService(settings=_settings(Path(tempfile.gettempdir())))

        with patch.object(service, "get_engine", return_value=fake_engine):
            result = svc.list_artifacts({"id": "44444444-4444-4444-8444-444444444444", "role": "admin"}, case_id, scope="all")

        self.assertEqual([item["filename"] for item in result["items"]], ["公式测试_v2.docx", "公式测试_v2.md", "修订记录_v2.md", "公式测试_v1.docx"])
        self.assertEqual({item["versionNo"] for item in result["items"]}, {1, 2})
        self.assertIn("revision_log", {item["artifactType"] for item in result["items"]})
        list_sql = fake_engine.connections[1].statements[0]
        self.assertNotIn("MAX(version_no)", list_sql)
        self.assertIn("ORDER BY version_no DESC", list_sql)


def _settings(root: Path) -> PatentDisclosureSettings:
    return service.PatentDisclosureSettings(
        repo_root=root,
        data_dir=root / "data",
        skill_dir=root / "skill",
        max_file_size_bytes=1024,
        max_case_size_bytes=4096,
        allowed_extensions={".md", ".zip"},
        cnipa_enabled=True,
        cnipa_timeout_seconds=1,
        cnipa_max_results=1,
        enable_mermaid_render=False,
        tool_timeout_seconds=1,
        llm=PatentLlmConfig(base_url="", api_key="", model=""),
    )


def _upload_file(filename: str, content: bytes, content_type: str) -> UploadFile:
    return UploadFile(file=BytesIO(content), filename=filename, headers={"content-type": content_type})


def _run_pipeline(pipeline: GenerationPipeline, root: Path):
    return pipeline.run(
        case={"id": "case-1", "title": "测试案件", "technical_topic": "检索增强"},
        materials=[{"id": "material-1", "filename": "notes.md", "storage_path": str(root / "notes.md")}],
        output_dir=root / "outputs",
        parsed_dir=root / "parsed",
        tmp_dir=root / "tmp",
        safe_case_title="公式测试",
        timestamp="v1",
        options=PipelineOptions(
            output_formats=["md", "docx"],
            include_mermaid=True,
            render_mermaid_png=True,
            anonymize=False,
            extra_instruction="",
        ),
        emit=lambda progress: None,
    )


def _case_row(case_id: str) -> dict[str, object]:
    return {
        "id": case_id,
        "owner_user_id": "44444444-4444-4444-8444-444444444444",
        "title": "公式测试",
        "technical_topic": "公式渲染",
        "applicant": "",
        "project_name": "",
        "description": "",
        "status": "succeeded",
        "anonymize": False,
        "metadata": {},
        "created_at": None,
        "updated_at": None,
    }


def _artifact_row(
    artifact_id: str,
    case_id: str,
    artifact_type: str,
    version_no: int,
    filename: str,
) -> dict[str, object]:
    return {
        "id": artifact_id,
        "case_id": case_id,
        "job_id": "55555555-5555-4555-8555-555555555555",
        "artifact_type": artifact_type,
        "version_no": version_no,
        "filename": filename,
        "storage_path": f"/tmp/{filename}",
        "mime_type": service._artifact_mime(artifact_type, filename),
        "size_bytes": 123,
        "metadata": {},
        "created_at": None,
    }


class _FakeEngine:
    def __init__(self, results: list[list[dict[str, object]]]) -> None:
        self.results = results
        self.connections: list[_FakeConnection] = []

    def begin(self):
        connection = _FakeConnection(self, self.results[len(self.connections)] if len(self.connections) < len(self.results) else [])
        self.connections.append(connection)
        return connection


class _FakeConnection:
    def __init__(self, engine: _FakeEngine, rows: list[dict[str, object]]) -> None:
        self.engine = engine
        self.rows = rows
        self.statements: list[str] = []

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        return False

    def execute(self, statement, params=None):
        _ = params
        self.statements.append(str(statement))
        return _FakeResult(self.rows)


class _FakeResult:
    def __init__(self, rows: list[dict[str, object]]) -> None:
        self.rows = rows

    def mappings(self):
        return self

    def first(self):
        return self.rows[0] if self.rows else None

    def all(self):
        return self.rows


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


class _ScriptedPatentLlm:
    def chat(self, messages: list[dict[str, str]], **kwargs) -> str:
        _ = kwargs
        content = messages[-1]["content"]
        if "# 查新指令" in content:
            return "查新分析"
        if "# 交底书生成指令" in content and "# 结构修复任务" not in content:
            return self.disclosure()
        if "# 自检指令" in content:
            return self.self_check()
        if "# 结构修复任务" in content:
            return self.repair()
        return "LLM 输出"

    def disclosure(self) -> str:
        return _valid_disclosure("原始合格稿")

    def self_check(self) -> str:
        return "自检无问题。"

    def repair(self) -> str:
        return _valid_disclosure("修复稿")


class _PriorArtCaptureLlm(_ScriptedPatentLlm):
    prior_art_prompt = ""

    def chat(self, messages: list[dict[str, str]], **kwargs) -> str:
        content = messages[-1]["content"]
        if "# 查新指令" in content:
            self.prior_art_prompt = content
            return "查新分析"
        return super().chat(messages, **kwargs)


class _SelfCheckRevisionLlm(_ScriptedPatentLlm):
    def disclosure(self) -> str:
        return _bad_flow_disclosure("符号先行坏稿")

    def self_check(self) -> str:
        return f"## 修订后的交底书正文\n\n{_valid_disclosure('修订稿专属步骤')}"


class _FencedSelfCheckRevisionLlm(_SelfCheckRevisionLlm):
    def self_check(self) -> str:
        return "## 修订后的交底书正文\n\n```markdown\n" + _valid_disclosure("代码块包装修订稿") + "\n```"


class _FlowRepairLlm(_ScriptedPatentLlm):
    def disclosure(self) -> str:
        return _bad_flow_disclosure("缺少步骤坏稿")

    def self_check(self) -> str:
        return "自检没有给出完整正文。"

    def repair(self) -> str:
        return _valid_disclosure("修复稿")


class _NoRevisionLlm(_ScriptedPatentLlm):
    def disclosure(self) -> str:
        return _valid_disclosure("原始合格稿")

    def self_check(self) -> str:
        return "仅自检摘要，没有完整正文。"


class _FailedFlowRepairLlm(_FlowRepairLlm):
    def disclosure(self) -> str:
        return _bad_flow_disclosure("修复失败坏稿")

    def repair(self) -> str:
        return "修复失败，没有完整正文。"


class _RevisionLlm:
    def chat(self, messages: list[dict[str, str]], **kwargs) -> str:
        _ = kwargs
        content = messages[-1]["content"]
        if "请输出“纠正摘要" in content or "请输出“合并摘要" in content:
            return "修改了第三章系统流程说明，依据用户要求将回退逻辑调整为先灰度再全量。该修订影响流程表述，不改变查新结论。"
        return "```markdown\n" + _valid_disclosure("修订后流程") + "\n```"


class _ErrorCnipaSearcher:
    max_results = 20

    def __init__(self, message: str) -> None:
        self.message = message
        self.called = False

    def search(self, terms: list[str], *, work_dir: Path):
        _ = terms, work_dir
        self.called = True
        raise CnipaSearchError(self.message)


class _FakeCnipaSearcher:
    max_results = 20

    def search(self, terms: list[str], *, work_dir: Path):
        _ = terms, work_dir
        return [{"pub_number": "CN1", "title": "检索结果"}]


class _FakeFallbackSearcher:
    def __init__(self) -> None:
        self.called = False

    def search(self, terms: list[str]):
        self.called = True
        return {
            "source": "fallback",
            "channels": ["Google Patents"],
            "attempts": [{"source": "Google Patents", "term": terms[0], "status": "succeeded", "message": "命中 1 条"}],
            "hits": [{"source": "Google Patents", "pub_number": "CNFALLBACK1", "title": "降级检索结果"}],
        }


class _FailingFallbackSearcher:
    def __init__(self, message: str) -> None:
        self.message = message

    def search(self, terms: list[str]):
        _ = terms
        raise FallbackPriorArtSearchError(self.message)


class _FakeDocxExporter:
    def export(self, *, input_md: Path, output_docx: Path, work_dir: Path) -> list[str]:
        _ = input_md, work_dir
        output_docx.parent.mkdir(parents=True, exist_ok=True)
        output_docx.write_bytes(b"fake docx")
        return []


def _valid_disclosure(marker: str) -> str:
    return "\n".join(
        [
            "# 技术交底书",
            "",
            "**案件名称**：一种测试方法及系统",
            "",
            "## 一、介绍相关技术背景，描述与本发明技术最相近的现有技术，并说明该现有技术存在的缺点",
            "",
            "### 1.1 现有技术",
            "",
            "现有技术。",
            "",
            "## 三、本发明技术方案的详细阐述",
            "",
            "### 3.4 系统流程说明",
            "",
            "```mermaid",
            "flowchart TD",
            "  A[开始] --> B[处理] --> C[结束]",
            "```",
            "",
            f"S1：接收输入。{marker}",
            "",
            "S2：执行处理。",
            "",
            "S3：输出结果。",
            "",
            "#### 3.4.1 符号与公式",
            "",
            "如涉及公式，可在此定义。",
            "",
            "### 3.5 关键技术参数",
            "",
            "参数说明。",
            "",
            "## 四、与现有技术相比，本发明具有哪些优点？",
            "",
            "具有优点。",
        ]
    )


def _bad_flow_disclosure(marker: str) -> str:
    return "\n".join(
        [
            "# 技术交底书",
            "",
            "**案件名称**：一种测试方法及系统",
            "",
            "## 三、本发明技术方案的详细阐述",
            "",
            "### 3.4 系统流程说明",
            "",
            "#### 3.4.1 符号与公式",
            "",
            f"符号先行坏稿。{marker}",
            "",
            "#### 3.4.2 流程图",
            "",
            "```mermaid",
            "flowchart TD",
            "  A[开始] --> B[结束]",
            "```",
            "",
            "### 3.5 关键技术参数",
            "",
            "参数说明。",
        ]
    )


def _write_minimal_docx(path: Path, text: str = "") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    escaped = (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )
    document_xml = (
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        f"<w:body><w:p><w:r><w:t>{escaped}</w:t></w:r></w:p></w:body>"
        "</w:document>"
    )
    with zipfile.ZipFile(path, "w") as docx:
        docx.writestr(
            "[Content_Types].xml",
            """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>""",
        )
        docx.writestr("word/document.xml", document_xml)


def _tiny_png() -> bytes:
    return (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01"
        b"\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
        b"\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01"
        b"\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
    )


if __name__ == "__main__":
    unittest.main()
