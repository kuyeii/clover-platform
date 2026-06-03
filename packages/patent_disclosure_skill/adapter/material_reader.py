from __future__ import annotations

import zipfile
from dataclasses import dataclass
from pathlib import Path

import fitz

from .safe_subprocess import run_python_tool


class MaterialParseError(RuntimeError):
    pass


@dataclass(frozen=True)
class ParsedMaterial:
    source_path: Path
    parsed_path: Path | None
    text: str
    status: str


@dataclass(frozen=True)
class MaterialReader:
    skill_dir: Path
    timeout_seconds: int = 120

    def parse(self, *, source_path: Path, parsed_dir: Path, work_dir: Path) -> ParsedMaterial:
        parsed_dir.mkdir(parents=True, exist_ok=True)
        suffix = source_path.suffix.lower()
        parsed_path = parsed_dir / f"{source_path.stem}.md"

        if suffix in {".md", ".txt"}:
            text = source_path.read_text(encoding="utf-8", errors="replace")
            parsed_path.write_text(text, encoding="utf-8")
            return ParsedMaterial(source_path, parsed_path, text, "parsed")

        if suffix == ".pdf":
            text = _read_pdf(source_path)
            parsed_path.write_text(text, encoding="utf-8")
            return ParsedMaterial(source_path, parsed_path, text, "parsed")

        if suffix == ".docx":
            result = run_python_tool(
                skill_dir=self.skill_dir,
                tool_name="docx_to_md.py",
                args=["--input", str(source_path), "--output", str(parsed_path)],
                cwd=work_dir,
                timeout_seconds=self.timeout_seconds,
            )
            if result.returncode != 0:
                raise MaterialParseError((result.stderr or result.stdout or "Word 材料解析失败。").strip())
            return ParsedMaterial(source_path, parsed_path, parsed_path.read_text(encoding="utf-8"), "parsed")

        if suffix == ".pptx":
            result = run_python_tool(
                skill_dir=self.skill_dir,
                tool_name="pptx_to_md.py",
                args=["--input", str(source_path), "--output", str(parsed_path)],
                cwd=work_dir,
                timeout_seconds=self.timeout_seconds,
            )
            if result.returncode != 0:
                raise MaterialParseError((result.stderr or result.stdout or "PPT 材料解析失败。").strip())
            return ParsedMaterial(source_path, parsed_path, parsed_path.read_text(encoding="utf-8"), "parsed")

        if suffix == ".zip":
            text = _read_safe_zip_text(source_path)
            parsed_path.write_text(text, encoding="utf-8")
            return ParsedMaterial(source_path, parsed_path, text, "parsed")

        raise MaterialParseError("暂不支持该文件类型。")


def validate_zip_safe(path: Path) -> None:
    with zipfile.ZipFile(path) as archive:
        for info in archive.infolist():
            name = info.filename
            target = Path(name)
            if target.is_absolute() or ".." in target.parts:
                raise MaterialParseError("ZIP 文件包含不安全路径。")
            if info.is_dir():
                continue
            mode = (info.external_attr >> 16) & 0o170000
            if mode == 0o120000:
                raise MaterialParseError("ZIP 文件包含不允许的软链接。")


def _read_pdf(path: Path) -> str:
    pages: list[str] = []
    with fitz.open(path) as doc:
        for index, page in enumerate(doc, start=1):
            text = page.get_text("text").strip()
            if text:
                pages.append(f"## 第 {index} 页\n\n{text}")
    return "\n\n".join(pages).strip()


def _read_safe_zip_text(path: Path) -> str:
    validate_zip_safe(path)
    blocks: list[str] = []
    with zipfile.ZipFile(path) as archive:
        for info in archive.infolist():
            if info.is_dir():
                continue
            suffix = Path(info.filename).suffix.lower()
            if suffix not in {".md", ".txt"}:
                continue
            with archive.open(info) as handle:
                text = handle.read(512_000).decode("utf-8", errors="replace").strip()
            if text:
                blocks.append(f"# {info.filename}\n\n{text}")
    return "\n\n".join(blocks).strip() or "ZIP 中未发现可直接读取的 Markdown 或文本材料。"

