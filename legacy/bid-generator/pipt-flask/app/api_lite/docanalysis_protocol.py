from __future__ import annotations

import ast
import json
import re
from pathlib import Path
from typing import Any, Optional


def load_docanalysis_framework(config_path: Optional[Path] = None) -> tuple[str, list[dict]]:
    path = config_path or (Path(__file__).parent.parent.parent / "config" / "analysis_framework.json")
    with open(path, "r", encoding="utf-8") as f:
        framework = json.load(f)
    system_prompt_base = str(framework.get("systemPrompt") or "")
    all_nodes = framework.get("framework") or []
    return system_prompt_base, all_nodes if isinstance(all_nodes, list) else []


def build_docanalysis_node_index(nodes: list[dict]) -> dict[str, dict]:
    flattened: list[dict] = []
    for parent in nodes or []:
        if not isinstance(parent, dict):
            continue
        parent_prompt = str(parent.get("extractionPrompt") or "").strip()
        if parent_prompt:
            flattened.append({
                "id": str(parent.get("id") or "").strip(),
                "label": str(parent.get("label") or "").strip(),
                "extractionPrompt": parent_prompt,
            })
        for child in (parent.get("children") or []):
            if not isinstance(child, dict):
                continue
            child_prompt = str(child.get("extractionPrompt") or "").strip()
            if not child_prompt:
                continue
            flattened.append({
                "id": str(child.get("id") or "").strip(),
                "label": str(child.get("label") or "").strip(),
                "extractionPrompt": child_prompt,
            })
    return {node["id"]: node for node in flattened if node.get("id")}


def build_docanalysis_groups(all_nodes: list[dict], selected_ids: Optional[set[str]] = None) -> list[dict]:
    node_by_id = build_docanalysis_node_index(all_nodes)
    if selected_ids:
        selected_nodes = [node_by_id[nid] for nid in selected_ids if nid in node_by_id]
        if not selected_nodes:
            return []
        return [{"group_label": f"批量重提取（{len(selected_nodes)} 节点）", "nodes": selected_nodes}]

    first_batch_ids = ["proj_overview", "proj_basic", "scoring_details", "structure_attachments"]
    second_batch_ids = ["resp_tech", "resp_param", "resp_substance"]
    groups: list[dict] = []
    first_batch_nodes = [node_by_id[nid] for nid in first_batch_ids if nid in node_by_id]
    second_batch_nodes = [node_by_id[nid] for nid in second_batch_ids if nid in node_by_id]
    if first_batch_nodes:
        groups.append({
            "group_label": "第一批：项目信息+评分细则+附件结构",
            "nodes": first_batch_nodes,
        })
    if second_batch_nodes:
        groups.append({
            "group_label": "第二批：项目技术目标",
            "nodes": second_batch_nodes,
        })
    return groups


def build_docanalysis_system_prompt(system_prompt_base: str, subset_nodes: list[dict], subset_label: str) -> str:
    node_ids = [str(n.get("id") or "").strip() for n in subset_nodes if str(n.get("id") or "").strip()]
    task_sections = [
        f"### 任务: {str(n.get('label') or '').strip()} (node_id: {str(n.get('id') or '').strip()})\n\n{str(n.get('extractionPrompt') or '').strip()}"
        for n in subset_nodes
        if str(n.get("id") or "").strip() and str(n.get("extractionPrompt") or "").strip()
    ]
    allow_attachments = ("形式审查" in str(subset_label or "")) or any(node_id == "structure_attachments" for node_id in node_ids)
    constraint_text = (
        "\n\n---\n\n"
        "【目录定位优先级（必须遵守）】\n"
        "先在“第X章 投标文件格式/第X章 附件/格式文件/投标文件组成与格式”区域定位目录，仅抽取“投标人应提交的文件条目”；"
        "禁止误抽评标办法、合同条款、技术规范正文目录。\n\n"
        "【强制任务：必须输出附件目录 JSON，不可省略】\n"
        "完成上述所有 node_id 字段的 JSON 输出后，必须紧接着输出 <BID_ATTACHMENTS> 标签，内容为投标文件目录中每个章节的结构化清单，格式严格如下：\n\n"
        "<BID_ATTACHMENTS>\n"
        "[\n"
        '  {"name": "章节名称（与附件结构节点提取的完整原文名称一致）", "start_locator": "起始段落号（若文档有 P0001 格式编号则填写，否则填空字符串）", "end_locator": "结束段落号（同上）", "description": ""},\n'
        "  ...\n"
        "]\n"
        "</BID_ATTACHMENTS>\n\n"
        "执行规则：\n"
        "① name 与附件结构节点中提取的章节名称完全一致，每个章节一个 JSON 对象，不遗漏\n"
        "② 若招标文件无 P 编号定位符，start_locator 和 end_locator 均填空字符串 \"\"\n"
        "③ <BID_ATTACHMENTS> 标签必须出现在所有 JSON 字段之后，禁止省略"
        if allow_attachments else
        "\n\n---\n\n【重要约束】本次任务仅允许输出最外层 JSON；绝对不允许输出 <BID_ATTACHMENTS> 标签以及任何 JSON 之外的内容。"
    )
    format_guard = (
        "【全局格式硬性约束（最高优先级）】：你必须把每个子任务的结果作为对应 node_id 的 value，"
        f"严格嵌套在唯一的最外层 JSON 中返回。外层 JSON 的 key 必须严格包含：{node_ids}。\n"
        "即使某个子任务本身要求“直接输出纯 JSON”或“不要任何其他文本”，那也只是该 node_id 对应 value 的内容要求，"
        "不是整个工作流的最外层输出格式。\n\n"
    )
    return (
        f"{str(system_prompt_base or '').strip()}\n\n"
        f"## 当前分组：{str(subset_label or '').strip()}\n\n"
        f"本次需要提取以下 {len(node_ids)} 个字段，每个字段对应一个 node_id。\n"
        "你必须为每个 node_id 都输出内容，用 JSON 格式返回，key 为 node_id。\n"
        f"{format_guard}"
        + "\n\n---\n\n".join(task_sections)
        + constraint_text
    ).strip()


