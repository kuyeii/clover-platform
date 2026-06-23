from __future__ import annotations

import asyncio
import json
import os
import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any, Mapping

from app.services.bid_outline_knowledge import retrieve_outline_knowledge
from app.services.bid_outline_llm import BidOutlineLlmClient
from app.services.bid_outline_prompts import build_generation_messages, build_review_messages
from app.services.bid_outline_service import (
    build_seeded_outline_sections,
    evaluate_outline_quality,
    extract_outline_sections_raw,
    normalize_outline_word_budget_dict,
    parse_structure_heading_seed_json,
)

EnsureRunning = Callable[[], None]
EmitEvent = Callable[[str, dict[str, Any]], None]


@dataclass
class NativeOutlineBatchResult:
    batch_index: int
    sections: list[dict[str, Any]]
    execution_trace: list[dict[str, Any]] = field(default_factory=list)


def native_outline_max_concurrency() -> int:
    try:
        return max(1, int(os.environ.get("BID_OUTLINE_NATIVE_MAX_CONCURRENCY", "2").strip()))
    except (TypeError, ValueError):
        return 2


async def generate_outline_batch_native(
    *,
    inputs: Mapping[str, Any],
    seed_headings: list[dict[str, Any]],
    expected_total_words: int,
    max_diagrams: int,
    batch_index: int,
    total_batches: int,
    use_knowledge: bool,
    ensure_running: EnsureRunning,
    emit_event: EmitEvent | None = None,
    llm_client: BidOutlineLlmClient | None = None,
) -> NativeOutlineBatchResult:
    """执行单批 native 大纲生成；入参为批次 inputs/种子，出参为归一化 sections。"""
    llm = llm_client or BidOutlineLlmClient()
    trace: list[dict[str, Any]] = []
    ensure_running()
    _emit(emit_event, "execution_trace", {"kind": "native_batch_generating", "batch_index": batch_index, "total_batches": total_batches})

    draft = await llm.chat_json(build_generation_messages(inputs), temperature=0.2)
    ensure_running()
    parsed_stage = normalize_outline_parse_stage(
        draft,
        requirements=str(inputs.get("requirements") or ""),
        structure_heading_seed_json=str(inputs.get("structure_heading_seed_json") or ""),
        technical_h2_bindings_json=str(inputs.get("technical_h2_bindings_json") or ""),
    )
    outline_json = str(parsed_stage.get("outline_json") or json.dumps({"outline": []}, ensure_ascii=False))
    keywords_for_search = str(parsed_stage.get("keywords_for_search") or "")
    trace.append({"kind": "native_parse_finished", "batch_index": batch_index, "keywords": keywords_for_search[:220]})
    _emit(emit_event, "execution_trace", trace[-1])

    knowledge_context = ""
    if use_knowledge and keywords_for_search.strip():
        _emit(emit_event, "execution_trace", {"kind": "native_knowledge_retrieving", "batch_index": batch_index})
        knowledge_context = await retrieve_outline_knowledge(keywords_for_search, top_k=2)
        ensure_running()

    _emit(emit_event, "execution_trace", {"kind": "native_batch_reviewing", "batch_index": batch_index})
    reviewed = await llm.chat_json(
        build_review_messages(inputs, outline_json=outline_json, knowledge_context=knowledge_context),
        temperature=0.15,
    )
    ensure_running()
    validated = normalize_outline_final_stage(
        reviewed,
        requirements=str(inputs.get("requirements") or ""),
        total_words=int(inputs.get("total_words") or inputs.get("expected_total_words") or expected_total_words or 0),
        structure_heading_seed_json=str(inputs.get("structure_heading_seed_json") or ""),
        technical_h2_bindings_json=str(inputs.get("technical_h2_bindings_json") or ""),
    )
    structured_output = str(validated.get("structured_output") or "{}")
    structured_data = _loads_json_object(structured_output) or {"outline": []}
    sections_raw = extract_outline_sections_raw(structured_data)
    sections = build_seeded_outline_sections(sections_raw, seed_headings, max_diagrams=max_diagrams)
    normalize_outline_word_budget_dict(sections, expected_total_words)
    quality_report = evaluate_outline_quality(sections, seed_headings)
    if not quality_report.get("pass"):
        raise RuntimeError(f"第 {batch_index}/{total_batches} 批 native 大纲结构质量校验失败：" + "; ".join(quality_report.get("issues") or []))
    trace.append({"kind": "native_batch_finished", "batch_index": batch_index, "total_batches": total_batches})
    _emit(emit_event, "execution_trace", trace[-1])
    return NativeOutlineBatchResult(batch_index=batch_index, sections=sections, execution_trace=trace)


