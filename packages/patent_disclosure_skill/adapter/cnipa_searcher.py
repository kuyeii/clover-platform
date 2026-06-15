from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .safe_subprocess import run_python_tool


class CnipaSearchError(RuntimeError):
    pass


@dataclass(frozen=True)
class CnipaPriorArtSearcher:
    skill_dir: Path
    enabled: bool = True
    timeout_seconds: int = 300
    max_results: int = 20

    def available(self) -> bool:
        return self.enabled and (self.skill_dir / "tools" / "cnipa_epub_search.py").is_file()

    def search(self, terms: list[str], *, work_dir: Path) -> list[dict[str, Any]]:
        if not self.available():
            raise CnipaSearchError("国知局查新工具不可用。")

        normalized_terms = [term.strip() for term in terms if term.strip()][:8]
        if not normalized_terms:
            raise CnipaSearchError("缺少国知局查新关键词。")

        hits_by_key: dict[str, dict[str, Any]] = {}
        for term in normalized_terms:
            result = run_python_tool(
                skill_dir=self.skill_dir,
                tool_name="cnipa_epub_search.py",
                args=[term],
                cwd=work_dir,
                timeout_seconds=self.timeout_seconds,
            )
            if result.returncode != 0:
                raise CnipaSearchError((result.stderr or result.stdout or "国知局查新失败。").strip())
            hits = _parse_hits(result.stdout)
            for hit in hits:
                key = str(hit.get("pub_number") or hit.get("link") or hit.get("title") or "")
                if key and key not in hits_by_key:
                    hits_by_key[key] = hit
                if len(hits_by_key) >= self.max_results:
                    break
        if not hits_by_key:
            raise CnipaSearchError("国知局查新未返回可用结果，将进入降级查新。")
        return list(hits_by_key.values())[: self.max_results]


def _parse_hits(stdout: str) -> list[dict[str, Any]]:
    match = re.search(r"EPUB_HITS_JSON:\s*(\[.*\])", stdout, flags=re.S)
    if not match:
        return []
    try:
        value = json.loads(match.group(1))
    except json.JSONDecodeError:
        return []
    return value if isinstance(value, list) else []
