# -*- coding: utf-8 -*-
"""
招标文件关键信息提取器
从解析后的文档中提取项目名称、技术要求、评分标准等结构化信息
"""

import logging
import re
from dataclasses import dataclass, field

from ..parsers.base import ParsedDocument

logger = logging.getLogger(__name__)


@dataclass
class BidInfo:
    """招标文件提取后的结构化信息"""
    project_name: str = ""                       # 项目名称
    bid_number: str = ""                         # 招标编号
    purchaser: str = ""                          # 采购单位
    budget: str = ""                             # 预算金额
    deadline: str = ""                           # 截止日期
    technical_requirements: list[dict] = field(default_factory=list)  # 技术要求列表
    scoring_criteria: list[dict] = field(default_factory=list)        # 评分标准
    qualification_requirements: list[str] = field(default_factory=list)  # 资质要求
    deliverables: list[str] = field(default_factory=list)             # 交付物
    raw_sections: list[dict] = field(default_factory=list)            # 原始章节（用于 RAG）
    extra: dict = field(default_factory=dict)                         # 其他信息


class BidExtractor:
    """
    招标文件信息提取器

    从 ParsedDocument 中基于关键字和模式匹配提取结构化的招标信息
    """

    # 各类信息的关键字模式
    PROJECT_NAME_PATTERNS = [
        re.compile(r'项目名称[：:]\s*(.+)'),
        re.compile(r'采购项目[：:]\s*(.+)'),
        re.compile(r'招标项目[：:]\s*(.+)'),
    ]

    BID_NUMBER_PATTERNS = [
        re.compile(r'(?:招标|采购|项目)编号[：:]\s*([A-Za-z0-9\-]+)'),
        re.compile(r'项目编号[：:]\s*(.+)'),
    ]

    BUDGET_PATTERNS = [
        re.compile(r'(?:预算|控制价|最高限价)[：:]\s*([\d,.]+\s*(?:万?元))'),
    ]

    TECHNICAL_SECTION_TITLES = [
        "技术要求", "技术参数", "技术规格", "技术指标",
        "功能需求", "功能要求", "系统要求", "性能要求",
    ]

    SCORING_SECTION_TITLES = [
        "评分标准", "评审标准", "评分办法", "评审办法",
        "评分细则", "评标标准",
    ]

    def extract(self, document: ParsedDocument) -> BidInfo:
        """
        从解析后的文档中提取招标信息

        Args:
            document: 解析后的文档对象

        Returns:
            BidInfo: 结构化的招标信息
        """
        info = BidInfo()
        info.raw_sections = document.sections

        text = document.full_text

        # 提取项目名称
        info.project_name = self._extract_by_patterns(text, self.PROJECT_NAME_PATTERNS)

        # 提取招标编号
        info.bid_number = self._extract_by_patterns(text, self.BID_NUMBER_PATTERNS)

        # 提取预算金额
        info.budget = self._extract_by_patterns(text, self.BUDGET_PATTERNS)

        # 基于章节提取技术要求
        info.technical_requirements = self._extract_sections_from_tree(
            document.document_tree, self.TECHNICAL_SECTION_TITLES
        )

        # 基于章节提取评分标准
        info.scoring_criteria = self._extract_sections_from_tree(
            document.document_tree, self.SCORING_SECTION_TITLES
        )

        # 如果表格中包含评分信息，追加到评分标准
        for table in document.tables:
            if self._is_scoring_table(table):
                info.scoring_criteria.append({
                    "title": "评分表格",
                    "content": self._table_to_text(table),
                    "level": 2,
                })

        logger.info(
            f"信息提取完成: 项目={info.project_name or '未识别'}, "
            f"技术要求={len(info.technical_requirements)}项, "
            f"评分标准={len(info.scoring_criteria)}项"
        )
        return info

    @staticmethod
    def _extract_by_patterns(text: str, patterns: list[re.Pattern]) -> str:
        """按优先级尝试多个正则模式匹配"""
        for pattern in patterns:
            match = pattern.search(text)
            if match:
                return match.group(1).strip()
        return ""

    @staticmethod
    def _extract_sections_from_tree(tree_node, title_keywords: list[str]) -> list[dict]:
        """根据标题关键字在文档树中搜索，并提取该标题及所有子节点的完整内容"""
        if not tree_node:
            return []
        
        target_node = tree_node.search_by_keywords(title_keywords)
        if target_node:
            return [{
                "title": target_node.title,
                "content": target_node.to_markdown(),
                "level": target_node.level
            }]
        return []

    @staticmethod
    def _is_scoring_table(table: list[list[str]]) -> bool:
        """判断表格是否为评分标准表"""
        if not table or len(table) < 2:
            return False
        header = " ".join(str(cell) for cell in table[0])
        return any(keyword in header for keyword in ["评分", "分值", "权重", "得分"])

    @staticmethod
    def _table_to_text(table: list[list[str]]) -> str:
        """将表格转为文本表示"""
        lines = []
        for row in table:
            lines.append(" | ".join(str(cell) for cell in row))
        return "\n".join(lines)