def extract_docanalysis_text_output(outputs: dict[str, Any]) -> str:
    return str(
        (outputs or {}).get("text")
        or (outputs or {}).get("result")
        or (outputs or {}).get("structured_output")
        or ""
    )


def strip_docanalysis_think_blocks(text: str) -> str:
    return re.sub(r"<think>.*?</think>", "", str(text or ""), flags=re.DOTALL).strip()


def split_bid_attachments_tag(text: str) -> tuple[str, str]:
    raw = str(text or "")
    match = re.search(r"<BID_ATTACHMENTS>(.*?)</BID_ATTACHMENTS>", raw, re.DOTALL)
    if not match:
        return raw.strip(), ""
    content = re.sub(r"\s*<BID_ATTACHMENTS>.*?</BID_ATTACHMENTS>", "", raw, flags=re.DOTALL).strip()
    return content, match.group(1).strip()


def parse_docanalysis_result_map(raw_text: str) -> dict[str, Any]:
    cleaned = strip_docanalysis_think_blocks(raw_text)
    parsed = _try_parse_jsonish(cleaned)
    if not isinstance(parsed, dict):
        raise ValueError("docanalysis 输出不是可解析的 JSON 对象")
    return parsed


def extract_docanalysis_node_content(result_map: dict[str, Any], node_id: str) -> Any:
    if not isinstance(result_map, dict):
        return result_map
    if node_id in result_map:
        return result_map[node_id]
    if len(result_map) == 1:
        return next(iter(result_map.values()))
    return result_map


def parse_bid_attachments_payload(raw: str) -> list[dict]:
    payload = str(raw or "").strip()
    if not payload:
        return []
    parsed = None
    try:
        parsed = json.loads(payload)
    except Exception:
        try:
            parsed = ast.literal_eval(payload)
        except Exception:
            return []
    if isinstance(parsed, dict):
        parsed = parsed.get("attachments") or parsed.get("bid_attachments") or []
    if not isinstance(parsed, list):
        return []

    cleaned: list[dict] = []
    for item in parsed:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()
        if not name:
            continue
        cleaned.append({
            "name": name,
            "start_locator": _normalize_locator(item.get("start_locator", "")),
            "end_locator": _normalize_locator(item.get("end_locator", "")),
            "description": str(item.get("description") or "").strip(),
        })
    return cleaned


def _normalize_locator(raw_locator: Any) -> str:
    s = str(raw_locator or "").strip().upper()
    if not s:
        return ""
    m = re.search(r"P\s*0*(\d+)", s)
    if not m:
        return s if s.startswith("P") else ""
    return f"P{int(m.group(1)):04d}"


def _strip_code_fence(text: str) -> str:
    raw = str(text or "").strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```[a-zA-Z0-9_-]*\n?", "", raw, count=1)
        raw = re.sub(r"\n?```$", "", raw, count=1)
    return raw.strip()


def _try_parse_jsonish(raw: Any) -> Any:
    if isinstance(raw, (dict, list)):
        return raw
    text = _strip_code_fence(str(raw or ""))
    if not text:
        return None
    candidates = [text]
    for left, right in (("{", "}"), ("[", "]")):
        start = text.find(left)
        end = text.rfind(right)
        if start >= 0 and end > start:
            candidates.append(text[start:end + 1])
    for candidate in candidates:
        try:
            return json.loads(candidate)
        except Exception:
            pass
        try:
            return ast.literal_eval(candidate)
        except Exception:
            pass
    return None
