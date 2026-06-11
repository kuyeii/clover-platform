from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


PROMPT_FILES = {
    "project_scan": "project_scan.md",
    "patent_points": "patent_points_analyzer.md",
    "prior_art": "prior_art_search.md",
    "disclosure_builder": "disclosure_builder.md",
    "self_check": "disclosure_self_check.md",
    "template_reference": "template_reference.md",
    "iteration_context": "iteration_context.md",
    "merger": "merger.md",
    "correction_handler": "correction_handler.md",
}


@dataclass(frozen=True)
class PromptLoader:
    skill_dir: Path

    def skill_found(self) -> bool:
        return (self.skill_dir / "SKILL.md").is_file()

    def load(self, name: str) -> str:
        filename = PROMPT_FILES[name]
        path = self.skill_dir / "prompts" / filename
        return path.read_text(encoding="utf-8")

    def load_bundle(self, names: list[str]) -> dict[str, str]:
        return {name: self.load(name) for name in names}
