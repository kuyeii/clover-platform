"""
大纲字数归一化：将模型返回的 wordCount 与用户「预期技术方案总字数」对齐。

注意：
- 一级章节与二级章节预算相互独立，不做父子覆盖。
- 仅对一级章节总和做归一化，使其更贴近用户输入的总字数目标。
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


def normalize_outline_word_budget_dict(sections: List[dict], target_total: int, *, min_leaf: int = 80) -> None:
    """
    就地修改 dict 结构的大纲（与 task_routes._build_sections_list 输出一致）。
    target_total <= 0 时不做修改（保留模型原始预算）。
    """
    if not sections:
        return

    if target_total <= 0:
        return

    # 仅按一级章节归一化，保留二级预算不变
    top_sections = [s for s in sections if isinstance(s, dict)]
    if not top_sections:
        return

    weights = [float(max(1, int(s.get("wordCount") or s.get("word_count") or 0))) for s in top_sections]
    amounts = _distribute_proportional(target_total, weights)
    for s, amt in zip(top_sections, amounts):
        s["wordCount"] = max(min_leaf, int(amt))
    _rebalance_dict_leaves(top_sections, target_total, min_leaf)


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
    仅对一级章节做总量归一化，二级/三级预算不做回卷覆盖。
    """
    if not sections:
        return

    if target_total <= 0:
        return

    tops = _collect_model_top_sections(sections)
    if not tops:
        return

    weights = [float(max(1, int(getattr(x, "wordCount", 0) or 0))) for x in tops]
    amounts = _distribute_proportional(target_total, weights)
    for x, amt in zip(tops, amounts):
        x.wordCount = max(min_leaf, int(amt))
    _rebalance_model_leaves(tops, target_total, min_leaf)
