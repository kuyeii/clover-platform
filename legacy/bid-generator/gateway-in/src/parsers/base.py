# -*- coding: utf-8 -*-
"""
文件解析器抽象基类
所有文件格式解析器均需继承此基类并实现 parse() 方法
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from .document_tree import DocumentNode

@dataclass
class ParsedDocument:
    """解析后的文档结构"""
    # 文件元信息
    source_path: str = ""
    file_format: str = ""

    # 文本内容
    full_text: str = ""                          # 完整纯文本
    document_tree: Optional[DocumentNode] = None # 文档层级树（用于高精度块提取）
    sections: list[dict] = field(default_factory=list)  # 按章节拆分 [{"title": "", "content": "", "level": 1}]

    # 表格数据
    tables: list[list[list[str]]] = field(default_factory=list)  # [[[cell, cell], [cell, cell]]]

    # 图片信息
    images: list[dict] = field(default_factory=list)  # [{"page": 1, "index": 0, "data": bytes, "format": "png"}]

    # 元数据
    metadata: dict = field(default_factory=dict)  # 标题、作者等


class BaseParser(ABC):
    """
    文件解析器抽象基类

    所有格式特定的解析器（PDF、DOCX、HTML）必须继承此类
    并实现 parse() 方法，返回 ParsedDocument 实例
    """

    def __init__(self, file_path: str):
        self.file_path = Path(file_path)
        if not self.file_path.exists():
            raise FileNotFoundError(f"文件不存在: {file_path}")

    @abstractmethod
    def parse(self) -> ParsedDocument:
        """
        解析文件，返回结构化的 ParsedDocument

        Returns:
            ParsedDocument: 解析后的文档结构
        """
        ...

    @abstractmethod
    def extract_text(self) -> str:
        """
        提取文件中的纯文本内容

        Returns:
            str: 纯文本内容
        """
        ...

    @abstractmethod
    def extract_tables(self) -> list[list[list[str]]]:
        """
        提取文件中的表格数据

        Returns:
            list: 表格数据列表
        """
        ...

    def get_file_size_mb(self) -> float:
        """获取文件大小（MB）"""
        return self.file_path.stat().st_size / (1024 * 1024)
