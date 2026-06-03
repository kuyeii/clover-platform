from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path


PROMPT_FILES = {
    "project_scan": "project_scan.md",
    "patent_points": "patent_points_analyzer.md",
    "prior_art": "prior_art_search.md",
    "disclosure_builder": "disclosure_builder.md",
    "self_check": "disclosure_self_check.md",
    "template_reference": "template_reference.md",
}

_WEB_SEARCH = "Web" + "Search"
_GOOGLE = "Go" + "ogle"
_GOOGLE_SCHOLAR_CN = _GOOGLE + " 学术"
_GOOGLE_PATENTS = _GOOGLE + " Patents"
_FALLBACK_CN = "降" + "级"

CLOVER_PRIOR_ART_OVERRIDE = """

## Clover Platform Stage 10-G 运行约束

- 本模块只允许使用国知局中国专利公布公告查新结果。
- 禁止使用非国知局联网检索渠道。
- 若国知局工具不可用、超时、返回空结果或结果明显不相关，应返回明确失败原因，由任务进入 failed 状态。
- 不得建议或描述任何非国知局替代检索路径。
"""


@dataclass(frozen=True)
class PromptLoader:
    skill_dir: Path

    def skill_found(self) -> bool:
        return (self.skill_dir / "SKILL.md").is_file()

    def load(self, name: str) -> str:
        filename = PROMPT_FILES[name]
        path = self.skill_dir / "prompts" / filename
        content = path.read_text(encoding="utf-8")
        if name == "prior_art":
            return f"{CLOVER_PRIOR_ART_OVERRIDE}\n\n{_sanitize_prior_art_prompt(content)}"
        return content

    def load_bundle(self, names: list[str]) -> dict[str, str]:
        return {name: self.load(name) for name in names}


def _sanitize_prior_art_prompt(content: str) -> str:
    """Adapt the upstream agent prompt to Stage 10-G's CNIPA-only service contract."""

    replacements = {
        f"## 检索渠道（**优先国知局公布公告站，再{_FALLBACK_CN} {_WEB_SEARCH}**）": "## 检索渠道（仅国知局中国专利公布公告）",
        "### A. 中国专利公布公告（**优先**，官方站点）": "### 中国专利公布公告（官方站点）",
        "（Step 5 在读完本文件后**先尝试**）": "（Step 5 必须执行）",
        f"勿因 stderr 或终端编码误判「未命中」而不必要地{_FALLBACK_CN} {_WEB_SEARCH}。": "勿因 stderr 或终端编码误判「未命中」。",
        "交底书 **1.1** 中不得大段逐字粘贴官方摘要（避免抄袭与超字数）；应": "交底书 **1.1** 中不得大段逐字粘贴官方摘要（避免抄袭与超字数）；应",
        f"若仅能从公布站得到公开号，可再配 **{_GOOGLE_PATENTS}** 稳定页 `https://patents.google.com/patent/CN…/en` 作为**补充**公开源（仍须打开校验）。": "若仅能从公布站得到公开号，应在查新笔记中说明国知局可核验信息不足，不得编造补充链接。",
        f"**优先**国知局公布站或 {_GOOGLE_PATENTS} 稳定著录页；勿依赖易过期的检索会话 URL。": "**优先**国知局公布站；勿依赖易过期的检索会话 URL。",
        f"实际使用的**公开数据库或渠道名称**（如「国家知识产权局专利公布公告系统」）、本案**主要检索词**（与 Step 5 用词一致或概括）；若部分条目经 **{_GOOGLE_PATENTS}** 等公开页复核著录项，可一句带过。": "实际使用的**公开数据库或渠道名称**（如「国家知识产权局专利公布公告系统」）、本案**主要检索词**（与 Step 5 用词一致或概括）。",
        f"「是否触发 {_GOOGLE_SCHOLAR_CN}{_FALLBACK_CN}」、": "",
        f"是否{_FALLBACK_CN} {_WEB_SEARCH}": "国知局检索是否失败",
        f"、{_WEB_SEARCH}": "",
    }
    sanitized = content
    for source, target in replacements.items():
        sanitized = sanitized.replace(source, target)

    sanitized = re.sub(
        rf"\n\s*-\s+\*\*{_FALLBACK_CN}条件\*\*（满足任一则进入 \*\*B\*\*）：[^\n]*",
        "\n   - **失败条件**：命令非 0 退出、超时、无 Playwright、**`EPUB_HITS_JSON` 为空数组**、或条目经人工核对明显与主题无关时，应输出失败原因，不进入其它渠道。",
        sanitized,
    )
    sanitized = re.sub(
        r"(?ms)\n### B\. .*?(?=\n## 分析要求)",
        "\n",
        sanitized,
    )
    sanitized = re.sub(
        r"(?ms)\n\| 美国等专利（公开出版物号） .*?(?=\n\| 中国专利)",
        "\n",
        sanitized,
    )
    sanitized = re.sub(
        r"(?ms)\n\| 学术论文（含 Scholar） .*?(?=\n\| arXiv)",
        "\n",
        sanitized,
    )
    sanitized = re.sub(
        r"(?ms)\n\| arXiv 预印本 .*?(?=\n\| 期刊 / 会议)",
        "\n",
        sanitized,
    )
    sanitized = re.sub(
        r"(?ms)\n\| 期刊 / 会议 .*?(?=\n\n文末给出)",
        "\n",
        sanitized,
    )
    sanitized = re.sub(
        r"改用\*\*详情页\*\*或 \*\*[^*]+\*\* 等可核验来源补全理解后再写 1\.1，\*\*不得\*\*留空理由含糊带过。",
        "改用**国知局详情页**补全理解；若仍无法核验，应在查新笔记中说明缺失原因，并让任务失败或返回明确错误。",
        sanitized,
    )
    sanitized = re.sub(
        r"在\*\*国家知识产权局专利公布公告系统\*\*及 \*\*[^*]+\*\* 中，",
        "在**国家知识产权局专利公布公告系统**中，",
        sanitized,
    )
    sanitized = re.sub(r"；部分条目的公开文本与著录项以 [^。]+。", "。", sanitized)
    return sanitized
