# -*- coding: utf-8 -*-
"""writing_hint 运行时清洗与本地规则拼装。"""

from __future__ import annotations

from typing import Final


RUNTIME_BLOCK_TITLES: Final[tuple[str, ...]] = (
    "【本节目录层级定位（勿用 # 标题重复以下编号）】",
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
        f"- 目标篇幅：约 {target if target > 0 else 800} 字，允许上浮 10%-20%，禁止明显短篇化输出；\n"
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

    core = extract_core_writing_intent(core_hint)
    if core:
        parts.append(core)

    analysis_block = build_analysis_context_block(analysis_context)
    if analysis_block:
        parts.append(analysis_block)

    parts.append(build_content_expansion_constraints(section_title, expected_words, keywords))
    return _join_segments(parts)
