# -*- coding: utf-8 -*-
"""
章节 Markdown 归一化：降级非法井号标题、去重连续重复的小节标题、剥离与 forge 注入重复的标题行。
供 gateway DocumentForge 与 pipt 内容任务共用（pipt 通过工程根路径导入）。
"""

from __future__ import annotations

import re


def _strip_bookmark_fragment(s: str) -> str:
    return re.sub(r"\s*\{#BM_[^}]+\}\s*$", "", s).strip()


def demote_markdown_headings(text: str) -> str:
    """将行首 ATX 标题转为加粗单行（保留语义、避免 Word 目录层级失控）。"""
    if not text:
        return ""

    def _line_repl(line: str) -> str:
        m = re.match(r"^(#{1,6})\s+(.*)$", line.strip())
        if not m:
            return line
        inner = m.group(2).strip()
        if not inner:
            return line
        return f"**{inner}**"

    return "\n".join(_line_repl(line) for line in text.split("\n"))


def strip_markdown_rule_lines(text: str) -> str:
    """移除 Markdown 水平分割线，避免导出为 Word 中可见的 -- / --- 段落。"""
    if not text:
        return ""
    return "\n".join(
        line
        for line in text.split("\n")
        if not re.match(r"^\s*(?:-{2,}|\*{3,}|_{3,})\s*$", line)
    )


def demote_numbered_heading_like_lines(text: str) -> str:
    """
    将常见“标题样式编号行”降级为加粗普通段落，避免其被当作导出结构 heading。
    仅处理疑似小节标题（后面有中文/字母文本），并保留正常列表项：
    - 一、章节标题
    - 1.1 小节标题
    - 1.1.1 小节标题
    - 上述形式的 **加粗** 包裹版本
    """
    if not text:
        return ""

    zh_num = "零一二三四五六七八九十百千"
    pat_h1 = re.compile(rf"^[{zh_num}]+、\s*[^\s].+")
    pat_h2_h3 = re.compile(r"^\d+\.\d+(?:\.\d+)?\s+[^\s].+")

    def _unwrap_bold(s: str) -> tuple[str, bool]:
        x = s.strip()
        if x.startswith("**") and x.endswith("**") and len(x) > 4:
            return x[2:-2].strip(), True
        return x, False

    out: list[str] = []
    for line in text.split("\n"):
        stripped = line.strip()
        inner, _was_bold = _unwrap_bold(stripped)
        if pat_h1.match(inner) or pat_h2_h3.match(inner):
            out.append(f"**{inner}**")
            continue
        out.append(line)
    return "\n".join(out)


def strip_leading_redundant_titles(content: str, section_title: str) -> str:
    """删除正文开头与章节标题重复或互为子串的井号标题行（forge 将统一注入 # 章节名）。"""
    t = (content or "").strip()
    norm = _strip_bookmark_fragment(section_title)
    norm_l = re.sub(r"\s+", "", norm).lower()

    while t:
        lines = t.split("\n")
        first = lines[0].strip()
        m = re.match(r"^#{1,6}\s+(.+)$", first)
        if not m:
            break
        line_inner = _strip_bookmark_fragment(m.group(1).strip())
        line_l = re.sub(r"\s+", "", line_inner).lower()
        if not line_l:
            t = "\n".join(lines[1:]).lstrip()
            continue
        if line_l == norm_l or norm_l in line_l or line_l in norm_l:
            t = "\n".join(lines[1:]).lstrip()
            continue
        # 去掉以 ** 包裹但与章节标题等价的加粗行（demote 后）
        mb = re.match(r"^\*\*(.+)\*\*$", first)
        if mb:
            inner = _strip_bookmark_fragment(mb.group(1).strip())
            il = re.sub(r"\s+", "", inner).lower()
            if il == norm_l or norm_l in il or il in norm_l:
                t = "\n".join(lines[1:]).lstrip()
                continue
        break
    return t


def _is_numbered_subsection_heading_line(line: str) -> bool:
    s = line.strip()
    if s.startswith("**") and s.endswith("**"):
        inner = s[2:-2].strip()
    else:
        inner = s
    return bool(re.match(r"^\d+\.\d+\.\d+\b", inner))


def dedupe_consecutive_numbered_headings(text: str) -> str:
    """
    若两个连续段落均以同一行「x.x.x …」式加粗/标题开头，则丢弃后一段（缓解 1.2.1–1.2.3 重复两遍）。
    """
    if not text:
        return ""
    paras = re.split(r"\n{2,}", text.strip())
    out: list[str] = []
    for p in paras:
        p = p.strip()
        if not p:
            continue
        first = p.split("\n")[0].strip()
        if out and _is_numbered_subsection_heading_line(first):
            prev_first = out[-1].split("\n")[0].strip()
            if first == prev_first:
                continue
        out.append(p)
    return "\n\n".join(out)


def normalize_generated_markdown(content: str, section_title: str = "") -> str:
    """内容生成任务输出后的完整归一化管道。"""
    t = (content or "").strip()
    t = strip_markdown_rule_lines(t)
    t = demote_markdown_headings(t)
    t = demote_numbered_heading_like_lines(t)
    if section_title:
        t = strip_leading_redundant_titles(t, section_title)
    t = dedupe_consecutive_numbered_headings(t)
    t = re.sub(r"\n{3,}", "\n\n", t).strip()
    return t


def prepare_section_for_forge(title: str, content: str) -> str:
    """单节并入总 Markdown 前的正文：统一降级、去重、去掉与节标题重复的首行。"""
    body = normalize_generated_markdown(content, title or "")
    return body
