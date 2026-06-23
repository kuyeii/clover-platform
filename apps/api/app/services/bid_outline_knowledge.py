from __future__ import annotations

import asyncio
import os
from typing import Any

import httpx

from app.services.rag_dify_service import get_dataset_api_base_url, get_dataset_api_key, get_default_dataset_id


class BidOutlineKnowledgeError(RuntimeError):
    pass


def _headers() -> dict[str, str]:
    key = get_dataset_api_key().strip()
    if not key:
        raise BidOutlineKnowledgeError("知识库检索未配置 DIFY_DATASET_API_KEY。")
    return {
        "Authorization": f"Bearer {key}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }


async def retrieve_outline_knowledge(query: str, *, top_k: int = 2) -> str:
    """检索 Dify Dataset 知识库；入参为查询词，出参为拼接后的知识片段文本。"""
    normalized_query = str(query or "").strip()
    if not normalized_query:
        return ""
    dataset_id = (
        os.environ.get("BID_OUTLINE_DATASET_ID", "").strip()
        or os.environ.get("DIFY_BID_BASE_ID", "").strip()
        or get_default_dataset_id().strip()
    )
    if not dataset_id:
        raise BidOutlineKnowledgeError("知识库检索未配置 DIFY_DEFAULT_DATASET_ID。")

    url = f"{get_dataset_api_base_url().rstrip('/')}/datasets/{dataset_id}/retrieve"
    payload = {
        "query": normalized_query,
        "retrieval_model": {
            "search_method": "semantic_search",
            "reranking_enable": False,
            "top_k": max(1, int(top_k or 2)),
            "score_threshold_enabled": False,
        },
    }
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(60.0), trust_env=False) as client:
            response = await client.post(url, headers=_headers(), json=payload)
    except asyncio.CancelledError:
        raise
    except httpx.RequestError as exc:
        raise BidOutlineKnowledgeError(f"知识库检索请求失败：{exc}") from exc

    if response.status_code >= 400:
        raise BidOutlineKnowledgeError(_upstream_error_message(response, "知识库检索失败。"))
    data = response.json()
    snippets = _extract_retrieval_snippets(data)
    return "\n\n".join(snippets[: max(1, int(top_k or 2))])


def _extract_retrieval_snippets(payload: Any) -> list[str]:
    if not isinstance(payload, dict):
        return []
    candidates = payload.get("records") or payload.get("data") or payload.get("documents") or []
    if isinstance(candidates, dict):
        candidates = candidates.get("records") or candidates.get("data") or candidates.get("documents") or []
    snippets: list[str] = []
    for item in candidates if isinstance(candidates, list) else []:
        text = _extract_record_text(item)
        if text:
            snippets.append(text[:1800])
    return snippets


def _extract_record_text(item: Any) -> str:
    if isinstance(item, str):
        return item.strip()
    if not isinstance(item, dict):
        return ""
    segment = item.get("segment") if isinstance(item.get("segment"), dict) else item
    for key in ("content", "text", "answer", "document", "name"):
        value = segment.get(key) if isinstance(segment, dict) else None
        if isinstance(value, str) and value.strip():
            return value.strip()
    document = item.get("document")
    if isinstance(document, dict):
        for key in ("content", "text", "name"):
            value = document.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    return ""


def _upstream_error_message(response: httpx.Response, fallback: str) -> str:
    try:
        payload = response.json()
        if isinstance(payload, dict):
            value = payload.get("message") or payload.get("detail") or payload.get("error")
            if value:
                return str(value)[:500]
    except Exception:
        pass
    return (response.text or fallback)[:500]
