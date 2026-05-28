from __future__ import annotations

import asyncio
import json
import time
from pathlib import Path
import tempfile
from typing import Any
from urllib.parse import quote

import httpx
from fastapi import UploadFile
from fastapi.responses import Response

from app.services.rag_dify_service import get_dataset_api_base_url, get_dataset_api_key, get_default_dataset_id


class RagKnowledgeError(Exception):
    def __init__(self, detail: str, *, status_code: int = 502) -> None:
        self.detail = detail
        self.status_code = status_code
        super().__init__(detail)


def _dify_headers() -> dict[str, str]:
    key = get_dataset_api_key().strip()
    if not key:
        raise RagKnowledgeError("知识库服务配置错误：未设置 DIFY_DATASET_API_KEY。", status_code=503)
    return {
        "Authorization": f"Bearer {key}",
        "Accept": "application/json",
    }


def _dataset_id() -> str:
    dataset_id = get_default_dataset_id().strip()
    if not dataset_id:
        raise RagKnowledgeError("知识库服务配置错误：未设置 DIFY_DEFAULT_DATASET_ID。", status_code=503)
    return dataset_id


def _extract_description(raw: dict[str, Any]) -> str | None:
    direct = raw.get("description")
    if isinstance(direct, str) and direct.strip():
        return direct.strip()
    meta = raw.get("doc_metadata")
    if isinstance(meta, list):
        for item in meta:
            if not isinstance(item, dict):
                continue
            name = (item.get("name") or "").strip().lower()
            if name in ("description", "描述", "简介", "summary"):
                value = item.get("value")
                if isinstance(value, str) and value.strip():
                    return value.strip()
        for item in meta:
            if isinstance(item, dict):
                value = item.get("value")
                if isinstance(value, str) and value.strip():
                    return value.strip()
    return None


def _kb_document_config() -> dict[str, Any]:
    return {
        "indexing_technique": "high_quality",
        "doc_form": "text_model",
        "doc_language": "Chinese",
        "embedding_model": "text-embedding-v4",
        "embedding_model_provider": "langgenius/tongyi/tongyi",
        "process_rule": {
            "rules": {
                "segmentation": {
                    "separator": "\n##",
                    "chunk_overlap": 150,
                    "max_tokens": 1024,
                }
            },
            "mode": "automatic",
        },
        "retrieval_model": {
            "search_method": "hybrid_search",
            "reranking_enable": True,
            "top_k": 3,
            "score_threshold_enabled": False,
            "reranking_model": {
                "reranking_model_name": "qwen3-rerank",
                "reranking_provider_name": "langgenius/tongyi/tongyi",
            },
            "reranking_mode": "reranking_model",
            "weights": {"weight_type": "semantic_first"},
        },
    }


def _create_by_text_payload(name: str, text: str) -> dict[str, Any]:
    return {"name": name, "text": text, **_kb_document_config()}


def _upstream_error_message(response: httpx.Response, fallback: str = "Upstream error") -> str:
    try:
        payload = response.json()
        if isinstance(payload, dict):
            value = payload.get("message") or payload.get("detail") or payload.get("error")
            if value:
                return str(value)[:500]
    except Exception:
        pass
    return (response.text or fallback)[:500]


async def _wait_indexing_complete(
    client: httpx.AsyncClient,
    *,
    base: str,
    dataset_id: str,
    batch: str,
    document_id: str,
    headers: dict[str, str],
    timeout_seconds: float = 180.0,
    poll_interval: float = 1.0,
) -> tuple[str, str | None]:
    url = f"{base}/datasets/{dataset_id}/documents/{batch}/indexing-status"
    deadline = time.monotonic() + timeout_seconds
    last_status = "unknown"

    while time.monotonic() < deadline:
        try:
            response = await client.get(url, headers=headers)
        except httpx.RequestError as exc:
            return "error", f"Upstream error: {exc}"

        if response.status_code >= 400:
            return "error", _upstream_error_message(response, "Indexing status request failed")

        payload = response.json()
        rows = payload.get("data") if isinstance(payload, dict) else []
        rows = rows if isinstance(rows, list) else []
        row = next((item for item in rows if isinstance(item, dict) and item.get("id") == document_id), None)
        if row is None and rows and isinstance(rows[0], dict):
            row = rows[0]
        if not isinstance(row, dict):
            await asyncio.sleep(poll_interval)
            continue

        last_status = str(row.get("indexing_status") or "")
        if last_status == "completed":
            return "completed", None
        if last_status == "error":
            error = row.get("error")
            return "error", str(error) if error else "Indexing failed"
        await asyncio.sleep(poll_interval)

    return last_status, "Timeout waiting for indexing to complete"