async def run_outline_batches_native(
    *,
    batch_jobs: list[dict[str, Any]],
    expected_total_words: int,
    max_diagrams: int,
    use_knowledge: bool,
    ensure_running: EnsureRunning,
    on_batch_done: Callable[[int, list[dict[str, Any]]], Awaitable[None]] | None = None,
    emit_event: EmitEvent | None = None,
) -> list[dict[str, Any]]:
    """并发执行 native 大纲批次；入参为批次任务列表，出参按批次顺序合并 sections。"""
    semaphore = asyncio.Semaphore(native_outline_max_concurrency())
    llm_client = BidOutlineLlmClient()
    total_batches = len(batch_jobs)

    async def run_one(job: dict[str, Any]) -> NativeOutlineBatchResult:
        async with semaphore:
            ensure_running()
            return await generate_outline_batch_native(
                inputs=job["inputs"],
                seed_headings=job["seed_headings"],
                expected_total_words=expected_total_words,
                max_diagrams=max_diagrams,
                batch_index=int(job["batch_index"]),
                total_batches=total_batches,
                use_knowledge=use_knowledge,
                ensure_running=ensure_running,
                emit_event=emit_event,
                llm_client=llm_client,
            )

    tasks = [asyncio.create_task(run_one(job)) for job in batch_jobs]
    results: dict[int, list[dict[str, Any]]] = {}
    try:
        for done in asyncio.as_completed(tasks):
            ensure_running()
            result = await done
            results[result.batch_index] = result.sections
            if on_batch_done is not None:
                await on_batch_done(result.batch_index, result.sections)
    except asyncio.CancelledError:
        for task in tasks:
            if not task.done():
                task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        raise
    except Exception:
        for task in tasks:
            if not task.done():
                task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        raise

    return [section for index in range(1, total_batches + 1) for section in (results.get(index) or [])]


def normalize_outline_parse_stage(
    structured_output: dict[str, Any],
    *,
    requirements: str,
    structure_heading_seed_json: str,
    technical_h2_bindings_json: str,
) -> dict[str, Any]:
    """固化 DSL 的 JSON解析1 节点；入参为初稿，出参为 outline_json 与检索关键词。"""
    data = structured_output if isinstance(structured_output, dict) else {}
    outline = data.get("outline") if isinstance(data.get("outline"), list) else []
    seed_titles = (
        _extract_seed_titles_from_json(technical_h2_bindings_json)
        or _extract_seed_titles_from_json(structure_heading_seed_json)
        or _extract_seed_titles_from_requirements(requirements)
    )
    normalized_outline = _normalize_to_seed_outline(outline, seed_titles, strict_critical=False)
    data["outline"] = normalized_outline if seed_titles else outline

    tokens: list[str] = []
    normalized_sections = data.get("outline") if isinstance(data.get("outline"), list) else []
    for section in normalized_sections:
        if not isinstance(section, dict):
            continue
        tokens.extend(_clean_keywords(section.get("keywords"), str(section.get("title") or "")))
        tokens.append(str(section.get("title") or "").strip())
        for child in _ensure_list(section.get("children")):
            if isinstance(child, dict):
                tokens.extend(_clean_keywords(child.get("keywords"), str(child.get("title") or "")))
                tokens.append(str(child.get("title") or "").strip())
    compact = list(dict.fromkeys(token for token in (str(item or "").strip() for item in tokens) if token))
    return {"outline_json": json.dumps(data, ensure_ascii=False), "keywords_for_search": " ".join(compact[:18])}


