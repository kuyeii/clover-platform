# -*- coding: utf-8 -*-
"""
提示词优化器
对生成的提示词进行 Token 预估、冗余去除和窗口适配
"""

import logging
import re

logger = logging.getLogger(__name__)


class PromptOptimizer:
    """
    提示词优化器

    功能：
    - Token 数量预估（基于近似规则或 tiktoken）
    - 冗余内容检测与去除
    - 上下文窗口大小适配
    """

    def __init__(self, max_tokens: int = 8000, model: str = "gpt-4"):
        """
        Args:
            max_tokens: 上下文窗口中系统提示词的最大 Token 数
            model: 目标模型（用于 Token 计算）
        """
        self.max_tokens = max_tokens
        self.model = model

    def estimate_tokens(self, text: str) -> int:
        """
        估算文本的 Token 数量

        优先使用 tiktoken，不可用时用近似规则：
        - 中文：约 1 字 ≈ 1.5 tokens
        - 英文：约 1 词 ≈ 1.3 tokens

        Args:
            text: 待估算的文本

        Returns:
            int: 估算的 Token 数
        """
        try:
            import tiktoken
            enc = tiktoken.encoding_for_model(self.model)
            return len(enc.encode(text))
        except (ImportError, KeyError):
            # 近似估算
            chinese_chars = len(re.findall(r'[\u4e00-\u9fff]', text))
            other_chars = len(text) - chinese_chars
            return int(chinese_chars * 1.5 + other_chars * 0.3)

    def optimize(self, prompt: str) -> str:
        """
        优化提示词

        Args:
            prompt: 原始提示词

        Returns:
            str: 优化后的提示词
        """
        # 1. 去除多余空行
        prompt = re.sub(r'\n{3,}', '\n\n', prompt)

        # 2. 去除尾随空格
        prompt = "\n".join(line.rstrip() for line in prompt.split("\n"))

        # 3. Token 检查
        token_count = self.estimate_tokens(prompt)
        if token_count > self.max_tokens:
            logger.warning(
                f"提示词 Token 数 ({token_count}) 超过限制 ({self.max_tokens})，"
                f"可能需要手动精简"
            )

        logger.info(f"提示词优化完成: {token_count} tokens")
        return prompt
