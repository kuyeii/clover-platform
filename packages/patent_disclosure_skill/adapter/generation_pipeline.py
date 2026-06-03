from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from .cnipa_searcher import CnipaPriorArtSearcher
from .docx_exporter import DocxExporter
from .material_reader import MaterialReader
from .openai_compatible_llm import OpenAICompatibleLLMClient
from .prompt_loader import PromptLoader


@dataclass(frozen=True)
class PipelineOptions:
    output_formats: list[str]
    include_mermaid: bool
    render_mermaid_png: bool
    anonymize: bool
    skip_prior_art: bool = False
    extra_instruction: str = ""


@dataclass(frozen=True)
class PipelineProgress:
    step: str
    progress: int
    message: str


@dataclass(frozen=True)
class PipelineResult:
    patent_points_md: Path
    prior_art_md: Path
    disclosure_md: Path
    disclosure_docx: Path
    self_check_md: Path
    warnings: list[str]
    parsed_materials: list[dict[str, str]]


class GenerationPipeline:
    def __init__(
        self,
        *,
        skill_dir: Path,
        material_reader: MaterialReader,
        llm: OpenAICompatibleLLMClient,
        cnipa_searcher: CnipaPriorArtSearcher,
        docx_exporter: DocxExporter,
    ) -> None:
        self.skill_dir = skill_dir
        self.material_reader = material_reader
        self.llm = llm
        self.cnipa_searcher = cnipa_searcher
        self.docx_exporter = docx_exporter
        self.prompts = PromptLoader(skill_dir)

    def run(
        self,
        *,
        case: dict,
        materials: list[dict],
        output_dir: Path,
        parsed_dir: Path,
        tmp_dir: Path,
        safe_case_title: str,
        timestamp: str,
        options: PipelineOptions,
        emit: Callable[[PipelineProgress], None],
    ) -> PipelineResult:
        output_dir.mkdir(parents=True, exist_ok=True)
        parsed_dir.mkdir(parents=True, exist_ok=True)
        tmp_dir.mkdir(parents=True, exist_ok=True)

        emit(PipelineProgress("material_parse", 10, "正在解析上传材料"))
        material_text, parsed_updates = self._parse_materials(materials, parsed_dir=parsed_dir, tmp_dir=tmp_dir)

        emit(PipelineProgress("project_scan", 25, "正在扫描项目材料"))
        project_scan = self._llm_step(
            "project_scan",
            "请基于案件信息和项目材料，输出项目技术扫描摘要。",
            case,
            material_text,
            options,
        )

        emit(PipelineProgress("patent_points", 40, "正在分析专利点"))
        patent_points = self._llm_step(
            "patent_points",
            "请输出候选专利点、融合建议和推荐保护主题。",
            case,
            f"{project_scan}\n\n# 项目材料\n\n{material_text}",
            options,
        )
        patent_points_md = output_dir / f"patent_points_{timestamp}.md"
        patent_points_md.write_text(patent_points, encoding="utf-8")

        terms = _build_cnipa_terms(case, patent_points, options.extra_instruction)
        if options.skip_prior_art:
            emit(PipelineProgress("cnipa_prior_art", 60, "已按临时配置跳过国知局查新"))
            prior_art_notes = _build_skipped_prior_art_notes(terms, patent_points)
        else:
            emit(PipelineProgress("cnipa_prior_art", 60, "正在执行国知局查新"))
            hits = self.cnipa_searcher.search(terms, work_dir=tmp_dir)
            prior_art_notes = self._build_prior_art_notes(terms, hits, patent_points)
        prior_art_md = output_dir / f"cnipa_prior_art_notes_{timestamp}.md"
        prior_art_md.write_text(prior_art_notes, encoding="utf-8")

        emit(PipelineProgress("build_disclosure", 75, "正在生成技术交底书"))
        disclosure = self._build_disclosure(case, material_text, project_scan, patent_points, prior_art_notes, options)
        disclosure_md = output_dir / f"{safe_case_title}_{timestamp}.md"
        disclosure_md.write_text(disclosure, encoding="utf-8")

        emit(PipelineProgress("self_check", 84, "正在执行交底书自检"))
        self_check = self._self_check(case, disclosure, prior_art_notes, options)
        self_check_md = output_dir / f"self_check_{timestamp}.md"
        self_check_md.write_text(self_check, encoding="utf-8")

        emit(PipelineProgress("export_docx", 92, "正在导出 Word 文档"))
        disclosure_docx = output_dir / f"{safe_case_title}_{timestamp}.docx"
        warnings = self.docx_exporter.export(input_md=disclosure_md, output_docx=disclosure_docx, work_dir=tmp_dir)

        return PipelineResult(
            patent_points_md=patent_points_md,
            prior_art_md=prior_art_md,
            disclosure_md=disclosure_md,
            disclosure_docx=disclosure_docx,
            self_check_md=self_check_md,
            warnings=warnings,
            parsed_materials=parsed_updates,
        )

    def _parse_materials(self, materials: list[dict], *, parsed_dir: Path, tmp_dir: Path) -> tuple[str, list[dict[str, str]]]:
        blocks: list[str] = []
        updates: list[dict[str, str]] = []
        for material in materials:
            parsed = self.material_reader.parse(
                source_path=Path(str(material["storage_path"])),
                parsed_dir=parsed_dir,
                work_dir=tmp_dir,
            )
            title = material.get("filename") or parsed.source_path.name
            blocks.append(f"# 材料：{title}\n\n{parsed.text[:80_000]}")
            updates.append(
                {
                    "id": str(material.get("id") or ""),
                    "status": parsed.status,
                    "parsed_text_path": str(parsed.parsed_path or ""),
                }
            )
        return "\n\n".join(blocks).strip(), updates

    def _llm_step(
        self,
        prompt_name: str,
        task: str,
        case: dict,
        context: str,
        options: PipelineOptions,
    ) -> str:
        prompt = self.prompts.load(prompt_name)
        return self.llm.chat(
            [
                {"role": "system", "content": "你是中国专利技术交底书生成助手，严格按技术事实和专利文书规范输出。"},
                {
                    "role": "user",
                    "content": "\n\n".join(
                        [
                            "# Skill 指令",
                            prompt[:30_000],
                            "# 任务",
                            task,
                            "# 案件信息",
                            _json(case),
                            "# 生成参数",
                            _json(options.__dict__),
                            "# 上下文",
                            context[:90_000],
                        ]
                    ),
                },
            ]
        )

    def _build_prior_art_notes(self, terms: list[str], hits: list[dict], patent_points: str) -> str:
        prompt = self.prompts.load("prior_art")
        return self.llm.chat(
            [
                {"role": "system", "content": "你是专利查新分析助手，只基于给定国知局检索结果做差异化分析。"},
                {
                    "role": "user",
                    "content": "\n\n".join(
                        [
                            "# 查新指令",
                            prompt[:28_000],
                            "# 检索词",
                            "\n".join(f"- {term}" for term in terms),
                            "# 国知局检索结果 JSON",
                            _json(hits)[:80_000],
                            "# 候选专利点",
                            patent_points[:60_000],
                            "请输出可写入交底书的现有技术摘要、最接近现有技术、区别特征和创造性支撑。",
                        ]
                    ),
                },
            ]
        )

    def _build_disclosure(
        self,
        case: dict,
        material_text: str,
        project_scan: str,
        patent_points: str,
        prior_art_notes: str,
        options: PipelineOptions,
    ) -> str:
        prompts = self.prompts.load_bundle(["disclosure_builder", "template_reference"])
        return self.llm.chat(
            [
                {"role": "system", "content": "你是资深专利代理人与技术交底书撰写助手。输出完整 Markdown 交底书正文。"},
                {
                    "role": "user",
                    "content": "\n\n".join(
                        [
                            "# 交底书生成指令",
                            prompts["disclosure_builder"][:35_000],
                            "# 模版参考",
                            prompts["template_reference"][:35_000],
                            "# 案件信息",
                            _json(case),
                            "# 参数",
                            _json(options.__dict__),
                            "# 项目扫描",
                            project_scan[:30_000],
                            "# 专利点",
                            patent_points[:40_000],
                            "# 国知局查新分析",
                            prior_art_notes[:40_000],
                            "# 项目材料摘录",
                            material_text[:50_000],
                        ]
                    ),
                },
            ],
            timeout=240,
        )

    def _self_check(self, case: dict, disclosure: str, prior_art_notes: str, options: PipelineOptions) -> str:
        prompt = self.prompts.load("self_check")
        return self.llm.chat(
            [
                {"role": "system", "content": "你是专利交底书质量检查助手。自检内容只作为内部产物，不写回正文。"},
                {
                    "role": "user",
                    "content": "\n\n".join(
                        [
                            "# 自检指令",
                            prompt[:30_000],
                            "# 案件信息",
                            _json(case),
                            "# 参数",
                            _json(options.__dict__),
                            "# 查新分析",
                            prior_art_notes[:30_000],
                            "# 交底书正文",
                            disclosure[:90_000],
                        ]
                    ),
                },
            ]
        )