async def create_text_document_and_wait(name: str, text: str) -> dict[str, Any]:
    base = get_dataset_api_base_url()
    dataset_id = _dataset_id()
    headers = {**_dify_headers(), "Content-Type": "application/json"}
    payload = _create_by_text_payload(name.strip(), text)
    url = f"{base}/datasets/{dataset_id}/document/create-by-text"

    async with httpx.AsyncClient(timeout=httpx.Timeout(300.0), trust_env=False) as client:
        try:
            response = await client.post(url, headers=headers, json=payload)
        except httpx.RequestError as exc:
            raise RagKnowledgeError(f"Upstream error: {exc}") from exc

        if response.status_code >= 400:
            raise RagKnowledgeError(_upstream_error_message(response, "Create document failed"), status_code=response.status_code)

        created = response.json()
        document = created.get("document") if isinstance(created, dict) else None
        batch = created.get("batch") if isinstance(created, dict) else None
        if not isinstance(document, dict) or not isinstance(batch, str):
            raise RagKnowledgeError("Invalid upstream response")
        document_id = document.get("id")
        if not isinstance(document_id, str):
            raise RagKnowledgeError("Missing document id in upstream response")

        final_status, error = await _wait_indexing_complete(
            client,
            base=base,
            dataset_id=dataset_id,
            batch=batch,
            document_id=document_id,
            headers=_dify_headers(),
        )

    if final_status == "completed":
        return {
            "ok": True,
            "document_id": document_id,
            "name": document.get("name") if isinstance(document.get("name"), str) else name,
            "batch": batch,
            "indexing_status": "completed",
        }

    raise RagKnowledgeError(error or f"Document created but indexing did not complete (status={final_status})", status_code=500)


async def _save_upload_to_temp(file: UploadFile) -> tuple[Path, str, str]:
    filename = (file.filename or "upload.bin").strip() or "upload.bin"
    mime = file.content_type or "application/octet-stream"
    suffix = Path(filename).suffix
    tmp = tempfile.NamedTemporaryFile(prefix="rag-upload-", suffix=suffix, delete=False)
    path = Path(tmp.name)
    try:
        with tmp:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                tmp.write(chunk)
    except Exception:
        path.unlink(missing_ok=True)
        raise
    if path.stat().st_size <= 0:
        path.unlink(missing_ok=True)
        raise RagKnowledgeError("Empty file upload", status_code=400)
    return path, filename, mime


async def create_file_document_and_wait(file: UploadFile) -> dict[str, Any]:
    base = get_dataset_api_base_url()
    dataset_id = _dataset_id()
    headers = _dify_headers()
    temp_path, filename, mime = await _save_upload_to_temp(file)
    data_json = json.dumps(_kb_document_config(), ensure_ascii=False)
    url = f"{base}/datasets/{dataset_id}/document/create-by-file"

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(300.0), trust_env=False) as client:
            try:
                with temp_path.open("rb") as upload:
                    response = await client.post(
                        url,
                        headers=headers,
                        files={"file": (filename, upload, mime)},
                        data={"data": data_json},
                    )
            except httpx.RequestError as exc:
                raise RagKnowledgeError(f"Upstream error: {exc}") from exc

            if response.status_code >= 400:
                raise RagKnowledgeError(
                    _upstream_error_message(response, "Create document from file failed"),
                    status_code=response.status_code,
                )

            created = response.json()
            document = created.get("document") if isinstance(created, dict) else None
            batch = created.get("batch") if isinstance(created, dict) else None
            if not isinstance(document, dict) or not isinstance(batch, str):
                raise RagKnowledgeError("Invalid upstream response")
            document_id = document.get("id")
            if not isinstance(document_id, str):
                raise RagKnowledgeError("Missing document id in upstream response")

            final_status, error = await _wait_indexing_complete(
                client,
                base=base,
                dataset_id=dataset_id,
                batch=batch,
                document_id=document_id,
                headers=headers,
            )
    finally:
        temp_path.unlink(missing_ok=True)

    if final_status == "completed":
        return {
            "ok": True,
            "document_id": document_id,
            "name": document.get("name") if isinstance(document.get("name"), str) else filename,
            "batch": batch,
            "indexing_status": "completed",
        }

    raise RagKnowledgeError(error or f"Document created but indexing did not complete (status={final_status})", status_code=500)


