from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import re
import shutil
from typing import Callable, Literal

from .docx_exporter import DocxExporter
from .generation_pipeline import (
    PipelineProgress,
    _extract_revised_disclosure,
    _has_required_flow_structure,
    _is_valid_disclosure_body,
    _normalize_disclosure_body,
)
from .openai_compatible_llm import OpenAICompatibleLLMClient
from .prompt_loader import PromptLoader


RevisionKind = Literal["merge", "correct"]


@dataclass(frozen=True)
class RevisionOptions:
    render_mermaid_png: bool


@dataclass(frozen=True)
class RevisionResult:
    disclosure_md: Path
    disclosure_docx: Path
    revision_kind: RevisionKind
    summary: str
    warnings: list[str]


class RevisionPipeline:
    def __init__(
        self,
        *,
        skill_dir: Path,
        llm: OpenAICompatibleLLMClient,
        docx_exporter: DocxExporter,
    ) -> None:
        self.skill_dir = skill_dir
        self.llm = llm
        self.docx_exporter = docx_exporter
        self.prompts = PromptLoader(skill_dir)

    def run(
        self,
        *,
        case: dict,
        base_disclosure_md: Path,
        output_dir: Path,
        tmp_dir: Path,
        safe_case_title: str,
        timestamp: str,
        revision_instruction: str,
        options: RevisionOptions,
        emit: Callable[[PipelineProgress], None],
    ) -> RevisionResult:
        output_dir.mkdir(parents=True, exist_ok=True)
        tmp_dir.mkdir(parents=True, exist_ok=True)

        emit(PipelineProgress("revision_read_base", 10, "正在读取最新交底书"))
        base_disclosure = base_disclosure_md.read_text(encoding="utf-8")
        kind = classify_revision_kind(revision_instruction)

        emit(PipelineProgress("revision_llm", 45, "正在根据用户意见修订交底书"))
        revised_raw = self._revise_disclosure(
            case=case,
            base_disclosure=base_disclosure,
            revision_instruction=revision_instruction,
            kind=kind,
        )
        revised_disclosure = _extract_revised_disclosure(revised_raw) or _normalize_disclosure_body(revised_raw)
        if not _is_valid_disclosure_body(revised_disclosure):
            raise ValueError("模型未返回可用的完整交底书正文。")
        revised_disclosure = prepare_revision_disclosure_assets(
            revised_disclosure,
            output_dir=output_dir,
            base_dir=base_disclosure_md.parent,
        )

        warnings: list[str] = []
        if not _has_required_flow_structure(revised_disclosure):
            warnings.append("修订稿 3.4 系统流程说明结构未完全通过校验，请下载后重点复核。")

        disclosure_md = output_dir / f"{safe_case_title}_{timestamp}.md"
        disclosure_md.write_text(revised_disclosure, encoding="utf-8")

        emit(PipelineProgress("revision_export_docx", 78, "正在导出修订版 Word 文档"))
        disclosure_docx = output_dir / f"{safe_case_title}_{timestamp}.docx"
        warnings.extend(
            self.docx_exporter.export(input_md=disclosure_md, output_docx=disclosure_docx, work_dir=tmp_dir)
        )

        emit(PipelineProgress("revision_summary", 90, "正在生成修订摘要"))
        summary = self._build_summary(
            case=case,
            base_disclosure=base_disclosure,
            revised_disclosure=revised_disclosure,
            revision_instruction=revision_instruction,
            kind=kind,
        )

        return RevisionResult(
            disclosure_md=disclosure_md,
            disclosure_docx=disclosure_docx,
            revision_kind=kind,
            summary=summary,
            warnings=warnings,
        )

    def _revise_disclosure(
        self,
        *,
        case: dict,
        base_disclosure: str,
        revision_instruction: str,
        kind: RevisionKind,
    ) -> str:
        prompts = self.prompts.load_bundle(
            ["iteration_context", "correction_handler" if kind == "correct" else "merger", "self_check"]
        )
        template_name = "correction_handler" if kind == "correct" else "merger"
        summary_title = "纠正摘要" if kind == "correct" else "合并摘要"
        return self.llm.chat(
            [
                {"role": "system", "content": "你是资深专利代理人与技术交底书修订助手。只输出修订后的完整 Markdown 交底书正文。"},
                {
                    "role": "user",
                    "content": "\n\n".join(
                        [
                            "# 迭代上下文指令",
                            prompts["iteration_context"][:22_000],
                            "# 本轮迭代模板",
                            prompts[template_name][:28_000],
                            "# 自检指令摘录",
                            prompts["self_check"][:18_000],
                            "# 输出硬性要求",
                            (
                                "根据用户修改意见修订基准交底书。输出必须是完整 Markdown 交底书正文，"
                                "以“# 技术交底书”开始，保留未涉及章节，不要输出路径、对话记录、"
                                f"不要输出“{summary_title}（留档）”或任何解释性小节。"
                            ),
                            "# 案件信息",
                            _json(case),
                            "# 用户修改意见",
                            revision_instruction[:12_000],
                            "# 基准交底书全文",
                            base_disclosure[:110_000],
                        ]
                    ),
                },
            ],
            timeout=600,
        )

    def _build_summary(
        self,
        *,
        case: dict,
        base_disclosure: str,
        revised_disclosure: str,
        revision_instruction: str,
        kind: RevisionKind,
    ) -> str:
        title = "纠正摘要（留档）" if kind == "correct" else "合并摘要（留档）"
        return self.llm.chat(
            [
                {"role": "system", "content": "你是专利交底书修订记录助手。输出简短中文留档摘要。"},
                {
                    "role": "user",
                    "content": "\n\n".join(
                        [
                            f"# 任务\n请输出“{title}”，只写 2-5 句完整中文，不要使用 Markdown 标题。",
                            "# 案件信息",
                            _json(case),
                            "# 用户修改意见",
                            revision_instruction[:12_000],
                            "# 修订前正文摘录",
                            base_disclosure[:30_000],
                            "# 修订后正文摘录",
                            revised_disclosure[:30_000],
                        ]
                    ),
                },
            ],
            timeout=120,
        ).strip()


