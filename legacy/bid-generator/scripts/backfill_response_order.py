#!/usr/bin/env python3
"""
回补 analysisV2 中技术部分顺序与响应特例标记。

默认 dry-run，仅输出差异统计；
加 --apply 才会写回 pipt-flask/pipt_mappings.db。
"""

from __future__ import annotations

import argparse
import copy
import json
import re
import sqlite3
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "pipt-flask" / "pipt_mappings.db"


def normalize_score_tag(value: str) -> str:
    tag = str(value or "").strip().lower()
    if tag in {"tech", "biz", "mixed"}:
        return tag
    return "mixed"


def as_optional_bool(value: Any):
    if isinstance(value, bool):
        return value
    if value is None:
        return None
    s = str(value).strip().lower()
    if s in {"true", "1", "yes", "y", "是"}:
        return True
    if s in {"false", "0", "no", "n", "否", ""}:
        return False
    return None


def is_response_candidate_strict(name: str, criteria: str) -> bool:
    title = re.sub(r"\s+", "", str(name or "")).lower()
    crt = str(criteria or "").lower()
    strong_title_keys = [
        "响应情况", "响应程度", "符合性响应", "符合性偏离", "偏离情况", "偏离表", "逐条响应情况",
        "实质性条款响应情况", "技术条款响应情况",
    ]
    if any(k in title for k in strong_title_keys):
        return True
    if (
        ("完全响应" in crt and "部分响应" in crt and ("不响应" in crt or "未响应" in crt or "偏离" in crt))
        and ("得分" in crt or "得" in crt or "评分" in crt)
    ):
        return True
    return False


def rebuild_analysis_v2(av2: dict) -> dict:
    out = copy.deepcopy(av2)
    project_info = out.get("project_info") or {}
    scoring_items = project_info.get("scoring_items") or []
    technical_targets = out.get("technical_targets") or []
    target_ids = [str(x.get("id") or "").strip() for x in technical_targets if str(x.get("id") or "").strip()]

    bid_structure = out.setdefault("bid_structure", {})
    old_tech = bid_structure.get("technical_sections") or []
    old_by_score_id = {str(x.get("score_item_id") or ""): x for x in old_tech if isinstance(x, dict)}
    old_by_title = {str(x.get("title") or ""): x for x in old_tech if isinstance(x, dict)}

    technical_sections = []
    for i, item in enumerate(scoring_items):
        if not isinstance(item, dict):
            continue
        score_tag = normalize_score_tag(item.get("score_tag"))
        if score_tag == "biz":
            continue
        name = str(item.get("name") or "").strip()
        if not name:
            continue
        criteria = str(item.get("criteria") or "").strip()
        score_id = str(item.get("id") or f"score_{i+1}")
        explicit = as_optional_bool(item.get("is_response_item", item.get("isResponseItem")))
        if explicit is None:
            is_response = is_response_candidate_strict(name, criteria)
        else:
            is_response = bool(explicit)

        base = copy.deepcopy(old_by_score_id.get(score_id) or old_by_title.get(name) or {})
        base.update({
            "id": str(base.get("id") or f"technical_{re.sub(r'[^\\w\\u4e00-\\u9fa5]+', '_', name.lower()).strip('_') or i+1}"),
            "title": name,
            "level": int(base.get("level") or 2),
            "category": "technical",
            "source": str(base.get("source") or "score_item"),
            "source_node_id": "scoring_details",
            "source_title": name,
            "score_tag": score_tag,
            "score_item_id": score_id,
            "max_score": int(float(item.get("max_score") or item.get("maxScore") or 0)),
            "criteria": criteria,
            "criteria_excerpt": str(base.get("criteria_excerpt") or criteria[:220]),
            "related_target_ids": target_ids,
            "priority_weight": float(base.get("priority_weight") or item.get("max_score") or 0.0),
            "generation_strategy": "response_special" if is_response else "general",
            "generation_mode": str(base.get("generation_mode") or "derived"),
            "response_candidate": is_response,
            "deleted": False,
        })
        technical_sections.append(base)

    objective = None
    for sec in old_tech:
        if str((sec or {}).get("title") or "").strip() == "项目实施目标":
            objective = copy.deepcopy(sec)
            break
    if objective is None:
        objective = {
            "id": "technical_project_objective",
            "title": "项目实施目标",
            "level": 2,
            "category": "technical",
            "source": "system",
            "source_node_id": "technical_targets",
            "source_title": "项目实施目标",
            "score_tag": "tech",
            "score_item_id": "",
            "max_score": 0,
            "criteria": "",
            "criteria_excerpt": "",
            "related_target_ids": target_ids,
            "priority_weight": 0.0,
            "generation_strategy": "objective_special",
            "generation_mode": "system",
            "response_candidate": False,
            "deleted": False,
        }
    objective["generation_strategy"] = "objective_special"
    objective["generation_mode"] = "system"
    objective["response_candidate"] = False

    response_sections = [s for s in technical_sections if bool(s.get("response_candidate"))]
    if len(response_sections) > 1:
        preferred = [
            s for s in response_sections
            if any(k in str(s.get("title") or "") for k in ["响应情况", "响应程度", "符合性偏离", "偏离情况"])
        ]
        keep = preferred[0] if preferred else response_sections[0]
        keep_title = str(keep.get("title") or "")
        for sec in technical_sections:
            if str(sec.get("title") or "") != keep_title and bool(sec.get("response_candidate")):
                sec["response_candidate"] = False
                sec["generation_strategy"] = "general"

    response_sections = [s for s in technical_sections if bool(s.get("response_candidate"))]
    non_response = [s for s in technical_sections if not bool(s.get("response_candidate"))]
    technical_sections = non_response + response_sections + [objective]

    bid_structure["technical_sections"] = technical_sections
    out["enable_response_branch"] = any(bool(s.get("response_candidate")) for s in technical_sections)
    out["technical_h2_bindings"] = [
        {
            "h2_id": sec.get("id", ""),
            "title": sec.get("title", ""),
            "score_item_id": sec.get("score_item_id", ""),
            "score_value": int(sec.get("max_score") or 0),
            "score_criteria": sec.get("criteria", ""),
            "score_tag": sec.get("score_tag", ""),
            "related_target_ids": sec.get("related_target_ids", []),
            "priority_weight": float(sec.get("priority_weight") or 0.0),
            "generation_strategy": sec.get("generation_strategy", "general"),
            "response_candidate": bool(sec.get("response_candidate")),
        }
        for sec in technical_sections
        if not bool(sec.get("deleted"))
    ]
    return out


