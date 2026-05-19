# -*- coding: utf-8 -*-
"""
安全等级分类器
根据配置和文件属性判断文件属于 Tier 1（安全区）还是 Tier 2（红线区）
"""

import logging
from pathlib import Path
from typing import Optional

from ..config import SecurityConfig

logger = logging.getLogger(__name__)


class TierClassifier:
    """
    安全等级分类器

    Tier 1 (安全区): 甲方招标文件，允许外传和联网搜索
    Tier 2 (红线区): 内部财务/机密材料，必须脱敏后方可流出
    """

    def __init__(self, config: SecurityConfig):
        self.config = config

    def classify(self, file_path: str, user_specified_tier: Optional[int] = None) -> int:
        """
        判断文件的安全等级

        优先使用用户指定的等级，否则基于文件名关键字自动判断

        Args:
            file_path: 文件路径
            user_specified_tier: 用户显式指定的安全等级（1 或 2）

        Returns:
            int: 安全等级 (1 或 2)
        """
        # 用户显式指定时直接使用
        if user_specified_tier is not None:
            tier = user_specified_tier
            logger.info(f"使用用户指定安全等级: Tier {tier} — {file_path}")
            return tier

        # 基于文件名和路径关键字自动判断
        path_str = Path(file_path).resolve().as_posix()
        for keyword in self.config.tier2_keywords:
            if keyword.lower() in path_str.lower():
                logger.warning(f"检测到 Tier 2 关键字 '{keyword}': {file_path}")
                return 2

        # 新增逻辑：基于路径自动匹配 tier_mapping
        if hasattr(self.config, 'tier_mapping') and getattr(self.config, 'tier_mapping'):
            for dirname, assigned_tier in self.config.tier_mapping.items():
                if dirname in path_str.lower():
                    logger.info(f"根据目录规则 [{dirname}] 赋予安全等级: Tier {assigned_tier} — {file_path}")
                    return assigned_tier

        # 默认等级
        logger.info(f"默认安全等级: Tier {self.config.default_tier} — {file_path}")
        return self.config.default_tier

    def requires_desensitization(self, tier: int) -> bool:
        """判断是否需要脱敏处理"""
        return tier >= 2

    def requires_image_stripping(self, tier: int) -> bool:
        """判断是否需要图片剥离"""
        return tier >= 2 and self.config.strip_images_for_tier2
