# -*- coding: utf-8 -*-
"""
占位符复原引擎
将脱敏占位符还原为原始敏感信息，同时支持投标人信息占位符替换
"""

import logging
import re
from typing import Dict, Optional

logger = logging.getLogger(__name__)

# 投标人字段映射（前端 BidderInfo 字段名 → 占位符键名）
# 标准格式：{{__BIDDER_ORG__}}（双下划线包裹）
BIDDER_FIELD_MAP = {
    "orgName":     "{{__BIDDER_ORG__}}",
    "legalRep":    "{{__BIDDER_LEGAL_REP__}}",
    "projectLead": "{{__BIDDER_LEAD__}}",
    "phone":       "{{__BIDDER_PHONE__}}",
    "docDate":     "{{__BIDDER_DATE__}}",
}

# 兜底映射：兼容 AI 可能输出的简化格式（无双下划线）
# 格式示例: {{BIDDER_ORG}} → {{__BIDDER_ORG__}} 的语义等价物
BIDDER_FIELD_MAP_FALLBACK = {
    "orgName":     "{{BIDDER_ORG}}",
    "legalRep":    "{{BIDDER_LEGAL_REP}}",
    "projectLead": "{{BIDDER_LEAD}}",
    "phone":       "{{BIDDER_PHONE}}",
    "docDate":     "{{BIDDER_DATE}}",
}


class PlaceholderRestorer:
    """
    占位符复原器

    支持两类占位符：
    - PIPT 脱敏占位符：{{__PIPT_name_1__}} → 原始敏感信息
    - 投标人信息占位符：{{__BIDDER_ORG__}} 等 → 投标人真实信息
    """

    # 匹配所有 ProEngine 占位符（PIPT + BIDDER）
    DEFAULT_PATTERN = re.compile(r'\{\{__(?:PIPT|BIDDER)_\w+__\}\}')

    def __init__(self, mapping_table: Optional[Dict[str, str]] = None):
        """
        Args:
            mapping_table: PIPT 脱敏映射表 {占位符: 原始文本}
                例: {"{{__PIPT_name_1__}}": "张三"}
        """
        self.mapping_table = mapping_table or {}

    def load_mapping(self, mapping_table: dict[str, str]) -> None:
        """加载/更新映射表"""
        self.mapping_table.update(mapping_table)
        logger.info(f"映射表已加载: {len(self.mapping_table)} 条映射")

    def restore_bidder(self, text: str, bidder_info: dict) -> str:
        """
        将投标人占位符替换为真实值。
        同时兼容两种格式：
          - 标准格式 {{__BIDDER_ORG__}}（双下划线，由标准 Prompt 引导输出）
          - 简化格式 {{BIDDER_ORG}}（无下划线，AI 可能自行简化的兜底容错）

        Args:
            text: 含投标人占位符的文本
            bidder_info: 投标人信息字典（前端 BidderInfo 结构）

        Returns:
            str: 替换后的文本
        """
        if not bidder_info:
            return text

        result = text
        replaced = 0

        # 第一轮：标准格式 {{__BIDDER_*__}}
        for field_key, placeholder in BIDDER_FIELD_MAP.items():
            real_value = bidder_info.get(field_key, "")
            if real_value and placeholder in result:
                result = result.replace(placeholder, real_value)
                replaced += 1

        # 第二轮：兜底格式 {{BIDDER_*}}（兼容 AI 简化输出）
        for field_key, placeholder in BIDDER_FIELD_MAP_FALLBACK.items():
            real_value = bidder_info.get(field_key, "")
            if real_value and placeholder in result:
                result = result.replace(placeholder, real_value)
                replaced += 1
                logger.debug(f"兜底还原简化格式占位符: {placeholder} → {real_value[:8]}...")

        if replaced:
            logger.info(f"投标人占位符替换完成: {replaced} 处")
        return result

    def restore(self, text: str) -> str:
        """
        将文本中的 PIPT 脱敏占位符还原为原始敏感信息

        Args:
            text: 含占位符的文本

        Returns:
            str: 还原后的文本
        """
        if not self.mapping_table:
            logger.warning("映射表为空，跳过 PIPT 占位符复原")
            return text

        restored_count = 0
        hit_count = 0
        result = text

        for placeholder, original in self.mapping_table.items():
            if placeholder in result:
                hit_count += 1
                result = result.replace(placeholder, original)
                restored_count += 1

        # 检查是否有未还原的占位符
        remaining = self.get_unreplaced_placeholders(result)
        if remaining:
            logger.warning(f"存在 {len(remaining)} 个未还原的占位符: {remaining[:5]}")

        logger.info(
            "PIPT 占位符复原完成: 文档命中 %s 个占位符，成功还原 %s 处（映射表总量 %s）",
            hit_count,
            restored_count,
            len(self.mapping_table),
        )
        return result

    def restore_all(self, text: str, bidder_info: Optional[dict] = None) -> str:
        """
        一步完成投标人占位符 + PIPT 占位符的全量还原

        Args:
            text: 原始文本（含两类占位符）
            bidder_info: 投标人信息字典（可选）

        Returns:
            str: 全量还原后的文本
        """
        # 先还原投标人占位符（优先级高，避免被其他 pattern 误匹配）
        if bidder_info:
            text = self.restore_bidder(text, bidder_info)
        # 再还原 PIPT 脱敏占位符
        text = self.restore(text)
        return text

    def get_unreplaced_placeholders(self, text: str) -> list[str]:
        """检查文本中是否还有未被还原的占位符"""
        return self.DEFAULT_PATTERN.findall(text)
