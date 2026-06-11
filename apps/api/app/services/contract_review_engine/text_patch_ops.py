from __future__ import annotations

import re
from dataclasses import dataclass
from difflib import SequenceMatcher

_LOOSE_IGNORABLE_RE = re.compile(r"""[\s，。！？；：、“”‘’（）【】《》「」『』\[\]{}()<>.,!?;:'\"`~!@#$%^&*_\-+=|\\/]+""")
_MARKER_RE = re.compile(
    r"(^|[\s\r\n。！？；;：:])"
    r"("
    r"(?:\d{1,3}|[一二三四五六七八九十百千万零〇两]{1,8})[\.．、]"
    r"|[（(](?:\d{1,3}|[一二三四五六七八九十百千万零〇两]{1,8})[）)]"
    r"|[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]"
    r")"
    r"\s*"
)
_SENTENCE_BOUNDARY_RE = re.compile(r"[^。！？\n\r]+[。！？]?", re.MULTILINE)
_STRONG_BOUNDARY_CHARS = set("。！？；;\n\r")


@dataclass(frozen=True)
class _PatchUnit:
    kind: str
    key: str
    text: str
    start: int
    end: int
    order: int


def compact_text(text: str | None) -> str:
    return re.sub(r"\s+", "", str(text or ""))


def loose_compact_text(text: str | None) -> str:
    return _LOOSE_IGNORABLE_RE.sub("", str(text or "")).lower()


def _marker_key(marker: str) -> str:
    value = re.sub(r"\s+", "", str(marker or ""))
    value = value.strip(".．、()（）")
    return value


def _marker_is_plausible(text: str, marker_end: int) -> bool:
    """Avoid treating decimals/section numbers such as 4.1 as list items."""
    if marker_end < len(text) and text[marker_end].isdigit():
        return False
    return True


def _find_marker_matches(text: str) -> list[tuple[int, int, str]]:
    out: list[tuple[int, int, str]] = []
    for match in _MARKER_RE.finditer(text):
        marker = match.group(2)
        start = match.start(2)
        end = match.end(0)
        if not marker or not _marker_is_plausible(text, end):
            continue
        out.append((start, end, marker))
    return out


def _first_boundary_after(text: str, start: int, hard_limit: int | None = None) -> int:
    limit = len(text) if hard_limit is None else min(len(text), hard_limit)
    for idx in range(max(0, start), limit):
        if text[idx] in _STRONG_BOUNDARY_CHARS:
            return idx + 1
    return limit


def _list_units(text: str) -> tuple[list[_PatchUnit], list[tuple[int, int]]]:
    markers = _find_marker_matches(text)
    units: list[_PatchUnit] = []
    spans: list[tuple[int, int]] = []
    for order, (start, marker_end, marker) in enumerate(markers):
        next_start = markers[order + 1][0] if order + 1 < len(markers) else len(text)
        end = _first_boundary_after(text, marker_end, next_start)
        if end <= start:
            continue
        raw = text[start:end].strip()
        if not raw or len(compact_text(raw)) < 2:
            continue
        units.append(_PatchUnit("list", _marker_key(marker), raw, start, end, order))
        spans.append((start, end))
    return units, spans


def _mask_spans_with_newlines(text: str, spans: list[tuple[int, int]]) -> str:
    if not spans:
        return text
    parts: list[str] = []
    cursor = 0
    for start, end in sorted(spans):
        if start > cursor:
            parts.append(text[cursor:start])
        parts.append("\n")
        cursor = max(cursor, end)
    if cursor < len(text):
        parts.append(text[cursor:])
    return "".join(parts)


def _sentence_units(text: str, spans_to_ignore: list[tuple[int, int]], order_offset: int = 0) -> list[_PatchUnit]:
    remaining = _mask_spans_with_newlines(text, spans_to_ignore)
    units: list[_PatchUnit] = []
    order = order_offset
    # Split on newlines first, then on Chinese/legal sentence punctuation.
    for line in re.split(r"[\r\n]+", remaining):
        line = line.strip()
        if not line:
            continue
        for match in _SENTENCE_BOUNDARY_RE.finditer(line):
            raw = match.group(0).strip()
            if not raw or len(compact_text(raw)) < 4:
                continue
            units.append(_PatchUnit("sentence", "", raw, -1, -1, order))
            order += 1
    return units


def _structured_units(text: str) -> list[_PatchUnit]:
    value = str(text or "").strip()
    if not value:
        return []
    list_items, spans = _list_units(value)
    sentence_items = _sentence_units(value, spans, order_offset=len(list_items))
    return sorted([*list_items, *sentence_items], key=lambda u: (u.start if u.start >= 0 else 10**9, u.order))


