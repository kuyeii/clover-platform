from __future__ import annotations

import re
from typing import Any


HeadingStyle = str

PIPT_TOKEN = re.compile(r"@@PIPT:v1:e\d{6}:k[a-f0-9]{8}@@")

CHINESE_HEADING = re.compile(r"(?m)^[一二三四五六七八九十百]+、.*$")
ARTICLE_HEADING = re.compile(r"(?m)^第[一二三四五六七八九十百0-9]+条.*$")
ARABIC_HEADING = re.compile(r"(?m)^[0-9]+、.*$")



def detect_heading_style(text: str) -> HeadingStyle | None:
    chinese = list(CHINESE_HEADING.finditer(text))
    article = list(ARTICLE_HEADING.finditer(text))
    arabic = list(ARABIC_HEADING.finditer(text))

    if len(chinese) >= 3:
        return "chinese"
    if len(article) >= 3:
        return "article"
    if len(arabic) >= 3:
        return "arabic"
    return None



def get_heading_pattern(style: HeadingStyle | None) -> re.Pattern[str] | None:
    if style == "chinese":
        return CHINESE_HEADING
    if style == "article":
        return ARTICLE_HEADING
    if style == "arabic":
        return ARABIC_HEADING
    return None



def split_into_segments(text: str) -> dict[str, Any]:
    style = detect_heading_style(text)
    pattern = get_heading_pattern(style)

    if pattern is None:
        return {
            "heading_style": "fallback_fulltext",
            "segment_count": 1,
            "segments": [
                {
                    "segment_id": "segment_1",
                    "segment_title": "全文",
                    "segment_text": text.strip(),
                }
            ],
        }

    matches = list(pattern.finditer(text))
    segments: list[dict[str, str]] = []

    for idx, match in enumerate(matches):
        start = match.start()
        end = matches[idx + 1].start() if idx + 1 < len(matches) else len(text)
        segment_text = text[start:end].strip()
        title_line = match.group(0).strip()
        if segment_text:
            segments.append(
                {
                    "segment_id": f"segment_{len(segments) + 1}",
                    "segment_title": title_line,
                    "segment_text": segment_text,
                }
            )

    if not segments:
        segments = [
            {
                "segment_id": "segment_1",
                "segment_title": "全文",
                "segment_text": text.strip(),
            }
        ]
        style = "fallback_fulltext"

    return {
        "heading_style": style,
        "segment_count": len(segments),
        "segments": segments,
    }


def validate_pipt_token_boundaries(full_text: str, segments: list[dict[str, Any]]) -> dict[str, Any]:
    """
    校验合同分段没有切断 PIPT token。
    当前切分按标题边界执行，理论上不会切断 token；这里作为未来长度分片的防线。
    """
    tokens = PIPT_TOKEN.findall(str(full_text or ""))
    if not tokens:
        return {"valid": True, "token_count": 0, "broken_tokens": [], "fragment_segments": []}

    segment_texts = [str(segment.get("segment_text") or "") for segment in segments if isinstance(segment, dict)]
    broken_tokens: list[str] = []
    for token in sorted(set(tokens)):
        if not any(token in segment_text for segment_text in segment_texts):
            broken_tokens.append(token)

    fragment_segments: list[dict[str, Any]] = []
    for segment in segments:
        if not isinstance(segment, dict):
            continue
        segment_text = str(segment.get("segment_text") or "")
        search_from = 0
        while True:
            start = segment_text.find("@@PIPT", search_from)
            if start < 0:
                break
            end = segment_text.find("@@", start + 2)
            fragment = segment_text[start:] if end < 0 else segment_text[start : end + 2]
            if PIPT_TOKEN.fullmatch(fragment):
                search_from = end + 2
                continue
            fragment_segments.append(
                {
                    "segment_id": str(segment.get("segment_id") or ""),
                    "fragment": fragment[:80],
                }
            )
            break

    return {
        "valid": not broken_tokens and not fragment_segments,
        "token_count": len(set(tokens)),
        "broken_tokens": broken_tokens,
        "fragment_segments": fragment_segments,
    }