async def list_knowledge_documents() -> dict[str, Any]:
    base = get_dataset_api_base_url()
    dataset_id = _dataset_id()
    headers = _dify_headers()
    all_rows: list[dict[str, Any]] = []
    page = 1
    limit = 100

    async with httpx.AsyncClient(timeout=60.0, trust_env=False) as client:
        while True:
            url = f"{base}/datasets/{dataset_id}/documents"
            try:
                response = await client.get(url, headers=headers, params={"page": page, "limit": limit})
            except httpx.RequestError as exc:
                raise RagKnowledgeError(f"Upstream error: {exc}") from exc

            if response.status_code == 404:
                raise RagKnowledgeError("Dataset not found.", status_code=404)
            if response.status_code >= 400:
                raise RagKnowledgeError(_upstream_error_message(response), status_code=response.status_code)

            payload = response.json()
            batch = payload.get("data") if isinstance(payload, dict) else []
            if isinstance(batch, list):
                all_rows.extend(row for row in batch if isinstance(row, dict))
            if not bool(payload.get("has_more")):
                break
            page += 1
            if page > 200:
                break

    documents: list[dict[str, Any]] = []
    for raw in all_rows:
        doc_id = raw.get("id")
        name = raw.get("name")
        if not doc_id or not isinstance(name, str):
            continue
        documents.append(
            {
                "id": doc_id,
                "name": name,
                "description": _extract_description(raw),
                "display_status": raw.get("display_status"),
                "indexing_status": raw.get("indexing_status"),
                "data_source_type": raw.get("data_source_type"),
                "word_count": raw.get("word_count"),
                "tokens": raw.get("tokens"),
                "segment_count": raw.get("segment_count"),
                "enabled": raw.get("enabled"),
                "created_at": raw.get("created_at"),
                "updated_at": raw.get("updated_at"),
            }
        )

    return {"documents": documents, "total": len(documents)}


def _summarize_document_detail(raw: dict[str, Any]) -> dict[str, Any]:
    upload: dict[str, Any] | None = None
    data_source_detail = raw.get("data_source_detail_dict")
    if isinstance(data_source_detail, dict):
        upload_file = data_source_detail.get("upload_file")
        if isinstance(upload_file, dict):
            upload = {
                "name": upload_file.get("name"),
                "size": upload_file.get("size"),
                "extension": upload_file.get("extension"),
                "mime_type": upload_file.get("mime_type"),
            }
    return {
        "id": raw.get("id"),
        "name": raw.get("name"),
        "data_source_type": raw.get("data_source_type"),
        "created_from": raw.get("created_from"),
        "word_count": raw.get("word_count"),
        "tokens": raw.get("tokens"),
        "hit_count": raw.get("hit_count"),
        "indexing_status": raw.get("indexing_status"),
        "display_status": raw.get("display_status"),
        "doc_form": raw.get("doc_form"),
        "doc_language": raw.get("doc_language"),
        "segment_count": raw.get("segment_count"),
        "average_segment_length": raw.get("average_segment_length"),
        "indexing_latency": raw.get("indexing_latency"),
        "created_at": raw.get("created_at"),
        "updated_at": raw.get("updated_at"),
        "completed_at": raw.get("completed_at"),
        "doc_metadata": raw.get("doc_metadata"),
        "upload_file": upload,
        "enabled": raw.get("enabled"),
        "error": raw.get("error"),
    }


def _summarize_segment(segment: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": segment.get("id"),
        "position": segment.get("position"),
        "content": segment.get("content") if isinstance(segment.get("content"), str) else "",
        "word_count": segment.get("word_count"),
        "tokens": segment.get("tokens"),
        "hit_count": segment.get("hit_count"),
        "status": segment.get("status"),
        "keywords": segment.get("keywords") if isinstance(segment.get("keywords"), list) else [],
    }


