from typing import Optional
# -*- coding: utf-8 -*-
"""
Dify 知识库管理
知识库的创建、文档上传、索引等待和生命周期管理
"""

import asyncio
import logging
from pathlib import Path

from .client import DifyClient
from .config import DifyConfig

logger = logging.getLogger(__name__)


class KnowledgeManager:
    """
    Dify 知识库管理器

    管理与 Dify 知识库相关的所有操作：
    - 创建/查询/删除知识库
    - 上传文档到知识库
    - 等待索引完成
    """

    def __init__(self, config: DifyConfig):
        self.config = config
        self.client = DifyClient(config)
        self.dataset_id = config.knowledge_base_id

    async def create_dataset(self, name: str, description: str = "") -> str:
        """
        创建新知识库，返回 dataset_id

        Args:
            name: 知识库名称（如 project_{id}_bid_doc）
            description: 知识库描述

        Returns:
            str: 新建知识库的 dataset_id
        """
        payload = {
            "name": name,
            "description": description or f"ProEngine 项目文档知识库: {name}",
            "indexing_technique": "high_quality",
            "permission": "only_me",
        }
        result = await self.client._request("POST", "/datasets", json=payload)
        dataset_id = result.get("id", "")
        logger.info(f"知识库创建成功: name={name}, dataset_id={dataset_id}")
        return dataset_id

    async def delete_dataset(self, dataset_id: str) -> bool:
        """删除指定知识库"""
        await self.client._request("DELETE", f"/datasets/{dataset_id}")
        logger.info(f"知识库已删除: {dataset_id}")
        return True

    async def upload_document(
        self, file_path: str, custom_rules: Optional[dict] = None,
        dataset_id: Optional[str] = None
    ) -> dict:
        """
        上传文档到 Dify 知识库

        Args:
            file_path: 文档路径
            custom_rules: 自定义分段规则
            dataset_id: 目标知识库 ID（不传则用默认）

        Returns:
            dict: 上传结果
        """
        import httpx

        path = Path(file_path)
        if not path.exists():
            raise FileNotFoundError(f"文件不存在: {file_path}")

        target_id = dataset_id or self.dataset_id
        url = f"{self.client.base_url}/datasets/{target_id}/document/create_by_file"

        async with httpx.AsyncClient(timeout=self.config.timeout) as client:
            with open(path, "rb") as f:
                files = {"file": (path.name, f, "application/octet-stream")}
                data = {
                    "data": '{"indexing_technique":"high_quality","process_rule":{"mode":"automatic"}}'
                }
                response = await client.post(
                    url,
                    headers={"Authorization": f"Bearer {self.config.api_key}"},
                    files=files,
                    data=data,
                )
                response.raise_for_status()
                result = response.json()

        doc_id = result.get("document", {}).get("id", "")
        logger.info(f"文档上传成功: {path.name} → document_id={doc_id}")
        return result

    async def upload_text(
        self, name: str, text: str,
        dataset_id: Optional[str] = None
    ) -> dict:
        """
        以文本方式创建知识库文档

        Args:
            name: 文档名称
            text: 文档内容
            dataset_id: 目标知识库 ID（不传则用默认）

        Returns:
            dict: 创建结果，含 document.id 和 document.indexing_status
        """
        target_id = dataset_id or self.dataset_id
        payload = {
            "name": name,
            "text": text,
            "indexing_technique": "high_quality",
            "process_rule": {
                "mode": "custom",
                "rules": {
                    "pre_processing_rules": [
                        {"id": "remove_extra_spaces", "enabled": True},
                        {"id": "remove_urls_emails", "enabled": False},
                    ],
                    "segmentation": {
                        "separator": "\n\n",
                        "max_tokens": 2000,
                        "chunk_overlap": 500,
                    }
                }
            },
        }

        result = await self.client._request(
            "POST",
            f"/datasets/{target_id}/document/create_by_text",
            json=payload,
        )
        logger.info(f"文本文档创建成功: {name}")
        return result

    async def get_document_status(
        self, document_id: str, dataset_id: Optional[str] = None
    ) -> str:
        """
        查询文档索引状态

        Returns:
            str: indexing_status（waiting/parsing/indexing/completed/error）
        """
        target_id = dataset_id or self.dataset_id
        result = await self.client._request(
            "GET", f"/datasets/{target_id}/documents"
        )
        for doc in result.get("data", []):
            if doc.get("id") == document_id:
                return doc.get("indexing_status", "unknown")
        return "not_found"

    async def wait_for_indexing(
        self, document_id: str, dataset_id: Optional[str] = None,
        timeout: int = 300, interval: int = 3
    ) -> bool:
        """
        等待文档索引完成

        Args:
            document_id: 文档 ID
            dataset_id: 知识库 ID
            timeout: 最长等待秒数
            interval: 轮询间隔秒数

        Returns:
            bool: 是否索引成功
        """
        elapsed = 0
        while elapsed < timeout:
            status = await self.get_document_status(document_id, dataset_id)
            logger.debug(f"索引状态: doc={document_id}, status={status}, elapsed={elapsed}s")
            if status == "completed":
                logger.info(f"文档索引完成: {document_id}")
                return True
            if status in ("error", "not_found"):
                logger.error(f"文档索引异常: {document_id}, status={status}")
                return False
            await asyncio.sleep(interval)
            elapsed += interval

        logger.warning(f"文档索引超时: {document_id}, 已等待 {timeout}s")
        return False

    async def list_documents(self, dataset_id: Optional[str] = None) -> list[dict]:
        """列出知识库中的所有文档"""
        target_id = dataset_id or self.dataset_id
        result = await self.client._request(
            "GET", f"/datasets/{target_id}/documents"
        )
        docs = result.get("data", [])
        logger.info(f"知识库文档数量: {len(docs)}")
        return docs

    async def delete_document(
        self, document_id: str, dataset_id: Optional[str] = None
    ) -> bool:
        """删除知识库中的指定文档"""
        target_id = dataset_id or self.dataset_id
        await self.client._request(
            "DELETE",
            f"/datasets/{target_id}/documents/{document_id}",
        )
        logger.info(f"文档已删除: {document_id}")
        return True
