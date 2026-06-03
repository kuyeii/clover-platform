from __future__ import annotations

import json
import re
from typing import Any


def parse_dify_outputs(dify_res: dict[str, Any]) -> dict[str, Any]:
    outputs = dify_res.get("data", {}).get("outputs", {})
    raw = outputs.get("structured_output") or outputs.get("result") or outputs.get("text") or outputs
    if isinstance(raw, list):
        return {"outline": raw}
    if isinstance(raw, str):
        cleaned = _extract_fenced_json(raw.strip())
        parsed = _safe_json_loads(cleaned)
        if parsed is None:
            parsed_dict = None
            parsed_list = None
            fallback_dict = None
            for candidate in _extract_balanced_candidates(cleaned):
                obj = _safe_json_loads(candidate)
                if isinstance(obj, dict):
                    if any(key in obj for key in ("outline", "sections", "items", "data")):
                        parsed_dict = obj
                        break
                    if fallback_dict is None:
                        fallback_dict = obj
                elif isinstance(obj, list) and parsed_list is None:
                    parsed_list = obj
            parsed = parsed_dict if parsed_dict is not None else (parsed_list if parsed_list is not None else (fallback_dict or {}))
        raw = parsed
    if isinstance(raw, list):
        return {"outline": raw}
    return raw if isinstance(raw, dict) else {}


def build_outline_generation_bundle(
    requirements: list[dict],
    analysis_context: str,
    expected_total_words: int,
    scoring_details_json: str,
    structure_heading_seed_json: str,
    technical_h2_bindings_json: str = "",
    technical_targets_json: str = "",
) -> dict[str, Any]:
    def clip_line(text: str, limit: int = 160) -> str:
        raw = re.sub(r"\s+", " ", str(text or "").strip())
        if len(raw) <= limit:
            return raw
        return raw[:limit].rstrip() + "..."

    def summarize_analysis_context(raw: str, focus_terms: list[str]) -> str:
        text = str(raw or "").strip()
        if not text:
            return ""
        lines = [line.strip() for line in text.splitlines() if line.strip()]
        focus = [line for line in lines if focus_terms and any(term and term in line for term in focus_terms)]
        priority = [line for line in lines if any(keyword in line for keyword in ["评分", "分值", "评审", "废标", "技术要求", "参数", "实质性", "目标", "响应", "交付", "验收"])]
        selected: list[str] = []
        for group in (focus, priority, lines):
            for line in group:
                if line not in selected:
                    selected.append(line)
                if len(selected) >= 70:
                    break
            if len(selected) >= 70:
                break
        merged = "\n".join(clip_line(line, 180) for line in selected)
        return merged[:2800]

    def build_outline_review_issues(expected_words: int, scoring_summary_text: str, heading_seeds: list[dict]) -> str:
        issues: list[str] = []
        if expected_words > 0:
            issues.append(f"总字数约束：章节总字数应尽量接近 {expected_words} 字，避免明显超配或欠配。")
        if scoring_summary_text.strip():
            issues.append("评分覆盖：高分值评分项必须在对应章节标题或写作引导提示词中可追溯。")
        if heading_seeds:
            first = "、".join(str(item.get("title") or "").strip() for item in heading_seeds[:8] if str(item.get("title") or "").strip())
            if first:
                issues.append(f"固定H2顺序：{first}。禁止新增、删除、重排二级标题。")
            if any(bool(item.get("response_candidate")) for item in heading_seeds):
                issues.append("响应类章节需后置到“项目实施目标”前；“项目实施目标”保持最后；响应情况为单章直生，不生成H3。")
        issues.append("关键词约束：剔除“项目/方案/系统”等泛词，保留实体技术关键词。")
        return "\n".join(f"- {issue}" for issue in issues)

    bindings_headings = parse_structure_heading_seed_json(technical_h2_bindings_json)
    seed_headings = bindings_headings or parse_structure_heading_seed_json(structure_heading_seed_json)
    focus_terms = collect_outline_focus_terms(seed_headings)

    scored_req_lines: list[tuple[int, str]] = []
    for index, item in enumerate(requirements):
        if index >= 120:
            break
        req_type = item.get("type", "tech")
        content = str(item.get("content", "") or "")
        if req_type == "biz":
            if any(keyword in content for keyword in ["复印件", "原件", "证书", "截图", "授权书", "承诺书", "扫描件"]):
                continue
            prefix = "[商务]"
        else:
            prefix = {"tech": "[技术]", "score": "[评分]"}.get(req_type, "[其他]")
        points = f"（{item.get('points')} 分）" if item.get("points") else ""
        line = f"{prefix} {clip_line(content, 180)}{points}"
        score = 0
        if focus_terms and any(term and term in content for term in focus_terms):
            score += 3
        if req_type == "score":
            score += 2
        if req_type == "tech":
            score += 1
        scored_req_lines.append((score, line))

    if any(score > 0 for score, _ in scored_req_lines):
        req_lines = [line for _, line in sorted(scored_req_lines, key=lambda item: item[0], reverse=True)[:80]]
    else:
        req_lines = [line for _, line in scored_req_lines[:80]]
    requirements_text = "\n".join(req_lines)

    scoring_summary = ""
    weight_prompt = ""
    if scoring_details_json and scoring_details_json.strip():
        scoring_data = _safe_json_loads(scoring_details_json)
        items = []
        total = 0
        if isinstance(scoring_data, dict):
            items = scoring_data.get("items", []) or []
            total = scoring_data.get("total", 0) or 0
        elif isinstance(scoring_data, list):
            items = scoring_data
        tech_items = []
        for item in items:
            if not isinstance(item, dict):
                continue
            score_tag = str(item.get("score_tag") or item.get("scoreTag") or "").strip().lower()
            if score_tag in {"tech", "mixed", ""}:
                tech_items.append(item)
        if tech_items:
            scoring_summary = f"技术相关评分总览（总分 {total}）\n" + "\n".join(
                f"- {item.get('name', '')}：{item.get('max_score', 0)}分"
                for item in tech_items
            )
            if expected_total_words > 0:
                weight_prompt = (
                    f"\n\n【字数分配要求】：预期总字数为 {expected_total_words} 字。"
                    "请结合技术评分项权重，为每个二级标题及其三级标题分配合理的字数预算。"
                )

    if not scoring_summary and analysis_context:
        scoring_lines = [line for line in analysis_context.split("\n") if any(keyword in line for keyword in ["评分", "分值", "评审", "扣分", "加分", "满分"])]
        scoring_summary = "\n".join(scoring_lines)[:2000]
        if scoring_summary and expected_total_words > 0:
            weight_prompt = (
                f"\n\n【字数分配要求】：预期总字数为 {expected_total_words} 字。"
                "请根据技术评分项的重要程度，给高权重部分分配更多字数。"
            )

    analysis_prefix = ""
    analysis_context_compact = summarize_analysis_context(analysis_context, focus_terms)
    if analysis_context_compact:
        analysis_prefix = "## 【招标文件解析上下文（优先级最高）】\n\n" + analysis_context_compact + "\n\n---\n\n"

    enable_response_branch = any(bool(item.get("response_candidate")) for item in seed_headings)
    heading_prompt = ""
    if seed_headings:
        heading_lines = "\n".join(f"{idx + 1}. {item['title']}" for idx, item in enumerate(seed_headings))
        response_hint = (
            "检测到“响应情况”类评分项，请将该类章节放在靠后位置，但必须排在“项目实施目标”之前；"
            "该章节为单章直生章节，必须保留该 H2，但禁止为它生成任何 H3 children；"
            "请直接为该 H2 产出完整 writingHint、keywords、relatedAnalysisIds 与字数预算。"
            if enable_response_branch
            else "未检测到“响应情况”类评分项，禁止额外创建“响应情况”章节。"
        )
        heading_prompt = (
            "\n\n【固定技术部分二级标题（强制）】\n"
            "以下标题由系统根据解析报告与评分细则生成，必须原样保留、顺序不得变更，"
            "不得新增、删除、合并或改写二级标题：\n"
            f"{heading_lines}\n"
            "你只能为普通二级标题生成三级标题 children。"
            "输出结构中顶层节点必须是这些二级标题，headingLevel=2；"
            "普通章节的 children 必须是三级标题，headingLevel=3。"
            "如果存在“项目实施目标”，请优先围绕项目技术目标、实施路径、交付目标和验收目标来补全三级标题。"
            + response_hint
        )

    decoupling_prompt = "【越界限制】：你当前只生成技术方案结构，禁止输出法定代表人授权书、营业执照、承诺函等商务附件标题。"
    full_requirements = analysis_prefix + requirements_text + "\n\n" + decoupling_prompt + heading_prompt + weight_prompt
    outline_review_issues = build_outline_review_issues(expected_total_words, scoring_summary[:3000], seed_headings)

    return {
        "seed_headings": seed_headings,
        "inputs": {
            "requirements": full_requirements,
            "bid_type": "tech",
            "use_knowledge": "true",
            "expected_total_words": expected_total_words if expected_total_words > 0 else 0,
            "total_words": expected_total_words if expected_total_words > 0 else 0,
            "scoring_summary": scoring_summary[:3000],
            "outline_review_issues": outline_review_issues,
            "structure_heading_seed": heading_prompt.strip(),
            "structure_heading_seed_json": structure_heading_seed_json or "",
            "technical_h2_bindings_json": technical_h2_bindings_json or "",
            "technical_targets_json": technical_targets_json or "",
            "enable_response_branch": "true" if enable_response_branch else "false",
        },
    }