def normalize_outline_final_stage(
    structured_output: dict[str, Any],
    *,
    requirements: str,
    total_words: int,
    structure_heading_seed_json: str,
    technical_h2_bindings_json: str,
) -> dict[str, Any]:
    """固化 DSL 的最终校验节点；入参为润色稿，出参为结构化 JSON 字符串和校验信息。"""
    raw_data = structured_output if isinstance(structured_output, dict) else {}
    outline = raw_data.get("outline") if isinstance(raw_data.get("outline"), list) else []
    if not outline and bool(raw_data.get("title")) and (isinstance(raw_data.get("children"), list) or raw_data.get("headingLevel") in (2, 3)):
        outline = [raw_data]
    seed_titles = (
        _extract_seed_titles_from_json(technical_h2_bindings_json)
        or _extract_seed_titles_from_json(structure_heading_seed_json)
        or _extract_seed_titles_from_requirements(requirements)
    )
    if not seed_titles:
        seed_titles = [str(item.get("title") or "").strip() for item in outline if isinstance(item, dict) and str(item.get("title") or "").strip()]
    normalized = _normalize_to_seed_outline(outline, seed_titles, strict_critical=True)
    total_children = sum(len(_ensure_list(item.get("children"))) for item in normalized)
    fallback_generated_count = sum(
        1
        for item in normalized
        for child in _ensure_list(item.get("children"))
        if isinstance(child, dict) and child.get("fallbackGenerated")
    )
    critical_section_failures = [
        str(item.get("title") or "")
        for item in normalized
        if _is_critical_h2(str(item.get("title") or "")) and not _is_self_generated_h2(str(item.get("title") or "")) and not _ensure_list(item.get("children"))
    ]
    total_allocated = sum(int(item.get("wordCount") or 0) for item in normalized)
    target = int(total_words or 0)
    validation_pass = True if target <= 0 else (0.85 <= (total_allocated / max(target, 1)) <= 1.15)
    clean_data = {
        "outline": normalized,
        "qualityMeta": {
            "fallbackGeneratedCount": int(fallback_generated_count),
            "fallbackRatio": float(fallback_generated_count / max(total_children, 1)),
            "criticalSectionFailures": critical_section_failures,
        },
    }
    return {
        "structured_output": json.dumps(clean_data, ensure_ascii=False),
        "total_allocated": total_allocated,
        "validation_pass": validation_pass,
    }


def _normalize_to_seed_outline(outline: list[Any], seed_titles: list[str], *, strict_critical: bool) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    used_indexes: set[int] = set()
    source_outline = outline if isinstance(outline, list) else []
    for idx, seed_title in enumerate(seed_titles):
        seed_key = _normalize_title(seed_title)
        raw: dict[str, Any] = {}
        raw_idx: int | None = None
        for cand_idx, cand in enumerate(source_outline):
            if cand_idx in used_indexes or not isinstance(cand, dict):
                continue
            if _normalize_title(str(cand.get("title") or "")) == seed_key:
                raw = cand
                raw_idx = cand_idx
                break
        if raw_idx is None and idx < len(source_outline) and isinstance(source_outline[idx], dict):
            raw = source_outline[idx]
            raw_idx = idx
        if raw_idx is not None:
            used_indexes.add(raw_idx)

        children = [] if _is_self_generated_h2(seed_title) else _normalize_children(_ensure_list(raw.get("children"))[:3], idx)
        if not children:
            if _is_self_generated_h2(seed_title):
                children = []
            elif strict_critical and _is_critical_h2(seed_title):
                children = []
            elif strict_critical:
                fallback_title = _default_child_title(seed_title)
                children = [_fallback_child(idx, fallback_title, raw)]

        normalized.append(
            {
                "id": str(raw.get("id") or f"tech_heading_{idx + 1}"),
                "title": seed_title,
                "headingLevel": 2,
                "wordCount": int(raw.get("wordCount") or max(1200, sum(int(child.get("wordCount") or 0) for child in children), 400 * max(len(children), 1))),
                "keywords": _clean_keywords(raw.get("keywords"), seed_title),
                "writingHint": str(raw.get("writingHint") or "").strip(),
                "relatedAnalysisIds": _ensure_list(raw.get("relatedAnalysisIds"))[:4],
                "needDiagram": bool(raw.get("needDiagram") or False) and not children,
                "diagramBrief": str(raw.get("diagramBrief") or "").strip() if not children else "",
                "diagramPlan": raw.get("diagramPlan") if isinstance(raw.get("diagramPlan"), dict) and not children else {"enabled": False, "brief": "", "typeHint": "logic", "priority": 0},
                "generationStrategy": "response_special" if _is_self_generated_h2(seed_title) else "general",
                "generatesFromSelf": _is_self_generated_h2(seed_title),
                "children": children,
            }
        )
    return normalized