async def get_knowledge_document_detail(document_id: str) -> dict[str, Any]:
    base = get_dataset_api_base_url()
    dataset_id = _dataset_id()
    headers = _dify_headers()
    doc_url = f"{base}/datasets/{dataset_id}/documents/{document_id}"

    async with httpx.AsyncClient(timeout=httpx.Timeout(120.0), trust_env=False) as client:
        try:
            doc_response = await client.get(doc_url, headers=headers, params={"metadata": "all"})
        except httpx.RequestError as exc:
            raise RagKnowledgeError(f"Upstream error: {exc}") from exc

        if doc_response.status_code == 404:
            raise RagKnowledgeError("Document not found.", status_code=404)
        if doc_response.status_code >= 400:
            raise RagKnowledgeError(
                _upstream_error_message(doc_response, "Failed to load document"),
                status_code=doc_response.status_code,
            )

        document_raw = doc_response.json()
        if not isinstance(document_raw, dict):
            raise RagKnowledgeError("Invalid document response")

        segments: list[dict[str, Any]] = []
        page = 1
        limit = 100
        doc_form_from_segments: str | None = None
        while page <= 200:
            seg_url = f"{base}/datasets/{dataset_id}/documents/{document_id}/segments"
            try:
                seg_response = await client.get(seg_url, headers=headers, params={"page": page, "limit": limit})
            except httpx.RequestError as exc:
                raise RagKnowledgeError(f"Upstream error (segments): {exc}") from exc

            if seg_response.status_code >= 400:
                raise RagKnowledgeError(
                    _upstream_error_message(seg_response, "Failed to load segments"),
                    status_code=seg_response.status_code,
                )

            payload = seg_response.json()
            if isinstance(payload.get("doc_form"), str):
                doc_form_from_segments = payload["doc_form"]
            batch = payload.get("data") if isinstance(payload, dict) else []
            if isinstance(batch, list):
                segments.extend(_summarize_segment(item) for item in batch if isinstance(item, dict))
            if not bool(payload.get("has_more")):
                break
            page += 1

    segments.sort(key=lambda item: (item.get("position") is None, item.get("position") or 0))
    summary = _summarize_document_detail(document_raw)
    if doc_form_from_segments and not summary.get("doc_form"):
        summary["doc_form"] = doc_form_from_segments
    return {"document": summary, "segments": segments, "segment_total": len(segments)}


def _safe_export_filename(name: str | None, suffix: str) -> str:
    base = (name or "knowledge-document").strip()
    base = "".join(ch if ch.isalnum() or ch in ("-", "_", ".", " ") else "_" for ch in base)
    base = base.strip(" .") or "knowledge-document"
    if len(base) > 80:
        base = base[:80].rstrip(" .")
    return f"{base}.{suffix}"


def _content_disposition(filename: str) -> str:
    ascii_name = filename.encode("ascii", errors="ignore").decode("ascii") or "knowledge-document"
    return f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(filename)}"


def _document_export_markdown(payload: dict[str, Any]) -> str:
    document = payload.get("document") if isinstance(payload.get("document"), dict) else {}
    segments = payload.get("segments") if isinstance(payload.get("segments"), list) else []
    name = document.get("name") or document.get("id") or "knowledge-document"
    lines = [
        f"# {name}",
        "",
        f"- 文档 ID: {document.get('id') or ''}",
        f"- 索引状态: {document.get('indexing_status') or document.get('display_status') or ''}",
        f"- 分段数: {payload.get('segment_total') or len(segments)}",
        f"- Tokens: {document.get('tokens') or ''}",
        "",
    ]
    for index, segment in enumerate(segments, start=1):
        if not isinstance(segment, dict):
            continue
        content = segment.get("content") if isinstance(segment.get("content"), str) else ""
        lines.extend([f"## Segment {segment.get('position') or index}", "", content.strip(), ""])
    return "\n".join(lines).rstrip() + "\n"


async def download_knowledge_document(document_id: str, *, format: str = "markdown") -> Response:
    payload = await get_knowledge_document_detail(document_id)
    document = payload.get("document") if isinstance(payload.get("document"), dict) else {}
    name = document.get("name") if isinstance(document.get("name"), str) else document_id
    if format == "json":
        body = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
        filename = _safe_export_filename(name, "json")
        media_type = "application/json; charset=utf-8"
    else:
        body = _document_export_markdown(payload)
        filename = _safe_export_filename(name, "md")
        media_type = "text/markdown; charset=utf-8"

    return Response(
        content=body,
        media_type=media_type,
        headers={"Content-Disposition": _content_disposition(filename)},
    )


async def delete_knowledge_document(document_id: str) -> Response:
    base = get_dataset_api_base_url()
    dataset_id = _dataset_id()
    headers = _dify_headers()
    url = f"{base}/datasets/{dataset_id}/documents/{document_id}"
    async with httpx.AsyncClient(timeout=60.0, trust_env=False) as client:
        try:
            response = await client.delete(url, headers=headers)
        except httpx.RequestError as exc:
            raise RagKnowledgeError(f"Upstream error: {exc}") from exc

    if response.status_code == 204:
        return Response(status_code=204)
    if response.status_code == 400:
        raise RagKnowledgeError(_upstream_error_message(response, "Bad request"), status_code=400)
    if response.status_code == 404:
        raise RagKnowledgeError("Document not found.", status_code=404)
    raise RagKnowledgeError(_upstream_error_message(response), status_code=response.status_code)