def extract_outline_sections_raw(structured_data: dict[str, Any] | list[Any]) -> list[Any]:
    if isinstance(structured_data, list):
        return structured_data
    if not isinstance(structured_data, dict):
        return []
    primary = structured_data.get("outline") or structured_data.get("sections") or structured_data.get("items") or structured_data.get("data")
    if isinstance(primary, list):
        return primary
    if isinstance(primary, dict):
        nested = primary.get("outline") or primary.get("sections") or primary.get("items") or primary.get("data")
        if isinstance(nested, list):
            return nested
        if isinstance(nested, dict):
            return [nested]
        return [primary]
    if structured_data.get("title") and (structured_data.get("children") or structured_data.get("subSections") or structured_data.get("subsections")):
        return [structured_data]
    return []


def build_seeded_outline_sections(sections_raw: list[Any], seed_headings: list[dict], max_diagrams: int = 0) -> list[dict]:
    normalized_raw = sections_raw if isinstance(sections_raw, list) else []
    if not seed_headings:
        sections: list[dict] = []
        for index, section in enumerate(normalized_raw):
            if isinstance(section, str):
                sections.append(
                    {
                        "id": f"s{index + 1}",
                        "title": section,
                        "wordCount": 1500,
                        "writingHint": "",
                        "keywords": [],
                        "headingLevel": 2,
                        "children": [],
                    }
                )
                continue
            if not isinstance(section, dict) or not section.get("title"):
                continue
            children = _normalize_outline_h3_children(
                section.get("children", section.get("subsections", section.get("subSections", section.get("sections", [])))),
                str(section.get("id", f"s{index + 1}")),
            )
            sections.append(
                {
                    "id": str(section.get("id", f"s{index + 1}")),
                    "title": str(section.get("title", "")),
                    "wordCount": int(section.get("wordCount", section.get("word_count", 1500))),
                    "writingHint": str(section.get("writingHint", section.get("writing_hint", ""))),
                    "keywords": section.get("keywords", []),
                    "relatedAnalysisIds": section.get("relatedAnalysisIds", section.get("related_analysis_ids", [])),
                    "needDiagram": bool(section.get("needDiagram", section.get("need_diagram", False))),
                    "diagramBrief": str(section.get("diagramBrief", section.get("diagram_brief", ""))),
                    "diagramPlan": section.get("diagramPlan", section.get("diagram_plan", {})),
                    "headingLevel": int(section.get("headingLevel", section.get("heading_level", 2)) or 2),
                    "generationStrategy": str(section.get("generationStrategy", section.get("generation_strategy", "general")) or "general"),
                    "generatesFromSelf": bool(
                        section.get("generatesFromSelf")
                        or section.get("generates_from_self")
                        or (
                            str(section.get("generationStrategy", section.get("generation_strategy", "general")) or "general").strip()
                            == "response_special"
                            and not children
                        )
                    ),
                    "children": children,
                }
            )
        sections = _enhance_outline_writing_hints(sections, [])
        return _normalize_outline_diagram_flags(sections, max_diagrams=max_diagrams, enable_diagrams=max_diagrams != 0)

    used_indexes: set[int] = set()
    sections: list[dict] = []
    for idx, seed in enumerate(seed_headings):
        matched_idx = None
        matched: dict[str, Any] | None = None
        seed_key = _normalize_heading_key(seed.get("title", ""))
        for raw_idx, raw in enumerate(normalized_raw):
            if raw_idx in used_indexes or not isinstance(raw, dict):
                continue
            if _normalize_heading_key(raw.get("title", "")) == seed_key:
                matched_idx = raw_idx
                matched = raw
                break
        if matched is None:
            for raw_idx, raw in enumerate(normalized_raw):
                if raw_idx in used_indexes or not isinstance(raw, dict):
                    continue
                matched_idx = raw_idx
                matched = raw
                break
        if matched_idx is not None:
            used_indexes.add(matched_idx)
        matched = matched or {}
        children = _normalize_outline_h3_children(
            matched.get("children", matched.get("subsections", matched.get("subSections", matched.get("sections", [])))),
            str(seed.get("id") or f"seed_{idx + 1}"),
        )
        if not children and idx < len(normalized_raw):
            raw = normalized_raw[idx]
            if isinstance(raw, list):
                children = _normalize_outline_h3_children(raw, str(seed.get("id") or f"seed_{idx + 1}"))
            elif isinstance(raw, dict):
                children = _normalize_outline_h3_children(
                    raw.get("children", raw.get("subsections", raw.get("subSections", raw.get("sections", [])))),
                    str(seed.get("id") or f"seed_{idx + 1}"),
                )
                if children and not matched:
                    matched = raw
        section_word_count = int(
            matched.get("wordCount")
            or matched.get("word_count")
            or seed.get("wordCount")
            or sum(int(child.get("wordCount") or 0) for child in children)
            or 1200
        )
        keywords = matched.get("keywords") if isinstance(matched.get("keywords"), list) else seed.get("keywords") or []
        generation_strategy = str(
            seed.get("generation_strategy")
            or matched.get("generationStrategy")
            or matched.get("generation_strategy")
            or "general"
        ).strip()
        sections.append(
            {
                "id": str(seed.get("id") or f"tech_heading_{idx + 1}"),
                "title": str(seed.get("title", "")),
                "wordCount": section_word_count,
                "writingHint": str(matched.get("writingHint") or matched.get("writing_hint") or seed.get("writingHint") or "").strip(),
                "keywords": keywords,
                "relatedAnalysisIds": matched.get("relatedAnalysisIds", matched.get("related_analysis_ids", seed.get("relatedAnalysisIds", []))),
                "needDiagram": bool(matched.get("needDiagram") or matched.get("need_diagram") or False),
                "diagramBrief": str(matched.get("diagramBrief") or matched.get("diagram_brief") or "").strip(),
                "diagramPlan": matched.get("diagramPlan") or matched.get("diagram_plan") or {},
                "headingLevel": 2,
                "generationStrategy": generation_strategy,
                "generatesFromSelf": bool(
                    seed.get("generates_from_self")
                    or matched.get("generatesFromSelf")
                    or matched.get("generates_from_self")
                    or (generation_strategy == "response_special" and not children)
                ),
                "children": children,
            }
        )
    sections = _enhance_outline_writing_hints(sections, seed_headings)
    return _normalize_outline_diagram_flags(sections, max_diagrams=max_diagrams, enable_diagrams=max_diagrams != 0)