def _normalize_children(raw_children: list[Any], section_index: int) -> list[dict[str, Any]]:
    children: list[dict[str, Any]] = []
    for child_idx, child in enumerate(raw_children, start=1):
        if not isinstance(child, dict):
            continue
        title = str(child.get("title") or "").strip()
        if not title:
            continue
        children.append(
            {
                "id": str(child.get("id") or f"sec_{section_index + 1}_{child_idx}"),
                "title": title,
                "headingLevel": 3,
                "wordCount": int(child.get("wordCount") or 300),
                "keywords": _clean_keywords(child.get("keywords"), title),
                "writingHint": str(child.get("writingHint") or "").strip(),
                "relatedAnalysisIds": _ensure_list(child.get("relatedAnalysisIds"))[:4],
                "needDiagram": bool(child.get("needDiagram") or False),
                "diagramBrief": str(child.get("diagramBrief") or "").strip(),
                "diagramPlan": child.get("diagramPlan") if isinstance(child.get("diagramPlan"), dict) else {"enabled": False, "brief": "", "typeHint": "logic", "priority": 0},
            }
        )
    return children


def _fallback_child(section_index: int, title: str, raw: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "id": f"sec_{section_index + 1}_1",
        "title": title,
        "headingLevel": 3,
        "wordCount": 300,
        "keywords": _clean_keywords([], title),
        "writingHint": str(raw.get("writingHint") or "").strip(),
        "relatedAnalysisIds": _ensure_list(raw.get("relatedAnalysisIds"))[:4],
        "needDiagram": False,
        "diagramBrief": "",
        "diagramPlan": {"enabled": False, "brief": "", "typeHint": "logic", "priority": 0},
        "fallbackGenerated": True,
    }


def _extract_seed_titles_from_requirements(requirements_text: str) -> list[str]:
    match = re.search(r"【固定技术部分二级标题（强制）】\s*(.*?)(?:\n\n【|\Z)", str(requirements_text or ""), flags=re.DOTALL)
    block = match.group(1) if match else ""
    titles: list[str] = []
    for line in block.splitlines():
        title_match = re.match(r"^\d+\.\s*(.+?)\s*$", line.strip())
        if title_match:
            titles.append(title_match.group(1).strip())
    return titles


def _extract_seed_titles_from_json(raw: str) -> list[str]:
    return [str(item.get("title") or "").strip() for item in parse_structure_heading_seed_json(str(raw or "")) if str(item.get("title") or "").strip()]


def _normalize_title(value: str) -> str:
    return re.sub(r"\s+", "", str(value or "")).lower()


def _ensure_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _clean_keywords(values: Any, title: str) -> list[str]:
    items: list[str] = []
    for item in _ensure_list(values):
        text = str(item or "").strip()
        if text and text not in {"项目", "方案", "系统", "报告"} and text not in items:
            items.append(text)
    if not items:
        core = re.sub(r"^[一二三四五六七八九十0-9\.、\-\s]+", "", str(title or "")).strip()
        if core:
            items.append(core[:16])
    return items[:4]


def _default_child_title(parent_title: str) -> str:
    core = re.sub(r"^[一二三四五六七八九十0-9\.、\-\s]+", "", str(parent_title or "")).strip()
    return f"{core}实施要点" if core else "实施要点"


def _is_critical_h2(title: str) -> bool:
    return str(title or "").strip() in {"售后服务方案", "响应情况", "项目实施目标"}


def _is_self_generated_h2(title: str) -> bool:
    return str(title or "").strip() == "响应情况"


def _loads_json_object(raw: str) -> dict[str, Any] | None:
    try:
        parsed = json.loads(str(raw or "{}"))
    except Exception:
        return None
    return parsed if isinstance(parsed, dict) else None


def _emit(emit_event: EmitEvent | None, event: str, payload: dict[str, Any]) -> None:
    if emit_event is not None:
        emit_event(event, payload)
