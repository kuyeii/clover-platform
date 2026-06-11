"""
大纲字数归一化：将模型返回的 wordCount 与用户「预期技术方案总字数」对齐。

注意：
- 正文生成按最终可写叶子节点的 wordCount 执行，因此归一化必须落到叶子节点。
- 父章节 wordCount 只作为汇总展示值，由子节点合计回填。
"""

from __future__ import annotations

from typing import Any, List, Sequence


def _distribute_proportional(target: int, weights: Sequence[float]) -> List[int]:
    """按权重将 target 拆成非负整数列表，且各数之和严格等于 target。"""
    if target <= 0:
        return [0] * len(weights)
    n = len(weights)
    if n == 0:
        return []
    s = float(sum(weights))
    if s <= 0:
        base, rem = divmod(target, n)
        return [base + (1 if i < rem else 0) for i in range(n)]
    raw = [target * (w / s) for w in weights]
    floors = [int(x) for x in raw]
    remainder = target - sum(floors)
    order = sorted(range(n), key=lambda i: raw[i] - floors[i], reverse=True)
    for i in range(remainder):
        floors[order[i % n]] += 1
    return floors


def _rebalance_dict_leaves(leaf_objs: List[dict], target_total: int, min_leaf: int) -> None:
    cur = sum(int(d.get("wordCount") or d.get("word_count") or 0) for d in leaf_objs)
    while cur > target_total:
        i = max(range(len(leaf_objs)), key=lambda k: int(leaf_objs[k].get("wordCount") or leaf_objs[k].get("word_count") or 0))
        w = int(leaf_objs[i].get("wordCount") or leaf_objs[i].get("word_count") or 0)
        if w > min_leaf:
            leaf_objs[i]["wordCount"] = w - 1
            cur -= 1
        else:
            break
    while cur < target_total:
        i = max(range(len(leaf_objs)), key=lambda k: int(leaf_objs[k].get("wordCount") or leaf_objs[k].get("word_count") or 0))
        leaf_objs[i]["wordCount"] = int(leaf_objs[i].get("wordCount") or 0) + 1
        cur += 1


def _rebalance_model_leaves(leaves: List[Any], target_total: int, min_leaf: int) -> None:
    cur = sum(int(getattr(x, "wordCount", 0) or 0) for x in leaves)
    while cur > target_total:
        i = max(range(len(leaves)), key=lambda k: int(getattr(leaves[k], "wordCount", 0) or 0))
        w = int(getattr(leaves[i], "wordCount", 0) or 0)
        if w > min_leaf:
            leaves[i].wordCount = w - 1
            cur -= 1
        else:
            break
    while cur < target_total:
        i = max(range(len(leaves)), key=lambda k: int(getattr(leaves[k], "wordCount", 0) or 0))
        leaves[i].wordCount = int(getattr(leaves[i], "wordCount", 0) or 0) + 1
        cur += 1


def _dict_word_count(obj: dict) -> int:
    return int(obj.get("wordCount") or obj.get("word_count") or 0)


def _model_word_count(obj: Any) -> int:
    return int(getattr(obj, "wordCount", 0) or 0)


def _collect_dict_budget_units(sections: List[dict]) -> List[dict]:
    """
    收集实际正文生成单元：
    - 有 children 的 H2：children 是正文叶子；
    - 无 children 的 H2：该 H2 自身是正文单元，如“响应情况”。
    """
    units: List[dict] = []
    for section in sections:
        if not isinstance(section, dict):
            continue
        children = [child for child in (section.get("children") or []) if isinstance(child, dict)]
        if children:
            units.extend(children)
        else:
            units.append(section)
    return units


def _collect_model_budget_units(sections: List[Any]) -> List[Any]:
    units: List[Any] = []
    for section in sections:
        children = list(getattr(section, "children", None) or [])
        if children:
            units.extend(children)
        else:
            units.append(section)
    return units


def _sync_dict_parent_word_counts(sections: List[dict]) -> None:
    for section in sections:
        if not isinstance(section, dict):
            continue
        children = [child for child in (section.get("children") or []) if isinstance(child, dict)]
        if children:
            section["wordCount"] = sum(_dict_word_count(child) for child in children)


def _sync_model_parent_word_counts(sections: List[Any]) -> None:
    for section in sections:
        children = list(getattr(section, "children", None) or [])
        if children:
            section.wordCount = sum(_model_word_count(child) for child in children)


def normalize_outline_word_budget_dict(sections: List[dict], target_total: int, *, min_leaf: int = 80) -> None:
    """
    就地修改 dict 结构的大纲（与 task_routes._build_sections_list 输出一致）。
    target_total <= 0 时不做修改（保留模型原始预算）。
    """
    if not sections:
        return

    if target_total <= 0:
        return

    budget_units = _collect_dict_budget_units(sections)
    if not budget_units:
        return

    feasible_min = max(0, int(min_leaf)) * len(budget_units)
    effective_min_leaf = int(min_leaf) if feasible_min <= target_total else 0
    weights = [float(max(1, _dict_word_count(s))) for s in budget_units]
    amounts = _distribute_proportional(target_total, weights)
    for s, amt in zip(budget_units, amounts):
        s["wordCount"] = max(effective_min_leaf, int(amt))
    _rebalance_dict_leaves(budget_units, target_total, effective_min_leaf)
    _sync_dict_parent_word_counts(sections)


def _collect_model_top_sections(sections: List[Any]) -> List[Any]:
    from .schemas import OutlineSection

    tops: List[Any] = []
    for sec in sections:
        if not isinstance(sec, OutlineSection):
            continue
        tops.append(sec)
    return tops


def normalize_outline_word_budget_models(sections: List[Any], target_total: int, *, min_leaf: int = 80) -> None:
    """
    就地修改 Pydantic OutlineSection 列表（generate_outline 同步接口）。
    target_total <= 0 时不做修改（保留模型原始预算）。
    按最终正文叶子节点做总量归一化，并将父章节 wordCount 回填为子节点合计。
    """
    if not sections:
        return

    if target_total <= 0:
        return

    budget_units = _collect_model_budget_units(_collect_model_top_sections(sections))
    if not budget_units:
        return

    feasible_min = max(0, int(min_leaf)) * len(budget_units)
    effective_min_leaf = int(min_leaf) if feasible_min <= target_total else 0
    weights = [float(max(1, _model_word_count(x))) for x in budget_units]
    amounts = _distribute_proportional(target_total, weights)
    for x, amt in zip(budget_units, amounts):
        x.wordCount = max(effective_min_leaf, int(amt))
    _rebalance_model_leaves(budget_units, target_total, effective_min_leaf)
    _sync_model_parent_word_counts(sections)