def normalize_outline_word_budget_dict(sections: list[dict], target_total: int, *, min_leaf: int = 80) -> None:
    """按最终正文叶子节点归一化字数预算，并回填父章节字数。"""
    if not sections or target_total <= 0:
        return

    budget_units = _collect_dict_budget_units(sections)
    if not budget_units:
        return

    feasible_min = max(0, int(min_leaf)) * len(budget_units)
    effective_min_leaf = int(min_leaf) if feasible_min <= target_total else 0
    weights = [float(max(1, _dict_word_count(section))) for section in budget_units]
    amounts = _distribute_proportional(target_total, weights)
    for section, amount in zip(budget_units, amounts):
        section["wordCount"] = max(effective_min_leaf, int(amount))
    _rebalance_dict_leaves(budget_units, target_total, effective_min_leaf)
    _sync_dict_parent_word_counts(sections)


def evaluate_outline_quality(sections: list[dict], seed_headings: list[dict], fallback_ratio_threshold: float = 0.45) -> dict[str, Any]:
    issues: list[str] = []
    section_list = sections if isinstance(sections, list) else []
    seed_list = seed_headings if isinstance(seed_headings, list) else []
    if seed_list and len(section_list) != len(seed_list):
        issues.append(f"H2数量不一致：期望 {len(seed_list)}，实际 {len(section_list)}。")
    title_mismatch = 0
    if seed_list:
        for idx, seed in enumerate(seed_list):
            expected = _normalize_outline_title_key(seed.get("title", ""))
            actual = _normalize_outline_title_key(section_list[idx].get("title", "")) if idx < len(section_list) and isinstance(section_list[idx], dict) else ""
            if expected and actual != expected:
                title_mismatch += 1
        if title_mismatch:
            issues.append(f"H2标题顺序异常：{title_mismatch} 处与固定种子不匹配。")

    total_children = 0
    fallback_children = 0
    empty_children = 0
    critical_failures: list[str] = []
    seed_strategy_map = {
        _normalize_outline_title_key(seed.get("title", "")): str(seed.get("generation_strategy") or "general").strip()
        for seed in seed_list
        if isinstance(seed, dict)
    }
    for section in section_list:
        if not isinstance(section, dict):
            continue
        children = section.get("children") if isinstance(section.get("children"), list) else []
        section_title = str(section.get("title") or "").strip()
        generation_strategy = str(
            section.get("generationStrategy")
            or section.get("generation_strategy")
            or seed_strategy_map.get(_normalize_outline_title_key(section_title), "general")
            or "general"
        ).strip()
        allows_self_generation = bool(section.get("generatesFromSelf") or section.get("generates_from_self") or generation_strategy == "response_special")
        if not children:
            if not allows_self_generation:
                empty_children += 1
            if _is_critical_outline_h2(section_title) and not allows_self_generation:
                critical_failures.append(f"{section_title} 缺少可用H3")
            if allows_self_generation:
                hint = str(section.get("writingHint") or section.get("writing_hint") or "").strip()
                keywords = section.get("keywords") if isinstance(section.get("keywords"), list) else []
                if not hint:
                    critical_failures.append(f"{section_title} 缺少 writingHint")
                if len([str(item).strip() for item in keywords if str(item).strip()]) < 2:
                    critical_failures.append(f"{section_title} 关键词过弱")
                if generation_strategy == "response_special" and children:
                    critical_failures.append(f"{section_title} 不应生成H3")
        for child in children:
            total_children += 1
            if _is_fallback_child(child):
                fallback_children += 1
                if _is_critical_outline_h2(section_title):
                    critical_failures.append(f"{section_title} 仍为占位H3")
            if _is_critical_outline_h2(section_title):
                hint = str(child.get("writingHint") or child.get("writing_hint") or "").strip()
                keywords = child.get("keywords") if isinstance(child.get("keywords"), list) else []
                if not hint:
                    critical_failures.append(f"{section_title} 的H3缺少 writingHint")
                if len([str(item).strip() for item in keywords if str(item).strip()]) < 2:
                    critical_failures.append(f"{section_title} 的H3关键词过弱")
    if empty_children:
        issues.append(f"存在 {empty_children} 个H2没有有效H3。")
    fallback_ratio = float(fallback_children / max(total_children, 1))
    if total_children > 0 and fallback_ratio > fallback_ratio_threshold:
        issues.append(f"H3兜底占比过高：{fallback_children}/{total_children}（{fallback_ratio:.0%}）。")
    if critical_failures:
        issues.extend(list(dict.fromkeys(critical_failures)))
    return {
        "pass": len(issues) == 0,
        "issues": issues,
        "fallback_ratio": fallback_ratio,
        "fallback_children": fallback_children,
        "total_children": total_children,
        "title_mismatch": title_mismatch,
        "critical_failures": list(dict.fromkeys(critical_failures)),
    }


