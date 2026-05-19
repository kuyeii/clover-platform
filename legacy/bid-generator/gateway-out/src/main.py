from typing import Optional
# -*- coding: utf-8 -*-
"""
gateway-out 主入口
完成占位符复原和 Markdown → DOCX 转换
"""

import argparse
import json
import logging
from pathlib import Path

from .restorer import PlaceholderRestorer
from .converter.md_to_docx import MarkdownToDocxConverter

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("gateway-out")


def process_output(
    markdown_text: str,
    mapping_table: dict[str, str],
    output_path: str,
    template_path: Optional[str] = None,
) -> str:
    """
    出口网关完整处理流程

    Args:
        markdown_text: LLM 生成的 Markdown 文本（含占位符）
        mapping_table: 脱敏映射表 {占位符: 原始文本}
        output_path: 输出 .docx 文件路径
        template_path: Word 模板路径（可选）

    Returns:
        str: 输出文件路径
    """
    # 1. 占位符复原
    restorer = PlaceholderRestorer(mapping_table)
    restored_text = restorer.restore(markdown_text)

    # 检查未还原的占位符
    remaining = restorer.get_unreplaced_placeholders(restored_text)
    if remaining:
        logger.warning(f"注意: 有 {len(remaining)} 个占位符未能还原")

    # 2. Markdown → DOCX
    converter = MarkdownToDocxConverter(template_path=template_path)
    result_path = converter.convert(restored_text, output_path)

    logger.info(f"出口网关处理完成: {result_path}")
    return result_path


def main():
    """CLI 入口"""
    parser = argparse.ArgumentParser(description="gateway-out: ProEngine 出口网关")
    parser.add_argument("--input", "-i", required=True, help="Markdown 文件路径")
    parser.add_argument("--mapping", "-m", default=None, help="映射表 JSON 文件路径")
    parser.add_argument("--output", "-o", required=True, help="输出 .docx 文件路径")
    parser.add_argument("--template", "-t", default=None, help="Word 模板路径")

    args = parser.parse_args()

    # 读取 Markdown 内容
    with open(args.input, "r", encoding="utf-8") as f:
        markdown_text = f.read()

    # 读取映射表
    mapping_table = {}
    if args.mapping:
        with open(args.mapping, "r", encoding="utf-8") as f:
            mapping_table = json.load(f)

    # 执行处理
    process_output(markdown_text, mapping_table, args.output, args.template)


if __name__ == "__main__":
    main()
