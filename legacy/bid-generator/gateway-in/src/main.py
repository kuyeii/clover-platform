# -*- coding: utf-8 -*-
"""
gateway-in 主入口
完成文件解析、结构化提取、安全分流的全流程
"""

import argparse
import logging
import sys
from pathlib import Path
from typing import Dict, Any, Optional

from .config import GatewayInConfig
from .parsers.base import ParsedDocument
from .parsers.pdf_parser import PdfParser
from .parsers.docx_parser import DocxParser
from .parsers.html_parser import HtmlParser
from .parsers.markdown_parser import MarkdownParser
from .extractors.bid_extractor import BidExtractor, BidInfo
from .extractors.template import render_bid_template
from .security.tier_classifier import TierClassifier
from .security.image_stripper import ImageStripper

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("gateway-in")

# 解析器注册表：文件扩展名 → 解析器类
PARSER_REGISTRY = {
    ".pdf": PdfParser,
    ".docx": DocxParser,
    ".html": HtmlParser,
    ".htm": HtmlParser,
    ".md": MarkdownParser,
}


def get_parser(file_path: str):
    """根据文件扩展名获取对应的解析器"""
    ext = Path(file_path).suffix.lower()
    if ext == ".doc":
        raise ValueError("底层解析引擎不支持旧版的二进制 .doc 格式，请在 Word 中另存为现代的 .docx 格式后再试！")
    
    parser_cls = PARSER_REGISTRY.get(ext)
    if parser_cls is None:
        raise ValueError(f"不支持的文件格式: {ext}（支持: {list(PARSER_REGISTRY.keys())}）")
    return parser_cls(file_path)


def process_file(file_path: str, user_specified_tier: Optional[int] = None, config: GatewayInConfig = None) -> Dict[str, Any]:
    """
    处理单个文件的完整流程

    Args:
        file_path: 文件路径
        user_specified_tier: 安全等级 (1 或 2)，如果为 None 则自动判断
        config: 入口网关配置

    Returns:
        dict: {
            "bid_info": BidInfo,
            "structured_template": str,
            "mapping_table": dict,
            "tier": int,
        }
    """
    # 1. 安全等级判断
    classifier = TierClassifier(config.security)
    tier = classifier.classify(file_path, user_specified_tier=user_specified_tier)
    logger.info(f"安全等级确认: Tier {tier}")

    # 2. 文件解析
    parser = get_parser(file_path)
    document = parser.parse()
    logger.info(f"文件解析完成: {document.file_format}")

    # 3. Tier 2 图片剥离
    if classifier.requires_image_stripping(tier):
        stripper = ImageStripper()
        document = stripper.strip(document)

    # 4. 结构化信息提取
    extractor = BidExtractor()
    bid_info = extractor.extract(document)

    # 5. 渲染结构化模板
    template = render_bid_template(bid_info)

    result = {
        "bid_info": bid_info,
        "structured_template": template,
        "mapping_table": {},  # 脱敏映射表（Tier 2 时由 pipt-flask 填充）
        "tier": tier,
        "raw_text": document.full_text,
    }

    # 6. Tier 2 文件标记需要脱敏（实际脱敏由编排器调用 pipt-flask 完成）
    if classifier.requires_desensitization(tier):
        result["requires_desensitization"] = True
        logger.warning("此文件需要脱敏处理，请通过编排器调用 pipt-flask 服务")

    return result


def main():
    """CLI 入口"""
    parser = argparse.ArgumentParser(description="gateway-in: ProEngine 入口网关")
    parser.add_argument("--input", "-i", required=True, help="招标文件路径")
    parser.add_argument("--tier", "-t", type=int, choices=[1, 2], default=None, help="安全等级 (1=安全区, 2=红线区)")
    parser.add_argument("--config", "-c", default="config.yaml", help="配置文件路径")
    parser.add_argument("--output", "-o", default=None, help="输出结构化模板的路径")

    args = parser.parse_args()

    # 加载配置
    config = GatewayInConfig.from_yaml(args.config)

    # 处理文件
    result = process_file(args.input, args.tier, config)

    # 输出结果
    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            f.write(result["structured_template"])
        logger.info(f"结构化模板已保存: {args.output}")
    else:
        print(result["structured_template"])


if __name__ == "__main__":
    main()
