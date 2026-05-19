# -*- coding: utf-8 -*-
"""
pipt-flask API 客户端
调用 pipt-flask (pipt-lite 分支) 的 NER 识别和脱敏接口
"""

import logging
from typing import Optional

import httpx

from ..config import PiptConfig

logger = logging.getLogger(__name__)


class PiptClient:
    """
    pipt-flask API 客户端

    与 pipt-flask (pipt-lite 分支) 服务通信，
    发送文本进行 NER 识别和脱敏，获取脱敏后文本和映射表
    """

    def __init__(self, config: PiptConfig):
        self.config = config
        self.base_url = config.base_url.rstrip("/")
        self.timeout = config.timeout

    async def desensitize(self, text: str) -> dict:
        """
        调用脱敏接口

        Args:
            text: 待脱敏的文本

        Returns:
            dict: {
                "desensitized_text": str,   # 脱敏后的文本
                "mapping_table": dict,       # 占位符映射表 {占位符: 原文}
                "entities": list,            # 识别到的实体列表
            }
        """
        url = f"{self.base_url}/api/desensitize"
        payload = {
            "text": text,
            "target_entities": self.config.target_entities,
            "method": self.config.desensitize_method,
            "placeholder_format": self.config.placeholder_format,
        }

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(url, json=payload)
                response.raise_for_status()
                result = response.json()
                logger.info(
                    f"脱敏完成: 识别到 {len(result.get('entities', []))} 个敏感实体"
                )
                return result
        except httpx.HTTPError as e:
            logger.error(f"pipt-flask 调用失败: {e}")
            raise

    async def recognize(self, text: str) -> list[dict]:
        """
        仅进行 NER 识别（不脱敏）

        Args:
            text: 待识别的文本

        Returns:
            list[dict]: 识别到的实体列表
                [{"text": "张三", "type": "name", "start": 0, "end": 2}]
        """
        url = f"{self.base_url}/api/recognize"
        payload = {
            "text": text,
            "target_entities": self.config.target_entities,
        }

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(url, json=payload)
                response.raise_for_status()
                return response.json().get("entities", [])
        except httpx.HTTPError as e:
            logger.error(f"pipt-flask NER 识别失败: {e}")
            raise

    async def health_check(self) -> bool:
        """检查 pipt-flask 服务是否可用"""
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                response = await client.get(f"{self.base_url}/health")
                return response.status_code == 200
        except Exception:
            return False
