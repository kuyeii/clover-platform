from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Mapping


@dataclass(frozen=True, slots=True)
class GlobalRedactionResult:
    """当前文档全局脱敏兜底结果。"""

    text: str
    replacement_count: int


def apply_current_document_global_redactions(
    *,
    source_text: str,
    redacted_text: str,
    mapping_table: Mapping[str, Any] | None,
    replacement_mode: str = "placeholder",
) -> GlobalRedactionResult:
    """
    使用当前任务已确认实体，对同一文档做最后一轮全局兜底替换。
    实体值按字面量正则匹配，避免括号、点号等字符被解释成正则语义。
    """
    text_value = str(redacted_text or "")
    if not text_value or not mapping_table:
        return GlobalRedactionResult(text=text_value, replacement_count=0)

    current_source = str(source_text or "")
    replacements: list[tuple[str, str]] = []
    seen_originals: set[str] = set()
    for token_value, original_value in mapping_table.items():
        token = str(token_value or "").strip()
        original = str(original_value or "").strip()
        if not token or not original:
            continue
        if original in seen_originals:
            continue
        if _is_unsafe_original(original=original, token=token):
            continue
        if original not in current_source or original not in text_value:
            continue
        replacement = token if replacement_mode == "placeholder" else "*" * len(original)
        replacements.append((original, replacement))
        seen_originals.add(original)

    replacements.sort(key=lambda item: len(item[0]), reverse=True)
    replacement_count = 0
    for original, replacement in replacements:
        text_value, count = re.subn(re.escape(original), lambda _match, value=replacement: value, text_value)
        replacement_count += count
    return GlobalRedactionResult(text=text_value, replacement_count=replacement_count)


def _is_unsafe_original(*, original: str, token: str) -> bool:
    if token == original:
        return True
    return (
        original.startswith("@@PIPT:")
        or original.startswith("{{__PIPT_")
        or original.startswith("{{__BIDDER_")
    )
