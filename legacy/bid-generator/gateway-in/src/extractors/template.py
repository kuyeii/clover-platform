# -*- coding: utf-8 -*-
"""
结构化模板渲染
将提取的招标信息渲染为便于大模型理解的结构化 Markdown 模板
"""

import logging
from ..extractors.bid_extractor import BidInfo

logger = logging.getLogger(__name__)


def render_bid_template(info: BidInfo) -> str:
    """
    将 BidInfo 渲染为结构化 Markdown 模板

    此模板将作为后续提示词工程和 Dify 调用的输入数据

    Args:
        info: 结构化的招标信息

    Returns:
        str: Markdown 格式的结构化模板
    """
    parts = []

    # 基本信息
    parts.append("# 招标文件结构化摘要\n")

    parts.append("## 项目基本信息\n")
    parts.append(f"- **项目名称**: {info.project_name or '未提取'}")
    parts.append(f"- **招标编号**: {info.bid_number or '未提取'}")
    parts.append(f"- **采购单位**: {info.purchaser or '未提取'}")
    parts.append(f"- **预算金额**: {info.budget or '未提取'}")
    parts.append(f"- **截止日期**: {info.deadline or '未提取'}")
    parts.append("")

    # 技术要求
    if info.technical_requirements:
        parts.append("## 技术要求\n")
        for i, req in enumerate(info.technical_requirements, 1):
            parts.append(f"### {i}. {req.get('title', '未命名')}\n")
            parts.append(req.get("content", "（无详细内容）"))
            parts.append("")

    # 评分标准
    if info.scoring_criteria:
        parts.append("## 评分标准\n")
        for i, criteria in enumerate(info.scoring_criteria, 1):
            parts.append(f"### {i}. {criteria.get('title', '未命名')}\n")
            parts.append(criteria.get("content", "（无详细内容）"))
            parts.append("")

    # 资质要求
    if info.qualification_requirements:
        parts.append("## 资质要求\n")
        for req in info.qualification_requirements:
            parts.append(f"- {req}")
        parts.append("")

    # 交付物
    if info.deliverables:
        parts.append("## 交付物要求\n")
        for item in info.deliverables:
            parts.append(f"- {item}")
        parts.append("")

    return "\n".join(parts)
