# -*- coding: utf-8 -*-
"""writing_hint 运行时清洗与本地规则拼装。"""

from __future__ import annotations

import re
from typing import Final


RUNTIME_BLOCK_TITLES: Final[tuple[str, ...]] = (
    "【本节目录层级定位（勿用 # 标题重复以下编号）】",
    "【章内承接与开篇导入要求】",
    "【招标文件解析参考（优先级最高，严格对应本章节要求）】",
    "【正文扩写与技术深度约束（必须遵守）】",
)

IMPLICIT_TAIL_ANCHORS: Final[tuple[str, ...]] = (
    "正文应按“需求理解、方案机制、落地措施、验证与风险控制”展开",
    "不要重复目录编号",
    "不得编造缺乏依据",
)


def _normalize_text(text: str) -> str:
    return str(text or "").replace("\r\n", "\n").strip()


def _find_block_ranges(text: str) -> list[tuple[int, int]]:
    matches = [
        (title, text.find(title))
        for title in RUNTIME_BLOCK_TITLES
        if text.find(title) >= 0
    ]
    matches.sort(key=lambda item: item[1])
    return [
        (start, matches[idx + 1][1] if idx + 1 < len(matches) else len(text))
        for idx, (_, start) in enumerate(matches)
    ]


def _join_segments(segments: list[str]) -> str:
    return "\n\n".join(part.strip() for part in segments if part and part.strip()).strip()


def build_outline_slice_block(section_outline_slice: str) -> str:
    slice_text = _normalize_text(section_outline_slice)
    if not slice_text:
        return ""
    return "【本节目录层级定位（勿用 # 标题重复以下编号）】\n" + slice_text


def build_analysis_context_block(analysis_context: str) -> str:
    context_text = _normalize_text(analysis_context)
    if not context_text:
        return ""
    return "【招标文件解析参考（优先级最高，严格对应本章节要求）】\n" + context_text


def _parse_outline_lines(section_outline_slice: str) -> list[str]:
    text = _normalize_text(section_outline_slice)
    if not text:
        return []
    return [line.rstrip() for line in text.splitlines() if line.strip()]


def _outline_line_depth(line: str) -> int:
    raw = re.sub(r"\[当前\]\s*", "", str(line or ""))
    return len(raw) - len(raw.lstrip(" "))


def _current_outline_item_is_first_sibling(lines: list[str]) -> bool:
    for idx, line in enumerate(lines):
        if "[当前]" not in line:
            continue
        depth = _outline_line_depth(line)
        for prev in reversed(lines[:idx]):
            if not prev.strip():
                continue
            prev_depth = _outline_line_depth(prev)
            if prev_depth < depth:
                break
            if prev_depth == depth:
                return False
        return True
    return False


def _looks_like_first_section(section_title: str, section_outline_slice: str) -> bool:
    title = _normalize_text(section_title)
    lines = _parse_outline_lines(section_outline_slice)
    numbered_text = "\n".join(line.strip() for line in lines + [title])
    if re.search(r"(^|\n)\s*(?:第一节|第1节|1[.．、]1|[（(]一[）)]|一[、.．])", numbered_text):
        return True
    if _current_outline_item_is_first_sibling(lines):
        return True
    single_section_titles = ("响应情况", "响应程度", "符合性响应", "符合性偏离", "偏离情况")
    return len(lines) <= 1 and any(marker in title for marker in single_section_titles)


def build_section_bridge_block(section_title: str, section_outline_slice: str) -> str:
    """
    统一生成章节承接要求。
    目标是让首个正文单元自然承担章内导入，不把“绪论”硬塞成固定小标题。
    """
    if not _looks_like_first_section(section_title, section_outline_slice):
        return ""
    return (
        "【章内承接与开篇导入要求】\n"
        "- 本节若是所在章节的第一个正文单元，开头仅写 1 个投标响应定位段，说明我方对采购需求、评分关注点、交付边界与响应策略的理解；\n"
        "- 必须使用供应商/响应人视角，禁止把项目写成采购人战略宣传、城市宣传稿或立项报告，禁止使用“响应国家战略、关键举措、背景内涵、系统阐述”等宏大叙事套话；\n"
        "- 导入段不得使用“本节主要介绍/该节将阐述”这类机械句式，不得直接罗列标题；\n"
        "- 导入段之后立即进入具体响应内容，优先围绕需求理解、偏离控制、方案措施、交付物、验收与风险控制展开。"
    )


