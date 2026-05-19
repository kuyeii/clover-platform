"""Proxy Knowledge API (Dify) for dataset documents — keys stay server-side."""

from __future__ import annotations

import asyncio
import json
import time
from typing import Annotated, Any
from urllib.parse import quote

import httpx
from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile

from app.config import Settings, get_settings
from app.schemas.knowledge import CreateTextDocumentRequest

router = APIRouter(prefix="/api/v1", tags=["knowledge"])


def _dify_headers(settings: Settings) -> dict[str, str]:
    key = settings.dify_dataset_api_key.strip()
    if not key:
        raise HTTPException(
            status_code=503,
            detail="Server misconfiguration: DIFY_DATASET_API_KEY is not set.",
        )
    return {
        "Authorization": f"Bearer {key}",
        "Accept": "application/json",
    }


def _dataset_id(settings: Settings) -> str:
    did = settings.dify_default_dataset_id.strip()
    if not did:
        raise HTTPException(
            status_code=503,
            detail="Server misconfiguration: DIFY_DEFAULT_DATASET_ID is not set.",
        )
    return did


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
                val = item.get("value")
                if isinstance(val, str) and val.strip():
                    return val.strip()
        # fallback: first non-empty string value
        for item in meta:
            if isinstance(item, dict):
                val = item.get("value")
                if isinstance(val, str) and val.strip():
                    return val.strip()
    return None


def _kb_document_config() -> dict[str, Any]:
    """与 create-by-text / create-by-file 的 data 字段一致（不含 name、text）。"""
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
    """与已通过验证的 Dify create-by-text 调用保持一致（不含 original_document_id）。"""
    return {"name": name, "text": text, **_kb_document_config()}


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
    """
    Poll Dify indexing-status until completed / error / timeout.
    Returns (final_indexing_status, error_message_or_none).
    """
    url = f"{base}/datasets/{dataset_id}/documents/{batch}/indexing-status"
    deadline = time.monotonic() + timeout_seconds
    last_status = "unknown"

    while time.monotonic() < deadline:
        try:
            r = await client.get(url, headers=headers)
        except httpx.RequestError as exc:
            return "error", f"Upstream error: {exc}"

        if r.status_code >= 400:
            try:
                body = r.json()
                msg = body.get("message") or body.get("detail") or r.text
            except Exception:
                msg = r.text or "Indexing status request failed"
            return "error", str(msg)[:500]

        payload = r.json()
        rows = payload.get("data") or []
        row = next((x for x in rows if isinstance(x, dict) and x.get("id") == document_id), None)
        if row is None and rows:
            row = rows[0] if isinstance(rows[0], dict) else None
        if not isinstance(row, dict):
            await asyncio.sleep(poll_interval)
            continue

        last_status = str(row.get("indexing_status") or "")
        if last_status == "completed":
            return "completed", None
        if last_status == "error":
            err = row.get("error")
            return "error", str(err) if err else "Indexing failed"

        await asyncio.sleep(poll_interval)

    return last_status, "Timeout waiting for indexing to complete"


