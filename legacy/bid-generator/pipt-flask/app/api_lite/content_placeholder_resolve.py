"""正文输出侧 PIPT/BIDDER 占位符解析：扫描 + EntityRegistry / mapping_table 替换。"""
from __future__ import annotations

import re
import logging
from typing import Any

logger = logging.getLogger(__name__)

_PLACEHOLDER_RE = re.compile(r"\{\{__(?:PIPT_[a-z_]+_\d+|BIDDER_[A-Z_]+)__\}\}")
_ILLEGAL_PIPT_RE = re.compile(r"\{\{\s*PIPT_(\d+)\s*\}\}", re.IGNORECASE)
_ILLEGAL_BIDDER_RE = re.compile(r"\{\{\s*BIDDER_([A-Z_]+)\s*\}\}")
_MALFORMED_PIPT_RE = re.compile(
    r"\{\{\s*_*PIPT(?:[_\s-]+([a-z_]+))?[_\s-]+(\d+)_*\s*\}\}",
    re.IGNORECASE,
)
_SUSPECT_PLACEHOLDER_RE = re.compile(
    r"\{\{[^{}]*(?:PIPT|BIDDER)[^{}]*\}\}|(?<!\{)\{[^{}]*(?:PIPT|BIDDER)[^{}]*\}(?!\})",
    re.IGNORECASE,
)


def _normalize_original_text(value: Any) -> str:
    """
    规整映射值，避免注入多余空白/异常 markdown 包裹：
    - 去前后空白
    - 去掉整段 **...** 包裹
    - 将连续空白折叠为单空格
    """
    s = str(value or "").strip()
    if s.startswith("**") and s.endswith("**") and len(s) > 4:
        s = s[2:-2].strip()
    s = re.sub(r"[ \t\r\f\v]+", " ", s)
    return s.strip()


def find_pipt_bidder_placeholders(text: str) -> set[str]:
    if not text:
        return set()
    return set(_PLACEHOLDER_RE.findall(text))


def find_illegal_pipt_bidder_placeholders(text: str) -> set[str]:
    if not text:
        return set()
    illegal = set()
    for match in _SUSPECT_PLACEHOLDER_RE.finditer(text):
        token = match.group(0)
        if not _PLACEHOLDER_RE.fullmatch(token):
            illegal.add(token)
    return illegal


def _enrich_replace_map(
    found: set[str],
    replace_map: dict[str, str],
    request_mapping: dict[str, Any],
    db_session: Any = None,
) -> None:
    """根据正文里出现的占位符扩展 replace_map（查 DB + 回退 request_mapping）。"""
    from app.api_lite.database import EntityRegistry, FernetEncryptor, SessionLocal

    pipt_missing = [p for p in found if p.startswith("{{__PIPT_") and p not in replace_map]
    if pipt_missing:
        owns_session = db_session is None
        db = db_session or SessionLocal()
        try:
            enc = FernetEncryptor.get()
            rows = db.query(EntityRegistry).filter(EntityRegistry.placeholder.in_(pipt_missing)).all()
            for row in rows:
                replace_map[row.placeholder] = _normalize_original_text(enc.decrypt(row.original_text_enc))
        finally:
            if owns_session:
                db.close()

    if isinstance(request_mapping, dict):
        for ph in found:
            if ph not in replace_map and ph in request_mapping:
                replace_map[ph] = _normalize_original_text(request_mapping[ph])


def _normalize_placeholder_key(value: str) -> str:
    return re.sub(r"[^A-Z0-9_]+", "", str(value or "").strip().upper())


def _build_request_mapping_index(request_mapping: dict[str, Any]) -> dict[str, str]:
    if not isinstance(request_mapping, dict):
        return {}
    indexed: dict[str, str] = {}
    for placeholder, original in request_mapping.items():
        normalized = _normalize_placeholder_key(placeholder)
        if normalized and normalized not in indexed:
            indexed[normalized] = _normalize_original_text(original)
    return indexed


