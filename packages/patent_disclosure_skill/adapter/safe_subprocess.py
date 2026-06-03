from __future__ import annotations

import os
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path


ALLOWED_TOOLS = {
    "docx_to_md.py",
    "pptx_to_md.py",
    "md_to_docx.py",
    "cnipa_epub_search.py",
    "mermaid_render.py",
}


@dataclass(frozen=True)
class ToolResult:
    returncode: int
    stdout: str
    stderr: str


def run_python_tool(
    *,
    skill_dir: Path,
    tool_name: str,
    args: list[str],
    cwd: Path,
    timeout_seconds: int,
) -> ToolResult:
    if tool_name not in ALLOWED_TOOLS:
        raise ValueError(f"Tool is not allowed: {tool_name}")

    tool_path = (skill_dir / "tools" / tool_name).resolve()
    if not tool_path.is_file() or skill_dir.resolve() not in tool_path.parents:
        raise FileNotFoundError(f"Tool not found: {tool_name}")

    cwd = cwd.resolve()
    cwd.mkdir(parents=True, exist_ok=True)
    env = os.environ.copy()
    env["PYTHONPATH"] = os.pathsep.join(
        [
            str(tool_path.parent),
            str(skill_dir),
            env.get("PYTHONPATH", ""),
        ]
    )
    if tool_name == "cnipa_epub_search.py":
        env.setdefault("EPUB_TIMEOUT_MS", str(max(1, int(timeout_seconds)) * 1000))
        env.setdefault("EPUB_WAF_MAX_WAIT_SEC", str(max(1, int(timeout_seconds))))

    completed = subprocess.run(
        [sys.executable, str(tool_path), *args],
        cwd=str(cwd),
        env=env,
        capture_output=True,
        text=True,
        timeout=timeout_seconds,
        shell=False,
    )
    return ToolResult(
        returncode=completed.returncode,
        stdout=(completed.stdout or "")[-100_000:],
        stderr=(completed.stderr or "")[-100_000:],
    )