@router.post("/knowledge/documents/create-by-text")
async def create_text_document_and_wait(
    body: CreateTextDocumentRequest,
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict[str, Any]:
    """
    调用 Dify create-by-text，并轮询同一 batch 的 indexing-status 直至完成或失败。
    单次 HTTP 响应即可区分「仅受理」与「索引完成」（由本接口封装轮询）。
    """
    base = settings.dify_api_base_url.rstrip("/")
    ds = _dataset_id(settings)
    headers = {
        **_dify_headers(settings),
        "Content-Type": "application/json",
    }
    payload = _create_by_text_payload(body.name.strip(), body.text)
    create_url = f"{base}/datasets/{ds}/document/create-by-text"

    async with httpx.AsyncClient(timeout=httpx.Timeout(300.0)) as client:
        try:
            r = await client.post(create_url, headers=headers, json=payload)
        except httpx.RequestError as exc:
            raise HTTPException(status_code=502, detail=f"Upstream error: {exc}") from exc

        if r.status_code >= 400:
            try:
                err_body = r.json()
                msg = err_body.get("message") or err_body.get("detail") or r.text
            except Exception:
                msg = r.text or "Create document failed"
            raise HTTPException(status_code=r.status_code, detail=str(msg)[:500])

        created = r.json()
        doc = created.get("document") if isinstance(created, dict) else None
        batch = created.get("batch") if isinstance(created, dict) else None
        if not isinstance(doc, dict) or not isinstance(batch, str):
            raise HTTPException(status_code=502, detail="Invalid upstream response")
        document_id = doc.get("id")
        if not isinstance(document_id, str):
            raise HTTPException(status_code=502, detail="Missing document id in upstream response")
        doc_name = doc.get("name") if isinstance(doc.get("name"), str) else body.name

        final_status, err = await _wait_indexing_complete(
            client,
            base=base,
            dataset_id=ds,
            batch=batch,
            document_id=document_id,
            headers=_dify_headers(settings),
        )

        if final_status == "completed":
            return {
                "ok": True,
                "document_id": document_id,
                "name": doc_name,
                "batch": batch,
                "indexing_status": "completed",
            }

        raise HTTPException(
            status_code=500,
            detail=err or f"Document created but indexing did not complete (status={final_status})",
        )


@router.post("/knowledge/documents/create-by-file")
async def create_file_document_and_wait(
    settings: Annotated[Settings, Depends(get_settings)],
    file: UploadFile = File(...),
) -> dict[str, Any]:
    """
    multipart 转发 Dify create-by-file，`data` 为与文本创建相同的索引配置 JSON；
    创建后轮询 indexing-status 直至完成（与 create-by-text 行为一致）。
    """
    base = settings.dify_api_base_url.rstrip("/")
    ds = _dataset_id(settings)
    auth_headers = _dify_headers(settings)

    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty file upload")

    filename = (file.filename or "upload.bin").strip() or "upload.bin"
    mime = file.content_type or "application/octet-stream"
    data_json = json.dumps(_kb_document_config(), ensure_ascii=False)

    create_url = f"{base}/datasets/{ds}/document/create-by-file"
    # httpx：multipart 字段 file + data（JSON 字符串），勿带 Content-Type 以免破坏 boundary
    files = {"file": (filename, raw, mime)}
    form = {"data": data_json}

    async with httpx.AsyncClient(timeout=httpx.Timeout(300.0)) as client:
        try:
            r = await client.post(create_url, headers=auth_headers, files=files, data=form)
        except httpx.RequestError as exc:
            raise HTTPException(status_code=502, detail=f"Upstream error: {exc}") from exc

        if r.status_code >= 400:
            try:
                err_body = r.json()
                msg = err_body.get("message") or err_body.get("detail") or r.text
            except Exception:
                msg = r.text or "Create document from file failed"
            raise HTTPException(status_code=r.status_code, detail=str(msg)[:500])

        created = r.json()
        doc = created.get("document") if isinstance(created, dict) else None
        batch = created.get("batch") if isinstance(created, dict) else None
        if not isinstance(doc, dict) or not isinstance(batch, str):
            raise HTTPException(status_code=502, detail="Invalid upstream response")
        document_id = doc.get("id")
        if not isinstance(document_id, str):
            raise HTTPException(status_code=502, detail="Missing document id in upstream response")
        doc_name = doc.get("name") if isinstance(doc.get("name"), str) else filename

        final_status, err = await _wait_indexing_complete(
            client,
            base=base,
            dataset_id=ds,
            batch=batch,
            document_id=document_id,
            headers=auth_headers,
        )

        if final_status == "completed":
            return {
                "ok": True,
                "document_id": document_id,
                "name": doc_name,
                "batch": batch,
                "indexing_status": "completed",
            }

        raise HTTPException(
            status_code=500,
            detail=err or f"Document created but indexing did not complete (status={final_status})",
        )


@router.get("/knowledge/documents")
async def list_knowledge_documents(
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict[str, Any]:
    """List all documents in the configured dataset (paginates upstream until exhausted)."""
    base = settings.dify_api_base_url.rstrip("/")
    ds = _dataset_id(settings)
    headers = _dify_headers(settings)

    all_rows: list[dict[str, Any]] = []
    page = 1
    limit = 100
    total = 0

    async with httpx.AsyncClient(timeout=60.0) as client:
        while True:
            url = f"{base}/datasets/{ds}/documents"
            try:
                r = await client.get(
                    url,
                    headers=headers,
                    params={"page": page, "limit": limit},
                )
            except httpx.RequestError as exc:
                raise HTTPException(status_code=502, detail=f"Upstream error: {exc}") from exc

            if r.status_code == 404:
                raise HTTPException(status_code=404, detail="Dataset not found.")
            if r.status_code >= 400:
                try:
                    body = r.json()
                    msg = body.get("message") or body.get("detail") or r.text
                except Exception:
                    msg = r.text or "Upstream error"
                raise HTTPException(status_code=r.status_code, detail=str(msg)[:500])

            payload = r.json()
            batch = payload.get("data") or []
            all_rows.extend(batch)
            total = int(payload.get("total") or len(all_rows))
            has_more = bool(payload.get("has_more"))
            if not has_more:
                break
            page += 1
            if page > 200:
                break

    documents = []
    for raw in all_rows:
        if not isinstance(raw, dict):
            continue
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
    """Stable subset for UI; omits large nested rule blobs."""
    upload: dict[str, Any] | None = None
    dsd = raw.get("data_source_detail_dict")
    if isinstance(dsd, dict):
        uf = dsd.get("upload_file")
        if isinstance(uf, dict):
            upload = {
                "name": uf.get("name"),
                "size": uf.get("size"),
                "extension": uf.get("extension"),
                "mime_type": uf.get("mime_type"),
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


def _summarize_segment(s: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": s.get("id"),
        "position": s.get("position"),
        "content": s.get("content") if isinstance(s.get("content"), str) else "",
        "word_count": s.get("word_count"),
        "tokens": s.get("tokens"),
        "hit_count": s.get("hit_count"),
        "status": s.get("status"),
        "keywords": s.get("keywords") if isinstance(s.get("keywords"), list) else [],
    }


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
        lines.extend(
            [
                f"## Segment {segment.get('position') or index}",
                "",
                content.strip(),
                "",
            ]
        )
    return "\n".join(lines).rstrip() + "\n"


@router.get("/knowledge/documents/{document_id}/detail")
async def get_knowledge_document_detail(
    document_id: str,
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict[str, Any]:
    """
    Dify: GET document（metadata=all） + 分页 GET segments，聚合成单次响应。
    """
    base = settings.dify_api_base_url.rstrip("/")
    ds = _dataset_id(settings)
    headers = _dify_headers(settings)

    doc_url = f"{base}/datasets/{ds}/documents/{document_id}"

    async with httpx.AsyncClient(timeout=httpx.Timeout(120.0)) as client:
        try:
            dr = await client.get(doc_url, headers=headers, params={"metadata": "all"})
        except httpx.RequestError as exc:
            raise HTTPException(status_code=502, detail=f"Upstream error: {exc}") from exc

        if dr.status_code == 404:
            raise HTTPException(status_code=404, detail="Document not found.")
        if dr.status_code >= 400:
            try:
                err = dr.json()
                msg = err.get("message") or err.get("detail") or dr.text
            except Exception:
                msg = dr.text or "Failed to load document"
            raise HTTPException(status_code=dr.status_code, detail=str(msg)[:500])

        doc_raw = dr.json()
        if not isinstance(doc_raw, dict):
            raise HTTPException(status_code=502, detail="Invalid document response")

        segments_out: list[dict[str, Any]] = []
        seg_page = 1
        limit = 100
        doc_form_from_segments: str | None = None
        max_pages = 200

        while seg_page <= max_pages:
            seg_url = f"{base}/datasets/{ds}/documents/{document_id}/segments"
            try:
                sr = await client.get(
                    seg_url,
                    headers=headers,
                    params={"page": seg_page, "limit": limit},
                )
            except httpx.RequestError as exc:
                raise HTTPException(
                    status_code=502, detail=f"Upstream error (segments): {exc}"
                ) from exc

            if sr.status_code >= 400:
                try:
                    err = sr.json()
                    msg = err.get("message") or err.get("detail") or sr.text
                except Exception:
                    msg = sr.text or "Failed to load segments"
                raise HTTPException(status_code=sr.status_code, detail=str(msg)[:500])

            sp = sr.json()
            if isinstance(sp.get("doc_form"), str):
                doc_form_from_segments = sp["doc_form"]
            batch = sp.get("data") or []
            for item in batch:
                if isinstance(item, dict):
                    segments_out.append(_summarize_segment(item))

            if not sp.get("has_more"):
                break
            seg_page += 1

        segments_out.sort(key=lambda x: (x.get("position") is None, x.get("position") or 0))

        summary = _summarize_document_detail(doc_raw)
        if doc_form_from_segments and not summary.get("doc_form"):
            summary["doc_form"] = doc_form_from_segments

        return {
            "document": summary,
            "segments": segments_out,
            "segment_total": len(segments_out),
        }


@router.get("/knowledge/documents/{document_id}/download")
async def download_knowledge_document(
    document_id: str,
    settings: Annotated[Settings, Depends(get_settings)],
    format: str = Query(default="markdown", pattern="^(markdown|json)$"),
) -> Response:
    payload = await get_knowledge_document_detail(document_id, settings)
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


@router.delete("/knowledge/documents/{document_id}")
async def delete_knowledge_document(
    document_id: str,
    settings: Annotated[Settings, Depends(get_settings)],
) -> Response:
    base = settings.dify_api_base_url.rstrip("/")
    ds = _dataset_id(settings)
    headers = _dify_headers(settings)
    url = f"{base}/datasets/{ds}/documents/{document_id}"

    async with httpx.AsyncClient(timeout=60.0) as client:
        try:
            r = await client.delete(url, headers=headers)
        except httpx.RequestError as exc:
            raise HTTPException(status_code=502, detail=f"Upstream error: {exc}") from exc

    if r.status_code == 204:
        return Response(status_code=204)
    if r.status_code == 400:
        try:
            body = r.json()
            msg = body.get("message") or body.get("detail") or "Bad request"
        except Exception:
            msg = r.text
        raise HTTPException(status_code=400, detail=str(msg)[:500])
    if r.status_code == 404:
        raise HTTPException(status_code=404, detail="Document not found.")
    try:
        body = r.json()
        msg = body.get("message") or body.get("detail") or r.text
    except Exception:
        msg = r.text or "Upstream error"
    raise HTTPException(status_code=r.status_code, detail=str(msg)[:500])
