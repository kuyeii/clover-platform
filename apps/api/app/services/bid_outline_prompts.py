from __future__ import annotations

import json
from typing import Any, Mapping


OUTLINE_GENERATION_SYSTEM_PROMPT = """你是一名资深的招投标解决方案架构师，专注于标书目录规划以及核心技术特征提取。
请根据输入的招标需求、评分摘要和固定 H2，生成技术方案正文大纲。

硬性要求：
1. 只能输出一个合法 JSON 对象，不允许解释文字、Markdown 或代码块。
2. 顶层必须是 {"outline": [...]}。
3. 顶层 outline 必须严格对应输入中的固定 H2，标题原样保留、顺序一致，禁止新增、删除、改写 H2。
4. 普通 H2 只能生成 1-3 个 H3；若 H2 为“响应情况”，children 必须为 []，并在 H2 自身补齐 writingHint、keywords、relatedAnalysisIds 与 wordCount。
5. 每个 H2 必须包含 id、title、headingLevel、wordCount、keywords、writingHint、relatedAnalysisIds、needDiagram、diagramBrief、diagramPlan、children；每个 H3 必须包含 id、title、headingLevel、wordCount、keywords、writingHint、relatedAnalysisIds、needDiagram、diagramBrief、diagramPlan。
6. writingHint 是后续正文生成直接消费的写作指令，需覆盖本节作用、评分点/技术要求、展开方式、章节边界和禁止事项，禁止出现 [id:xxx]。
7. keywords 只保留 2-4 个核心技术实体词，禁止使用“项目”“方案”“系统”等泛词。
8. 禁止编排法定代表人授权书、营业执照、承诺函等商务资质附件模块。
9. 普通 H3 标题必须可直接写正文，禁止“概述/总结/补充说明/重点响应”等占位标题。
10. 父容器章节 needDiagram=false；只有最终正文叶子节点在确有流程、架构、数据流或组织关系时才允许 needDiagram=true。
"""


OUTLINE_REVIEW_SYSTEM_PROMPT = """你是一名标书评审和润色专家，负责对 AI 生成的大纲做必要修补。

只允许修补 H3、wordCount、keywords、writingHint、relatedAnalysisIds 与图表字段，不允许重写整体结构。
固定 H2 的标题和顺序必须与输入保持完全一致，禁止新增、删除、改写 H2。
普通 H2 的 children 必须为 1-3 个 H3；“响应情况”必须保持 children=[]。
只能输出一个合法 JSON 对象，顶层必须是 {"outline": [...]}，不允许解释文字、Markdown 或代码块。
如果无法稳定输出完整结构，返回 {"outline": []}。
"""


def build_generation_messages(inputs: Mapping[str, Any]) -> list[dict[str, str]]:
    """构造大纲初稿模型消息；入参为 workflow inputs，出参为 chat messages。"""
    user = f"""标书类型：{inputs.get("bid_type", "tech")}

预期总字数：{inputs.get("total_words") or inputs.get("expected_total_words") or 0}（0 表示由 AI 自行决定）
图表开关：{inputs.get("enable_diagrams", "false")}
图表上限：{inputs.get("max_diagrams", 0)}

评分标准摘要：
{inputs.get("scoring_summary", "")}

后端规则校验提示：
{inputs.get("outline_review_issues", "")}

已提取的需求列表（含解析报告上下文）：
{inputs.get("requirements", "")}

固定 H2 JSON：
{inputs.get("technical_h2_bindings_json") or inputs.get("structure_heading_seed_json") or "[]"}

请按约束输出最终 JSON。"""
    return [{"role": "system", "content": OUTLINE_GENERATION_SYSTEM_PROMPT}, {"role": "user", "content": user}]


def build_review_messages(
    inputs: Mapping[str, Any],
    *,
    outline_json: str,
    knowledge_context: str,
) -> list[dict[str, str]]:
    """构造大纲润色模型消息；入参为初稿和知识库上下文，出参为 chat messages。"""
    user = f"""评分标准摘要：
{inputs.get("scoring_summary", "")}

后端规则校验提示（仅修复以下问题，不要整体重写）：
{inputs.get("outline_review_issues", "")}

预期总字数：{inputs.get("total_words") or inputs.get("expected_total_words") or 0}

知识库检索上下文（用于补齐章节的技术实体和写作边界）：
{knowledge_context or ""}

待审核的大纲：
{outline_json or json.dumps({"outline": []}, ensure_ascii=False)}

请仅做必要修补并输出最终大纲 JSON。重点：补齐普通章节的 children，并将每章 H3 控制在最多 3 个；“响应情况”保持空 children。"""
    return [{"role": "system", "content": OUTLINE_REVIEW_SYSTEM_PROMPT}, {"role": "user", "content": user}]
