# -*- coding: utf-8 -*-
import logging
from .base import BaseParser, ParsedDocument
from .document_tree import DocumentNode

logger = logging.getLogger(__name__)

class MarkdownParser(BaseParser):
    def parse(self) -> ParsedDocument:
        doc = ParsedDocument(
            source_path=str(self.file_path),
            file_format="md",
        )
        
        with open(self.file_path, "r", encoding="utf-8") as f:
            content = f.read()
            
        doc.full_text = content
        
        # 简单构建层级树 (只按 ## H2 切割，方便测试)
        root = DocumentNode(level=0, title="Root")
        current_node = root
        
        for line in content.split("\n"):
            if line.startswith("## "):
                current_node = DocumentNode(level=2, title=line.replace("## ", "").strip())
                root.children.append(current_node)
            elif line.startswith("# "):
                current_node = DocumentNode(level=1, title=line.replace("# ", "").strip())
                root.children.append(current_node)
            else:
                if current_node:
                    current_node.content += line + "\n"
        
        doc.document_tree = root
        doc.sections = [{"title": n.title, "content": n.content, "level": n.level} for n in root.children]
        
        logger.info(f"Markdown 解析完成: {len(doc.sections)} 个章节")
        return doc

    def extract_text(self) -> str:
        with open(self.file_path, "r", encoding="utf-8") as f:
            return f.read()

    def extract_tables(self) -> list:
        return []