def _same_compact(left: str, right: str) -> bool:
    return compact_text(left) == compact_text(right)


def _similarity(left: str, right: str) -> tuple[float, int, int]:
    l = loose_compact_text(left)
    r = loose_compact_text(right)
    if not l or not r:
        return 0.0, 0, 0
    matcher = SequenceMatcher(None, l, r, autojunk=False)
    blocks = [b for b in matcher.get_matching_blocks() if b.size]
    longest = max((b.size for b in blocks), default=0)
    matched = sum(b.size for b in blocks)
    return matcher.ratio(), longest, matched


def _can_pair_units(before: _PatchUnit, after: _PatchUnit) -> bool:
    if before.kind != after.kind:
        return False
    if before.kind == "list":
        return bool(before.key and before.key == after.key)

    before_loose = loose_compact_text(before.text)
    after_loose = loose_compact_text(after.text)
    if not before_loose or not after_loose:
        return False
    if before_loose in after_loose or after_loose in before_loose:
        return True
    ratio, longest, matched = _similarity(before.text, after.text)
    min_shared = max(6, min(len(before_loose), len(after_loose)) // 3)
    return (longest >= 6 and matched >= min_shared) or ratio >= 0.45


def _pair_sentence_units(before_units: list[_PatchUnit], after_units: list[_PatchUnit]) -> list[tuple[_PatchUnit, _PatchUnit]]:
    pairs: list[tuple[_PatchUnit, _PatchUnit]] = []
    used_after: set[int] = set()
    for before in before_units:
        best: tuple[float, int, int] | None = None
        best_idx: int | None = None
        for idx, after in enumerate(after_units):
            if idx in used_after or not _can_pair_units(before, after):
                continue
            ratio, longest, matched = _similarity(before.text, after.text)
            score = ratio * 1000 + longest * 10 + matched
            # Prefer keeping order when scores are close.
            score -= abs(before.order - after.order) * 0.01
            if best is None or score > best[0]:
                best = (score, longest, matched)
                best_idx = idx
        if best_idx is None:
            continue
        used_after.add(best_idx)
        pairs.append((before, after_units[best_idx]))
    return pairs


def build_structured_patch_ops(target_text: str | None, revised_text: str | None) -> list[dict[str, str]]:
    """Build paragraph/list-item sized text replacements for broad AI rewrites.

    AI rewrite workflows often return a whole clause as target/revised text even
    though the edit is actually a set of independent list-item or sentence-level
    changes. Frontend rendering and DOCX export both operate on paragraph-like
    blocks, so exporting the broad pair can either fail to locate the text or
    replace the wrong paragraph. This function derives stable local operations
    without relying on any risk label or contract-specific hard-coding.
    """
    target = str(target_text or "").strip()
    revised = str(revised_text or "").strip()
    if not target or not revised or target == revised:
        return []

    before_units = _structured_units(target)
    after_units = _structured_units(revised)
    if len(before_units) < 2 or len(after_units) < 2:
        return []

    before_lists = [u for u in before_units if u.kind == "list" and u.key]
    after_lists_by_key: dict[str, _PatchUnit] = {}
    for unit in after_units:
        if unit.kind == "list" and unit.key and unit.key not in after_lists_by_key:
            after_lists_by_key[unit.key] = unit

    raw_pairs: list[tuple[_PatchUnit, _PatchUnit]] = []
    for before in before_lists:
        after = after_lists_by_key.get(before.key)
        if after is not None:
            raw_pairs.append((before, after))

    before_sentences = [u for u in before_units if u.kind == "sentence"]
    after_sentences = [u for u in after_units if u.kind == "sentence"]
    raw_pairs.extend(_pair_sentence_units(before_sentences, after_sentences))

    raw_pairs.sort(key=lambda pair: pair[0].order)

    ops: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for before, after in raw_pairs:
        before_text = before.text.strip()
        after_text = after.text.strip()
        if not before_text or not after_text or _same_compact(before_text, after_text):
            continue
        before_key = compact_text(before_text)
        after_key = compact_text(after_text)
        key = (before_key, after_key)
        if key in seen:
            continue
        seen.add(key)
        ops.append({"before_text": before_text, "after_text": after_text})

    if len(ops) < 2:
        return []

    target_len = max(1, len(loose_compact_text(target)))
    changed_before_len = sum(len(loose_compact_text(op["before_text"])) for op in ops)
    # If these operations still cover nearly the entire clause, they are not
    # materially safer than the broad replacement.
    if changed_before_len >= int(target_len * 0.9):
        return []
    return ops