def _distribute_proportional(target: int, weights: list[float]) -> list[int]:
    if target <= 0:
        return [0] * len(weights)
    total_weight = float(sum(weights))
    count = len(weights)
    if count == 0:
        return []
    if total_weight <= 0:
        base, remainder = divmod(target, count)
        return [base + (1 if index < remainder else 0) for index in range(count)]
    raw_values = [target * (weight / total_weight) for weight in weights]
    floors = [int(value) for value in raw_values]
    remainder = target - sum(floors)
    order = sorted(range(count), key=lambda index: raw_values[index] - floors[index], reverse=True)
    for index in range(remainder):
        floors[order[index % count]] += 1
    return floors


def _collect_dict_budget_units(sections: list[dict]) -> list[dict]:
    units: list[dict] = []
    for section in sections:
        if not isinstance(section, dict):
            continue
        children = [child for child in (section.get("children") or []) if isinstance(child, dict)]
        if children:
            units.extend(children)
        else:
            units.append(section)
    return units


def _dict_word_count(section: dict[str, Any]) -> int:
    return int(section.get("wordCount") or section.get("word_count") or 0)


def _rebalance_dict_leaves(leaf_sections: list[dict], target_total: int, min_leaf: int) -> None:
    current_total = sum(_dict_word_count(section) for section in leaf_sections)
    while current_total > target_total:
        target_index = max(range(len(leaf_sections)), key=lambda index: _dict_word_count(leaf_sections[index]))
        current_word_count = _dict_word_count(leaf_sections[target_index])
        if current_word_count > min_leaf:
            leaf_sections[target_index]["wordCount"] = current_word_count - 1
            current_total -= 1
        else:
            break
    while current_total < target_total:
        target_index = max(range(len(leaf_sections)), key=lambda index: _dict_word_count(leaf_sections[index]))
        leaf_sections[target_index]["wordCount"] = _dict_word_count(leaf_sections[target_index]) + 1
        current_total += 1


