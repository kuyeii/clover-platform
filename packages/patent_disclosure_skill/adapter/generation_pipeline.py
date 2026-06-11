from __future__ import annotations

import json
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from .cnipa_searcher import CnipaPriorArtSearcher, CnipaSearchError
from .docx_exporter import DocxExporter
from .fallback_searcher import FallbackPriorArtSearcher, FallbackPriorArtSearchError
from .material_reader import MaterialReader
from .openai_compatible_llm import OpenAICompatibleLLMClient
from .prompt_loader import PromptLoader


@dataclass(frozen=True)
class PipelineOptions:
    output_formats: list[str]
    include_mermaid: bool
    render_mermaid_png: bool
    anonymize: bool
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
        fallback_searcher: FallbackPriorArtSearcher | None = None,
        docx_exporter: DocxExporter,
    ) -> None:
        self.skill_dir = skill_dir
        self.material_reader = material_reader
        self.llm = llm
        self.cnipa_searcher = cnipa_searcher
        self.fallback_searcher = fallback_searcher or FallbackPriorArtSearcher(max_results=cnipa_searcher.max_results)
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
        emit(PipelineProgress("cnipa_prior_art", 60, "正在执行国知局查新"))
        prior_art_search = self._search_prior_art(terms=terms, patent_points=patent_points, work_dir=tmp_dir, emit=emit)
        prior_art_notes = self._build_prior_art_notes(terms, prior_art_search, patent_points)
        prior_art_md = output_dir / f"cnipa_prior_art_notes_{timestamp}.md"
        prior_art_md.write_text(prior_art_notes, encoding="utf-8")
        content_warnings: list[str] = []

        emit(PipelineProgress("build_disclosure", 75, "正在生成技术交底书"))
        disclosure = _normalize_disclosure_body(
            self._build_disclosure(case, material_text, project_scan, patent_points, prior_art_notes, options)
        )

        emit(PipelineProgress("self_check", 84, "正在执行交底书自检"))
        self_check = self._self_check(case, disclosure, prior_art_notes, options)
        self_check_md = output_dir / f"self_check_{timestamp}.md"
        self_check_md.write_text(self_check, encoding="utf-8")

        revised_disclosure = _extract_revised_disclosure(self_check)
        if revised_disclosure:
            disclosure = revised_disclosure
        else:
            content_warnings.append("自检未返回可提取的修订后交底书正文，已保留生成稿。")

        disclosure = self._ensure_flow_structure(
            case=case,
            disclosure=disclosure,
            material_text=material_text,
            project_scan=project_scan,
            patent_points=patent_points,
            prior_art_notes=prior_art_notes,
            options=options,
            warnings=content_warnings,
        )

        disclosure_md = output_dir / f"{safe_case_title}_{timestamp}.md"
        disclosure_md.write_text(disclosure, encoding="utf-8")

        emit(PipelineProgress("export_docx", 92, "正在导出 Word 文档"))
        disclosure_docx = output_dir / f"{safe_case_title}_{timestamp}.docx"
        warnings = [
            *content_warnings,
            *self.docx_exporter.export(input_md=disclosure_md, output_docx=disclosure_docx, work_dir=tmp_dir),
        ]

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

    def _search_prior_art(
        self,
        *,
        terms: list[str],
        patent_points: str,
        work_dir: Path,
        emit: Callable[[PipelineProgress], None],
    ) -> dict:
        _ = patent_points
        cnipa_status: dict[str, object] = {"status": "not_run", "message": ""}
        cnipa_hits: list[dict] = []
        fallback_result: dict[str, object] | None = None

        try:
            cnipa_hits = self.cnipa_searcher.search(terms, work_dir=work_dir)
            cnipa_status = {"status": "succeeded", "message": f"国知局查新命中 {len(cnipa_hits)} 条。"}
        except CnipaSearchError as exc:
            cnipa_status = {"status": "failed", "message": str(exc) or "国知局查新失败。"}
        except (TimeoutError, subprocess.TimeoutExpired) as exc:
            cnipa_status = {"status": "failed", "message": str(exc) or "国知局查新超时。"}

        if cnipa_hits:
            return {
                "terms": terms,
                "cnipa_status": cnipa_status,
                "cnipa_hits": cnipa_hits,
                "fallback_result": None,
            }

        emit(PipelineProgress("cnipa_prior_art", 65, "国知局查新未完成，正在执行降级查新"))
        try:
            fallback_result = self.fallback_searcher.search(terms)
        except FallbackPriorArtSearchError as exc:
            raise CnipaSearchError(
                "\n".join(
                    [
                        "国知局查新失败且降级查新未返回可用结果。",
                        f"国知局失败原因：{cnipa_status.get('message') or '无'}",
                        f"降级失败原因：{str(exc) or '无'}",
                    ]
                )
            ) from exc

        return {
            "terms": terms,
            "cnipa_status": cnipa_status,
            "cnipa_hits": [],
            "fallback_result": fallback_result,
        }

    def _build_prior_art_notes(self, terms: list[str], search_result: dict, patent_points: str) -> str:
        prompt = self.prompts.load("prior_art")
        return self.llm.chat(
            [
                {"role": "system", "content": "你是专利查新分析助手，基于给定国知局及降级检索结果做差异化分析。"},
                {
                    "role": "user",
                    "content": "\n\n".join(
                        [
                            "# 查新指令",
                            prompt[:28_000],
                            "# 检索词",
                            "\n".join(f"- {term}" for term in terms),
                            "# 国知局检索状态",
                            _json(search_result.get("cnipa_status", {})),
                            "# 国知局检索结果 JSON",
                            _json(search_result.get("cnipa_hits", []))[:80_000],
                            "# 降级检索结果 JSON",
                            _json(search_result.get("fallback_result"))[:80_000],
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
            timeout=600,
        )

    def _ensure_flow_structure(
        self,
        *,
        case: dict,
        disclosure: str,
        material_text: str,
        project_scan: str,
        patent_points: str,
        prior_art_notes: str,
        options: PipelineOptions,
        warnings: list[str],
    ) -> str:
        if _has_required_flow_structure(disclosure):
            return disclosure

        repaired = self._repair_flow_structure(
            case,
            disclosure,
            material_text,
            project_scan,
            patent_points,
            prior_art_notes,
            options,
        )
        if _is_valid_disclosure_body(repaired) and _has_required_flow_structure(repaired):
            warnings.append("检测到 3.4 系统流程说明结构不完整，已自动定向修复。")
            return repaired

        warnings.append("3.4 系统流程说明结构校验未通过，定向修复失败，已保留原稿。")
        return disclosure

    def _repair_flow_structure(
        self,
        case: dict,
        disclosure: str,
        material_text: str,
        project_scan: str,
        patent_points: str,
        prior_art_notes: str,
        options: PipelineOptions,
    ) -> str:
        prompts = self.prompts.load_bundle(["disclosure_builder", "template_reference"])
        return _normalize_disclosure_body(self.llm.chat(
            [
                {"role": "system", "content": "你是资深专利代理人与技术交底书结构修订助手。输出完整 Markdown 交底书正文。"},
                {
                    "role": "user",
                    "content": "\n\n".join(
                        [
                            "# 结构修复任务",
                            (
                                "仅修复第三章 3.4 系统流程说明的结构，保持其它章节事实、结论和表述尽量不变。"
                                "3.4 标题下必须先给 fenced mermaid 流程图，再给 S1、S2、S3... 或“步骤 S1：...”形式的具体步骤说明。"
                                "若需要符号与公式，必须放在流程图和具体步骤之后，不能作为 3.4 下第一块内容。"
                                "输出完整 Markdown 交底书正文，不要输出修订说明、自检报告、对话引导或内部路径。"
                            ),
                            "# 交底书生成指令",
                            prompts["disclosure_builder"][:20_000],
                            "# 模版参考",
                            prompts["template_reference"][:20_000],
                            "# 案件信息",
                            _json(case),
                            "# 参数",
                            _json(options.__dict__),
                            "# 当前交底书正文",
                            disclosure[:90_000],
                            "# 项目扫描",
                            project_scan[:20_000],
                            "# 专利点",
                            patent_points[:25_000],
                            "# 国知局查新分析",
                            prior_art_notes[:25_000],
                            "# 项目材料摘录",
                            material_text[:30_000],
                        ]
                    ),
                },
            ],
            timeout=600,
        ))

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


_REVISED_DISCLOSURE_MARKERS = (
    "## 修订后的交底书正文",
    "### 修订后的交底书正文",
    "修订后的交底书正文",
    "## 修订后正文",
    "### 修订后正文",
    "修订后正文",
)
_FLOW_SECTION_RE = re.compile(r"(?ms)^###\s+3\.4\s+系统流程说明\s*$([\s\S]*?)(?=^###\s+3\.5\s+|^##\s+四、|^##\s+4[.、]|\Z)")
_MERMAID_RE = re.compile(r"(?ms)^```mermaid\s*$.*?^```\s*$")
_FLOW_STEPS_RE = re.compile(r"(?:步骤\s*)?S[1-9]\d*[：:]")


def _extract_revised_disclosure(self_check: str) -> str | None:
    source = self_check.strip()
    candidates: list[str] = []
    candidates.extend(_markdown_fence_bodies(source))
    for marker in _REVISED_DISCLOSURE_MARKERS:
        pos = source.find(marker)
        if pos == -1:
            continue
        candidate = source[pos + len(marker) :].strip()
        candidates.append(_trim_to_disclosure_start(candidate))
    candidates.append(_trim_to_disclosure_start(source))

    for candidate in candidates:
        candidate = _normalize_disclosure_body(candidate)
        if _is_valid_disclosure_body(candidate):
            return candidate
    return None


def _normalize_disclosure_body(text: str) -> str:
    candidate = (text or "").strip().lstrip("\ufeff")
    candidate = _strip_outer_fence(candidate)
    candidate = _trim_to_disclosure_start(candidate)
    candidate = _strip_unmatched_trailing_fence(candidate)
    return candidate.strip()


def _markdown_fence_bodies(text: str) -> list[str]:
    bodies: list[str] = []
    lines = text.splitlines()
    for idx, line in enumerate(lines):
        if not re.match(r"^```(?:markdown|md)\s*$", line.strip(), re.IGNORECASE):
            continue
        for end_idx in range(len(lines) - 1, idx, -1):
            if lines[end_idx].strip() == "```":
                body = "\n".join(lines[idx + 1 : end_idx]).strip()
                if body:
                    bodies.append(body)
                break
    return bodies


def _trim_to_disclosure_start(text: str) -> str:
    idx = text.find("# 技术交底书")
    if idx != -1:
        return text[idx:].strip()
    idx = text.find("**案件名称**")
    if idx != -1:
        return text[idx:].strip()
    return text.strip()


def _strip_outer_fence(text: str) -> str:
    lines = text.splitlines()
    if len(lines) >= 2 and lines[0].strip().startswith("```") and lines[-1].strip() == "```":
        return "\n".join(lines[1:-1]).strip()
    return text


def _strip_unmatched_trailing_fence(text: str) -> str:
    lines = text.splitlines()
    if not lines:
        return text
    last_non_empty = next((idx for idx in range(len(lines) - 1, -1, -1) if lines[idx].strip()), None)
    if last_non_empty is None or lines[last_non_empty].strip() != "```":
        return text
    fence_count = sum(1 for line in lines[: last_non_empty + 1] if line.strip().startswith("```"))
    if fence_count % 2 == 1:
        return "\n".join(lines[:last_non_empty] + lines[last_non_empty + 1 :]).strip()
    return text


def _is_valid_disclosure_body(text: str) -> bool:
    if "# 技术交底书" not in text or "**案件名称**" not in text:
        return False
    forbidden_patterns = [
        r"(?m)^##\s*8(?:\.|、)",
        r"(?m)^###?\s*问题发现与修订",
        r"(?m)^##\s*(?:合并摘要|纠正摘要)",
        r"(?m)^##\s*修订后的交底书正文",
        r"(?m)^###?\s*修订后的交底书正文",
        r"若您希望权利要求/保护点表述",
        r"outputs/[0-9a-f-]{8,}/",
        r"patent-disclosure-skill",
        r"examples/",
    ]
    return not any(re.search(pattern, text) for pattern in forbidden_patterns)


def _has_required_flow_structure(text: str) -> bool:
    section = _flow_section(text)
    if not section:
        return False
    first_numbered_subheading = re.search(r"(?m)^#{3,6}\s+3\.4\.\d+", section)
    before_first_numbered_subheading = (
        section[: first_numbered_subheading.start()] if first_numbered_subheading else section
    )
    if not _MERMAID_RE.search(before_first_numbered_subheading):
        return False
    if not _FLOW_STEPS_RE.search(before_first_numbered_subheading):
        return False
    return True


def _flow_section(text: str) -> str:
    match = _FLOW_SECTION_RE.search(text)
    return match.group(1) if match else ""


def _json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2, default=str)
