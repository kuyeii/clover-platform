from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import re
import zipfile

from .safe_subprocess import run_python_tool


class DocxExportError(RuntimeError):
    pass


@dataclass(frozen=True)
class DocxExporter:
    skill_dir: Path
    timeout_seconds: int = 120
    enable_mermaid_render: bool = True

    def available(self) -> bool:
        return (self.skill_dir / "tools" / "md_to_docx.py").is_file()

    def export(self, *, input_md: Path, output_docx: Path, work_dir: Path) -> list[str]:
        if not self.available():
            raise DocxExportError("Word 导出工具不可用。")
        output_docx.parent.mkdir(parents=True, exist_ok=True)
        warnings: list[str] = []
        if self.enable_mermaid_render and (self.skill_dir / "tools" / "mermaid_render.py").is_file():
            result = run_python_tool(
                skill_dir=self.skill_dir,
                tool_name="mermaid_render.py",
                args=["--input", str(input_md), "--output", str(input_md), "--docx", str(output_docx)],
                cwd=work_dir,
                timeout_seconds=max(self.timeout_seconds, 180),
            )
            if result.returncode == 0 and output_docx.is_file():
                if "失败" in result.stderr or "failed" in result.stderr.lower():
                    warnings.append(result.stderr[-2000:])
                warnings.extend(_validate_rendered_docx(input_md, output_docx))
                return warnings
            warnings.append((result.stderr or result.stdout or "Mermaid 渲染失败，已改用基础 Word 导出。")[-2000:])

        result = run_python_tool(
            skill_dir=self.skill_dir,
            tool_name="md_to_docx.py",
            args=["--input", str(input_md), "--output", str(output_docx), "--base-dir", str(input_md.parent)],
            cwd=work_dir,
            timeout_seconds=self.timeout_seconds,
        )
        if result.returncode != 0 or not output_docx.is_file():
            raise DocxExportError((result.stderr or result.stdout or "Word 导出失败。").strip())
        warnings.extend(_validate_rendered_docx(input_md, output_docx))
        return warnings


_MERMAID_FENCE_RE = re.compile(r"^```mermaid\s*$", re.MULTILINE | re.IGNORECASE)
_HIDDEN_IMAGE_RE = re.compile(r"<!--\s*!\[[^\]]*]\(([^)]+)\)\s*-->")


def _validate_rendered_docx(input_md: Path, output_docx: Path) -> list[str]:
    warnings: list[str] = []
    try:
        md_text = input_md.read_text(encoding="utf-8")
    except OSError:
        md_text = ""

    mermaid_count = len(_MERMAID_FENCE_RE.findall(md_text))
    mermaid_image_refs = [
        ref for ref in _HIDDEN_IMAGE_RE.findall(md_text)
        if "mermaid_figures" in ref.replace("\\", "/")
    ]
    math_image_refs = [
        ref for ref in _HIDDEN_IMAGE_RE.findall(md_text)
        if "math_figures" in ref.replace("\\", "/")
    ]

    media_entries: list[str] = []
    document_xml = ""
    try:
        with zipfile.ZipFile(output_docx) as docx:
            names = docx.namelist()
            media_entries = [name for name in names if name.startswith("word/media/")]
            try:
                document_xml = docx.read("word/document.xml").decode("utf-8", errors="replace")
            except KeyError:
                document_xml = ""
    except zipfile.BadZipFile:
        warnings.append("Word 导出文件不是有效的 DOCX zip 包，请重新生成。")
        return warnings

    if mermaid_count and not mermaid_image_refs:
        warnings.append(f"检测到 {mermaid_count} 个 Mermaid 图示，但未生成 mermaid_figures PNG；Word 中会保留源码而不是图片。")
    if mermaid_image_refs and not media_entries:
        warnings.append("Markdown 已生成图示引用，但 DOCX 中没有 word/media 图片资源，请检查图片嵌入流程。")
    if mermaid_count and ("flowchart " in document_xml or "graph " in document_xml):
        warnings.append("DOCX 正文仍包含 Mermaid 源码，图示可能没有成功嵌入。")
    if math_image_refs and not media_entries:
        warnings.append("Markdown 已生成公式图片引用，但 DOCX 中没有 word/media 图片资源，请检查公式嵌入流程。")
    if "\\(" in document_xml or "$$" in document_xml:
        warnings.append("DOCX 正文仍包含部分 LaTeX 公式源码，可能有公式未能渲染为图片。")
    return warnings
