# -*- coding: utf-8 -*-
"""
文档层级树结构定义
用于替代扁平文本，保留文档的章节划分，极大提升信息提取的准确率。
"""

from dataclasses import dataclass, field
from typing import List, Optional

@dataclass
class DocumentNode:
    """文档层级树节点（如：一、技术要求 -> 1.1 硬件要求 -> 段落文本）"""
    level: int  # 0为根，1为H1，2为H2，依次类推
    title: str  # 节点标题或内容
    content: str = "" # 该节点下的直接文本内容
    children: List['DocumentNode'] = field(default_factory=list)

    def to_markdown(self, current_depth: int = 1) -> str:
        """将其转换为带有 Markdown 标题层级的文本"""
        md = ""
        if self.level > 0 and self.title:
            md += f"{'#' * current_depth} {self.title}\n\n"
        if self.content:
            md += f"{self.content}\n\n"
        
        for child in self.children:
            md += child.to_markdown(current_depth + 1)
        return md

    def search_by_keywords(self, keywords: List[str]) -> Optional['DocumentNode']:
        """根据标题关键字在树中搜索特定节点（如“评分标准”、“技术响应”）"""
        if self.level > 0 and self.title:
            if any(kw in self.title for kw in keywords):
                return self
        
        for child in self.children:
            result = child.search_by_keywords(keywords)
            if result:
                return result
        return None