def _build_cnipa_terms(case: dict, patent_points: str, extra_instruction: str) -> list[str]:
    seed = " ".join(
        [
            str(case.get("technical_topic") or ""),
            str(case.get("title") or ""),
            extra_instruction,
            patent_points[:2000],
        ]
    )
    chunks = re.findall(r"[\u4e00-\u9fffA-Za-z0-9]{2,18}", seed)
    stop = {"一种", "方法", "系统", "装置", "模块", "技术", "进行", "通过", "基于", "用于"}
    terms: list[str] = []
    for chunk in chunks:
        if chunk in stop or chunk.isdigit() or chunk in terms:
            continue
        terms.append(chunk)
        if len(terms) >= 6:
            break
    return terms or [str(case.get("technical_topic") or case.get("title") or "专利技术")]


def _build_skipped_prior_art_notes(terms: list[str], patent_points: str) -> str:
    return "\n\n".join(
        [
            "# 查新说明",
            "本次按临时配置跳过国知局查新，现有技术内容待后续补充。",
            "该产物仅用于验证专利交底书生成链路能否继续完成，不作为正式查新结论。",
            "## 原计划检索词",
            "\n".join(f"- {term}" for term in terms) or "- 未生成检索词",
            "## 专利点摘要",
            patent_points[:4000],
        ]
    )


def _json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2, default=str)
