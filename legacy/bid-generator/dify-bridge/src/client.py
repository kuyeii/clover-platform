from typing import Optional
# -*- coding: utf-8 -*-
"""
Dify API 客户端
封装与 Dify 平台的所有 HTTP 交互
"""

import logging
from typing import Any, AsyncIterator

import httpx

from .config import DifyConfig

logger = logging.getLogger(__name__)


class DifyClient:
    """
    Dify API 客户端

    提供统一的请求封装，包含重试机制和错误处理
    """

    def __init__(self, config: DifyConfig):
        self.config = config
        self.base_url = config.base_url.rstrip("/")
        self.headers = {
            "Authorization": f"Bearer {config.api_key}",
            "Content-Type": "application/json",
        }

    async def _request(
        self, method: str, path: str, **kwargs
    ) -> dict[str, Any]:
        """
        发送 HTTP 请求（带重试）

        Args:
            method: HTTP 方法
            path: 请求路径（相对于 base_url）
            **kwargs: httpx 请求参数

        Returns:
            dict: 响应 JSON
        """
        url = f"{self.base_url}{path}"
        last_error = None

        for attempt in range(1, self.config.max_retries + 1):
            try:
                async with httpx.AsyncClient(timeout=self.config.timeout) as client:
                    response = await client.request(
                        method, url, headers=self.headers, **kwargs
                    )
                    response.raise_for_status()
                    return response.json()
            except httpx.HTTPError as e:
                last_error = e
                logger.warning(f"Dify API 请求失败 (第 {attempt}/{self.config.max_retries} 次): {e}")

        raise RuntimeError(f"Dify API 请求失败（已重试 {self.config.max_retries} 次）: {last_error}")

    async def chat_completion(
        self, query: str, conversation_id: str = "", inputs: Optional[dict] = None
    ) -> dict:
        """
        调用 Dify 对话接口

        Args:
            query: 用户查询
            conversation_id: 对话 ID（空字符串表示新对话）
            inputs: 额外输入变量

        Returns:
            dict: Dify 响应
        """
        payload = {
            "query": query,
            "inputs": inputs or {},
            "response_mode": "blocking",
            "user": "pro-engine",
        }
        if conversation_id:
            payload["conversation_id"] = conversation_id

        result = await self._request("POST", "/chat-messages", json=payload)
        logger.info(f"对话完成: conversation_id={result.get('conversation_id', '')}")
        return result

    async def run_workflow(
        self, inputs: dict, response_mode: str = "blocking"
    ) -> dict:
        """
        执行 Dify 工作流

        Args:
            inputs: 工作流输入变量
            response_mode: 响应模式 (blocking / streaming)

        Returns:
            dict: 工作流执行结果
        """
        payload = {
            "inputs": inputs,
            "response_mode": response_mode,
            "user": "pro-engine",
        }

        result = await self._request("POST", "/workflows/run", json=payload)
        logger.info(f"工作流执行完成: task_id={result.get('task_id', '')}")
        return result