_CORRECTION_KEYWORDS = (
    "错误",
    "不对",
    "不正确",
    "不一致",
    "矛盾",
    "改成",
    "改为",
    "删除",
    "删掉",
    "替换",
    "参数",
    "公式",
    "符号",
    "保护点",
    "权利要求",
    "措辞",
    "风格",
    "表述",
    "错",
)


def classify_revision_kind(instruction: str) -> RevisionKind:
    normalized = instruction.strip().lower()
    if any(keyword.lower() in normalized for keyword in _CORRECTION_KEYWORDS):
        return "correct"
    return "merge"


_MERMAID_FENCE_WITH_FIGURE_RE = re.compile(
    r"(?ms)(^```mermaid\s*$.*?^```\s*)(?:\n[ \t]*)?<!--\s*!\[[^\]]*]\(([^)]*mermaid_figures/[^)]*)\)\s*-->"
)
_HIDDEN_IMAGE_COMMENT_RE = re.compile(r"<!--\s*!\[[^\]]*]\(([^)]+)\)\s*-->")
_VISIBLE_IMAGE_RE = re.compile(r"!\[[^\]]*]\(([^)]+)\)")


def prepare_revision_disclosure_assets(
    disclosure: str,
    *,
    output_dir: Path,
    base_dir: Path | None = None,
) -> str:
    """Remove stale generated-asset references before exporting a revised disclosure."""
    output_dir.mkdir(parents=True, exist_ok=True)
    cleaned = _MERMAID_FENCE_WITH_FIGURE_RE.sub(lambda match: match.group(1).rstrip() + "\n", disclosure)
    if base_dir is not None:
        _copy_referenced_math_images(cleaned, output_dir=output_dir, base_dir=base_dir)
    return _remove_missing_hidden_image_comments(cleaned, output_dir=output_dir)


def _copy_referenced_math_images(disclosure: str, *, output_dir: Path, base_dir: Path) -> None:
    for src in _math_image_references(disclosure):
        if _image_reference_exists(src, output_dir=output_dir):
            continue
        source = _safe_child_path(src, root=base_dir)
        target = _safe_child_path(src, root=output_dir)
        if source is None or target is None or not source.is_file():
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)


def _math_image_references(disclosure: str) -> set[str]:
    refs = {
        match.group(1).strip()
        for match in _HIDDEN_IMAGE_COMMENT_RE.finditer(disclosure)
        if "math_figures" in match.group(1).replace("\\", "/")
    }
    refs.update(
        match.group(1).strip()
        for match in _VISIBLE_IMAGE_RE.finditer(disclosure)
        if "math_figures" in match.group(1).replace("\\", "/")
    )
    return refs


def _remove_missing_hidden_image_comments(disclosure: str, *, output_dir: Path) -> str:
    def replace(match: re.Match[str]) -> str:
        src = match.group(1).strip()
        if _image_reference_exists(src, output_dir=output_dir):
            return match.group(0)
        return ""

    return _HIDDEN_IMAGE_COMMENT_RE.sub(replace, disclosure)


def _image_reference_exists(src: str, *, output_dir: Path) -> bool:
    resolved = _safe_child_path(src, root=output_dir)
    return bool(resolved and resolved.is_file())


def _safe_child_path(src: str, *, root: Path) -> Path | None:
    path = Path(src)
    if path.is_absolute() or src.startswith(("http://", "https://", "data:")):
        return None
    candidate = root / path
    try:
        resolved = candidate.resolve()
    except OSError:
        return None
    try:
        resolved.relative_to(root.resolve())
    except ValueError:
        return None
    return resolved


def _json(value: object) -> str:
    import json

    return json.dumps(value, ensure_ascii=False, indent=2, default=str)