def build_content_expansion_constraints(
    section_title: str,
    expected_words: int,
    keywords: str,
) -> str:
    target = max(int(expected_words or 0), 0)
    keyword_text = _normalize_text(keywords)
    density = (
        "不少于 4 个技术要点段（每段需包含“结论 + 依据/机制 + 落地方式”）"
        if target < 1200 else
        "不少于 6 个技术要点段（每段需包含“结论 + 依据/机制 + 落地方式”）"
    )
    return (
        "【正文扩写与技术深度约束（必须遵守）】\n"
        f"- 本节标题：{_normalize_text(section_title) or '未命名章节'}\n"
        f"- 目标篇幅：约 {target if target > 0 else 800} 字，建议控制在目标值的 90%-110%，不得明显短于用户设置字数；\n"
        "- 严禁输出任何 Markdown 标题（如 # / ## / ###）以及“一、/1.1/1.1.1”式自拟小节标题；\n"
        "- 允许的组织形式仅限：常规正文段落、编号项、有序/无序列表；\n"
        "- 不得重复输出章节名或目录结构，不得把目录当正文写出；\n"
        f"- 内容密度：{density}；\n"
        "- 每个要点优先使用“技术方案 → 实施步骤 → 验证方式/度量指标”结构；\n"
        "- 如涉及架构设计，需明确组件职责、接口边界、数据流与异常处理；\n"
        "- 如涉及实施保障，需补充可执行细节（人员角色、里程碑、风险控制、验收标准）；\n"
        "- 避免泛泛表述与同义反复，不得仅停留在原则层面；\n"
        f"- 关键词覆盖：{keyword_text if keyword_text else '按章节主题提炼 3-5 个技术关键词并自然覆盖'}。"
    )


def extract_core_writing_intent(writing_hint: str) -> str:
    """
    提取用户真正应编辑的“写作意图”。
    兼容旧数据中已经混入的：
    1. 目录定位块；
    2. 招标文件解析参考块；
    3. 运行时扩写约束块；
    4. 大纲增强阶段附加的固定通用尾句。
    """
    normalized = _normalize_text(writing_hint)
    if not normalized:
        return ""

    ranges = _find_block_ranges(normalized)
    if ranges:
        segments: list[str] = []
        cursor = 0
        for start, end in ranges:
            between = normalized[cursor:start].strip()
            if between:
                segments.append(between)
            cursor = end
        tail = normalized[cursor:].strip()
        if tail:
            segments.append(tail)
        normalized = _join_segments(segments)
        if not normalized:
            return ""

    anchor_indexes = [
        normalized.find(anchor)
        for anchor in IMPLICIT_TAIL_ANCHORS
        if normalized.find(anchor) >= 0
    ]
    if anchor_indexes:
        normalized = normalized[: min(anchor_indexes)].strip()
    return normalized


def compose_runtime_writing_hint(
    core_hint: str,
    section_title: str,
    expected_words: int,
    keywords: str,
    *,
    section_outline_slice: str = "",
    analysis_context: str = "",
) -> str:
    """
    基于当前参数确定性重建最终 writing_hint。
    用户只编辑 core_hint，系统默认规则统一在这里本地拼装。
    """
    parts: list[str] = []
    outline_block = build_outline_slice_block(section_outline_slice)
    if outline_block:
        parts.append(outline_block)

    bridge_block = build_section_bridge_block(section_title, section_outline_slice)
    if bridge_block:
        parts.append(bridge_block)

    core = extract_core_writing_intent(core_hint)
    if core:
        parts.append(core)

    analysis_block = build_analysis_context_block(analysis_context)
    if analysis_block:
        parts.append(analysis_block)

    parts.append(build_content_expansion_constraints(section_title, expected_words, keywords))
    return _join_segments(parts)