def _build_request_mapping_suffix_index(request_mapping: dict[str, Any]) -> tuple[dict[str, str], dict[str, str], dict[str, str], set[str]]:
    pipt_index_candidates: dict[str, set[str]] = {}
    pipt_by_type_index: dict[str, str] = {}
    bidder_by_key: dict[str, str] = {}
    if not isinstance(request_mapping, dict):
        return {}, pipt_by_type_index, bidder_by_key, set()
    for placeholder, original in request_mapping.items():
        key = str(placeholder or "").strip()
        normalized = _normalize_original_text(original)
        pipt_match = re.search(r"\{\{__PIPT_([a-z_]+)_(\d+)__\}\}", key, flags=re.IGNORECASE)
        if pipt_match:
            entity_type = pipt_match.group(1).lower()
            idx = pipt_match.group(2)
            pipt_by_type_index.setdefault(f"{entity_type}:{idx}", normalized)
            pipt_index_candidates.setdefault(idx, set()).add(normalized)
            continue
        bidder_match = re.search(r"\{\{__BIDDER_([A-Z_]+)__\}\}", key)
        if bidder_match and bidder_match.group(1) not in bidder_by_key:
            bidder_by_key[bidder_match.group(1)] = normalized
    unique_by_index = {
        idx: next(iter(values))
        for idx, values in pipt_index_candidates.items()
        if len(values) == 1
    }
    ambiguous_indexes = {
        idx for idx, values in pipt_index_candidates.items()
        if len(values) > 1
    }
    return unique_by_index, pipt_by_type_index, bidder_by_key, ambiguous_indexes


def _audit_resolve_event(
    db_session: Any,
    *,
    status: str,
    source: str,
    token: str,
    original: str = "",
    text: str = "",
    details: dict[str, Any] | None = None,
) -> None:
    if db_session is None:
        return
    try:
        from app.api_lite.database import add_pipt_audit_log
        add_pipt_audit_log(
            db_session,
            operation="resolve",
            status=status,
            source=source,
            placeholder=token,
            original_text=original,
            text=text,
            details=details or {},
        )
    except Exception as exc:
        logger.warning("PIPT resolve 审计日志写入失败: %s", exc)