def update_structure_technical_in_report(report: list, titles: list[str]) -> list:
    if not isinstance(report, list):
        return report
    content = "\n".join(f"<要点>{t}</要点>" for t in titles if str(t).strip())

    def walk(nodes: list):
        out_nodes = []
        for n in nodes:
            if not isinstance(n, dict):
                out_nodes.append(n)
                continue
            c = dict(n)
            if str(c.get("id") or "") == "structure_technical":
                c["content"] = content
            if isinstance(c.get("children"), list):
                c["children"] = walk(c["children"])
            out_nodes.append(c)
        return out_nodes

    return walk(report)


def main():
    parser = argparse.ArgumentParser(description="回补 analysisV2 响应特例顺序")
    parser.add_argument("--apply", action="store_true", help="写回数据库（默认 dry-run）")
    parser.add_argument("--project-id", default="", help="仅处理指定项目")
    args = parser.parse_args()

    conn = sqlite3.connect(str(DB_PATH))
    cur = conn.cursor()

    if args.project_id:
        rows = cur.execute("SELECT id, data FROM projects WHERE id = ?", (args.project_id,)).fetchall()
    else:
        rows = cur.execute("SELECT id, data FROM projects").fetchall()

    changed = 0
    touched = 0
    for pid, raw in rows:
        try:
            data = json.loads(raw or "{}")
        except Exception:
            continue
        av2 = data.get("analysisV2")
        if not isinstance(av2, dict) or not av2:
            continue
        touched += 1
        old_titles = [str(s.get("title") or "") for s in ((av2.get("bid_structure") or {}).get("technical_sections") or [])]
        new_av2 = rebuild_analysis_v2(av2)
        new_titles = [str(s.get("title") or "") for s in ((new_av2.get("bid_structure") or {}).get("technical_sections") or [])]
        if old_titles == new_titles and av2.get("technical_h2_bindings") == new_av2.get("technical_h2_bindings"):
            continue
        changed += 1
        print(f"[DIFF] {pid}")
        print("  old:", " | ".join(old_titles))
        print("  new:", " | ".join(new_titles))
        if args.apply:
            data["analysisV2"] = new_av2
            report = data.get("analysisReport")
            if isinstance(report, list):
                data["analysisReport"] = update_structure_technical_in_report(report, new_titles)
            cur.execute("UPDATE projects SET data = ? WHERE id = ?", (json.dumps(data, ensure_ascii=False), pid))

    if args.apply:
        conn.commit()
    conn.close()

    mode = "APPLY" if args.apply else "DRY-RUN"
    print(f"[{mode}] touched={touched}, changed={changed}")


if __name__ == "__main__":
    main()