def _sync_dict_parent_word_counts(sections: list[dict]) -> None:
    for section in sections:
        if not isinstance(section, dict):
            continue
        children = [child for child in (section.get("children") or []) if isinstance(child, dict)]
        if children:
            section["wordCount"] = sum(_dict_word_count(child) for child in children)


def parse_structure_heading_seed_json(raw: str) -> list[dict]:
    def as_bool(value: Any) -> bool:
        if isinstance(value, bool):
            return value
        if value is None:
            return False
        normalized = str(value).strip().lower()
        if normalized in {"true", "1", "yes", "y", "是"}:
            return True
        if normalized in {"false", "0", "no", "n", "否", ""}:
            return False
        return False

    parsed = _safe_json_loads((raw or "").strip())
    if parsed is None:
        return []
    if isinstance(parsed, dict):
        candidates = parsed.get("headings") or parsed.get("technical_sections") or (parsed.get("bid_structure") or {}).get("technical_sections") or parsed.get("sections") or []
    elif isinstance(parsed, list):
        candidates = parsed
    else:
        candidates = []

    seeds: list[dict] = []
    for idx, item in enumerate(candidates):
        if isinstance(item, str):
            title = item.strip()
            item = {}
        elif isinstance(item, dict):
            title = str(item.get("title", "") or "").strip()
        else:
            continue
        if not title:
            continue
        level = int(item.get("level") or item.get("headingLevel") or 2)
        if level != 2:
            continue
        raw_keywords = item.get("keywords") or []
        keywords = [str(keyword).strip() for keyword in raw_keywords if str(keyword).strip()] if isinstance(raw_keywords, list) else []
        seeds.append(
            {
                "id": str(item.get("id") or f"tech_heading_{idx + 1}"),
                "title": title,
                "headingLevel": 2,
                "wordCount": int(item.get("wordCount") or item.get("word_count") or 0),
                "writingHint": str(item.get("writingHint") or item.get("writing_hint") or "").strip(),
                "keywords": keywords,
                "relatedAnalysisIds": item.get("relatedAnalysisIds") or item.get("related_analysis_ids") or [],
                "score_tag": str(item.get("score_tag") or item.get("scoreTag") or "").strip(),
                "score_item_id": str(item.get("score_item_id") or item.get("scoreItemId") or "").strip(),
                "max_score": int(item.get("max_score") or item.get("maxScore") or 0),
                "criteria": str(item.get("criteria") or "").strip(),
                "related_target_ids": item.get("related_target_ids") or item.get("relatedTargetIds") or [],
                "priority_weight": float(item.get("priority_weight") or item.get("priorityWeight") or 0.0),
                "generation_strategy": str(item.get("generation_strategy") or item.get("generationStrategy") or "general").strip(),
                "response_candidate": as_bool(item.get("response_candidate", item.get("responseCandidate"))),
                "generates_from_self": as_bool(item.get("generates_from_self", item.get("generatesFromSelf"))),
            }
        )
    return seeds


def collect_outline_focus_terms(seed_headings: list[dict]) -> list[str]:
    terms: list[str] = []
    for item in seed_headings or []:
        title = str(item.get("title") or "").strip()
        if not title:
            continue
        candidates = {title, re.sub(r"^(对本项目的?)", "", title).strip()}
        for term in candidates:
            if term and term not in terms:
                terms.append(term)
    return terms


def _safe_json_loads(raw: str) -> Any:
    try:
        return json.loads(raw)
    except Exception:
        return None


def _normalize_heading_key(title: str) -> str:
    return re.sub(r"\s+", "", str(title or "")).strip().lower()


def _extract_fenced_json(text: str) -> str:
    match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text, flags=re.IGNORECASE)
    return (match.group(1) if match else text).strip()


def _extract_balanced_candidates(text: str) -> list[str]:
    out: list[str] = []
    for start in range(len(text)):
        char = text[start]
        if char not in "{[":
            continue
        stack = [char]
        in_str = False
        escaped = False
        for end in range(start + 1, len(text)):
            current = text[end]
            if in_str:
                if escaped:
                    escaped = False
                elif current == "\\":
                    escaped = True
                elif current == '"':
                    in_str = False
                continue
            if current == '"':
                in_str = True
                continue
            if current in "{[":
                stack.append(current)
                continue
            if current in "}]":
                if not stack:
                    break
                top = stack[-1]
                if (top == "{" and current == "}") or (top == "[" and current == "]"):
                    stack.pop()
                    if not stack:
                        out.append(text[start : end + 1])
                        break
                else:
                    break
    return out


