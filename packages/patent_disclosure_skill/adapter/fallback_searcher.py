from __future__ import annotations

import html
import re
from dataclasses import dataclass
from typing import Any
from urllib.parse import quote

import requests


class FallbackPriorArtSearchError(RuntimeError):
    pass


@dataclass(frozen=True)
class FallbackPriorArtSearcher:
    timeout_seconds: int = 20
    max_results: int = 20

    def search(self, terms: list[str]) -> dict[str, Any]:
        normalized_terms = [term.strip() for term in terms if term.strip()][:8]
        if not normalized_terms:
            raise FallbackPriorArtSearchError("缺少降级查新关键词。")

        hits_by_key: dict[str, dict[str, Any]] = {}
        attempts: list[dict[str, str]] = []
        for term in normalized_terms:
            try:
                term_hits = self._search_google_patents(term)
            except Exception as exc:
                attempts.append({"source": "Google Patents", "term": term, "status": "failed", "message": str(exc)})
                continue

            attempts.append(
                {
                    "source": "Google Patents",
                    "term": term,
                    "status": "succeeded",
                    "message": f"命中 {len(term_hits)} 条",
                }
            )
            for hit in term_hits:
                key = str(hit.get("pub_number") or hit.get("link") or hit.get("title") or "")
                if key and key not in hits_by_key:
                    hits_by_key[key] = hit
                if len(hits_by_key) >= self.max_results:
                    break
            if len(hits_by_key) >= self.max_results:
                break

        hits = list(hits_by_key.values())[: self.max_results]
        if not hits:
            attempts.append(
                {
                    "source": "WebSearch",
                    "term": " ".join(normalized_terms),
                    "status": "not_configured",
                    "message": "容器内未配置稳定的通用 WebSearch 后端，Google Patents 无可用命中。",
                }
            )
            raise FallbackPriorArtSearchError(_format_attempt_failures(attempts))

        return {
            "source": "fallback",
            "channels": ["Google Patents"],
            "attempts": attempts,
            "hits": hits,
        }

    def _search_google_patents(self, term: str) -> list[dict[str, Any]]:
        query_url = "q%3D" + quote(term)
        url = f"https://patents.google.com/xhr/query?url={query_url}"
        response = requests.get(
            url,
            timeout=self.timeout_seconds,
            headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json"},
        )
        response.raise_for_status()
        payload = response.json()
        return _parse_google_patents_payload(payload, max_results=self.max_results)


def _parse_google_patents_payload(payload: dict[str, Any], *, max_results: int = 20) -> list[dict[str, Any]]:
    clusters = payload.get("results", {}).get("cluster", [])
    hits: list[dict[str, Any]] = []
    for cluster in clusters:
        for item in cluster.get("result", []):
            patent = item.get("patent") or {}
            pub_number = str(patent.get("publication_number") or "").strip()
            result_id = str(item.get("id") or "").strip()
            title = _clean_html(str(patent.get("title") or ""))
            snippet = _clean_html(str(patent.get("snippet") or patent.get("abstract") or ""))
            link = _google_patents_link(pub_number, result_id)
            if not (pub_number or title or link):
                continue
            hits.append(
                {
                    "source": "Google Patents",
                    "title": title,
                    "pub_number": pub_number,
                    "link": link,
                    "abstract": snippet,
                    "snippet": snippet,
                }
            )
            if len(hits) >= max_results:
                return hits
    return hits


def _google_patents_link(pub_number: str, result_id: str) -> str:
    if pub_number:
        return f"https://patents.google.com/patent/{pub_number}/zh"
    if result_id.startswith("patent/"):
        return f"https://patents.google.com/{result_id}"
    return ""


def _clean_html(value: str) -> str:
    value = re.sub(r"<[^>]+>", "", value)
    return html.unescape(re.sub(r"\s+", " ", value)).strip()


def _format_attempt_failures(attempts: list[dict[str, str]]) -> str:
    if not attempts:
        return "降级查新未返回可用结果。"
    parts = []
    for attempt in attempts[-8:]:
        source = attempt.get("source") or "unknown"
        term = attempt.get("term") or ""
        status = attempt.get("status") or "failed"
        message = attempt.get("message") or ""
        parts.append(f"{source}[{term}] {status}: {message}".strip())
    return "降级查新未返回可用结果：" + "；".join(parts)
