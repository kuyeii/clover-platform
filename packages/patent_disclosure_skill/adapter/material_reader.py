from __future__ import annotations

import shutil
import subprocess
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
            text = _read_safe_zip_text(
                source_path,
                skill_dir=self.skill_dir,
                parsed_path=parsed_path,
                work_dir=work_dir,
                timeout_seconds=self.timeout_seconds,
            )
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


def _read_safe_zip_text(
    path: Path,
    *,
    skill_dir: Path | None = None,
    parsed_path: Path | None = None,
    work_dir: Path | None = None,
    timeout_seconds: int = 120,
) -> str:
    validate_zip_safe(path)
    if skill_dir is not None and parsed_path is not None and work_dir is not None:
        packed = _try_pack_zip_repository(
            path,
            skill_dir=skill_dir,
            output_path=parsed_path,
            work_dir=work_dir,
            timeout_seconds=timeout_seconds,
        )
        if packed:
            return packed

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


def repomix_cli_available(skill_dir: Path) -> bool:
    return _resolve_repomix_cli(skill_dir) is not None


def _try_pack_zip_repository(
    path: Path,
    *,
    skill_dir: Path,
    output_path: Path,
    work_dir: Path,
    timeout_seconds: int,
) -> str | None:
    repomix = _resolve_repomix_cli(skill_dir)
    if repomix is None:
        return None

    extract_root = _safe_work_child(work_dir, f"zip_repo_{path.stem}")
    if extract_root.exists():
        shutil.rmtree(extract_root)
    extract_root.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(path) as archive:
        archive.extractall(extract_root)

    repo_root = _repository_root(extract_root)
    if not _contains_source_like_files(repo_root):
        return None

    output_path.parent.mkdir(parents=True, exist_ok=True)
    command = [
        str(repomix),
        str(repo_root),
        "--output",
        str(output_path),
        "--style",
        "markdown",
        "--compress",
        "--remove-empty-lines",
        "--truncate-base64",
        "--no-git-sort-by-changes",
        "--quiet",
    ]
    try:
        completed = subprocess.run(
            command,
            cwd=str(work_dir),
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
            shell=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    if completed.returncode != 0 or not output_path.is_file():
        return None

    text = output_path.read_text(encoding="utf-8", errors="replace").strip()
    return text or None


def _resolve_repomix_cli(skill_dir: Path) -> Path | None:
    local = skill_dir / "tools" / "node_modules" / ".bin" / "repomix"
    if local.is_file():
        return local
    found = shutil.which("repomix")
    return Path(found) if found else None


def _safe_work_child(root: Path, name: str) -> Path:
    root = root.resolve()
    target = (root / name).resolve()
    if target != root and root not in target.parents:
        raise MaterialParseError("ZIP 解析临时路径越界。")
    return target


def _repository_root(extract_root: Path) -> Path:
    entries = [item for item in extract_root.iterdir() if item.name != "__MACOSX"]
    if len(entries) == 1 and entries[0].is_dir():
        return entries[0]
    return extract_root


_SOURCE_LIKE_SUFFIXES = {
    ".c",
    ".cc",
    ".cpp",
    ".cs",
    ".css",
    ".dart",
    ".go",
    ".h",
    ".hpp",
    ".html",
    ".java",
    ".js",
    ".jsx",
    ".kt",
    ".mjs",
    ".php",
    ".py",
    ".rb",
    ".rs",
    ".scala",
    ".sh",
    ".sql",
    ".swift",
    ".ts",
    ".tsx",
    ".vue",
}
_SOURCE_LIKE_NAMES = {
    "dockerfile",
    "makefile",
    "package.json",
    "pyproject.toml",
    "requirements.txt",
    "go.mod",
    "cargo.toml",
}


def _contains_source_like_files(root: Path) -> bool:
    for item in root.rglob("*"):
        if not item.is_file():
            continue
        name = item.name.lower()
        if name in _SOURCE_LIKE_NAMES or item.suffix.lower() in _SOURCE_LIKE_SUFFIXES:
            return True
    return False
