# -*- coding: utf-8 -*-
"""
提示词审查器
用于在外部优化器介入前，先做项目内可控的规则化质量审查。
"""

from dataclasses import dataclass
import re


@dataclass(frozen=True)
class PromptAuditIssue:
    """提示词审查问题。"""

    code: str
    severity: str
    message: str


class PromptAuditor:
    """
    规则化提示词审查器。

    检查重点：
    - 是否声明事实来源优先级，避免模型自由补全。
    - 是否明确禁止输出越界商务附件。
    - 是否约束章节标题重复和 Markdown 标题污染。
    - 是否声明结构化输出格式。
    """

    FACT_ANCHOR_PATTERNS = (
        r"解析报告",
        r"招标文件",
        r"评分",
        r"需求",
        r"证据",
        r"不得.*编造",
        r"禁止.*臆测",
    )
    BUSINESS_BOUNDARY_PATTERNS = (
        r"法定代表人",
        r"授权书",
        r"营业执照",
        r"报价单",
        r"商务附件",
    )
    STRUCTURE_BOUNDARY_PATTERNS = (
        r"禁止重复输出.*标题",
        r"禁止.*Markdown.*标题",
        r"禁止.*#",
        r"章节标题",
    )
    OUTPUT_FORMAT_PATTERNS = (
        r"JSON",
        r"```json",
        r"只输出",
        r"输出格式",
        r"schema",
    )

    def audit(self, prompt: str, *, stage: str = "generic") -> list[PromptAuditIssue]:
        """
        审查提示词质量。

        Args:
            prompt: 待审查提示词文本。
            stage: 阶段标识，如 outline/content/review。

        Returns:
            问题列表；空列表表示未发现规则级风险。
        """
        text = str(prompt or "").strip()
        issues: list[PromptAuditIssue] = []
        if not text:
            return [
                PromptAuditIssue(
                    code="empty_prompt",
                    severity="error",
                    message="提示词为空，无法约束模型输出。",
                )
            ]

        if not self._has_any(text, self.FACT_ANCHOR_PATTERNS):
            issues.append(PromptAuditIssue(
                code="weak_fact_anchor",
                severity="warning",
                message="缺少明确事实来源或禁止编造约束，容易产生幻觉。",
            ))

        if stage in {"outline", "content", "generic"} and not self._has_any(text, self.BUSINESS_BOUNDARY_PATTERNS):
            issues.append(PromptAuditIssue(
                code="missing_business_boundary",
                severity="warning",
                message="缺少商务附件越界边界，技术正文可能混入授权书、报价单等内容。",
            ))

        if stage in {"content", "generic"} and not self._has_any(text, self.STRUCTURE_BOUNDARY_PATTERNS):
            issues.append(PromptAuditIssue(
                code="missing_structure_boundary",
                severity="warning",
                message="缺少章节标题边界约束，正文可能重复输出标题或 Markdown 标题。",
            ))

        if stage in {"outline", "review"} and not self._has_any(text, self.OUTPUT_FORMAT_PATTERNS):
            issues.append(PromptAuditIssue(
                code="missing_output_format",
                severity="warning",
                message="缺少结构化输出格式约束，后续解析稳定性不足。",
            ))

        if self._has_contradictory_output_rules(text):
            issues.append(PromptAuditIssue(
                code="contradictory_output_rules",
                severity="error",
                message="同时存在互相冲突的输出格式约束，需要拆分或删减。",
            ))

        return issues

    @staticmethod
    def _has_any(text: str, patterns: tuple[str, ...]) -> bool:
        return any(re.search(pattern, text, flags=re.IGNORECASE) for pattern in patterns)

    @staticmethod
    def _has_contradictory_output_rules(text: str) -> bool:
        wants_json = bool(re.search(r"JSON|```json|schema", text, flags=re.IGNORECASE))
        forbids_json = bool(re.search(r"不要.*JSON|禁止.*JSON", text, flags=re.IGNORECASE))
        wants_markdown = bool(re.search(r"Markdown|#|标题", text, flags=re.IGNORECASE))
        forbids_markdown = bool(re.search(r"禁止.*Markdown|不要.*Markdown|禁止.*#", text, flags=re.IGNORECASE))
        return (wants_json and forbids_json) or (wants_markdown and forbids_markdown)
