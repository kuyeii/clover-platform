# -*- coding: utf-8 -*-
"""
HTML 文件解析器
基于 BeautifulSoup 实现 HTML 招标文件的文本和表格提取
"""

import logging

from .base import BaseParser, ParsedDocument

logger = logging.getLogger(__name__)


class HtmlParser(BaseParser):
    """HTML 文件解析器"""

    def parse(self) -> ParsedDocument:
        """解析 HTML 文件，返回结构化文档"""
        from bs4 import BeautifulSoup

        doc = ParsedDocument(
            source_path=str(self.file_path),
            file_format="html",
        )

        with open(self.file_path, "r", encoding="utf-8") as f:
            soup = BeautifulSoup(f.read(), "html.parser")

        # 元数据
        title_tag = soup.find("title")
        doc.metadata = {"title": title_tag.get_text(strip=True) if title_tag else ""}

        # 提取全文
        doc.full_text = soup.get_text(separator="\n", strip=True)

        # 提取章节（基于 h1-h6 标签）
        doc.sections = self._extract_sections(soup)

        # 提取表格
        doc.tables = self._extract_tables(soup)

        # 提取图片信息
        for idx, img_tag in enumerate(soup.find_all("img")):
            doc.images.append({
                "page": 0,
                "index": idx,
                "src": img_tag.get("src", ""),
                "alt": img_tag.get("alt", ""),
                "data": None,
                "format": "html_img",
            })

        logger.info(f"HTML 解析完成: {len(doc.sections)} 个章节, {len(doc.tables)} 个表格, {len(doc.images)} 张图片")
        return doc

    def extract_text(self) -> str:
        """提取 HTML 中的纯文本"""
        from bs4 import BeautifulSoup

        with open(self.file_path, "r", encoding="utf-8") as f:
            soup = BeautifulSoup(f.read(), "html.parser")
        return soup.get_text(separator="\n", strip=True)

    def extract_tables(self) -> list[list[list[str]]]:
        """提取 HTML 中的所有表格"""
        from bs4 import BeautifulSoup

        with open(self.file_path, "r", encoding="utf-8") as f:
            soup = BeautifulSoup(f.read(), "html.parser")
        return self._extract_tables(soup)

    @staticmethod
    def _extract_sections(soup) -> list[dict]:
        """基于 h1-h6 提取章节结构"""
        sections = []
        for tag in soup.find_all(["h1", "h2", "h3", "h4", "h5", "h6"]):
            level = int(tag.name[1])
            title = tag.get_text(strip=True)
            # 收集标题后续所有兄弟节点的文本直到下一个标题
            content_parts = []
            for sibling in tag.find_next_siblings():
                if sibling.name and sibling.name in ["h1", "h2", "h3", "h4", "h5", "h6"]:
                    break
                text = sibling.get_text(strip=True)
                if text:
                    content_parts.append(text)
            sections.append({"title": title, "content": "\n".join(content_parts), "level": level})
        return sections

    @staticmethod
    def _extract_tables(soup) -> list[list[list[str]]]:
        """提取所有 <table> 标签中的数据"""
        all_tables = []
        for table_tag in soup.find_all("table"):
            table_data = []
            for row in table_tag.find_all("tr"):
                cells = [cell.get_text(strip=True) for cell in row.find_all(["td", "th"])]
                table_data.append(cells)
            if table_data:
                all_tables.append(table_data)
        return all_tables
