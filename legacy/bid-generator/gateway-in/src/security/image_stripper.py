# -*- coding: utf-8 -*-
"""
图片剥离工具
对 Tier 2 文件中的图片进行硬性剥离，替换为空白占位符
严禁图片数据流出本地环境
"""

import logging
from ..parsers.base import ParsedDocument

logger = logging.getLogger(__name__)


class ImageStripper:
    """
    图片剥离器

    对 Tier 2（红线区）文件中的所有图片进行剥离处理：
    - 清除图片的二进制数据
    - 在文本中插入占位标记 [图片已剥离]
    - 记录剥离日志
    """

    PLACEHOLDER_TEXT = "[图片已剥离 - Tier 2 安全策略]"

    def strip(self, document: ParsedDocument) -> ParsedDocument:
        """
        剥离文档中的所有图片

        Args:
            document: 解析后的文档

        Returns:
            ParsedDocument: 图片已被剥离的文档
        """
        if not document.images:
            logger.info("文档中无图片，无需剥离")
            return document

        stripped_count = 0
        for img in document.images:
            if img.get("data") is not None:
                img["data"] = None  # 清除二进制数据
                stripped_count += 1
            img["stripped"] = True
            img["original_format"] = img.get("format", "unknown")
            img["format"] = "stripped"

        # 在全文中标记图片位置（如果有图片引用）
        if document.full_text:
            import re
            # 替换可能的图片引用标记
            document.full_text = re.sub(
                r'\[图片\d*\]|\[image\d*\]|\[img\d*\]',
                self.PLACEHOLDER_TEXT,
                document.full_text,
                flags=re.IGNORECASE,
            )

        logger.warning(
            f"图片剥离完成: 共 {len(document.images)} 张图片, "
            f"清除 {stripped_count} 份图片数据"
        )
        return document