def _normalize_outline_h3_children(children_raw: list[Any], parent_id: str) -> list[dict]:
    children: list[dict] = []
    for idx, child in enumerate(children_raw if isinstance(children_raw, list) else []):
        if isinstance(child, str):
            title = child.strip()
            child = {}
        elif isinstance(child, dict):
            title = str(child.get("title", "")).strip()
        else:
            continue
        if not title:
            continue
        keywords_raw = child.get("keywords") or []
        keywords = [str(keyword).strip() for keyword in keywords_raw if str(keyword).strip()] if isinstance(keywords_raw, list) else []
        children.append(
            {
                "id": str(child.get("id") or f"{parent_id}_h3_{idx + 1}"),
                "title": title,
                "wordCount": int(child.get("wordCount") or child.get("word_count") or 300),
                "writingHint": str(child.get("writingHint") or child.get("writing_hint") or "").strip(),
                "keywords": keywords,
                "relatedAnalysisIds": child.get("relatedAnalysisIds") or child.get("related_analysis_ids") or [],
                "needDiagram": bool(child.get("needDiagram") or child.get("need_diagram") or False),
                "diagramBrief": str(child.get("diagramBrief") or child.get("diagram_brief") or "").strip(),
                "diagramPlan": child.get("diagramPlan") or child.get("diagram_plan") or {},
                "fallbackGenerated": bool(child.get("fallbackGenerated") or child.get("fallback_generated") or False),
                "headingLevel": 3,
            }
        )
    return children


def _sanitize_outline_writing_hint(text: str) -> str:
    cleaned = re.sub(r"\[id:[^\]]+\]", "", str(text or ""), flags=re.IGNORECASE)
    lines: list[str] = []
    for raw_line in cleaned.splitlines():
        line = re.sub(r"^\s*([一二三四五六七八九十]+、|\d+(?:\.\d+){0,3}[、.]?)\s*", "", raw_line).strip()
        if line:
            lines.append(line)
    return re.sub(r"\s+", " ", " ".join(lines)).strip()


def _outline_writing_hint_is_weak(text: str) -> bool:
    hint = _sanitize_outline_writing_hint(text)
    if not hint:
        return True
    if len(hint) < 180:
        return True
    numbered_lines = sum(
        1
        for line in str(text or "").splitlines()
        if re.match(r"^\s*([一二三四五六七八九十]+、|\d+(?:\.\d+){0,3}[、.]?)\s*", line)
    )
    if numbered_lines >= 2:
        return True
    signal_count = sum(1 for token in ("评分", "技术要求", "覆盖", "展开", "边界", "风险", "验收", "不得", "避免", "响应") if token in hint)
    return signal_count < 3


def _compose_outline_writing_hint(title: str, parent_title: str, word_count: int, keywords: list[str], criteria: str, max_score: int, generation_strategy: str, existing_hint: str) -> str:
    normalized_existing = _sanitize_outline_writing_hint(existing_hint)
    if normalized_existing and not _outline_writing_hint_is_weak(existing_hint):
        return normalized_existing
    keyword_text = "、".join([keyword for keyword in keywords if keyword][:4]) or "招标技术要求、实施约束、交付与验收要求"
    criteria_text = re.sub(r"\s+", " ", str(criteria or "").strip())
    if len(criteria_text) > 72:
        criteria_text = criteria_text[:72].rstrip("，,；;。 ") + "。"
    score_text = f"需紧扣对应评分点（约 {max_score} 分）" if max_score > 0 else "需紧扣招标文件中的关键技术要求"
    parent_scope = f"在“{parent_title}”框架下" if parent_title else "作为本章统筹提示"
    if generation_strategy == "response_special":
        parent_scope = "本章为直接成文章节，不再拆分子节"
    focus_prefix = f"当前已识别的核心侧重点是：{normalized_existing[:56].rstrip('，,；;。 ')}。" if normalized_existing else ""
    target_words = f"正文目标篇幅约 {int(word_count)} 字。" if int(word_count or 0) > 0 else ""
    return (
        f"{focus_prefix}围绕“{title}”撰写本节内容，{parent_scope}，先说明本节要解决的问题和响应目标，"
        f"再把招标文件或评分细则要求转化为可执行方案。重点覆盖：{keyword_text}。{score_text}"
        f"{('，尤其要回应：' + criteria_text) if criteria_text else '。'}"
        "正文应按“需求理解、方案机制、落地措施、验证与风险控制”展开，明确为什么这样设计、如何实施、如何证明达标，"
        "尽量使用“针对…采用…实现…通过…保障…”这类响应式表述，使段落能直接回扣技术条款或评分点。"
        "不要重复目录编号、小标题清单或其他章节已经展开的通用背景，也不要只写空泛优势表述。"
        "不得编造缺乏依据的参数、型号、案例、标准编号或业绩事实；若证据不足，优先写控制措施、资源配置、交付边界、偏差闭环与验收方式。"
        f"{target_words}"
    ).strip()


