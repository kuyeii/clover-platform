from typing import Optional
# -*- coding: utf-8 -*-
"""
Dify 工作流管理
工作流的触发、状态查询和结果获取
"""

import logging

from .client import DifyClient
from .config import DifyConfig

logger = logging.getLogger(__name__)


class WorkflowManager:
    """
    Dify 工作流管理器

    管理标书生成相关工作流的触发和结果回收
    """

    def __init__(self, config: DifyConfig):
        self.config = config
        self.client = DifyClient(config)

    async def run_bid_generation(
        self,
        system_prompt: str,
        structured_data: str,
        knowledge_query: str = "",
        requires_search: str = "true",
    ) -> str:
        """
        执行标书生成工作流

        工作流内部会完成：
        1. RAG 内部知识库检索 (可能通过 requires_search 条件分支)
        2. SearXNG 联网搜索 (可能通过 requires_search 条件分支)
        3. LLM 生成 Markdown 文本

        Args:
            system_prompt: 系统提示词（来自 prompt-forge）
            structured_data: 结构化招标数据
            knowledge_query: 知识库检索查询（可选）
            requires_search: 是否需要进行搜索 ("true" 或 "false")

        Returns:
            str: 生成的 Markdown 文本（含占位符）
        """
        inputs = {
            "system_prompt": system_prompt,
            "structured_data": structured_data,
            "requires_search": requires_search,
        }
        if knowledge_query:
            inputs["knowledge_query"] = knowledge_query

        # 为了避免标书生成时间过长导致的 HTTP 超时，统一向 Dify 注册 "response_mode": "blocking"
        # 实际生产中可能需要 "streaming" 模式 + SSE 解析器
        result = await self.client.run_workflow(inputs)

        # 兼容不同响应模式的解析
        output_text = ""
        # 0. 检查是否工作流失败
        if "data" in result and isinstance(result["data"], dict):
            if result["data"].get("status") == "failed":
                logger.error(f"Dify 工作流执行失败: {result['data'].get('error')}")
                return ""
                
            outputs = result["data"].get("outputs")
            if outputs and isinstance(outputs, dict):
                output_text = outputs.get("text") or outputs.get("result") or str(outputs)
            elif "outputs" in result["data"]:
                output_text = "" # 输出存在但是为 None
        elif "outputs" in result and isinstance(result["outputs"], dict):
            output_text = result["outputs"].get("text") or result["outputs"].get("result", "")
        elif "message" in result and "code" in result:
            logger.error(f"Dify 接口返回错误: {result['message']}")
            raise RuntimeError(f"Dify 调用失败: {result['message']}")
        else:
            logger.warning(f"无法匹配 Dify 预期的输出格式或输出为空。原始返回: {str(result)[:500]}")
            output_text = str(result)

        logger.info(f"标书生成完成: 输出长度={len(output_text)} 字符")
        return output_text

    async def get_workflow_status(self, task_id: str) -> dict:
        """
        查询工作流执行状态

        Args:
            task_id: 工作流任务 ID

        Returns:
            dict: 状态信息
        """
        result = await self.client._request(
            "GET", f"/workflows/run/{task_id}"
        )
        status = result.get("status", "unknown")
        logger.info(f"工作流状态: task_id={task_id}, status={status}")
        return result
