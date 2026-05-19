# -*- coding: utf-8 -*-
"""
PDF 文件解析器
基于 pdfplumber 实现 PDF 招标文件的文本、表格、图片提取
"""

import logging
from typing import Optional

from .base import BaseParser, ParsedDocument

logger = logging.getLogger(__name__)


class PdfParser(BaseParser):
    """PDF 文件解析器"""

    def parse(self) -> ParsedDocument:
        """解析 PDF 文件，返回结构化文档"""
        import pdfplumber

        doc = ParsedDocument(
            source_path=str(self.file_path),
            file_format="pdf",
        )

        with pdfplumber.open(self.file_path) as pdf:
            doc.metadata = pdf.metadata or {}
            all_text_parts = []

            for page_num, page in enumerate(pdf.pages, start=1):
                # 提取文本
                text = page.extract_text() or ""
                all_text_parts.append(text)

                # 提取表格
                tables = page.extract_tables() or []
                for table in tables:
                    doc.tables.append(table)
                    # 追加一份排版好的 Markdown 表格到正文中增强 LLM 识别
                    if table:
                        md_table = []
                        for i, row in enumerate(table):
                            row_data = [str(cell).strip().replace("\n", " ") if cell else "" for cell in row]
                            md_table.append("| " + " | ".join(row_data) + " |")
                            if i == 0:
                                md_table.append("|" + "|".join(["---"] * len(row_data)) + "|")
                        all_text_parts.append("\n" + "\n".join(md_table) + "\n")

                # 提取图片元信息（不提取像素数据，仅记录位置）
                for img_idx, img in enumerate(page.images):
                    doc.images.append({
                        "page": page_num,
                        "index": img_idx,
                        "bbox": (img["x0"], img["top"], img["x1"], img["bottom"]),
                        "data": None,  # 暂不提取图片二进制数据
                        "format": "unknown",
                    })

            doc.full_text = "\n\n".join(all_text_parts)
            doc.sections = self._split_sections(doc.full_text)

        logger.info(f"PDF 解析完成: {len(doc.sections)} 个章节, {len(doc.tables)} 个表格, {len(doc.images)} 张图片")
        return doc

    def extract_text(self) -> str:
        """提取 PDF 中的纯文本"""
        import pdfplumber

        parts = []
        with pdfplumber.open(self.file_path) as pdf:
            for page in pdf.pages:
                text = page.extract_text() or ""
                parts.append(text)
        return "\n\n".join(parts)

    def extract_tables(self) -> list[list[list[str]]]:
        """提取 PDF 中的所有表格"""
        import pdfplumber

        all_tables = []
        with pdfplumber.open(self.file_path) as pdf:
            for page in pdf.pages:
                tables = page.extract_tables() or []
                all_tables.extend(tables)
        return all_tables

    @staticmethod
    def _split_sections(text: str) -> list[dict]:
        """
        将纯文本按章节标题拆分

        简单启发式规则：识别 "第X章"、"一、"、"1." 等标题模式
        """
        import re

        sections = []
        # 匹配常见招标文件章节标题模式
        pattern = re.compile(
            r'^(第[一二三四五六七八九十百千\d]+[章节篇部分]|'
            r'[一二三四五六七八九十]+[、.．]|'
            r'\d+[\.．]\d*\s)',
            re.MULTILINE,
        )

        matches = list(pattern.finditer(text))
        if not matches:
            # 无法识别章节，整体作为一个区块
            return [{"title": "全文", "content": text.strip(), "level": 0}]

        for i, match in enumerate(matches):
            start = match.start()
            end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
            chunk = text[start:end].strip()

            # 第一行作为标题
            lines = chunk.split("\n", 1)
            title = lines[0].strip()
            content = lines[1].strip() if len(lines) > 1 else ""

            # 判断层级
            level = 1 if re.match(r'^第', title) else 2

            sections.append({"title": title, "content": content, "level": level})

        return sections