def _enhance_outline_writing_hints(sections: list[dict], seed_headings: list[dict]) -> list[dict]:
    seed_map = {
        _normalize_outline_title_key(seed.get("title", "")): seed
        for seed in (seed_headings if isinstance(seed_headings, list) else [])
        if isinstance(seed, dict)
    }
    for index, section in enumerate(sections if isinstance(sections, list) else []):
        if not isinstance(section, dict):
            continue
        seed = seed_map.get(_normalize_outline_title_key(section.get("title", "")))
        if seed is None and isinstance(seed_headings, list) and index < len(seed_headings) and isinstance(seed_headings[index], dict):
            seed = seed_headings[index]
        section_keywords_raw = section.get("keywords") if isinstance(section.get("keywords"), list) else (seed or {}).get("keywords") or []
        section_keywords = [str(item).strip() for item in section_keywords_raw if str(item).strip()]
        section["writingHint"] = _compose_outline_writing_hint(
            title=str(section.get("title") or ""),
            parent_title="",
            word_count=int(section.get("wordCount") or 0),
            keywords=section_keywords,
            criteria=str((seed or {}).get("criteria") or ""),
            max_score=int((seed or {}).get("max_score") or (seed or {}).get("maxScore") or 0),
            generation_strategy=str(
                section.get("generationStrategy")
                or section.get("generation_strategy")
                or (seed or {}).get("generation_strategy")
                or "general"
            ).strip(),
            existing_hint=str(section.get("writingHint") or section.get("writing_hint") or ""),
        )
        for child in section.get("children") if isinstance(section.get("children"), list) else []:
            if not isinstance(child, dict):
                continue
            child_keywords_raw = child.get("keywords") if isinstance(child.get("keywords"), list) else section_keywords
            child_keywords = [str(item).strip() for item in child_keywords_raw if str(item).strip()]
            child["writingHint"] = _compose_outline_writing_hint(
                title=str(child.get("title") or ""),
                parent_title=str(section.get("title") or ""),
                word_count=int(child.get("wordCount") or 0),
                keywords=child_keywords,
                criteria=str((seed or {}).get("criteria") or ""),
                max_score=int((seed or {}).get("max_score") or (seed or {}).get("maxScore") or 0),
                generation_strategy=str(
                    child.get("generationStrategy")
                    or child.get("generation_strategy")
                    or section.get("generationStrategy")
                    or section.get("generation_strategy")
                    or (seed or {}).get("generation_strategy")
                    or "general"
                ).strip(),
                existing_hint=str(child.get("writingHint") or child.get("writing_hint") or ""),
            )
    return sections


def _force_disable_outline_diagram(node: dict) -> None:
    if not isinstance(node, dict):
        return
    node["needDiagram"] = False
    node["diagramBrief"] = ""
    plan = node.get("diagramPlan") or {}
    if not isinstance(plan, dict):
        plan = {}
    plan["enabled"] = False
    plan["brief"] = ""
    plan["priority"] = 0
    node["diagramPlan"] = plan


def _outline_children_list(node: dict) -> list[dict]:
    children = node.get("children") or []
    return children if isinstance(children, list) else []


def _outline_is_content_leaf(node: dict) -> bool:
    return len(_outline_children_list(node)) == 0


def _outline_allows_auto_diagram(node: dict) -> bool:
    if not _outline_is_content_leaf(node):
        return False
    generation_strategy = str(node.get("generationStrategy") or node.get("generation_strategy") or "general").strip()
    if generation_strategy == "response_special":
        return False
    if bool(node.get("generatesFromSelf") or node.get("generates_from_self")):
        return False
    return True


def _outline_effective_diagram_priority(node: dict) -> int:
    plan = node.get("diagramPlan") or {}
    if not isinstance(plan, dict):
        plan = {}
    try:
        base_priority = int(plan.get("priority") or 0)
    except (TypeError, ValueError):
        base_priority = 0
    related_ids_raw = node.get("relatedAnalysisIds") or node.get("related_analysis_ids") or []
    related_ids = {str(item).strip() for item in (related_ids_raw if isinstance(related_ids_raw, list) else []) if str(item).strip()}
    keywords_raw = node.get("keywords") or []
    keywords = [str(item).strip() for item in (keywords_raw if isinstance(keywords_raw, list) else []) if str(item).strip()]
    text = " ".join([str(node.get("title") or ""), str(node.get("writingHint") or node.get("writing_hint") or ""), " ".join(keywords)]).lower()
    try:
        word_count = int(node.get("wordCount") or node.get("word_count") or 0)
    except (TypeError, ValueError):
        word_count = 0
    bonus = 0
    if "scoring_details" in related_ids:
        bonus += 24
    if "resp_tech" in related_ids:
        bonus += 20
    if "resp_param" in related_ids:
        bonus += 12
    if "resp_substance" in related_ids:
        bonus += 12
    if "proj_overview" in related_ids:
        bonus += 4
    if "proj_basic" in related_ids:
        bonus += 2
    positive_patterns = [
        r"架构|拓扑|流程|部署|接口|集成|联动|数据流|模块|平台|迁移|运维|安全|实施|交付|验收|网络|时序|协同|方案设计",
        r"architecture|topology|flow|deploy|interface|integration|data[- ]?flow|module|platform|migration|ops|security|delivery|acceptance",
    ]
    negative_patterns = [
        r"背景|概述|总述|原则|说明|综述|理解|目标概览|项目概况|承诺|格式|附件|资质|商务|团队|公司|企业",
        r"background|overview|summary|principle|introduction|commitment|format|attachment|qualification|business|team|company",
    ]
    for pattern in positive_patterns:
        if re.search(pattern, text, re.IGNORECASE):
            bonus += 10
    for pattern in negative_patterns:
        if re.search(pattern, text, re.IGNORECASE):
            bonus -= 12
    if word_count >= 1200:
        bonus += 10
    elif word_count >= 800:
        bonus += 8
    elif word_count >= 500:
        bonus += 5
    elif word_count >= 250:
        bonus += 2
    return max(0, base_priority + bonus)