def _resolve_illegal_placeholders(
    text: str,
    request_mapping: dict[str, Any],
    *,
    db_session: Any = None,
    audit_source: str = "content_placeholder_resolve",
) -> tuple[str, list[dict[str, str]]]:
    if not text:
        return "", []

    indexed_mapping = _build_request_mapping_index(request_mapping)
    pipt_by_index, pipt_by_type_index, bidder_by_key, ambiguous_indexes = _build_request_mapping_suffix_index(request_mapping)
    report: list[dict[str, str]] = []

    def _replace_illegal_pipt(match: re.Match[str]) -> str:
        token = match.group(0)
        idx = match.group(1)
        if idx in ambiguous_indexes:
            _audit_resolve_event(
                db_session,
                status="ambiguous",
                source=audit_source,
                token=token,
                text=text,
                details={"reason": "pipt_index_without_type", "index": idx},
            )
            return token
        original = pipt_by_index.get(idx, "")
        if original:
            report.append({"placeholder": token, "original": original, "status": "success"})
            _audit_resolve_event(
                db_session,
                status="success",
                source=audit_source,
                token=token,
                original=original,
                text=text,
                details={"strategy": "unique_index", "index": idx},
            )
            return original
        _audit_resolve_event(
            db_session,
            status="miss",
            source=audit_source,
            token=token,
            text=text,
            details={"reason": "index_not_found", "index": idx},
        )
        return token

    def _replace_malformed_pipt(match: re.Match[str]) -> str:
        token = match.group(0)
        if _PLACEHOLDER_RE.fullmatch(token):
            return token
        entity_type = str(match.group(1) or "").lower()
        idx = match.group(2)
        original = pipt_by_type_index.get(f"{entity_type}:{idx}", "") if entity_type else ""
        strategy = "type_index" if original else "unique_index"
        if not original and not entity_type and idx in ambiguous_indexes:
            _audit_resolve_event(
                db_session,
                status="ambiguous",
                source=audit_source,
                token=token,
                text=text,
                details={"reason": "malformed_pipt_index_without_type", "index": idx},
            )
            return token
        original = original or pipt_by_index.get(idx, "")
        if original:
            report.append({"placeholder": token, "original": original, "status": "success"})
            _audit_resolve_event(
                db_session,
                status="success",
                source=audit_source,
                token=token,
                original=original,
                text=text,
                details={"strategy": strategy, "entity_type": entity_type, "index": idx},
            )
            return original
        _audit_resolve_event(
            db_session,
            status="miss",
            source=audit_source,
            token=token,
            text=text,
            details={"reason": "malformed_pipt_not_found", "entity_type": entity_type, "index": idx},
        )
        return token

    def _replace_illegal_bidder(match: re.Match[str]) -> str:
        token = match.group(0)
        suffix = match.group(1)
        normalized = _normalize_placeholder_key(f"{{{{__BIDDER_{suffix}__}}}}")
        original = bidder_by_key.get(suffix, indexed_mapping.get(normalized, ""))
        if original:
            report.append({"placeholder": token, "original": original, "status": "success"})
            _audit_resolve_event(
                db_session,
                status="success",
                source=audit_source,
                token=token,
                original=original,
                text=text,
                details={"strategy": "bidder_key", "suffix": suffix},
            )
            return original
        _audit_resolve_event(
            db_session,
            status="miss",
            source=audit_source,
            token=token,
            text=text,
            details={"reason": "bidder_key_not_found", "suffix": suffix},
        )
        return token

    out = _MALFORMED_PIPT_RE.sub(_replace_malformed_pipt, text)
    out = _ILLEGAL_PIPT_RE.sub(_replace_illegal_pipt, out)
    out = _ILLEGAL_BIDDER_RE.sub(_replace_illegal_bidder, out)
    out = re.sub(r"[ \t]{2,}", " ", out)
    out = re.sub(r"\n{3,}", "\n\n", out).strip()
    return out, report


def apply_replace_map_to_text(text: str, replace_map: dict[str, str]) -> str:
    if not text or not replace_map:
        return text or ""
    out = text
    for ph, orig in replace_map.items():
        if ph in out:
            out = out.replace(ph, orig)
    return out


def resolve_body_placeholders(
    text: str,
    seed_replace_map: dict[str, str],
    request_mapping: dict[str, Any],
    *,
    db_session: Any = None,
    audit_source: str = "content_placeholder_resolve",
) -> tuple[str, dict[str, str], list[dict[str, str]]]:
    """
    对模型输出或合并后的正文做占位符替换。
    seed_replace_map：入参侧已解析的 placeholder -> original。
    返回 (替换后正文, 合并后的映射, replace_report 列表)。
    """
    merged: dict[str, str] = dict(seed_replace_map)
    found = find_pipt_bidder_placeholders(text)
    if found:
        _enrich_replace_map(found, merged, request_mapping, db_session=db_session)
    out = apply_replace_map_to_text(text, merged)
    for ph, orig in merged.items():
        if ph in text:
            _audit_resolve_event(
                db_session,
                status="success",
                source=audit_source,
                token=ph,
                original=orig,
                text=text,
                details={"strategy": "exact_placeholder"},
            )
    out, illegal_report = _resolve_illegal_placeholders(
        out,
        request_mapping,
        db_session=db_session,
        audit_source=audit_source,
    )
    report = [{"placeholder": ph, "original": orig, "status": "success"} for ph, orig in merged.items()]
    if illegal_report:
        report.extend(illegal_report)
    return out, merged, report