def _outline_preferred_diagram_type(node: dict) -> str:
    keywords_raw = node.get("keywords") or []
    keywords = [str(item).strip() for item in (keywords_raw if isinstance(keywords_raw, list) else []) if str(item).strip()]
    text = " ".join([str(node.get("title") or ""), str(node.get("writingHint") or node.get("writing_hint") or ""), " ".join(keywords)]).lower()
    if re.search(r"数据|指标|同步|交换|data|etl|dataset", text, re.IGNORECASE):
        return "data-flow"
    if re.search(r"架构|部署|接口|集成|平台|模块|安全|网络|拓扑|系统|服务|中间件|architecture|deploy|interface|platform|module|security|topology", text, re.IGNORECASE):
        return "architecture"
    if re.search(r"流程|步骤|路径|进度|审批|流转|闭环|flow|process|procedure|workflow", text, re.IGNORECASE):
        return "flowchart"
    if re.search(r"组织|团队|职责|分工|岗位|org|team|role", text, re.IGNORECASE):
        return "org-chart"
    return "logic"


def _outline_default_diagram_brief(node: dict, diagram_type: str) -> str:
    title = str(node.get("title") or "").strip() or "本章节"
    writing_hint = str(node.get("writingHint") or node.get("writing_hint") or "").strip()
    keywords_raw = node.get("keywords") or []
    keywords = [str(item).strip() for item in (keywords_raw if isinstance(keywords_raw, list) else []) if str(item).strip()][:5]
    focus = "、".join(keywords) if keywords else (writing_hint[:80] if writing_hint else title)
    type_label = {
        "architecture": "技术架构",
        "flowchart": "流程路径",
        "org-chart": "组织职责",
        "data-flow": "数据流转",
        "logic": "逻辑关系",
    }.get(diagram_type, "逻辑关系")
    return f"围绕“{title}”绘制{type_label}图，突出核心对象、关键模块、上下游衔接关系与本章节要回答的问题；重点覆盖：{focus}。"


def _normalize_outline_diagram_flags(sections: list[dict], max_diagrams: int | None = 6, enable_diagrams: bool = True) -> list[dict]:
    if not isinstance(sections, list):
        return sections
    candidates: list[tuple[int, int, dict]] = []
    eligible_nodes: list[tuple[int, int, dict]] = []
    sequence_no = 0
    for section in sections:
        if not isinstance(section, dict):
            continue
        nodes = [section, *(section.get("children") or [])]
        for node in nodes:
            if not isinstance(node, dict):
                continue
            sequence_no += 1
            if not _outline_allows_auto_diagram(node):
                _force_disable_outline_diagram(node)
                continue
            effective_priority = _outline_effective_diagram_priority(node)
            eligible_nodes.append((effective_priority, sequence_no, node))
            need_diagram = bool(node.get("needDiagram") or node.get("need_diagram") or False)
            diagram_brief = str(node.get("diagramBrief") or node.get("diagram_brief") or "").strip()
            plan = node.get("diagramPlan") or node.get("diagram_plan") or {}
            if not isinstance(plan, dict):
                plan = {}
            node["diagramPlan"] = plan
            plan["enabled"] = bool(plan.get("enabled")) and need_diagram and bool(diagram_brief)
            plan["brief"] = str(plan.get("brief") or "").strip()
            if not enable_diagrams or not need_diagram or not diagram_brief:
                _force_disable_outline_diagram(node)
                continue
            if not str(plan.get("typeHint") or plan.get("type_hint") or "").strip():
                plan["typeHint"] = _outline_preferred_diagram_type(node)
            plan["priority"] = effective_priority
            candidates.append((effective_priority, sequence_no, node))
    if not enable_diagrams or max_diagrams is None:
        return sections
    if max_diagrams < 0:
        return sections
    target_limit = min(int(max_diagrams), len(eligible_nodes))
    if target_limit <= 0:
        for _, _, node in eligible_nodes:
            _force_disable_outline_diagram(node)
        return sections
    if len(candidates) < target_limit:
        selected_ids = {id(node) for _, _, node in candidates}
        eligible_nodes.sort(key=lambda row: (-row[0], row[1]))
        for effective_priority, sequence, node in eligible_nodes:
            if len(candidates) >= target_limit:
                break
            if id(node) in selected_ids:
                continue
            diagram_type = _outline_preferred_diagram_type(node)
            diagram_brief = _outline_default_diagram_brief(node, diagram_type)
            plan = node.get("diagramPlan") or {}
            if not isinstance(plan, dict):
                plan = {}
            plan.update({"enabled": True, "brief": diagram_brief, "typeHint": diagram_type, "priority": effective_priority})
            node["needDiagram"] = True
            node["diagramBrief"] = diagram_brief
            node["diagramPlan"] = plan
            candidates.append((effective_priority, sequence, node))
            selected_ids.add(id(node))
    if len(candidates) > target_limit:
        candidates.sort(key=lambda row: (-row[0], row[1]))
        keep_ids = {id(node) for _, _, node in candidates[:target_limit]}
        for _, _, node in candidates[target_limit:]:
            if id(node) not in keep_ids:
                _force_disable_outline_diagram(node)
    return sections


def _normalize_outline_title_key(value: str) -> str:
    return re.sub(r"\s+", "", str(value or "")).strip().lower()


def _is_fallback_child(child: dict) -> bool:
    if not isinstance(child, dict):
        return False
    if bool(child.get("fallbackGenerated") or child.get("fallback_generated")):
        return True
    title = str(child.get("title") or "").strip()
    hint = str(child.get("writingHint") or child.get("writing_hint") or "").strip()
    return title.endswith("重点响应") and not hint


def _is_critical_outline_h2(title: str) -> bool:
    return str(title or "").strip() in {"售后服务方案", "响应情况", "项目实施目标"}
