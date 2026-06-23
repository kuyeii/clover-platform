"""
后台任务端点 — 防前端刷新中断
将 Dify 调用放入后台 asyncio Task，前端通过 task_id 重连获取进度。
"""
import os
import json
import uuid
import logging
import time
import sys
import ast
import hashlib
import shutil
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional
import re

import httpx
from fastapi import APIRouter, HTTPException, UploadFile, File, Form, Query, Request
from fastapi.responses import StreamingResponse

_MW_SRC = Path(__file__).resolve().parents[3] / "gateway-out" / "src"
if _MW_SRC.is_dir() and str(_MW_SRC) not in sys.path:
    sys.path.insert(0, str(_MW_SRC))
try:
    from markdown_norm import normalize_generated_markdown  # type: ignore
except ImportError:
    def normalize_generated_markdown(content: str, section_title: str = "") -> str:  # type: ignore
        return (content or "").strip()

from .task_manager import task_manager
from .outline_word_normalize import normalize_outline_word_budget_dict
from .bidder_pipt import BidderInfoRequiredError, merge_bidder_pipt_context, validate_required_bidder_info
from .content_placeholder_resolve import find_illegal_pipt_bidder_placeholders, resolve_body_placeholders
from .writing_hint_builder import compose_runtime_writing_hint
from .database import ImageRegistry, KnowledgeImageAsset, SessionLocal, ProjectRecord
from .docanalysis_protocol import (
    build_docanalysis_groups,
    build_docanalysis_system_prompt,
    extract_docanalysis_node_content,
    extract_docanalysis_text_output,
    load_docanalysis_framework,
    parse_bid_attachments_payload,
    parse_docanalysis_result_map,
    split_bid_attachments_tag,
)

logger = logging.getLogger(__name__)


def _unresolved_placeholder_tokens(replace_report: list[dict[str, Any]]) -> list[str]:
    return [
        str(item.get("placeholder") or "")
        for item in (replace_report or [])
        if isinstance(item, dict) and item.get("status") == "miss" and item.get("placeholder")
    ]

router = APIRouter()
_BID_ATTACH_STAGE_PREFIX = "__bid_attachments__"
_ANALYSIS_V2_STAGE_PREFIX = "__analysis_v2__"
_TASK_EVENT_STAGE_PREFIX = "__task_event__"
PRO_ENGINE_ROOT = Path(__file__).resolve().parents[3]
DIAGRAM_ARTIFACT_DIR = Path(
    os.environ.get("DIAGRAM_ARTIFACT_DIR", str(PRO_ENGINE_ROOT / "data" / "diagram_artifacts"))
)
_MERMAID_PUPPETEER_CONFIG = PRO_ENGINE_ROOT / "tools" / "puppeteer.no-sandbox.json"

# SVG 图表生成默认关闭，需显式配置 ENABLE_DIAGRAM_GENERATION=true。
DIAGRAM_GENERATOR_MODE = os.environ.get("DIAGRAM_GENERATOR_MODE", "svg").strip().lower()


def _diagram_generation_enabled() -> bool:
    """运行时读取图表开关，避免任务模块导入早于环境变量加载导致误判。"""
    return os.environ.get("ENABLE_DIAGRAM_GENERATION", "false").strip().lower() == "true"


def _get_diagram_generator_mode() -> str:
    """返回当前图表工作流模式：svg 使用原工作流，mermaid 使用 Mermaid 专用工作流。"""
    mode = os.environ.get("DIAGRAM_GENERATOR_MODE", DIAGRAM_GENERATOR_MODE).strip().lower()
    return "mermaid" if mode in {"mermaid", "mmd"} else "svg"


def _get_diagram_workflow_name() -> str:
    return "diagram_generator_mermaid" if _get_diagram_generator_mode() == "mermaid" else "diagram_generator"


def _get_diagram_workflow_key(_r) -> str:
    return _r._get_workflow_key(_get_diagram_workflow_name())


def _push_task_event(task_id: str, event: str, payload: dict) -> None:
    body = {"event": event, **(payload or {})}
    task_manager.update_stage(task_id, f"{_TASK_EVENT_STAGE_PREFIX}{json.dumps(body, ensure_ascii=False)}")


def _outline_stage_meta_from_label(stage: str) -> tuple[int, int]:
    s = str(stage or "")
    if "模型连接中" in s or "模型预热中" in s:
        return 0, 3
    if "生成大纲" in s:
        return 2, 12
    if "大纲润色" in s:
        return 3, 75
    if "数据校验" in s or "解析中" in s:
        return 4, 86
    if "归一化中" in s:
        return 5, 94
    if "结构已就绪" in s:
        return 6, 100
    return 0, 0


def _emit_outline_stage_event(task_id: str, label: str, *, elapsed_sec: int = 0, heartbeat: bool = False) -> None:
    phase, percent = _outline_stage_meta_from_label(label)
    _push_task_event(task_id, "stage", {
        "label": label,
        "phase": phase,
        "percent": percent,
        "elapsed_sec": int(max(elapsed_sec, 0)),
        "heartbeat": bool(heartbeat),
    })


def _make_h2_seed_sections(seed_headings: list[dict]) -> list[dict]:
    sections: list[dict] = []
    for idx, seed in enumerate(seed_headings or []):
        sections.append({
            "id": str(seed.get("id") or f"seed_{idx + 1}"),
            "title": str(seed.get("title") or ""),
            "wordCount": int(seed.get("wordCount") or 0),
            "writingHint": str(seed.get("writingHint") or ""),
            "keywords": seed.get("keywords") or [],
            "relatedAnalysisIds": seed.get("relatedAnalysisIds") or [],
            "needDiagram": False,
            "diagramBrief": "",
            "diagramPlan": {},
            "headingLevel": 2,
            "children": [],
        })
    return sections


def _outline_sections_window_batches(sections: list[dict], window_size: int = 2) -> list[list[dict]]:
    if not sections:
        return []
    size = max(1, int(window_size or 1))
    return [sections[i:i + size] for i in range(0, len(sections), size)]


def _count_visible_chars(text: str) -> int:
    """统计正文可见字符数：排除 diagram/svg 源码与 HTML 标签。"""
    if not text:
        return 0
    plain = re.sub(r'<diagram\b[\s\S]*?</diagram>', '', text, flags=re.IGNORECASE)
    plain = re.sub(r'<svg\b[\s\S]*?</svg>', '', plain, flags=re.IGNORECASE)
    plain = re.sub(r'<[^>]+>', '', plain)
    return len((plain or '').replace(" ", "").replace("\n", ""))


def _split_diagram_blocks(text: str) -> tuple[str, str]:
    raw = str(text or "")
    blocks = re.findall(r"<diagram\b[\s\S]*?</diagram>", raw, flags=re.IGNORECASE)
    content = re.sub(r"\n?<diagram\b[\s\S]*?</diagram>\n?", "\n", raw, flags=re.IGNORECASE).strip()
    suffix = "\n".join(blocks).strip()
    return content, suffix


def _safe_diagram_artifact_id(diagram_id: str) -> str:
    did = str(diagram_id or "").strip()
    if not re.fullmatch(r"[a-fA-F0-9]{16,64}", did):
        raise HTTPException(status_code=400, detail="无效的图表 ID")
    return did.lower()


def _persist_diagram_artifact(project_id: str, section_id: str, svg: str) -> dict[str, Any]:
    """将大段 SVG 落为后端 artifact，正文只保存轻量 diagram 引用。"""
    raw_svg = str(svg or "").strip()
    if not raw_svg:
        raise ValueError("svg 不能为空")
    seed = f"{project_id}\n{section_id}\n{raw_svg}".encode("utf-8", errors="ignore")
    diagram_id = hashlib.sha256(seed).hexdigest()[:24]
    project_dir = DIAGRAM_ARTIFACT_DIR / re.sub(r"[^a-zA-Z0-9_.-]+", "_", project_id or "default")
    project_dir.mkdir(parents=True, exist_ok=True)
    path = project_dir / f"{diagram_id}.svg"
    if not path.exists():
        path.write_text(raw_svg, encoding="utf-8")
    return {
        "diagram_id": diagram_id,
        "svg_length": len(raw_svg),
        "svg_url": f"/api/diagram-artifacts/{diagram_id}.svg?project_id={project_id}",
    }


def _persist_mermaid_artifact(project_id: str, section_id: str, mermaid: str) -> dict[str, Any]:
    """将 Mermaid 源码落为 artifact，导出阶段再渲染为 PNG。"""
    raw_mermaid = str(mermaid or "").strip()
    if not raw_mermaid:
        raise ValueError("mermaid 不能为空")
    seed = f"{project_id}\n{section_id}\n{raw_mermaid}".encode("utf-8", errors="ignore")
    diagram_id = hashlib.sha256(seed).hexdigest()[:24]
    project_dir = DIAGRAM_ARTIFACT_DIR / re.sub(r"[^a-zA-Z0-9_.-]+", "_", project_id or "default")
    project_dir.mkdir(parents=True, exist_ok=True)
    path = project_dir / f"{diagram_id}.mmd"
    if not path.exists():
        path.write_text(raw_mermaid, encoding="utf-8")
    return {
        "diagram_id": diagram_id,
        "mermaid_length": len(raw_mermaid),
        "mermaid_url": f"/api/diagram-artifacts/{diagram_id}.mmd?project_id={project_id}",
    }


def _build_diagram_reference_tag(diagram: dict[str, Any]) -> str:
    did = str(diagram.get("diagram_id") or "").strip()
    title = str(diagram.get("title") or "架构图").replace('"', "&quot;")
    dtype = str(diagram.get("type") or "architecture").replace('"', "&quot;")
    return f'<diagram data-diagram-id="{did}" type="{dtype}" title="{title}"></diagram>'


def _escape_svg_text(text: str) -> str:
    return (
        str(text or "")
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def _mermaid_to_fallback_svg(mermaid: str, title: str = "数据流图") -> str:
    """
    Mermaid artifact 的轻量预览兜底。
    前端编辑器只消费 SVG；当图表工作流返回 .mmd 时，后端提供可读 SVG，DOCX 导出仍走 mmdc 渲染。
    """
    lines = [line.strip() for line in str(mermaid or "").splitlines() if line.strip()]
    body_lines = [line for line in lines if not re.match(r"^(?:flowchart|graph)\s+", line, flags=re.IGNORECASE)]
    if not body_lines:
        body_lines = ["Mermaid 图表源码已生成"]
    body_lines = body_lines[:18]
    width = 1120
    row_h = 30
    height = max(180, 92 + len(body_lines) * row_h)
    escaped_title = _escape_svg_text(title or "数据流图")
    rows = []
    for idx, line in enumerate(body_lines):
        y = 88 + idx * row_h
        rows.append(
            f'<text x="40" y="{y}" font-size="16" fill="#334155" font-family="monospace">{_escape_svg_text(line[:118])}</text>'
        )
    footer_y = height - 28
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">'
        '<rect width="100%" height="100%" rx="16" fill="#f8fafc"/>'
        '<rect x="24" y="22" width="1072" height="44" rx="10" fill="#e0f2fe" stroke="#bae6fd"/>'
        f'<text x="40" y="50" font-size="20" font-weight="700" fill="#0369a1" font-family="Arial, sans-serif">{escaped_title}</text>'
        f'{"".join(rows)}'
        f'<text x="40" y="{footer_y}" font-size="13" fill="#64748b" font-family="Arial, sans-serif">Mermaid 源码预览；导出 DOCX 时会渲染为正式图片。</text>'
        '</svg>'
    )


def _find_mmdc_command() -> list[str] | None:
    """查找本地 Mermaid CLI；不隐式安装依赖。"""
    candidates: list[Path] = []
    if sys.platform == "win32":
        candidates.extend([
            PRO_ENGINE_ROOT / "node_modules" / ".bin" / "mmdc.cmd",
            PRO_ENGINE_ROOT / "tools" / "node_modules" / ".bin" / "mmdc.cmd",
        ])
    else:
        candidates.extend([
            PRO_ENGINE_ROOT / "node_modules" / ".bin" / "mmdc",
            PRO_ENGINE_ROOT / "tools" / "node_modules" / ".bin" / "mmdc",
        ])
    for candidate in candidates:
        if candidate.is_file():
            return [str(candidate)]
    found = shutil.which("mmdc")
    return [found] if found else None


def _render_mermaid_to_svg_file(mermaid_path: Path, svg_path: Path) -> bool:
    """将 .mmd 渲染为同名 .svg，失败时由调用方走预览兜底。"""
    command = _find_mmdc_command()
    if not command:
        logger.warning("Mermaid CLI(mmdc) 未安装，使用 SVG 预览兜底: %s", mermaid_path.name)
        return False
    svg_path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="proengine_mmdc_") as tmp_dir:
        tmp_svg = Path(tmp_dir) / f"{mermaid_path.stem}.svg"
        parts = [
            *command,
            "-i",
            str(mermaid_path),
            "-o",
            str(tmp_svg),
            "-b",
            "white",
            "-w",
            os.environ.get("MERMAID_RENDER_WIDTH", "1400"),
            "-H",
            os.environ.get("MERMAID_RENDER_HEIGHT", "1050"),
        ]
        if _MERMAID_PUPPETEER_CONFIG.is_file():
            parts.extend(["-p", str(_MERMAID_PUPPETEER_CONFIG)])
        try:
            env = os.environ.copy()
            env.setdefault("PUPPETEER_CACHE_DIR", str(PRO_ENGINE_ROOT / "node_modules" / ".cache" / "puppeteer"))
            result = subprocess.run(parts, capture_output=True, text=True, timeout=120, env=env)
            if result.returncode != 0:
                err = (result.stderr or result.stdout or "").strip()
                logger.warning("Mermaid SVG 渲染失败: %s", err[:1000])
                return False
            if not tmp_svg.exists() or tmp_svg.stat().st_size <= 0:
                return False
            svg_text = tmp_svg.read_text(encoding="utf-8").strip()
            if not svg_text.lower().startswith("<svg"):
                return False
            svg_path.write_text(svg_text, encoding="utf-8")
            return True
        except Exception as exc:
            logger.warning("Mermaid SVG 渲染异常: %s", exc)
            return False


def _build_diagram_task_result(
    request: dict,
    content: str,
    diagrams_generated: list,
    diagram_error: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """统一组装图表任务的章节结果，确保单图和批量任务返回结构一致。"""
    section_id = str(request.get("section_id", "") or "")
    replace_report = request.get("replace_report", []) or []
    raw_score = request.get("quality_score")
    quality_score = None
    if raw_score is not None:
        try:
            quality_score = int(float(raw_score))
        except (ValueError, TypeError):
            pass
    result_payload = {
        "done": True,
        "section_id": section_id,
        "content": content,
        "word_count": _count_visible_chars(content),
        "quality_score": quality_score,
        "feedback": request.get("feedback"),
        "replace_report": replace_report,
        "diagrams_count": len(diagrams_generated or []),
    }
    if diagram_error:
        result_payload["diagram_error"] = diagram_error
    return result_payload


def _build_diagram_skip_payload(
    *,
    workflow_name: str,
    enable_diagrams: bool,
    need_diagram: bool,
    diagram_brief: str,
    max_diagrams: int,
    diagram_key: str,
) -> Optional[dict[str, Any]]:
    """生成可观测的图表跳过原因，避免把配置/规划问题误判成工作流失败。"""
    reasons: list[str] = []
    if workflow_name != "content_writer":
        reasons.append(f"workflow_name={workflow_name}")
    if not _diagram_generation_enabled():
        reasons.append("ENABLE_DIAGRAM_GENERATION=false")
    if not enable_diagrams:
        reasons.append("enable_diagrams=false")
    if not need_diagram:
        reasons.append("need_diagram=false")
    if not str(diagram_brief or "").strip():
        reasons.append("diagram_brief=empty")
    if max_diagrams <= 0:
        reasons.append(f"max_diagrams={max_diagrams}")
    if enable_diagrams and need_diagram and str(diagram_brief or "").strip() and max_diagrams > 0 and not diagram_key:
        reasons.append(f"{_get_diagram_workflow_name()}_key_missing")
    if not reasons:
        return None
    return {
        "code": "diagram_skipped",
        "mode": _get_diagram_generator_mode(),
        "workflow": _get_diagram_workflow_name(),
        "reasons": reasons,
    }


async def _run_diagram_request(
    task_id: str,
    request: dict,
    _r,
    diagram_key: str,
) -> dict[str, Any]:
    """执行单个章节图表请求，失败时返回原正文和 diagram_error。"""
    project_id = str(request.get("project_id", "") or "").strip()
    section_title = str(request.get("section_title", "") or "").strip()
    base_content = str(request.get("base_content", "") or "")
    writing_hint = str(request.get("writing_hint", "") or "")
    keywords = str(request.get("keywords", "") or "")
    expected_words = int(request.get("expected_words", 900) or 900)
    analysis_context = str(request.get("analysis_context", "") or "")
    slice_text = str(request.get("section_outline_slice", "") or "")
    composed_hint = compose_runtime_writing_hint(
        writing_hint,
        section_title,
        expected_words,
        keywords,
        section_outline_slice=slice_text,
        analysis_context=analysis_context,
    )

    enable_diagrams = bool(request.get("enable_diagrams", False) and _diagram_generation_enabled())
    max_diagrams = int(request.get("max_diagrams", 0) or 0) if enable_diagrams else 0
    need_diagram = bool(request.get("need_diagram", False))
    diagram_brief = str(request.get("diagram_brief", "") or "")
    diagram_type_hint = str(request.get("diagram_type_hint", "architecture") or "architecture")
    diagram_specs = request.get("diagram_specs") or request.get("diagram_spec")
    raw_global_outline = str(request.get("global_outline", "") or "")

    request_mapping_flat = request.get("mapping_table", {}) or {}
    if not isinstance(request_mapping_flat, dict):
        request_mapping_flat = {}
    replace_map_seed: dict[str, str] = {}
    for row in request.get("replace_report", []) or []:
        if isinstance(row, dict) and row.get("placeholder"):
            replace_map_seed[str(row["placeholder"])] = str(row.get("original", ""))

    diagrams_generated, diagram_slot_reserved, diagram_error = await _execute_diagram_for_section(
        task_id,
        project_id,
        _r,
        diagram_key,
        enable_diagrams,
        need_diagram,
        diagram_brief,
        max_diagrams,
        diagram_type_hint,
        section_title,
        composed_hint,
        keywords,
        raw_global_outline,
        base_content,
        diagram_specs,
    )
    if not diagrams_generated and diagram_slot_reserved:
        await task_manager.release_diagram_slot(project_id)

    content = base_content
    if diagrams_generated:
        diagram_html_blocks = [_build_diagram_reference_tag(d) for d in diagrams_generated]
        content = content + "\n" + "\n".join(diagram_html_blocks)
    db = SessionLocal()
    try:
        content, _, replace_report = resolve_body_placeholders(
            content,
            replace_map_seed,
            request_mapping_flat,
            db_session=db,
            audit_source="task.diagram_section",
        )
        db.commit()
    except Exception:
        db.rollback()
        content, _, replace_report = resolve_body_placeholders(
            content,
            replace_map_seed,
            request_mapping_flat,
            audit_source="task.diagram_section",
        )
    finally:
        db.close()
    req_for_result = {**request, "replace_report": replace_report}
    return _build_diagram_task_result(req_for_result, content, diagrams_generated, diagram_error)


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
    for left, right in (("[", "]"), ("{", "}")):
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


def _dedupe_join(parts: list[str], max_len: int = 7000) -> str:
    out: list[str] = []
    seen = set()
    total = 0
    for raw in parts:
        text = str(raw or "").strip()
        if not text or text in seen:
            continue
        seen.add(text)
        item = text if not out else f"\n\n---\n\n{text}"
        if total + len(item) > max_len:
            remain = max_len - total
            if remain > 40:
                out.append(item[:remain].rstrip() + "\n\n...(截断)")
            break
        out.append(item)
        total += len(item)
    return "".join(out).strip()


def _normalize_group_title_key(value: str) -> str:
    return re.sub(r"\s+", "", str(value or "").strip().lower())


def _extract_group_sections_payload(outputs: dict[str, Any]) -> list[dict]:
    candidates = [
        outputs.get("sections"),
        outputs.get("result"),
        outputs.get("text"),
        outputs.get("structured_output"),
        outputs.get("sections_json"),
    ]
    for candidate in candidates:
        parsed = _try_parse_jsonish(candidate)
        if isinstance(parsed, list):
            return [row for row in parsed if isinstance(row, dict)]
        if isinstance(parsed, dict):
            sections = parsed.get("sections") or parsed.get("items") or parsed.get("data")
            if isinstance(sections, list):
                return [row for row in sections if isinstance(row, dict)]
    return []


def _summarize_workflow_outputs(outputs: dict[str, Any]) -> str:
    if not isinstance(outputs, dict):
        return f"outputs 类型异常: {type(outputs).__name__}"
    parts: list[str] = []
    for key, value in outputs.items():
        text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, default=str)
        parts.append(f"{key}={str(text)[:180]}")
    return "; ".join(parts)[:700] if parts else "outputs 为空"


def _build_group_writing_children(children: list[dict]) -> list[dict]:
    normalized: list[dict] = []
    for idx, child in enumerate(children):
        section_id = str(child.get("section_id") or child.get("id") or f"group_child_{idx + 1}").strip()
        section_title = str(child.get("section_title") or child.get("title") or "").strip()
        keywords = str(child.get("keywords") or section_title).strip()
        expected_words = int(child.get("expected_words") or 0)
        analysis_context = str(child.get("analysis_context") or "").strip()
        writing_hint = compose_runtime_writing_hint(
            str(child.get("writing_hint") or ""),
            section_title,
            expected_words,
            keywords,
            section_outline_slice=str(child.get("section_outline_slice") or ""),
            analysis_context=analysis_context,
        )
        normalized.append({
            "section_id": section_id,
            "section_title": section_title,
            "keywords": keywords,
            "expected_words": expected_words,
            "writing_hint": writing_hint,
            "analysis_context": analysis_context,
            "section_outline_slice": str(child.get("section_outline_slice") or ""),
            "requires_search": bool(child.get("requires_search", False)),
            "generation_strategy": str(child.get("generation_strategy") or "general").strip() or "general",
            "need_diagram": bool(child.get("need_diagram", False)),
            "diagram_brief": str(child.get("diagram_brief") or "").strip(),
            "diagram_type_hint": str(child.get("diagram_type_hint") or "architecture").strip() or "architecture",
            "diagram_priority": int(child.get("diagram_priority") or 0),
        })
    return normalized


def _build_group_search_query(group_title: str, children: list[dict], max_terms: int = 12, max_len: int = 160) -> str:
    """
    为 content_group_writer 生成联网搜索关键词。
    不能只搜 H2 标题，否则很容易退化成父级泛词；应带上 H3 标题与关键词做约束。
    """
    terms: list[str] = []
    seen: set[str] = set()

    def _push(raw: Any) -> None:
        text = re.sub(r"\s+", " ", str(raw or "").strip())
        if not text:
            return
        key = re.sub(r"\s+", "", text).lower()
        if key in seen:
            return
        seen.add(key)
        terms.append(text)

    def _split_keywords(raw: Any) -> list[str]:
        text = str(raw or "").strip()
        if not text:
            return []
        normalized = re.sub(r"[，、；;/|]+", ",", text)
        return [item.strip() for item in normalized.split(",") if item and item.strip()]

    _push(group_title)
    for child in children:
        _push(child.get("section_title"))
    for child in children:
        for keyword in _split_keywords(child.get("keywords")):
            _push(keyword)

    compact: list[str] = []
    current_len = 0
    for term in terms:
        if len(compact) >= max_terms:
            break
        next_len = current_len + (1 if compact else 0) + len(term)
        if compact and next_len > max_len:
            break
        compact.append(term)
        current_len = next_len
    return " ".join(compact).strip() or str(group_title or "").strip() or "招标技术方案"


def _format_dify_runtime_error(exc: Exception) -> str:
    """将 Dify/模型供应商底层错误转成可操作文案，避免只暴露 Python 异常串。"""
    message = str(exc or "").strip()
    lower = message.lower()
    if "dashscope.aliyuncs.com" in lower and ("nameresolutionerror" in lower or "failed to resolve" in lower):
        return (
            "Dify 模型供应商 DashScope DNS 解析失败：dashscope.aliyuncs.com 无法解析。"
            "请在 Dify API/Worker 运行环境检查 DNS、代理或出网策略；标书后端已成功调用 Dify，但模型节点不可用。"
        )
    if "[models]" in lower and "server unavailable" in lower:
        return (
            "Dify 模型节点不可用（[models] Server Unavailable）。"
            "请检查 Dify 模型供应商配置、API Key、DNS/代理与出网策略。"
            + (f" 原始错误：{message}" if message else "")
        )
    if "name or service not known" in lower or "failed to resolve" in lower:
        return (
            "Dify 工作流网络解析失败。请检查 DIFY_API_URL 或 Dify 运行环境的 DNS/代理配置。"
            + (f" 原始错误：{message}" if message else "")
        )
    return message or "Dify 工作流调用失败"


async def _collect_workflow_outputs(
    task_id: str,
    dify_key: str,
    inputs: dict[str, Any],
    *,
    _r,
    initial_stage: str,
) -> dict[str, Any]:
    task_manager.update_stage(task_id, initial_stage)
    outputs: dict[str, Any] = {}
    got_finished = False
    workflow_run_id = ""
    async for chunk in _r._call_dify_workflow_stream(dify_key, inputs):
        _ensure_task_running(task_id)
        if isinstance(chunk, dict):
            if chunk.get("dify_task_id"):
                task_manager.set_dify_task_id(task_id, chunk["dify_task_id"])
            if chunk.get("__error__"):
                raise RuntimeError(_format_dify_runtime_error(RuntimeError(str(chunk.get("error") or "Dify 工作流返回错误事件"))))
            if chunk.get("__stage__"):
                workflow_run_id = str(chunk.get("workflow_run_id") or workflow_run_id or "")
                task_manager.update_stage(task_id, chunk["__stage__"])
            elif chunk.get("__finished__"):
                outputs = chunk.get("outputs", {}) or {}
                workflow_run_id = str(chunk.get("workflow_run_id") or workflow_run_id or "")
                got_finished = True
                break
    if not got_finished and workflow_run_id:
        logger.warning("[Task %s] 内容工作流未收到 finished，尝试 fallback GET /workflows/run/%s", task_id, workflow_run_id)
        try:
            dify_base = os.environ.get("DIFY_API_URL", "http://localhost/v1").rstrip("/")
            async with httpx.AsyncClient(timeout=60) as fc:
                fb_resp = await fc.get(
                    f"{dify_base}/workflows/run/{workflow_run_id}",
                    headers={"Authorization": f"Bearer {dify_key}"},
                )
                fb_resp.raise_for_status()
                fb_data = fb_resp.json()
            outputs = (((fb_data or {}).get("data") or {}).get("outputs") or {}) if isinstance(fb_data, dict) else {}
            if outputs:
                task_manager.update_stage(task_id, "📥 正在回收远端完成结果")
                got_finished = True
        except Exception as fb_err:
            logger.warning("[Task %s] 内容工作流 fallback GET 失败: %s", task_id, _format_dify_runtime_error(fb_err))
    if not got_finished:
        raise RuntimeError("内容工作流异常中断（未收到 finished 事件）")
    return outputs


_PRO_IMAGE_PLACEHOLDER_RE = re.compile(r"__PRO_IMG_([a-fA-F0-9]+)__")
_PRO_IMAGE_MARKDOWN_RE = re.compile(r"!\[([^\]]*)\]\(\s*(__PRO_IMG_([a-fA-F0-9]+)__)\s*\)")


def _normalize_referenced_images(content: str) -> tuple[str, list[dict[str, Any]]]:
    """校验正文图片占位符，只保留后端图片库中真实存在的引用。"""
    text = str(content or "")
    hashes = sorted({match.group(1).lower() for match in _PRO_IMAGE_PLACEHOLDER_RE.finditer(text)})
    if not hashes:
        return text, []

    db = SessionLocal()
    try:
        registry_rows = db.query(ImageRegistry).filter(ImageRegistry.image_hash.in_(hashes)).all()
        asset_rows = db.query(KnowledgeImageAsset).filter(KnowledgeImageAsset.image_hash.in_(hashes)).all()
    finally:
        db.close()

    registry_by_hash = {str(row.image_hash or "").lower(): row for row in registry_rows}
    asset_by_hash = {str(row.image_hash or "").lower(): row for row in asset_rows}
    referenced_by_placeholder: dict[str, dict[str, Any]] = {}

    def _image_info(image_hash: str) -> dict[str, Any] | None:
        row = registry_by_hash.get(image_hash)
        if not row:
            return None
        asset = asset_by_hash.get(image_hash)
        caption = (
            str(getattr(asset, "caption", "") or "").strip()
            or str(getattr(row, "vlm_caption", "") or "").strip()
            or "知识库配图"
        )
        placeholder = str(row.placeholder or f"__PRO_IMG_{image_hash}__")
        return {
            "placeholder": placeholder,
            "caption": caption,
            "preview_url": str(row.preview_url or ""),
            "source_doc": str(getattr(asset, "source_doc", "") or ""),
        }

    def _remember(info: dict[str, Any]) -> None:
        referenced_by_placeholder[info["placeholder"]] = info

    def _replace_markdown_image(match: re.Match[str]) -> str:
        image_hash = match.group(3).lower()
        info = _image_info(image_hash)
        if not info:
            logger.warning("清理不存在的知识库图片引用: %s", match.group(2))
            return ""
        _remember(info)
        alt = match.group(1).strip() or f"图：{info['caption']}"
        return f"![{alt}]({info['placeholder']})"

    text = _PRO_IMAGE_MARKDOWN_RE.sub(_replace_markdown_image, text)

    def _replace_plain_placeholder(match: re.Match[str]) -> str:
        if text[max(0, match.start() - 2):match.start()] == "](" and text[match.end():match.end() + 1] == ")":
            return match.group(0)
        image_hash = match.group(1).lower()
        info = _image_info(image_hash)
        if not info:
            logger.warning("清理不存在的知识库图片占位符: %s", match.group(0))
            return ""
        _remember(info)
        return f"![图：{info['caption']}]({info['placeholder']})"

    text = _PRO_IMAGE_PLACEHOLDER_RE.sub(_replace_plain_placeholder, text)
    referenced_images = list(referenced_by_placeholder.values())
    return text, referenced_images


def _finalize_single_content_result(
    section_title: str,
    outputs: dict[str, Any],
    request_mapping_flat: dict[str, str],
    *,
    strip_structural_numbering: bool = False,
) -> dict[str, Any]:
    raw_content = (
        outputs.get("text")
        or outputs.get("result")
        or outputs.get("structured_output")
        or ""
    )
    content = re.sub(r"<think>.*?</think>", "", str(raw_content or ""), flags=re.DOTALL).strip()
    content = _finalize_generated_body(
        content,
        section_title,
        strip_structural_numbering=strip_structural_numbering,
    )

    feedback = outputs.get("feedback") or ""
    if feedback:
        fb_clean = str(feedback).strip()
        if fb_clean and len(fb_clean) > 10 and content.startswith(fb_clean):
            content = content[len(fb_clean):].strip()
            content = _finalize_generated_body(
                content,
                section_title,
                strip_structural_numbering=strip_structural_numbering,
            )

    raw_score = outputs.get("quality_score")
    quality_score = None
    if raw_score is not None:
        try:
            quality_score = int(float(raw_score))
        except (ValueError, TypeError):
            quality_score = None

    replace_map: dict[str, str] = {}
    db = SessionLocal()
    try:
        content, _, replace_report = resolve_body_placeholders(
            content,
            replace_map,
            request_mapping_flat,
            db_session=db,
            audit_source="task.content_result",
        )
        db.commit()
    except Exception:
        db.rollback()
        content, _, replace_report = resolve_body_placeholders(
            content,
            replace_map,
            request_mapping_flat,
            audit_source="task.content_result",
        )
    finally:
        db.close()
    content, referenced_images = _normalize_referenced_images(content)
    if _count_visible_chars(content) <= 0:
        raise RuntimeError("内容工作流未返回可用正文")
    placeholder_issues = sorted(find_illegal_pipt_bidder_placeholders(content))
    unresolved_placeholders = _unresolved_placeholder_tokens(replace_report)
    if unresolved_placeholders:
        placeholder_issues.extend(unresolved_placeholders)
    return {
        "content": content,
        "word_count": _count_visible_chars(content),
        "quality_score": quality_score,
        "feedback": feedback or None,
        "replace_report": replace_report,
        "referenced_images": referenced_images,
        "placeholder_issues": placeholder_issues,
    }


def _match_group_section_item(item: dict[str, Any], children: list[dict]) -> Optional[dict]:
    item_id = str(item.get("section_id") or item.get("id") or "").strip()
    item_title = _normalize_group_title_key(str(item.get("section_title") or item.get("title") or ""))
    for child in children:
        if item_id and item_id == child["section_id"]:
            return child
        if item_title and item_title == _normalize_group_title_key(child["section_title"]):
            return child
    return None


def _parse_group_content_results(
    outputs: dict[str, Any],
    children: list[dict],
    request_mapping_flat: dict[str, str],
) -> dict[str, Any]:
    sections_raw = _extract_group_sections_payload(outputs)
    child_by_id = {child["section_id"]: child for child in children}
    rank = {child["section_id"]: idx for idx, child in enumerate(children)}
    failed_by_id: dict[str, str] = {}
    if not sections_raw:
        return {
            "sections": [],
            "failed_sections": [
                {
                    "section_id": child["section_id"],
                    "section_title": child["section_title"],
                    "error": "批量正文工作流未返回可解析的 sections",
                }
                for child in children
            ],
            "parse_error": "批量正文工作流未返回可解析的 sections",
        }

    ordered: list[dict] = []
    used_ids = set()
    for item in sections_raw:
        child = _match_group_section_item(item, children)
        if not child:
            continue
        section_id = child["section_id"]
        if section_id in used_ids:
            continue
        raw_content = item.get("content") or item.get("text") or item.get("body") or ""
        if not str(raw_content or "").strip():
            failed_by_id[section_id] = "批量正文结果正文为空"
            continue
        payload = _finalize_single_content_result(child["section_title"], {"text": raw_content}, request_mapping_flat)
        placeholder_issues = payload.get("placeholder_issues") or []
        if placeholder_issues:
            failed_by_id[section_id] = (
                "占位符格式异常且无法可靠还原: "
                + "、".join(str(item) for item in placeholder_issues[:5])
            )
            continue
        failed_by_id.pop(section_id, None)
        payload.update({
            "section_id": section_id,
            "section_title": child["section_title"],
        })
        raw_score = item.get("quality_score")
        if raw_score is not None:
            try:
                payload["quality_score"] = int(float(raw_score))
            except (ValueError, TypeError):
                pass
        if item.get("feedback"):
            payload["feedback"] = str(item.get("feedback") or "")
        ordered.append(payload)
        used_ids.add(section_id)

    for child in children:
        section_id = child["section_id"]
        if section_id in used_ids or section_id in failed_by_id:
            continue
        failed_by_id[section_id] = "批量正文结果缺失子章节"

    ordered.sort(key=lambda row: rank.get(row["section_id"], 9999))
    failed_sections = [
        {
            "section_id": section_id,
            "section_title": child_by_id.get(section_id, {}).get("section_title", section_id),
            "error": error,
        }
        for section_id, error in failed_by_id.items()
    ]
    failed_sections.sort(key=lambda row: rank.get(row["section_id"], 9999))

    parse_error = ""
    if not ordered:
        parse_error = "批量正文工作流返回了 sections，但没有可用正文"
    elif failed_sections:
        parse_error = "批量正文结果存在缺失子章节"
    return {
        "sections": ordered,
        "failed_sections": failed_sections,
        "parse_error": parse_error,
    }


async def _repair_group_failed_sections(
    *,
    task_id: str,
    _r,
    children: list[dict],
    failed_sections: list[dict],
    request: dict,
    request_mapping_flat: dict[str, str],
    group_placeholder_hint: str,
    group_outline_slice: str,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """批量正文漏回个别子章节时，使用单章节工作流补偿生成。"""
    if not failed_sections:
        return [], []

    failed_ids = [str(row.get("section_id") or "").strip() for row in failed_sections if row.get("section_id")]
    failed_id_set = {sid for sid in failed_ids if sid}
    if not failed_id_set:
        return [], failed_sections

    child_by_id = {child["section_id"]: child for child in children}
    repaired: list[dict[str, Any]] = []
    still_failed: list[dict[str, Any]] = []
    for failed in failed_sections:
        section_id = str(failed.get("section_id") or "").strip()
        child = child_by_id.get(section_id)
        if not child:
            still_failed.append(failed)
            continue

        workflow_name = _r._resolve_content_workflow_name(child.get("generation_strategy", "general"))
        dify_key = _r._get_workflow_key(workflow_name)
        if not dify_key:
            still_failed.append({
                **failed,
                "error": f"{workflow_name} 工作流 API Key 未配置，无法补生成",
            })
            continue

        task_manager.update_stage(task_id, f"🩹 子章节补生成中：{child['section_title']}")
        repair_writing_hint = compose_runtime_writing_hint(
            str(child.get("writing_hint") or ""),
            child["section_title"],
            int(child.get("expected_words") or 0),
            str(child.get("keywords") or ""),
            section_outline_slice=str(child.get("section_outline_slice") or group_outline_slice),
            analysis_context=str(child.get("analysis_context") or ""),
        )
        inputs: dict[str, Any] = {
            "section_title": child["section_title"],
            "writing_hint": repair_writing_hint,
            "keywords": child["keywords"] if str(child.get("keywords") or "").strip() else child["section_title"],
            "expected_words": child["expected_words"],
            "project_summary": request.get("project_summary", ""),
            "global_outline": group_outline_slice,
            "placeholder_hint": group_placeholder_hint,
        }
        if workflow_name == "content_writer":
            inputs["requires_search"] = "true" if bool(child.get("requires_search", False)) else "false"
            inputs["image_map_hint"] = request.get("image_map_hint", "")

        try:
            outputs = await _collect_workflow_outputs(
                task_id,
                dify_key,
                inputs,
                _r=_r,
                initial_stage=f"🩹 子章节补生成中：{child['section_title']}",
            )
            payload = _finalize_single_content_result(
                child["section_title"],
                outputs,
                request_mapping_flat,
                strip_structural_numbering=workflow_name == "response_content_writer",
            )
            placeholder_issues = payload.get("placeholder_issues") or []
            if placeholder_issues:
                still_failed.append({
                    **failed,
                    "error": "补生成结果占位符格式异常且无法可靠还原: "
                    + "、".join(str(item) for item in placeholder_issues[:5]),
                })
                continue
            diagram_specs = outputs.get("diagram_specs") or outputs.get("diagram_spec") or outputs.get("diagram")
            if diagram_specs:
                payload["diagram_specs"] = diagram_specs
            payload.update({
                "section_id": section_id,
                "section_title": child["section_title"],
                "repaired": True,
                "repair_source": "single_content_writer",
            })
            repaired.append(payload)
            task_manager.update_stage(task_id, f"✅ 子章节补生成完成：{child['section_title']}")
        except Exception as exc:
            still_failed.append({
                **failed,
                "error": "批量正文缺失且补生成失败: " + _format_dify_runtime_error(exc),
            })
            logger.warning(
                "[Task %s] H2 子章节补生成失败: section=%s; error=%s",
                task_id,
                child["section_title"],
                _format_dify_runtime_error(exc),
            )

    return repaired, still_failed


def _parse_group_review_result(outputs: dict[str, Any]) -> dict[str, Any]:
    candidates = [
        outputs.get("group_feedback"),
        outputs.get("result"),
        outputs.get("text"),
        outputs.get("structured_output"),
    ]
    for candidate in candidates:
        parsed = _try_parse_jsonish(candidate)
        if isinstance(parsed, dict):
            group_feedback = str(parsed.get("group_feedback") or parsed.get("feedback") or "").strip()
            quality_score = parsed.get("quality_score")
            payload: dict[str, Any] = {"group_feedback": group_feedback}
            if quality_score is not None:
                try:
                    payload["quality_score"] = int(float(quality_score))
                except (TypeError, ValueError):
                    pass
            return payload
        text = _strip_code_fence(str(candidate or ""))
        if text:
            return {"group_feedback": text}
    return {"group_feedback": ""}


def _extract_chapter_names_from_text(text: str) -> list[str]:
    """
    从附件结构节点内容中提取章节名列表，用于生成无定位符的兜底附件目录。
    优先级：<要点> XML 标签 → 按行切割（清理序号前缀）。
    """
    if not text:
        return []

    # 1. 优先解析 <要点>...</要点> 标签
    names = re.findall(r'<要点[^>]*>(.*?)</要点>', text, re.DOTALL)
    names = [n.strip() for n in names if n.strip()]
    if names:
        return names

    # 2. 降级：按行切割，过滤噪声
    _NOISE_PREFIX = re.compile(
        r'^(?:'
        r'[\d一二三四五六七八九十百]+[.、．。）)]\s*'   # 数字/中文序号
        r'|第[一二三四五六七八九十百\d]+[章节条]\s*'     # 第X章/节/条
        r'|\([一二三四五六七八九十\d]+\)\s*'             # （一）括号序号
        r')'
    )
    _JSON_CHARS = set('{}[]"=:/')
    cleaned: list[str] = []
    for line in text.splitlines():
        line = _NOISE_PREFIX.sub('', line.strip()).strip()
        # 过滤：太短、含 JSON 语法字符、以 * # 等 Markdown 开头
        if len(line) < 2:
            continue
        if any(c in _JSON_CHARS for c in line):
            continue
        if line.startswith(('*', '#', '`', '>')):
            continue
        cleaned.append(line)
    return cleaned


def _normalize_chapter_name_for_match(name: str) -> str:
    """章节名归一化：去掉序号、括号说明与空白，便于与 doc_blocks 匹配。"""
    s = str(name or "").strip().lower()
    if not s:
        return ""
    s = re.sub(r"<[^>]+>", "", s)
    s = re.sub(r"^[\s]*(?:\d+[.、)）]|\(?\d+\)?[.、]?|第[一二三四五六七八九十百\d]+[章节条])\s*", "", s)
    s = re.sub(r"[（(]\s*(?:商务|技术|资格|价格|响应|投标)\s*部分\s*[）)]", "", s)
    s = re.sub(r"[《》“”\"'`·\-\s:：，,。；;、/\\\\]", "", s)
    return s


def _is_chapter_match(chapter_norm: str, block_norm: str) -> bool:
    if not chapter_norm or not block_norm:
        return False
    if chapter_norm in block_norm:
        return True
    # 允许短标题反向包含（避免“报价表（商务部分）”与“报价表”匹配失败）
    if len(block_norm) >= 4 and block_norm in chapter_norm:
        return True
    return False


def _enrich_bid_attachments_with_doc_blocks(_r, project_id: str, items: list[dict]) -> list[dict]:
    """
    使用项目 doc_blocks 为附件目录补齐锚点：
    - start_locator/end_locator
    - start_block_id/end_block_id
    若定位失败则保持原值。
    """
    if not project_id or not isinstance(items, list) or not items:
        return items

    cache_entry = _r._locator_cache.get(project_id)
    if not cache_entry:
        _r._restore_locator_cache_from_disk(project_id)
        cache_entry = _r._locator_cache.get(project_id)

    doc_blocks = []
    if cache_entry:
        doc_blocks = cache_entry.get("doc_blocks", []) or []
    if not doc_blocks:
        doc_blocks = _r._load_doc_blocks_snapshot(project_id) or []
    if not doc_blocks:
        return items

    normalized_blocks: list[dict] = []
    for b in doc_blocks:
        if not isinstance(b, dict):
            continue
        text_norm = _normalize_chapter_name_for_match(b.get("text", ""))
        try:
            body_idx = int(b.get("body_idx", 0))
        except Exception:
            body_idx = 0
        normalized_blocks.append({
            "block_id": str(b.get("block_id") or ""),
            "locator": str(b.get("locator") or "").upper(),
            "body_idx": body_idx,
            "text_norm": text_norm,
        })
    if not normalized_blocks:
        return items

    matched_block_indices: list[tuple[int, int]] = []  # (item_idx, block_pos)
    cursor = 0
    for idx, item in enumerate(items):
        if not isinstance(item, dict):
            continue
        name_norm = _normalize_chapter_name_for_match(item.get("name", ""))
        if not name_norm:
            continue

        hit = -1
        for pos in range(cursor, len(normalized_blocks)):
            if _is_chapter_match(name_norm, normalized_blocks[pos]["text_norm"]):
                hit = pos
                break
        if hit < 0:
            for pos in range(0, len(normalized_blocks)):
                if _is_chapter_match(name_norm, normalized_blocks[pos]["text_norm"]):
                    hit = pos
                    break
        if hit >= 0:
            matched_block_indices.append((idx, hit))
            cursor = hit + 1

    if not matched_block_indices:
        return items

    enriched = [dict(i) if isinstance(i, dict) else i for i in items]
    for pos, (item_idx, block_pos) in enumerate(matched_block_indices):
        start_block = normalized_blocks[block_pos]
        next_block_pos = matched_block_indices[pos + 1][1] if pos + 1 < len(matched_block_indices) else len(normalized_blocks)
        end_block = normalized_blocks[max(block_pos, next_block_pos - 1)]

        row = enriched[item_idx]
        if not isinstance(row, dict):
            continue

        if not str(row.get("start_locator", "")).strip():
            row["start_locator"] = start_block.get("locator", "")
        if not str(row.get("end_locator", "")).strip():
            row["end_locator"] = end_block.get("locator", "")
        row["start_block_id"] = start_block.get("block_id", "")
        row["end_block_id"] = end_block.get("block_id", "")

    resolved = sum(
        1
        for x in enriched
        if isinstance(x, dict) and (x.get("start_locator") or x.get("start_block_id"))
    )
    logger.info(f"[{project_id}] 附件目录锚点补齐完成: {resolved}/{len(enriched)}")
    return enriched


def _load_existing_project_data(project_id: str) -> dict:
    if not project_id:
        return {}
    db = SessionLocal()
    try:
        record = db.query(ProjectRecord).filter(ProjectRecord.id == project_id).first()
        if not record:
            return {}
        data = json.loads(record.data) if isinstance(record.data, str) else (record.data or {})
        return data if isinstance(data, dict) else {}
    except Exception as e:
        logger.warning(f"[{project_id}] 读取项目数据失败: {e}")
        return {}
    finally:
        db.close()


def _collect_analysis_content_map(nodes: list[dict]) -> dict[str, str]:
    result: dict[str, str] = {}
    for node in nodes or []:
        if not isinstance(node, dict):
            continue
        node_id = str(node.get("id") or "").strip()
        children = node.get("children") or []
        if children:
            result.update(_collect_analysis_content_map(children))
            continue
        if node_id:
            result[node_id] = str(node.get("content") or "")
    return result


def _inflate_analysis_tree(nodes: list[dict], content_map: dict[str, str], parent_id: Optional[str] = None) -> list[dict]:
    tree: list[dict] = []
    for node in nodes or []:
        if not isinstance(node, dict):
            continue
        children = _inflate_analysis_tree(node.get("children") or [], content_map, str(node.get("id") or "").strip() or parent_id)
        tree.append({
            "id": str(node.get("id") or ""),
            "label": str(node.get("label") or ""),
            "content": str(content_map.get(str(node.get("id") or ""), "")),
            "parent_id": parent_id,
            "children": children,
        })
    return tree


def _parse_xml_items(text: str) -> list[str]:
    if not text:
        return []
    items = re.findall(r'<要点[^>]*>(.*?)</要点>', text, re.DOTALL)
    if items:
        return [re.sub(r'<[^>]+>', '', item).strip() for item in items if item and item.strip()]
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    return [re.sub(r'^\[[^\]]+\]\s*', '', line).strip() for line in lines if line.strip()]


def _parse_xml_field_map(text: str) -> dict[str, str]:
    result: dict[str, str] = {}
    if not text:
        return result
    for key, value in re.findall(r'<([^>/]+)>(.*?)</\1>', text, re.DOTALL):
        result[str(key).strip()] = re.sub(r'<[^>]+>', '', value).strip()
    return result


def _normalize_score_tag(value: str, name: str = "", criteria: str = "") -> str:
    tag = str(value or "").strip().lower()
    if tag in {"tech", "biz", "mixed"}:
        return tag
    text = f"{name}\n{criteria}".lower()
    tech_keywords = ["技术", "方案", "架构", "实施", "服务响应", "功能", "性能", "团队", "驻场", "运维", "培训", "交付"]
    biz_keywords = ["资质", "商务", "报价", "价格", "业绩", "合同", "付款", "售后", "承诺", "证书", "企业"]
    tech_hit = sum(1 for kw in tech_keywords if kw in text)
    biz_hit = sum(1 for kw in biz_keywords if kw in text)
    if tech_hit and not biz_hit:
        return "tech"
    if biz_hit and not tech_hit:
        return "biz"
    if tech_hit or biz_hit:
        return "mixed"
    return "mixed"


def _normalize_optional_bool(value) -> Optional[bool]:
    """将模型输出归一化为可选布尔值；无法识别返回 None。"""
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


def _parse_scoring_details(raw: str) -> dict:
    if not raw:
        return {"total": 0, "items": []}
    try:
        payload = json.loads(raw)
    except Exception:
        try:
            payload = ast.literal_eval(raw)
        except Exception:
            logger.warning("[analysis_v2] scoring_details 解析失败，使用空列表")
            return {"total": 0, "items": []}
    items = payload.get("items") if isinstance(payload, dict) else []
    normalized_items = []
    for idx, item in enumerate(items or []):
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()
        if not name:
            continue
        max_score = item.get("max_score", item.get("maxScore", 0))
        try:
            max_score = int(float(max_score or 0))
        except Exception:
            max_score = 0
        criteria = str(item.get("criteria") or "").strip()
        score_tag = _normalize_score_tag(item.get("score_tag", ""), name=name, criteria=criteria)
        explicit_response = _normalize_optional_bool(item.get("is_response_item", item.get("isResponseItem")))
        normalized_items.append({
            "id": str(item.get("id") or f"score_{idx + 1}"),
            "name": name,
            "max_score": max_score,
            "criteria": criteria,
            "score_tag": score_tag,
            "is_response_item": explicit_response,
            "response_reason": str(item.get("response_reason", item.get("responseReason", "")) or "").strip(),
            "response_explicit": explicit_response is not None,
        })
    total = payload.get("total", 0) if isinstance(payload, dict) else 0
    try:
        total = int(float(total or 0))
    except Exception:
        total = sum(item["max_score"] for item in normalized_items)
    if total <= 0:
        total = sum(item["max_score"] for item in normalized_items)
    return {"total": total, "items": normalized_items}


def _slugify_heading(text: str, fallback: str) -> str:
    slug = re.sub(r"[^\w\u4e00-\u9fa5]+", "_", str(text or "").strip().lower()).strip("_")
    return slug or fallback


def _make_structure_heading(
    *,
    title: str,
    level: int,
    category: str,
    source: str,
    source_node_id: str = "",
    source_title: str = "",
    score_tag: str = "",
    score_item_id: str = "",
    max_score: int = 0,
    criteria: str = "",
    criteria_excerpt: str = "",
    related_target_ids: Optional[list[str]] = None,
    priority_weight: float = 0.0,
    generation_strategy: str = "general",
    generation_mode: str = "derived",
    response_candidate: bool = False,
    generates_from_self: bool = False,
    start_block_id: str = "",
    end_block_id: str = "",
    start_locator: str = "",
    end_locator: str = "",
    anchor_confidence: float = 0.0,
) -> dict:
    safe_title = str(title or "").strip()
    return {
        "id": f"{category}_{_slugify_heading(safe_title, fallback=str(uuid.uuid4())[:8])}",
        "title": safe_title,
        "level": int(level),
        "category": category,
        "source": source,
        "source_node_id": source_node_id,
        "source_title": source_title or safe_title,
        "score_tag": score_tag,
        "score_item_id": score_item_id,
        "max_score": int(max_score or 0),
        "criteria": str(criteria or "").strip(),
        "criteria_excerpt": str(criteria_excerpt or "").strip(),
        "related_target_ids": list(related_target_ids or []),
        "priority_weight": float(priority_weight or 0.0),
        "generation_strategy": str(generation_strategy or "general"),
        "generation_mode": str(generation_mode or "derived"),
        "response_candidate": bool(response_candidate),
        "generates_from_self": bool(generates_from_self),
        "start_block_id": start_block_id,
        "end_block_id": end_block_id,
        "start_locator": start_locator,
        "end_locator": end_locator,
        "anchor_confidence": float(anchor_confidence),
        "editable_ops": ["rename", "delete"],
        "deleted": False,
        "children": [],
    }


def _criteria_excerpt(text: str, limit: int = 220) -> str:
    raw = str(text or "").strip()
    if len(raw) <= limit:
        return raw
    return raw[:limit].rstrip() + "..."


def _is_response_candidate_strict(name: str, criteria: str) -> bool:
    """
    严格兜底判别：只识别“响应情况/符合性偏离”类显式评分项，
    避免将“服务响应方案”等普通技术项误判为响应特例。
    """
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


def _build_analysis_v2(content_map: dict[str, str], bid_items: list[dict]) -> dict:
    basic_info = _parse_xml_field_map(content_map.get("proj_basic", ""))
    scoring = _parse_scoring_details(content_map.get("scoring_details", ""))
    technical_target_nodes = []
    for node_id, label in [
        ("resp_tech", "技术目标与范围"),
        ("resp_param", "参数与指标要求"),
        ("resp_substance", "实施与交付硬约束"),
    ]:
        text = str(content_map.get(node_id, "")).strip()
        if not text:
            continue
        technical_target_nodes.append({"id": node_id, "label": label, "content": text})

    attachments = []
    for idx, item in enumerate(bid_items or []):
        if not isinstance(item, dict):
            continue
        title = str(item.get("name") or "").strip()
        if not title:
            continue
        attachments.append({
            **_make_structure_heading(
                title=title,
                level=1,
                category="attachments",
                source="llm",
                source_node_id="structure_attachments",
                source_title=title,
                start_block_id=str(item.get("start_block_id") or ""),
                end_block_id=str(item.get("end_block_id") or ""),
                start_locator=str(item.get("start_locator") or ""),
                end_locator=str(item.get("end_locator") or ""),
                anchor_confidence=0.95 if item.get("start_block_id") or item.get("start_locator") else 0.35,
            ),
            "id": f"attachments_{idx + 1}_{_slugify_heading(title, fallback=str(idx + 1))}",
        })

    technical_sections = []
    business_sections = []
    technical_target_ids = [str(node.get("id") or "").strip() for node in technical_target_nodes if str(node.get("id") or "").strip()]
    has_response_branch = False
    for idx, item in enumerate(scoring.get("items", [])):
        score_tag = str(item.get("score_tag") or "mixed")
        if score_tag not in {"tech", "biz", "mixed"}:
            score_tag = "mixed"
        item_name = str(item.get("name") or f"评分项{idx + 1}")
        item_criteria = str(item.get("criteria") or "")
        max_score = int(item.get("max_score") or 0)
        explicit_response = item.get("is_response_item")
        if score_tag == "biz":
            is_response = False
        elif item.get("response_explicit"):
            is_response = bool(explicit_response)
        else:
            is_response = _is_response_candidate_strict(item_name, item_criteria)
        has_response_branch = has_response_branch or is_response
        heading = _make_structure_heading(
            title=item_name,
            level=2,
            category="technical" if score_tag != "biz" else "business",
            source="score_item",
            source_node_id="scoring_details",
            source_title=item_name,
            score_tag=score_tag,
            score_item_id=str(item.get("id") or ""),
            max_score=max_score,
            criteria=item_criteria,
            criteria_excerpt=_criteria_excerpt(item_criteria),
            related_target_ids=technical_target_ids if score_tag != "biz" else [],
            priority_weight=float(max_score),
            generation_strategy="response_special" if is_response else "general",
            generation_mode="derived",
            response_candidate=is_response,
            generates_from_self=is_response,
        )
        if score_tag == "biz":
            business_sections.append(heading)
        else:
            technical_sections.append(heading)

    objective_heading = _make_structure_heading(
        title="项目实施目标",
        level=2,
        category="technical",
        source="system",
        source_node_id="technical_targets",
        source_title="项目实施目标",
        score_tag="tech",
        related_target_ids=technical_target_ids,
        generation_strategy="objective_special",
        generation_mode="system",
        generates_from_self=False,
    )
    if not any(str(item.get("title") or "").strip() == "项目实施目标" for item in technical_sections):
        technical_sections.append(objective_heading)
    elif technical_sections:
        for sec in technical_sections:
            if str(sec.get("title") or "").strip() == "项目实施目标":
                sec["generation_strategy"] = "objective_special"
                sec["generation_mode"] = "system"

    # 顺序策略：
    # 1) 默认保持评分项原始顺序；
    # 2) 若存在“响应类”章节，将其整体后置到“项目实施目标”之前；
    # 3) “项目实施目标”固定最后。
    if technical_sections:
        # 防误判保护：若误判出多个响应特例，只保留 1 个（优先标题显式“响应情况”）。
        response_candidates = [
            s for s in technical_sections
            if bool(s.get("response_candidate")) and str(s.get("title") or "").strip() != "项目实施目标"
        ]
        if len(response_candidates) > 1:
            preferred = [
                s for s in response_candidates
                if any(k in str(s.get("title") or "") for k in ["响应情况", "响应程度", "符合性偏离", "偏离情况"])
            ]
            keep = preferred[0] if preferred else response_candidates[0]
            logger.warning(
                "[analysis_v2] 命中多个响应特例，已自动收敛为 1 个。keep=%s, all=%s",
                str(keep.get("title") or ""),
                [str(x.get("title") or "") for x in response_candidates],
            )
            for sec in technical_sections:
                title = str(sec.get("title") or "").strip()
                if title == str(keep.get("title") or "").strip():
                    continue
                if bool(sec.get("response_candidate")) and title != "项目实施目标":
                    sec["response_candidate"] = False
                    sec["generation_strategy"] = "general"
                    sec["generates_from_self"] = False

        response_sections = [s for s in technical_sections if bool(s.get("response_candidate")) and str(s.get("title") or "").strip() != "项目实施目标"]
        non_response = [s for s in technical_sections if not bool(s.get("response_candidate")) and str(s.get("title") or "").strip() != "项目实施目标"]
        objective_sections = [s for s in technical_sections if str(s.get("title") or "").strip() == "项目实施目标"]
        if response_sections:
            technical_sections = non_response + response_sections + objective_sections
        else:
            technical_sections = non_response + objective_sections

    technical_h2_bindings = [
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
            "generates_from_self": bool(sec.get("generates_from_self")),
        }
        for sec in technical_sections
        if not bool(sec.get("deleted"))
    ]

    has_response_branch = any(bool(sec.get("response_candidate")) for sec in technical_sections)

    return {
        "schema_version": 3,
        "project_info": {
            "overview": str(content_map.get("proj_overview", "")).strip(),
            "basic_info": basic_info,
            "scoring_items": scoring.get("items", []),
            "scoring_total": int(scoring.get("total", 0) or 0),
        },
        "technical_targets": technical_target_nodes,
        "enable_response_branch": bool(has_response_branch),
        "technical_h2_bindings": technical_h2_bindings,
        "bid_structure": {
            "attachments": attachments,
            "technical_sections": technical_sections,
            "business_sections": business_sections,
        },
    }


def _render_derived_structure_content(items: list[dict]) -> str:
    lines: list[str] = []
    for item in items or []:
        if not isinstance(item, dict):
            continue
        title = str(item.get("title") or "").strip()
        if not title:
            continue
        lines.append(f"<要点>{title}</要点>")
    return "\n".join(lines)


def _inject_analysis_report_derived_nodes(report_nodes: list[dict], analysis_v2: dict) -> list[dict]:
    business_content = _render_derived_structure_content(
        (analysis_v2.get("bid_structure") or {}).get("business_sections") or []
    )
    technical_content = _render_derived_structure_content(
        (analysis_v2.get("bid_structure") or {}).get("technical_sections") or []
    )

    def _walk(nodes: list[dict]) -> list[dict]:
        updated: list[dict] = []
        for node in nodes or []:
            if not isinstance(node, dict):
                continue
            node_copy = dict(node)
            node_id = str(node_copy.get("id") or "")
            if node_id == "structure_business":
                node_copy["content"] = business_content
            elif node_id == "structure_technical":
                node_copy["content"] = technical_content
            children = node_copy.get("children") or []
            if children:
                node_copy["children"] = _walk(children)
            updated.append(node_copy)
        return updated

    return _walk(report_nodes)


def _persist_analysis_state(project_id: str, analysis_report: list[dict], analysis_v2: dict) -> None:
    if not project_id:
        return
    db = SessionLocal()
    try:
        record = db.query(ProjectRecord).filter(ProjectRecord.id == project_id).first()
        if record:
            data = json.loads(record.data) if isinstance(record.data, str) else (record.data or {})
            if not isinstance(data, dict):
                data = {}
            data["analysisReport"] = analysis_report
            data["analysisV2"] = analysis_v2
            data["bidAttachmentList"] = [
                {
                    "name": item.get("title", ""),
                    "start_locator": item.get("start_locator", ""),
                    "end_locator": item.get("end_locator", ""),
                    "start_block_id": item.get("start_block_id", ""),
                    "end_block_id": item.get("end_block_id", ""),
                    "description": "",
                }
                for item in analysis_v2.get("bid_structure", {}).get("attachments", [])
                if not item.get("deleted")
            ]
            record.data = json.dumps(data, ensure_ascii=False)
            db.commit()
    except Exception as e:
        db.rollback()
        logger.warning(f"[{project_id}] 持久化 analysis_v2 失败: {e}")
    finally:
        db.close()


def _task_recovery_status(task_type: str, data: dict) -> str:
    """任务结束后的阶段回退：超时/失败后落回可编辑页面，而不是继续停在 generating_*。"""
    if task_type in {"analyze", "extract"}:
        has_report = bool((data.get("analysisV2") or {}).get("schema_version")) or bool(data.get("analysisReport"))
        return "report_done" if has_report else "report_done"
    if task_type == "outline":
        return "outline_ready" if data.get("outline") else "report_done"
    if task_type in {"content", "diagram"}:
        return "editing"
    return str(data.get("status") or "report_done")


def _persist_project_runtime(
    project_id: str,
    *,
    task_id: str,
    task_type: str,
    runtime_state: str,
    message: str = "",
    override_status: Optional[str] = None,
    progress: Optional[float] = None,
    started_at: Optional[str] = None,
    cancellable: Optional[bool] = None,
) -> None:
    """将任务运行态写回项目记录，供前端锁与超时恢复使用。"""
    if not project_id:
        return
    db = SessionLocal()
    try:
        record = db.query(ProjectRecord).filter(ProjectRecord.id == project_id).first()
        if not record:
            return
        data = json.loads(record.data or "{}")
        runtime = {
            "state": runtime_state,
            "taskId": task_id,
            "taskType": task_type,
            "message": message or "",
            "progress": progress if progress is not None else 0,
            "startedAt": started_at or datetime.utcnow().isoformat(),
            "cancellable": bool(cancellable) if cancellable is not None else runtime_state in {"queued", "running", "cancelling"},
            "updatedAt": datetime.utcnow().isoformat(),
        }
        data["taskRuntime"] = runtime
        next_status = override_status or str(data.get("status") or record.status or "report_done")
        data["status"] = next_status
        record.status = next_status
        record.data = json.dumps(data, ensure_ascii=False)
        db.commit()
    except Exception as e:
        db.rollback()
        logger.warning(f"[{project_id}] 持久化 taskRuntime 失败: {e}")
    finally:
        db.close()


def _persist_content_result_to_project(
    project_id: str,
    section_id: str,
    payload: dict[str, Any],
    *,
    status: str = "done",
    error: str = "",
) -> None:
    """将正文任务结果幂等写回项目，避免前端轮询中断导致 generatedContent 停在 idle。"""
    if not project_id or not section_id:
        return
    db = SessionLocal()
    try:
        record = db.query(ProjectRecord).filter(ProjectRecord.id == project_id).first()
        if not record:
            return
        data = json.loads(record.data or "{}")
        generated = data.get("generatedContent")
        if not isinstance(generated, dict):
            generated = {}
        existing = generated.get(section_id) if isinstance(generated.get(section_id), dict) else {}
        if status == "done":
            content = str(payload.get("content") or "")
            if _count_visible_chars(content) <= 0:
                generated[section_id] = {
                    **existing,
                    "status": "error",
                    "content": str(existing.get("content") or ""),
                    "wordCount": int(existing.get("wordCount") or existing.get("word_count") or 0),
                    "error": error or "内容工作流未返回可用正文",
                    "stage": None,
                }
            else:
                next_state = {
                    **existing,
                    "status": "done",
                    "content": content,
                    "wordCount": int(payload.get("word_count") or payload.get("wordCount") or _count_visible_chars(content)),
                    "qualityScore": payload.get("quality_score"),
                    "feedback": payload.get("feedback"),
                    "diagramError": payload.get("diagram_error"),
                    "previousContent": None,
                    "previousWordCount": None,
                }
                next_state.pop("error", None)
                next_state.pop("stage", None)
                generated[section_id] = next_state
        else:
            generated[section_id] = {
                **existing,
                "status": "error",
                "content": str(existing.get("content") or ""),
                "wordCount": int(existing.get("wordCount") or existing.get("word_count") or 0),
                "error": error or "生成失败",
                "stage": None,
            }
        data["generatedContent"] = generated
        record.data = json.dumps(data, ensure_ascii=False)
        record.updated_at = datetime.now(timezone.utc)
        db.commit()
    except Exception as exc:
        db.rollback()
        logger.warning("[%s] 持久化正文结果失败: section=%s; error=%s", project_id, section_id, exc)
    finally:
        db.close()


def _persist_group_content_result_to_project(
    project_id: str,
    sections: list[dict[str, Any]],
    failed_sections: list[dict[str, Any]],
) -> None:
    """批量正文任务结束时写回所有成功/失败子章节。"""
    for row in sections or []:
        section_id = str(row.get("section_id") or row.get("sectionId") or "").strip()
        _persist_content_result_to_project(project_id, section_id, row, status="done")
    for row in failed_sections or []:
        section_id = str(row.get("section_id") or row.get("sectionId") or "").strip()
        _persist_content_result_to_project(
            project_id,
            section_id,
            row,
            status="error",
            error=str(row.get("error") or "分组生成失败"),
        )


def _task_status_to_runtime_state(status: str) -> str:
    return {
        "running": "running",
        "done": "succeeded",
        "error": "failed",
        "cancelled": "cancelled",
        "timeout": "timed_out",
    }.get(status, "failed")


def _task_status_to_api_state(status: str) -> str:
    return {
        "running": "running",
        "done": "succeeded",
        "error": "failed",
        "cancelled": "cancelled",
        "timeout": "timed_out",
    }.get(status, "failed")


def _sync_project_runtime_from_task(task, *, force: bool = False) -> None:
    """根据任务当前状态回写项目运行态。"""
    if not task or not task.project_id:
        return
    runtime_state = _task_status_to_runtime_state(task.status)
    override_status = None
    if task.status in {"done", "error", "cancelled", "timeout"}:
        db = SessionLocal()
        try:
            record = db.query(ProjectRecord).filter(ProjectRecord.id == task.project_id).first()
            data = json.loads(record.data or "{}") if record else {}
        except Exception:
            data = {}
        finally:
            db.close()
        override_status = _task_recovery_status(task.task_type, data)
    _persist_project_runtime(
        task.project_id,
        task_id=task.task_id,
        task_type=task.task_type,
        runtime_state=runtime_state,
        message=task.error or task.current_stage or "",
        override_status=override_status,
        progress=100 if task.status == "done" else 0,
        started_at=datetime.utcfromtimestamp(float(task.created_at or time.time())).isoformat(),
        cancellable=task.status == "running",
    )


def _ensure_task_running(task_id: str):
    """在长循环中做本地任务活性守卫，避免已取消任务继续跑远端。"""
    task = task_manager.get_task(task_id)
    if not task or task.status != "running":
        if task:
            _sync_project_runtime_from_task(task)
        import asyncio as _asyncio
        raise _asyncio.CancelledError()


async def _ensure_project_slot(project_id: str, task_type: str):
    pid = (project_id or "").strip()
    if not pid:
        raise HTTPException(status_code=400, detail="project_id 不能为空")
    try:
        task_manager.ensure_backend_ready()
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail={"code": "TASK_BACKEND_UNAVAILABLE", "message": str(e)})
    limits = task_manager.get_limits()
    content_project_limit = int(limits.get("max_project_content_running", 2) or 2)
    project_limit_override = content_project_limit if task_type == "content" else None
    type_limit_override = None
    if task_type == "diagram":
        type_limit_override = int(os.environ.get("MAX_DIAGRAM_RUNNING_TASKS", "1") or "1")

    allowed, details = await task_manager.try_acquire_task_slot(
        pid,
        task_type,
        enforce_project_limit=(task_type != "diagram"),
        max_project_running=project_limit_override,
        max_type_running=type_limit_override,
    )
    if not allowed:
        reason = (details or {}).get("reason", "limit")
        if reason == "global_limit":
            message = "后台任务并发达到全局上限，请稍后重试"
        elif reason == "project_limit":
            limit_num = (details or {}).get("max_project_running")
            if task_type == "content" and limit_num:
                message = f"项目 {pid} 正在运行 {limit_num} 个正文任务，请等待空闲后再发起"
            else:
                message = f"项目 {pid} 正在运行任务，请等待当前任务完成后再发起"
        else:
            message = "任务并发受限，请稍后重试"
        raise HTTPException(
            status_code=409,
            detail={
                "code": "TASK_LIMIT_REACHED",
                "message": message,
                "limit_reason": reason,
                "requested_project_id": pid,
                "task_type": task_type,
                "limits": task_manager.get_limits(),
                "metrics": details,
            },
        )


def _require_task_owner(task_id: str, project_id: Optional[str]):
    task = task_manager.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在或已过期")
    _sync_project_runtime_from_task(task)
    pid = (project_id or "").strip()
    if pid and task.project_id and task.project_id != pid:
        raise HTTPException(status_code=403, detail="任务不属于当前项目")
    return task


async def _best_effort_stop_dify_by_task_id(task_id: str):
    """兜底 stop：即使取消链路异常，也尽量终止远端 Dify 任务。"""
    t = task_manager.get_task(task_id)
    if not t:
        return
    if t.dify_task_id or getattr(t, "dify_task_ids", None):
        try:
            await _stop_dify_workflows(t)
        except Exception:
            pass


async def _collect_dify_outputs_via_stream(
    api_key: str,
    inputs: dict,
    task_id: str,
    *,
    batch_index: int = 0,
    trace: Optional[list[dict]] = None,
    started_at: float = 0.0,
) -> dict:
    """静默消费 Dify streaming，收集最终 outputs，并为取消链路登记全部 dify_task_id。"""
    _r = _get_deps()
    outputs = {}
    run_id = ""
    got_finished = False

    async for chunk in _r._call_dify_workflow_stream(api_key, inputs):
        _ensure_task_running(task_id)
        if not isinstance(chunk, dict):
            continue
        if chunk.get("dify_task_id"):
            task_manager.set_dify_task_id(task_id, chunk["dify_task_id"])
        if chunk.get("__stage__"):
            entry = {
                "kind": "node_started",
                "label": str(chunk.get("__stage__") or ""),
                "node_title": str(chunk.get("node_title") or ""),
                "batch_index": int(batch_index or 0),
                "node_id": str(chunk.get("node_id") or ""),
                "dify_task_id": str(chunk.get("dify_task_id") or ""),
                "at": datetime.utcnow().isoformat(),
                "elapsed_sec": int(max(0, time.monotonic() - started_at)) if started_at > 0 else 0,
            }
            if isinstance(trace, list):
                trace.append(entry)
            _push_task_event(task_id, "execution_trace", entry)
        if chunk.get("__finished__"):
            got_finished = True
            outputs = chunk.get("outputs", {}) or {}
            run_id = str(chunk.get("workflow_run_id", "") or "")
            finish_entry = {
                "kind": "workflow_finished",
                "workflow_run_id": run_id,
                "batch_index": int(batch_index or 0),
                "dify_task_id": str(chunk.get("dify_task_id") or ""),
                "at": datetime.utcnow().isoformat(),
                "elapsed_sec": int(max(0, time.monotonic() - started_at)) if started_at > 0 else 0,
            }
            if isinstance(trace, list):
                trace.append(finish_entry)
            _push_task_event(task_id, "execution_trace", finish_entry)
            break

    if not got_finished:
        raise RuntimeError("Dify streaming 异常中断（未收到 finished 事件）")
    return {"data": {"outputs": outputs}, "workflow_run_id": run_id}


def _build_diagram_source_context(
    diagram_brief: str,
    writing_hint: str,
    keywords: str,
    section_title: str,
    global_outline: str,
    diagram_type_hint: str,
    content_context: str = "",
    max_len: int = 2800,
) -> str:
    """
    组装 diagram_generator 的 source_excerpt：合并大纲 diagramBrief、写作引导、关键词与全书大纲节选。
    与 content_writer 并行执行，故不含正文；上下文应足够让模型推断节点与关系。
    """
    def _clip(text: str, limit: int) -> str:
        s = (text or "").strip()
        if not s:
            return ""
        if len(s) <= limit:
            return s
        return s[: max(1, limit - 8)].rstrip() + " ...(截断)"

    def _focus_hint(text: str, limit: int) -> str:
        s = (text or "").strip()
        if not s:
            return ""
        lines = [ln.strip() for ln in re.split(r"[\n\r]+", s) if ln.strip()]
        keep: list[str] = []
        hot_words = (
            "架构", "模块", "接口", "数据", "链路", "流程", "分层", "服务", "数据库", "缓存",
            "消息", "安全", "鉴权", "高可用", "容灾", "监控", "日志", "告警", "规则", "算法",
        )
        for ln in lines:
            if any(w in ln for w in hot_words):
                keep.append(ln)
            if len("\n".join(keep)) >= limit:
                break
        if not keep:
            keep = lines[:8]
        return _clip("\n".join(keep), limit)

    def _outline_window(outline: str, title: str, limit: int) -> str:
        raw = (outline or "").strip()
        if not raw:
            return ""
        lines = [ln.rstrip() for ln in raw.splitlines() if ln.strip()]
        if not lines:
            return ""
        anchor = (title or "").strip()
        idx = -1
        if anchor:
            for i, ln in enumerate(lines):
                if anchor in ln:
                    idx = i
                    break
        if idx < 0:
            sample = "\n".join(lines[:20])
            return _clip(sample, limit)
        start = max(0, idx - 8)
        end = min(len(lines), idx + 12)
        sample = "\n".join(lines[start:end])
        return _clip(sample, limit)

    parts: list[str] = []
    type_hint = (diagram_type_hint or "architecture").strip()
    constraints = (
        "【图生成硬约束】\n"
        "1) 必须体现分层边界与主链路；\n"
        "2) 节点命名必须是技术实体（服务/模块/中间件/存储）；\n"
        "3) 必须包含关键连线语义（调用/数据/约束）；\n"
        f"4) 图类型优先按 {type_hint} 组织结构。"
    )
    parts.append(_clip(constraints, 260))

    b = _clip(diagram_brief, 850)
    if b:
        parts.append("【diagramBrief】\n" + b)

    st = _clip(section_title, 120)
    if st:
        parts.append("【章节标题】" + st)

    kw = _clip(keywords, 220)
    if kw:
        parts.append("【关键词】" + kw)

    wh = _focus_hint(writing_hint, 1200)
    if wh:
        parts.append("【写作引导-技术相关摘要】\n" + wh)

    cc = _clip(content_context, 1200)
    if cc:
        parts.append("【已生成正文摘要】\n" + cc)

    go = _outline_window(global_outline, section_title, 650)
    if go:
        parts.append("【大纲邻域窗口】\n" + go)

    out = "\n\n---\n\n".join(p for p in parts if p.strip())
    if len(out) > max_len:
        out = out[: max(1, max_len - 8)].rstrip() + " ...(截断)"
    return out


def _extract_svg_from_candidate(raw: Any) -> str:
    if raw is None:
        return ""
    if isinstance(raw, str):
        text = raw.strip()
        if not text:
            return ""
        svg_match = re.search(r"<svg\b[\s\S]*?</svg>", text, flags=re.IGNORECASE)
        if svg_match:
            return svg_match.group(0).strip()
        parsed = _try_parse_jsonish(text)
        if parsed is not None and parsed is not raw:
            return _extract_svg_from_candidate(parsed)
        return ""
    if isinstance(raw, dict):
        preferred_keys = ("svg", "svg_content", "content", "result", "text", "output", "structured_output")
        for key in preferred_keys:
            svg = _extract_svg_from_candidate(raw.get(key))
            if svg:
                return svg
        for value in raw.values():
            svg = _extract_svg_from_candidate(value)
            if svg:
                return svg
        return ""
    if isinstance(raw, list):
        for item in raw:
            svg = _extract_svg_from_candidate(item)
            if svg:
                return svg
    return ""


def _extract_mermaid_from_candidate(raw: Any) -> str:
    if raw is None:
        return ""
    if isinstance(raw, str):
        text = raw.strip()
        if not text:
            return ""
        fence = re.search(r"```mermaid\s*([\s\S]*?)```", text, flags=re.IGNORECASE)
        if fence:
            return fence.group(1).strip()
        parsed = _try_parse_jsonish(text)
        if parsed is not None and parsed is not raw:
            return _extract_mermaid_from_candidate(parsed)
        first_line = text.splitlines()[0].strip().lower() if text.splitlines() else ""
        if first_line.startswith(("graph ", "flowchart ", "sequenceDiagram".lower(), "classDiagram".lower(), "stateDiagram".lower(), "erDiagram".lower(), "journey", "gantt", "pie ")):
            return text
        return ""
    if isinstance(raw, dict):
        preferred_keys = ("mermaid", "mermaid_source", "mmd", "code", "content", "result", "text", "output", "structured_output")
        for key in preferred_keys:
            mermaid = _extract_mermaid_from_candidate(raw.get(key))
            if mermaid:
                return mermaid
        for value in raw.values():
            mermaid = _extract_mermaid_from_candidate(value)
            if mermaid:
                return mermaid
        return ""
    if isinstance(raw, list):
        for item in raw:
            mermaid = _extract_mermaid_from_candidate(item)
            if mermaid:
                return mermaid
    return ""


def _extract_diagram_svg_output(outputs: dict[str, Any]) -> str:
    if not isinstance(outputs, dict):
        return ""
    for key in ("svg", "svg_content", "result", "text", "output", "structured_output"):
        svg = _extract_svg_from_candidate(outputs.get(key))
        if svg:
            return svg
    for value in outputs.values():
        svg = _extract_svg_from_candidate(value)
        if svg:
            return svg
    return ""


def _extract_diagram_mermaid_output(outputs: dict[str, Any]) -> str:
    if not isinstance(outputs, dict):
        return ""
    for key in ("mermaid", "mermaid_source", "mmd", "code", "result", "text", "output", "structured_output"):
        mermaid = _extract_mermaid_from_candidate(outputs.get(key))
        if mermaid:
            return mermaid
    for value in outputs.values():
        mermaid = _extract_mermaid_from_candidate(value)
        if mermaid:
            return mermaid
    return ""


def _is_fallback_diagram_svg(svg: str) -> bool:
    text = re.sub(r"\s+", "", str(svg or ""))
    if not text:
        return False
    if "架构图" in text and "降级模板" in text:
        return True
    return ">上游模块<" in text and ">下游模块<" in text


def _normalize_diagram_spec_list(value: Any) -> list:
    if isinstance(value, list):
        return value
    if isinstance(value, dict):
        return [value]
    return []


def _parse_diagram_specs(raw: Any) -> dict[str, list]:
    parsed = _try_parse_jsonish(raw)
    if isinstance(parsed, list):
        parsed = {"elements": parsed}
    if not isinstance(parsed, dict):
        return {"elements": [], "flows": [], "emphasis": []}
    elements = (
        parsed.get("elements")
        or parsed.get("nodes")
        or parsed.get("components")
        or parsed.get("modules")
        or []
    )
    flows = (
        parsed.get("flows")
        or parsed.get("edges")
        or parsed.get("links")
        or parsed.get("relations")
        or []
    )
    emphasis = (
        parsed.get("emphasis")
        or parsed.get("highlights")
        or parsed.get("key_nodes")
        or []
    )
    return {
        "elements": _normalize_diagram_spec_list(elements),
        "flows": _normalize_diagram_spec_list(flows),
        "emphasis": _normalize_diagram_spec_list(emphasis),
    }


def _shrink_error_text(text: str, limit: int = 220) -> str:
    cleaned = re.sub(r"\s+", " ", str(text or "")).strip()
    if len(cleaned) <= limit:
        return cleaned
    return cleaned[: max(1, limit - 8)].rstrip() + " ...(截断)"


def _build_diagram_error_payload(exc: Exception, section_title: str) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "code": "diagram_failed",
        "message": "图表工作流调用失败",
    }
    title = (section_title or "").strip() or "未命名章节"
    if isinstance(exc, httpx.HTTPStatusError):
        response = exc.response
        status_code = int(response.status_code)
        payload["status_code"] = status_code
        detail = ""
        try:
            body = response.json()
            if isinstance(body, dict):
                detail = (
                    str(body.get("message") or body.get("detail") or body.get("error") or body.get("code") or "").strip()
                )
            elif body is not None:
                detail = str(body).strip()
        except Exception:
            try:
                detail = response.text.strip()
            except Exception:
                detail = ""
        detail = _shrink_error_text(detail)
        if status_code == 401:
            payload["code"] = "diagram_auth_failed"
            payload["message"] = (
                f"图表工作流鉴权失败（401）。请检查 {_get_diagram_workflow_name()} 对应的 Dify API Key 是否有效。"
            )
        elif status_code == 404:
            payload["code"] = "diagram_endpoint_not_found"
            payload["message"] = "图表工作流接口不存在（404）。请检查 DIFY_API_URL 或目标 Dify 实例。"
        else:
            payload["code"] = f"diagram_http_{status_code}"
            payload["message"] = f"图表工作流调用失败（HTTP {status_code}）。"
        if detail:
            payload["message"] = f"{payload['message']} Dify 返回：{detail}"
        payload["detail"] = detail
        payload["section_title"] = title
        return payload
    if isinstance(exc, httpx.RequestError):
        payload["code"] = "diagram_request_error"
        payload["message"] = f"图表工作流请求失败：{_shrink_error_text(_format_dify_runtime_error(exc))}"
        payload["section_title"] = title
        return payload
    payload["message"] = f"图表工作流异常：{_shrink_error_text(_format_dify_runtime_error(exc))}"
    payload["section_title"] = title
    return payload


async def _execute_diagram_for_section(
    task_id: str,
    project_id: str,
    _r,
    diagram_key: Optional[str],
    enable_diagrams: bool,
    need_diagram: bool,
    diagram_brief: str,
    max_diagrams: int,
    diagram_type_hint: str,
    section_title: str,
    writing_hint: str,
    raw_keywords: str,
    raw_global_outline: str,
    content_context: str = "",
    diagram_specs: Any = None,
) -> tuple[list, bool, Optional[dict[str, Any]]]:
    """
    执行图表工作流。返回 (diagrams_generated, diagram_slot_reserved, diagram_error)。
    diagram_slot_reserved 为 True 时，若未生成图表，调用方须 release_diagram_slot。
    """
    skip_reasons: list[str] = []
    if not enable_diagrams:
        skip_reasons.append("enable_diagrams=false")
    if not need_diagram:
        skip_reasons.append("need_diagram=false")
    if not str(diagram_brief or "").strip():
        skip_reasons.append("diagram_brief=empty")
    if max_diagrams <= 0:
        skip_reasons.append(f"max_diagrams={max_diagrams}")
    if not diagram_key:
        skip_reasons.append("diagram_key_missing")
    if skip_reasons:
        logger.info(
            "[Task %s] 图表生成跳过: section=%s; reasons=%s",
            task_id,
            (section_title or "").strip() or "<unknown>",
            ", ".join(skip_reasons),
        )
        return [], False, None
    diagram_slot_reserved = await task_manager.reserve_diagram_slot(project_id, max_diagrams)
    if not diagram_slot_reserved:
        task_manager.update_stage(task_id, "⏭️ 图表额度已满，跳过图表")
        return [], False, None
    try:
        task_manager.update_stage(task_id, "🎨 图表生成中")
        src_ctx = _build_diagram_source_context(
            diagram_brief,
            writing_hint,
            raw_keywords,
            section_title,
            raw_global_outline,
            diagram_type_hint,
            content_context,
        )
        spec_payload = _parse_diagram_specs(diagram_specs)
        diagram_inputs = {
            "diagram_type": diagram_type_hint,
            "diagram_title": (section_title or "架构图")[:120],
            "source_excerpt": src_ctx,
            "elements": json.dumps(spec_payload["elements"], ensure_ascii=False),
            "flows": json.dumps(spec_payload["flows"], ensure_ascii=False),
            "emphasis": json.dumps(spec_payload["emphasis"], ensure_ascii=False),
            "style_preset": "consulting",
        }
        out: dict[str, Any] = {}
        svg_content = ""
        mermaid_content = ""
        workflow_run_id = ""
        async for chunk in _r._call_dify_workflow_stream(diagram_key, diagram_inputs):
            _ensure_task_running(task_id)
            if isinstance(chunk, dict):
                workflow_run_id = str(chunk.get("workflow_run_id") or workflow_run_id or "")
                if chunk.get("dify_task_id"):
                    task_manager.set_dify_task_id(task_id, chunk["dify_task_id"])
                if chunk.get("__error__"):
                    raise RuntimeError(str(chunk.get("error") or "图表工作流返回错误事件"))
                if chunk.get("__finished__"):
                    out = chunk.get("outputs", {})
                    svg_content = _extract_diagram_svg_output(out)
                    mermaid_content = "" if svg_content else _extract_diagram_mermaid_output(out)
                    break
        if not svg_content and workflow_run_id:
            try:
                dify_base = os.environ.get("DIFY_API_URL", "http://localhost/v1").rstrip("/")
                async with httpx.AsyncClient(timeout=60) as fc:
                    fb = await fc.get(
                        f"{dify_base}/workflows/run/{workflow_run_id}",
                        headers={"Authorization": f"Bearer {diagram_key}"},
                    )
                    fb.raise_for_status()
                fb_body = fb.json() or {}
                fb_outputs = fb_body.get("data", {}).get("outputs", {}) or fb_body.get("outputs", {})
                if isinstance(fb_outputs, dict):
                    out = fb_outputs
                    svg_content = _extract_diagram_svg_output(out)
                    mermaid_content = "" if svg_content else _extract_diagram_mermaid_output(out)
                    if svg_content:
                        logger.info("[Task %s] 图表 SVG 通过 workflow_run fallback 获取: run_id=%s", task_id, workflow_run_id)
                    elif mermaid_content:
                        logger.info("[Task %s] 图表 Mermaid 通过 workflow_run fallback 获取: run_id=%s", task_id, workflow_run_id)
            except Exception as e:
                logger.warning("[Task %s] 图表 workflow_run fallback 失败: %s", task_id, e)
        if svg_content:
            output_keys = list(out.keys()) if isinstance(out, dict) else []
            if _is_fallback_diagram_svg(svg_content):
                error_payload = {
                    "code": "diagram_fallback_svg",
                    "message": "图表工作流返回了降级模板，已拦截并保留正文。",
                    "output_keys": output_keys,
                    "svg_length": len(svg_content),
                    "section_title": (section_title or "").strip() or "未命名章节",
                }
                if isinstance(out, dict):
                    for field in ("quality_report", "layout_plan", "semantic_plan"):
                        value = str(out.get(field) or "").strip()
                        if value:
                            error_payload[field] = _shrink_error_text(value, limit=800)
                logger.warning(
                    "[Task %s] 图表工作流返回降级模板: section=%s; output_keys=%s; svg_len=%s",
                    task_id,
                    (section_title or "").strip() or "<unknown>",
                    output_keys,
                    len(svg_content),
                )
                return [], True, error_payload
            logger.info(
                "[Task %s] 图表 SVG 生成完成: section=%s; output_keys=%s; svg_len=%s; specs=%s/%s/%s",
                task_id,
                (section_title or "").strip() or "<unknown>",
                list(out.keys()) if isinstance(out, dict) else [],
                len(svg_content),
                len(spec_payload["elements"]),
                len(spec_payload["flows"]),
                len(spec_payload["emphasis"]),
            )
            artifact = _persist_diagram_artifact(project_id, section_title, svg_content.strip())
            return (
                [{
                    "title": (section_title or "架构图")[:120],
                    "type": diagram_type_hint,
                    "diagram_id": artifact["diagram_id"],
                    "svg_url": artifact["svg_url"],
                    "svg_length": artifact["svg_length"],
                }],
                True,
                None,
            )
        if mermaid_content:
            output_keys = list(out.keys()) if isinstance(out, dict) else []
            logger.info(
                "[Task %s] 图表 Mermaid 生成完成: section=%s; output_keys=%s; mmd_len=%s",
                task_id,
                (section_title or "").strip() or "<unknown>",
                output_keys,
                len(mermaid_content),
            )
            artifact = _persist_mermaid_artifact(project_id, section_title, mermaid_content.strip())
            return (
                [{
                    "title": (section_title or "架构图")[:120],
                    "type": diagram_type_hint,
                    "diagram_id": artifact["diagram_id"],
                    "mermaid_url": artifact["mermaid_url"],
                    "mermaid_length": artifact["mermaid_length"],
                }],
                True,
                None,
            )
        output_keys = list(out.keys()) if isinstance(out, dict) else []
        error_payload = {
            "code": "diagram_output_missing",
            "message": "图表工作流已完成，但未返回可识别的 SVG 或 Mermaid 输出。",
            "output_keys": output_keys,
            "section_title": (section_title or "").strip() or "未命名章节",
        }
        logger.warning(
            "[Task %s] 图表工作流完成但未返回 SVG/Mermaid: section=%s; output_keys=%s",
            task_id,
            (section_title or "").strip() or "<unknown>",
            output_keys,
        )
        return [], True, error_payload
    except Exception as e:
        error_payload = _build_diagram_error_payload(e, section_title)
        logger.warning("[Task %s] 图表生成失败: %s", task_id, error_payload["message"])
        if diagram_slot_reserved:
            await task_manager.release_diagram_slot(project_id)
        return [], False, error_payload


def _clean_markdown_artifacts(text: str) -> str:
    """清理常见 Markdown 包裹痕迹，保留正文结构。"""
    if not text:
        return ""
    t = text.strip()
    # 去掉整段代码围栏包裹
    t = re.sub(r"^\s*```(?:markdown|md)?\s*", "", t, flags=re.IGNORECASE)
    t = re.sub(r"\s*```\s*$", "", t, flags=re.IGNORECASE)
    # 去掉孤立的占位标题残片
    t = re.sub(r"^\s*#+\s*$", "", t, flags=re.MULTILINE)
    # 归一化多余空行
    t = re.sub(r"\n{3,}", "\n\n", t).strip()
    return t


def _strip_response_section_numbering(text: str) -> str:
    """响应情况正文只允许连续段落，不保留模型自造的小节编号。"""
    if not text:
        return ""
    cleaned_lines: list[str] = []
    pattern = re.compile(
        r"^(?:"
        r"[一二三四五六七八九十]+、"
        r"|（[一二三四五六七八九十]+）"
        r"|\([一二三四五六七八九十]+\)"
        r"|\d+(?:\.\d+){1,3}"
        r"|\d+\."
        r")\s*"
    )
    for raw_line in str(text).splitlines():
        line = raw_line.strip()
        if not line:
            cleaned_lines.append("")
            continue
        line = pattern.sub("", line, count=1).strip()
        if not line:
            continue
        cleaned_lines.append(line)
    out = "\n".join(cleaned_lines)
    out = re.sub(r"\n{3,}", "\n\n", out).strip()
    return out


def _finalize_generated_body(content: str, section_title: str, *, strip_structural_numbering: bool = False) -> str:
    """正文保存前只做确定性格式清理，不删除疑似标题行。"""
    body = _clean_markdown_artifacts(content)
    body = normalize_generated_markdown(body, section_title)
    if strip_structural_numbering:
        body = _strip_response_section_numbering(body)
    return body.strip()


def _get_deps():
    """延迟导入 routes.py 中的依赖，避免循环引用"""
    from . import routes as _r
    return _r


# ═══════════════════════════════════════════════════════════════
#  POST /tasks/start-outline
# ═══════════════════════════════════════════════════════════════

@router.post("/tasks/start-outline", summary="发起大纲生成后台任务")
async def start_outline_task(request: dict):
    """将大纲生成放入后台任务，立即返回 task_id。"""
    _r = _get_deps()
    dify_key = _r._get_workflow_key("structure_generator")
    if not dify_key:
        raise HTTPException(status_code=500, detail="大纲生成工作流 API Key 未配置")

    # 复用请求准备逻辑
    requirements = request.get("requirements", [])
    bid_type = request.get("bid_type", "tech")
    use_knowledge = request.get("use_knowledge", True)
    analysis_context = request.get("analysis_context", "")
    expected_total_words = request.get("expected_total_words", 0)
    enable_diagrams = bool(request.get("enable_diagrams", False) and _diagram_generation_enabled())
    max_diagrams = int(request.get("max_diagrams", 0) if enable_diagrams else 0)
    scoring_details_json = request.get("scoring_details_json", "")
    structure_heading_seed_json = request.get("structure_heading_seed_json", "")
    technical_h2_bindings_json = request.get("technical_h2_bindings_json", "")
    technical_targets_json = request.get("technical_targets_json", "")
    outline_batch_strategy = str(request.get("outline_batch_strategy", "auto") or "auto").strip().lower()
    outline_auto_parallel_threshold = int(request.get("outline_auto_parallel_threshold", 4) or 4)
    project_id = str(request.get("project_id", "") or "").strip()
    await _ensure_project_slot(project_id, "outline")
    bundle = _r._build_outline_generation_bundle(
        requirements,
        analysis_context,
        int(expected_total_words or 0),
        scoring_details_json,
        structure_heading_seed_json,
        technical_h2_bindings_json,
        technical_targets_json,
    )
    inputs = dict(bundle["inputs"])
    inputs["bid_type"] = bid_type
    inputs["use_knowledge"] = "true" if use_knowledge else "false"
    inputs["enable_diagrams"] = "true" if enable_diagrams else "false"
    inputs["max_diagrams"] = max_diagrams
    outline_batches = _r._split_outline_seed_headings(
        bundle.get("seed_headings") or [],
        strategy=outline_batch_strategy,
        auto_threshold=outline_auto_parallel_threshold,
    )

    task_id = task_manager.create_task("outline", project_id)
    _persist_project_runtime(
        project_id,
        task_id=task_id,
        task_type="outline",
        runtime_state="running",
        message="大纲生成中",
    )

    async def _run():
        execution_trace: list[dict] = []

        async def _execute_outline_batch(
            *,
            batch_seed_headings: list[dict],
            batch_index: int,
            total_batches: int,
        ) -> list[dict]:
            batch_bundle = _r._build_outline_generation_bundle(
                requirements,
                analysis_context,
                int(expected_total_words or 0),
                scoring_details_json,
                _r._dump_structure_heading_seed_json(batch_seed_headings),
                _r._dump_structure_heading_seed_json(batch_seed_headings),
                technical_targets_json,
                seed_headings_override=batch_seed_headings,
                # 并发批次之间不再串联“前序摘要”，避免后发批次被前一批阻塞。
                batch_index=batch_index,
                total_batches=total_batches,
            )
            batch_inputs = dict(batch_bundle["inputs"])
            batch_inputs["bid_type"] = bid_type
            batch_inputs["use_knowledge"] = "true" if use_knowledge else "false"
            batch_inputs["enable_diagrams"] = "true" if enable_diagrams else "false"
            batch_inputs["max_diagrams"] = max_diagrams

            execution_trace.append({
                "kind": "batch_started",
                "batch_index": int(batch_index),
                "total_batches": int(total_batches),
                "h2_count": len(batch_seed_headings or []),
                "at": datetime.utcnow().isoformat(),
                "elapsed_sec": int(max(0, time.monotonic() - started_at)),
            })
            _push_task_event(task_id, "execution_trace", execution_trace[-1])
            dify_res = await _collect_dify_outputs_via_stream(
                dify_key,
                batch_inputs,
                task_id,
                batch_index=batch_index,
                trace=execution_trace,
                started_at=started_at,
            )
            structured_data = _r._parse_dify_outputs(dify_res)
            sections_raw = _r._extract_outline_sections_raw(structured_data)
            sections = _r._build_seeded_outline_sections(
                sections_raw,
                batch_seed_headings,
                max_diagrams=0,
            )
            quality_report = _r._evaluate_outline_quality(sections, batch_seed_headings)
            if not quality_report.get("pass"):
                raise RuntimeError(
                    f"第 {batch_index}/{total_batches} 批大纲结构质量校验失败："
                    + "; ".join(quality_report.get("issues") or [])
                )
            execution_trace.append({
                "kind": "batch_finished",
                "batch_index": int(batch_index),
                "total_batches": int(total_batches),
                "h2_count": len(batch_seed_headings or []),
                "at": datetime.utcnow().isoformat(),
                "elapsed_sec": int(max(0, time.monotonic() - started_at)),
            })
            _push_task_event(task_id, "execution_trace", execution_trace[-1])
            return sections

        try:
            started_at = time.monotonic()
            execution_trace.append({
                "kind": "outline_task_started",
                "strategy": outline_batch_strategy,
                "auto_threshold": outline_auto_parallel_threshold,
                "total_batches": len(outline_batches),
                "seed_h2_count": len(bundle.get("seed_headings") or []),
                "at": datetime.utcnow().isoformat(),
                "elapsed_sec": 0,
            })
            _push_task_event(task_id, "execution_trace", execution_trace[-1])
            task_manager.update_stage(task_id, "📤 模型连接中")
            _emit_outline_stage_event(task_id, "📤 模型连接中", elapsed_sec=0)
            task_manager.update_stage(task_id, "🧠 模型预热中")
            _emit_outline_stage_event(task_id, "🧠 模型预热中", elapsed_sec=int(time.monotonic() - started_at))
            control_flag = "enabled" if bundle.get("enable_response_branch") else "skipped"
            _push_task_event(task_id, "control", {"response_branch": control_flag})

            seed_sections = _make_h2_seed_sections(bundle.get("seed_headings") or [])
            if seed_sections:
                _push_task_event(task_id, "h2_seed", {"sections": seed_sections})
                task_manager.set_partial_result(task_id, {
                    "phase": "h2_seed_ready",
                    "sections": seed_sections,
                    "completeness": {"h2_ready": True, "h3_ready": False, "meta_ready": False},
                })
            got_finished = False
            task_manager.update_stage(task_id, "✍️ 生成大纲")
            _emit_outline_stage_event(
                task_id,
                "✍️ 生成大纲",
                elapsed_sec=int(time.monotonic() - started_at),
            )
            if len(outline_batches) > 1:
                progressive_sections = _make_h2_seed_sections(bundle.get("seed_headings") or [])
                sec_by_id = {str(s.get("id") or ""): s for s in progressive_sections}
                total_batches = len(outline_batches)
                completed_batches = 0
                batch_results: dict[int, list[dict]] = {}
                batch_start_ts: dict[int, float] = {}
                async def _run_outline_batch(batch_index: int, batch_seed_headings: list[dict]) -> tuple[int, list[dict]]:
                    return (
                        batch_index,
                        await _execute_outline_batch(
                            batch_seed_headings=batch_seed_headings,
                            batch_index=batch_index,
                            total_batches=total_batches,
                        ),
                    )

                batch_tasks = [
                    asyncio.create_task(_run_outline_batch(batch_index, batch_seed_headings))
                    for batch_index, batch_seed_headings in enumerate(outline_batches, start=1)
                ]
                for batch_index, batch_seed_headings in enumerate(outline_batches, start=1):
                    batch_start_ts[batch_index] = time.monotonic()
                    _push_task_event(task_id, "outline_batch", {
                        "batch_index": batch_index,
                        "total_batches": total_batches,
                        "status": "started",
                        "h2_count": len(batch_seed_headings or []),
                        "label": f"第 {batch_index}/{total_batches} 批已启动",
                        "elapsed_sec": int(time.monotonic() - started_at),
                    })
                try:
                    task_manager.update_stage(task_id, f"✍️ 并发生成 {total_batches} 批大纲")
                    _emit_outline_stage_event(
                        task_id,
                        f"✍️ 并发生成 {total_batches} 批大纲",
                        elapsed_sec=int(time.monotonic() - started_at),
                    )
                    for done in asyncio.as_completed(batch_tasks):
                        _ensure_task_running(task_id)
                        batch_index, batch_sections = await done
                        batch_results[batch_index] = batch_sections
                        completed_batches += 1

                        _push_task_event(task_id, "outline_batch", {
                            "batch_index": completed_batches,
                            "completed_batches": completed_batches,
                            "finished_batch_index": batch_index,
                            "total_batches": total_batches,
                            "status": "finished",
                            "batch_elapsed_sec": int(max(0, time.monotonic() - batch_start_ts.get(batch_index, started_at))),
                            "label": f"第 {batch_index}/{total_batches} 批已完成",
                            "elapsed_sec": int(time.monotonic() - started_at),
                        })
                        _emit_outline_stage_event(
                            task_id,
                            f"✍️ 已完成 {completed_batches}/{total_batches} 批大纲",
                            elapsed_sec=int(time.monotonic() - started_at),
                            heartbeat=completed_batches < total_batches,
                        )

                        for item in batch_sections:
                            sid = str(item.get("id") or "")
                            target = sec_by_id.get(sid)
                            if not target:
                                continue
                            target["children"] = item.get("children") or []
                            target["wordCount"] = int(item.get("wordCount") or 0)
                            target["writingHint"] = str(item.get("writingHint") or "")
                            target["keywords"] = item.get("keywords") or []
                            target["needDiagram"] = bool(item.get("needDiagram") or item.get("need_diagram") or False)
                            target["diagramBrief"] = str(item.get("diagramBrief") or item.get("diagram_brief") or "")
                            target["diagramPlan"] = item.get("diagramPlan") or item.get("diagram_plan") or {}

                        _r._normalize_outline_diagram_flags(
                            progressive_sections,
                            max_diagrams=max_diagrams if enable_diagrams else 0,
                            enable_diagrams=enable_diagrams,
                        )

                        _push_task_event(task_id, "partial_outline", {
                            "sections": progressive_sections,
                            "completeness": {
                                "h2_ready": True,
                                "h3_ready": completed_batches == total_batches,
                                "meta_ready": completed_batches == total_batches,
                            },
                        })
                        task_manager.set_partial_result(task_id, {
                            "phase": f"outline_batch_{completed_batches}",
                            "sections": progressive_sections,
                            "completeness": {
                                "h2_ready": True,
                                "h3_ready": completed_batches == total_batches,
                                "meta_ready": completed_batches == total_batches,
                            },
                        })
                except Exception:
                    for pending in batch_tasks:
                        if not pending.done():
                            pending.cancel()
                    await asyncio.gather(*batch_tasks, return_exceptions=True)
                    raise

                sections = [
                    section
                    for batch_index in range(1, total_batches + 1)
                    for section in (batch_results.get(batch_index) or [])
                ]
                _r._normalize_outline_diagram_flags(
                    sections,
                    max_diagrams=max_diagrams if enable_diagrams else 0,
                    enable_diagrams=enable_diagrams,
                )
                normalize_outline_word_budget_dict(sections, int(expected_total_words or 0))
                final_quality = _r._evaluate_outline_quality(sections, bundle["seed_headings"])
                if not final_quality.get("pass"):
                    raise RuntimeError(
                        "分批大纲结构归一化后校验失败："
                        + "; ".join(final_quality.get("issues") or [])
                    )
                task_manager.update_stage(task_id, "✅ 大纲结构已就绪")
                _emit_outline_stage_event(
                    task_id,
                    "✅ 大纲结构已就绪",
                    elapsed_sec=int(time.monotonic() - started_at),
                )
                task_manager.set_result(task_id, {
                    "done": True,
                    "sections": sections,
                    "phase": "outline_finalized",
                    "execution_trace": execution_trace,
                    "batch_strategy": outline_batch_strategy,
                    "total_batches": len(outline_batches),
                })
                _sync_project_runtime_from_task(task_manager.get_task(task_id))
                return
            async for chunk in _r._call_dify_workflow_stream(dify_key, inputs):
                _ensure_task_running(task_id)
                if isinstance(chunk, dict):
                    if chunk.get("__finished__"):
                        got_finished = True
                        task_manager.update_stage(task_id, "📋 大纲结构解析中")
                        outputs = chunk.get("outputs", {})
                        run_id = chunk.get("workflow_run_id", "")
                        finish_entry = {
                            "kind": "workflow_finished",
                            "batch_index": 1,
                            "total_batches": 1,
                            "workflow_run_id": str(run_id or ""),
                            "dify_task_id": str(chunk.get("dify_task_id") or ""),
                            "at": datetime.utcnow().isoformat(),
                            "elapsed_sec": int(max(0, time.monotonic() - started_at)),
                        }
                        execution_trace.append(finish_entry)
                        _push_task_event(task_id, "execution_trace", finish_entry)
                        structured_data = _r._parse_dify_outputs({"data": {"outputs": outputs}}) if outputs else {}
                        sections_raw = _r._extract_outline_sections_raw(structured_data)
                        # fallback 1
                        if not sections_raw:
                            for k, v in (outputs.items() if isinstance(outputs, dict) else []):
                                if isinstance(v, str):
                                    v = v.strip()
                                    try: v = json.loads(v)
                                    except Exception: pass
                                if isinstance(v, list): sections_raw = v; break
                                if isinstance(v, dict):
                                    inner = v.get("outline") or v.get("sections")
                                    if inner: sections_raw = inner; break
                        # fallback 2: GET /workflows/run/{run_id}
                        if not sections_raw and run_id:
                            logger.info(f"[Task {task_id}] fallback GET run/{run_id}")
                            try:
                                dify_base = os.environ.get("DIFY_API_URL", "http://localhost/v1").rstrip("/")
                                async with httpx.AsyncClient(timeout=60) as fc:
                                    fb = await fc.get(f"{dify_base}/workflows/run/{run_id}", headers={"Authorization": f"Bearer {dify_key}"})
                                    fb.raise_for_status()
                                fb_s = _r._parse_dify_outputs(fb.json())
                                sections_raw = _r._extract_outline_sections_raw(fb_s)
                            except Exception as e:
                                logger.warning(f"[Task {task_id}] fallback GET 失败: {e}")

                        sections = _r._build_seeded_outline_sections(
                            sections_raw,
                            bundle["seed_headings"],
                            max_diagrams=max_diagrams if enable_diagrams else 0,
                        )
                        quality_report = _r._evaluate_outline_quality(sections, bundle["seed_headings"])
                        if not quality_report.get("pass"):
                            raise RuntimeError(
                                "大纲结构质量校验失败："
                                + "; ".join(quality_report.get("issues") or [])
                            )
                        # H3 批次回传：先只回传标题树，再进入元数据批次回填
                        progressive_sections = _make_h2_seed_sections(bundle.get("seed_headings") or [])
                        sec_by_id = {str(s.get("id") or ""): s for s in progressive_sections}
                        h3_batches = _outline_sections_window_batches(sections, window_size=2)
                        for i, batch in enumerate(h3_batches, start=1):
                            _ensure_task_running(task_id)
                            batch_payload = []
                            for item in batch:
                                sid = str(item.get("id") or "")
                                target = sec_by_id.get(sid)
                                if not target:
                                    continue
                                target["children"] = [{"id": c.get("id", ""), "title": c.get("title", ""), "headingLevel": 3} for c in (item.get("children") or [])]
                                batch_payload.append({
                                    "id": sid,
                                    "title": target.get("title", ""),
                                    "children": target["children"],
                                })
                            _push_task_event(task_id, "h3_batch", {
                                "window_index": i,
                                "total_windows": len(h3_batches),
                                "items": batch_payload,
                            })
                            _push_task_event(task_id, "partial_outline", {
                                "sections": progressive_sections,
                                "completeness": {"h2_ready": True, "h3_ready": i == len(h3_batches), "meta_ready": False},
                            })
                            task_manager.set_partial_result(task_id, {
                                "phase": "h3_generating",
                                "sections": progressive_sections,
                                "completeness": {"h2_ready": True, "h3_ready": i == len(h3_batches), "meta_ready": False},
                            })
                            _push_task_event(task_id, "stage", {
                                "code": "outline_generating",
                                "label": "✍️ 生成大纲",
                                "phase": 2,
                                "percent": min(65, 25 + int(i * 40 / max(len(h3_batches), 1))),
                                "elapsed_sec": int(time.monotonic() - started_at),
                                "heartbeat": True,
                            })

                        meta_batches = _outline_sections_window_batches(sections, window_size=2)
                        for i, batch in enumerate(meta_batches, start=1):
                            _ensure_task_running(task_id)
                            batch_payload = []
                            for item in batch:
                                sid = str(item.get("id") or "")
                                target = sec_by_id.get(sid)
                                if not target:
                                    continue
                                target["wordCount"] = int(item.get("wordCount") or 0)
                                target["writingHint"] = str(item.get("writingHint") or "")
                                target["keywords"] = item.get("keywords") or []
                                target["needDiagram"] = bool(item.get("needDiagram") or item.get("need_diagram") or False)
                                target["diagramBrief"] = str(item.get("diagramBrief") or item.get("diagram_brief") or "")
                                target["diagramPlan"] = item.get("diagramPlan") or item.get("diagram_plan") or {}
                                child_map = {str(c.get("id") or ""): c for c in (target.get("children") or [])}
                                for child in item.get("children") or []:
                                    cid = str(child.get("id") or "")
                                    if cid and cid in child_map:
                                        child_map[cid]["wordCount"] = int(child.get("wordCount") or 0)
                                        child_map[cid]["writingHint"] = str(child.get("writingHint") or "")
                                        child_map[cid]["keywords"] = child.get("keywords") or []
                                        child_map[cid]["needDiagram"] = bool(child.get("needDiagram") or child.get("need_diagram") or False)
                                        child_map[cid]["diagramBrief"] = str(child.get("diagramBrief") or child.get("diagram_brief") or "")
                                        child_map[cid]["diagramPlan"] = child.get("diagramPlan") or child.get("diagram_plan") or {}
                                batch_payload.append({
                                    "id": sid,
                                    "wordCount": target.get("wordCount", 0),
                                    "keywords": target.get("keywords", []),
                                })
                            _push_task_event(task_id, "meta_batch", {
                                "window_index": i,
                                "total_windows": len(meta_batches),
                                "items": batch_payload,
                            })
                            _push_task_event(task_id, "partial_outline", {
                                "sections": progressive_sections,
                                "completeness": {"h2_ready": True, "h3_ready": True, "meta_ready": i == len(meta_batches)},
                            })
                            task_manager.set_partial_result(task_id, {
                                "phase": "h3_meta_generating",
                                "sections": progressive_sections,
                                "completeness": {"h2_ready": True, "h3_ready": True, "meta_ready": i == len(meta_batches)},
                            })
                            _push_task_event(task_id, "stage", {
                                "code": "outline_generating",
                                "label": "✍️ 生成大纲",
                                "phase": 3,
                                "percent": min(90, 70 + int(i * 20 / max(len(meta_batches), 1))),
                                "elapsed_sec": int(time.monotonic() - started_at),
                                "heartbeat": True,
                            })

                        task_manager.update_stage(task_id, "🧾 大纲归一化中")
                        _push_task_event(task_id, "stage", {
                            "code": "outline_finalized",
                            "label": "大纲归一化中",
                            "phase": 4,
                            "percent": 95,
                            "elapsed_sec": int(time.monotonic() - started_at),
                        })
                        normalize_outline_word_budget_dict(sections, int(expected_total_words or 0))
                        final_quality = _r._evaluate_outline_quality(sections, bundle["seed_headings"])
                        if not final_quality.get("pass"):
                            raise RuntimeError(
                                "大纲结构归一化后校验失败："
                                + "; ".join(final_quality.get("issues") or [])
                            )
                        task_manager.update_stage(task_id, "✅ 大纲结构已就绪")
                        _emit_outline_stage_event(
                            task_id,
                            "✅ 大纲结构已就绪",
                            elapsed_sec=int(time.monotonic() - started_at),
                        )
                        task_manager.set_result(task_id, {
                            "done": True,
                            "sections": sections,
                            "phase": "outline_finalized",
                            "execution_trace": execution_trace,
                            "batch_strategy": outline_batch_strategy,
                            "total_batches": 1,
                        })
                        _sync_project_runtime_from_task(task_manager.get_task(task_id))
                        break
                    elif chunk.get("__stage__"):
                        # 提取 Dify task_id（首次有效，后续相同）用于 Stop API
                        if chunk.get("dify_task_id"):
                            task_manager.set_dify_task_id(task_id, chunk["dify_task_id"])
                        node_entry = {
                            "kind": "node_started",
                            "label": str(chunk.get("__stage__") or ""),
                            "node_title": str(chunk.get("node_title") or ""),
                            "batch_index": 1,
                            "total_batches": 1,
                            "node_id": str(chunk.get("node_id") or ""),
                            "dify_task_id": str(chunk.get("dify_task_id") or ""),
                            "at": datetime.utcnow().isoformat(),
                            "elapsed_sec": int(max(0, time.monotonic() - started_at)),
                        }
                        execution_trace.append(node_entry)
                        _push_task_event(task_id, "execution_trace", node_entry)
                        task_manager.update_stage(task_id, chunk["__stage__"])
                        _emit_outline_stage_event(
                            task_id,
                            str(chunk["__stage__"]),
                            elapsed_sec=int(time.monotonic() - started_at),
                        )
            if not got_finished:
                raise RuntimeError("大纲工作流异常中断（未收到 finished 事件）")
        except asyncio.CancelledError:
            await _best_effort_stop_dify_by_task_id(task_id)
            logger.info(f"[Task {task_id}] 大纲任务被用户取消")
            task_manager.set_cancelled(task_id)
            _push_task_event(task_id, "cancelled", {"phase": "outline", "dify_stopped": True})
            _sync_project_runtime_from_task(task_manager.get_task(task_id))
        except Exception as e:
            logger.error(f"[Task {task_id}] 大纲后台任务失败: {e}", exc_info=True)
            task_manager.set_error(task_id, _format_dify_runtime_error(e))
            _sync_project_runtime_from_task(task_manager.get_task(task_id))

    import asyncio
    bg = asyncio.create_task(_run())
    task_manager.set_async_task(task_id, bg)
    return {"task_id": task_id}


# ═══════════════════════════════════════════════════════════════
#  POST /tasks/start-extract
# ═══════════════════════════════════════════════════════════════

@router.post("/tasks/start-extract", summary="发起文档解析后台任务")
async def start_extract_task(
    file: UploadFile = File(...),
    project_name: str = Form(default=""),
    project_id: str = Form(default=""),
    enable_desensitize: bool = Form(default=True),
    desensitize_profile: str = Form(default="tender"),
    use_vision_parsing: bool = Form(default=False),
):
    """将文档解析放入后台任务，立即返回 task_id。"""
    _r = _get_deps()
    project_id = (project_id or "").strip()
    await _ensure_project_slot(project_id, "extract")
    content_bytes = await file.read()
    filename = file.filename or ""
    ext = filename.lower().split(".")[-1]

    task_id = task_manager.create_task("extract", project_id)
    _persist_project_runtime(
        project_id,
        task_id=task_id,
        task_type="extract",
        runtime_state="running",
        message="文档抽取中",
    )

    async def _run():
        try:
            task_manager.update_stage(task_id, "解析文档结构")
            pdf_url = ""
            cache_id = project_id or uuid.uuid4().hex[:12]

            if ext == "pdf":
                pdf_url = _r._cache_pdf_file(cache_id, content_bytes)
                _r._extract_pdf_pages_text(content_bytes)
            elif ext in ("docx", "doc"):
                try: pdf_url = _r._convert_to_pdf_and_cache(cache_id, content_bytes, filename)
                except Exception as e: logger.warning(f"DOCX→PDF 异常: {e}")

            raw_document, raw_image_map = _r._extract_raw_text_with_images(
                filename, content_bytes, use_vision_parsing=use_vision_parsing
            )
            if raw_document.startswith("["):
                task_manager.set_error(task_id, "旧版 .doc 文件无法自动解析，请将文件另存为 .docx 后重新上传。")
                return

            loc_text_for_dify = raw_document
            if ext in ("docx", "doc") and cache_id:
                try:
                    import io
                    import docx as _docx_mod
                    _loc_doc = _docx_mod.Document(io.BytesIO(content_bytes))
                    _loc_text, _loc_map, _blocks = _r._extract_docx_with_locators(_loc_doc)
                    _r._locator_cache[cache_id] = {"doc": _loc_doc, "locator_map": _loc_map, "doc_blocks": _blocks}
                    _r._persist_doc_blocks_snapshot(cache_id, _blocks)
                    if ext == "docx":
                        _r._persist_docx_for_locators(cache_id, content_bytes)
                    loc_text_for_dify = _loc_text
                except Exception as e:
                    logger.warning(f"[Task {task_id}] 定位符缓存写入失败: {e}")

            task_manager.update_stage(task_id, "文档结构解析完成")

            text_for_dify = loc_text_for_dify
            mapping_table = {}
            entity_count = 0
            placeholder_manifest = {}
            placeholder_policy = {}
            if enable_desensitize:
                task_manager.update_stage(task_id, "隐私脱敏处理中")
                db = None
                try:
                    engine = _r.get_engine()
                    db = SessionLocal()
                    profile_config = _r.load_profile_config(desensitize_profile)
                    target_entities = profile_config.get("target_entities", ["name", "phone", "email", "id_number"])
                    method = profile_config.get("method", "mask")
                    desen_result = await asyncio.to_thread(
                        engine.desensitize,
                        text=text_for_dify[:300000],
                        target_entities=target_entities,
                        method=method,
                        placeholder_protocol="strong",
                        db_session=db,
                        llm_mode=os.environ.get('PIPT_LLM_MODE_EXTRACT', 'verify_only'),
                        audit_context={
                            "source": "task.extract",
                            "project_id": project_id or cache_id,
                            "task_id": task_id,
                        },
                    )
                    text_for_dify = desen_result.desensitized_text
                    mapping_table = getattr(desen_result, "mapping_table", {}) or {}
                    entity_count = getattr(desen_result, "entity_count", 0) or 0
                    placeholder_manifest = getattr(desen_result, "placeholder_manifest", {}) or {}
                    placeholder_policy = getattr(desen_result, "placeholder_policy", {}) or {}
                    task_manager.update_stage(task_id, f"脱敏完成，识别 {entity_count} 处实体")
                except Exception as e:
                    logger.warning(f"脱敏失败: {e}")
                    text_for_dify = text_for_dify[:300000]
                    task_manager.update_stage(task_id, "脱敏跳过（使用原文）")
                finally:
                    if db is not None:
                        try:
                            db.close()
                        except Exception:
                            pass
            else:
                task_manager.update_stage(task_id, "跳过脱敏")

            _r._persist_raw_document(cache_id, text_for_dify[:300000])
            task_manager.update_stage(task_id, "预处理完成")
            task_manager.set_result(task_id, {
                "bid_type": "tech", "project_summary": "", "requirements": [],
                "analysis_report": [], "mapping_table": mapping_table,
                "placeholder_manifest": placeholder_manifest,
                "placeholder_policy": placeholder_policy,
                "entity_count": entity_count, "image_map": raw_image_map,
                "required_attachments": [], "scoring_table_template": [],
                "raw_document": text_for_dify, "pdf_url": pdf_url,
            })
            _sync_project_runtime_from_task(task_manager.get_task(task_id))
        except asyncio.CancelledError:
            logger.info(f"[Task {task_id}] 解析任务被用户取消")
            task_manager.set_cancelled(task_id)
            _sync_project_runtime_from_task(task_manager.get_task(task_id))
        except Exception as e:
            logger.error(f"[Task {task_id}] 解析后台任务失败: {e}", exc_info=True)
            task_manager.set_error(task_id, str(e))
            _sync_project_runtime_from_task(task_manager.get_task(task_id))

    import asyncio
    bg = asyncio.create_task(_run())
    task_manager.set_async_task(task_id, bg)
    return {"task_id": task_id}


# ═══════════════════════════════════════════════════════════════
#  POST /tasks/start-content — Blocking 模式
# ═══════════════════════════════════════════════════════════════

@router.post("/tasks/start-content", summary="发起内容生成后台任务（blocking）")
async def start_content_task(request: dict):
    """将章节内容生成放入后台任务（Dify blocking 模式），立即返回 task_id。"""
    try:
        validate_required_bidder_info(request.get("bidder_info", {}) or {})
    except BidderInfoRequiredError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    _r = _get_deps()
    generation_strategy = str(request.get("generation_strategy", "general") or "general").strip()
    workflow_name = _r._resolve_content_workflow_name(generation_strategy)
    strip_structural_numbering = workflow_name == "response_content_writer"
    dify_key = _r._get_workflow_key(workflow_name)
    if not dify_key:
        raise HTTPException(status_code=500, detail=f"{workflow_name} 工作流 API Key 未配置")

    section_id = request.get("section_id", "")
    project_id = str(request.get("project_id", "") or "").strip()
    await _ensure_project_slot(project_id, "content")
    section_title = request.get("section_title", "")
    writing_hint = request.get("writing_hint", "")
    keywords = request.get("keywords", "")
    expected_words = request.get("expected_words", 500)
    analysis_context = request.get("analysis_context", "")
    slice_text = str(request.get("section_outline_slice", "") or "")
    writing_hint = compose_runtime_writing_hint(
        writing_hint,
        section_title,
        int(expected_words or 0),
        keywords,
        section_outline_slice=slice_text,
        analysis_context=analysis_context,
    )

    requires_search = bool(request.get("requires_search", True)) and workflow_name == "content_writer"

    inputs = {
        "section_title": section_title,
        "writing_hint": writing_hint,
        "keywords": keywords if keywords and keywords.strip() else section_title,
        "expected_words": expected_words,
        "project_summary": request.get("project_summary", ""),
        "global_outline": request.get("global_outline", ""),
        "placeholder_hint": request.get("placeholder_hint", ""),
    }
    if workflow_name == "content_writer":
        inputs["requires_search"] = "true" if requires_search else "false"
        # 可用图片清单（格式："{{IMG_xxx}}: VLM描述"\n...)，俩空则 Dify 流忽略）
        inputs["image_map_hint"] = request.get("image_map_hint", "")
        # 注：decoupling_instruction 已在 DSL system prompt 中内嵌，无需额外传递

    # 图表结构化入参（来自大纲）
    enable_diagrams = bool(request.get("enable_diagrams", False) and _diagram_generation_enabled())
    max_diagrams = int(request.get("max_diagrams", 0) or 0) if enable_diagrams else 0
    need_diagram = bool(request.get("need_diagram", False) and enable_diagrams)
    diagram_brief = str(request.get("diagram_brief", "") or "") if enable_diagrams else ""
    diagram_type_hint = str(request.get("diagram_type_hint", "architecture") or "architecture")
    diagram_priority = int(request.get("diagram_priority", 0) or 0)
    raw_keywords = str(request.get("keywords", "") or "")
    raw_global_outline = str(request.get("global_outline", "") or "")
    defer_diagram = bool(request.get("defer_diagram", False))
    request_mapping_flat = request.get("mapping_table", {}) or {}
    if not isinstance(request_mapping_flat, dict):
        request_mapping_flat = {}
    db = SessionLocal()
    try:
        request_mapping_flat, merged_placeholder_hint, _bidder_context = merge_bidder_pipt_context(
            mapping_table=request_mapping_flat,
            placeholder_hint=request.get("placeholder_hint", ""),
            bidder_info=request.get("bidder_info", {}) or {},
            db=db,
        )
        db.commit()
        inputs["placeholder_hint"] = merged_placeholder_hint
    except Exception:
        db.rollback()
        logger.warning("投标人信息 PIPT 归一化失败，正文任务使用请求原始占位符上下文", exc_info=True)
    finally:
        db.close()

    task_id = task_manager.create_task("content", project_id, workflow_name=workflow_name)
    _persist_project_runtime(
        project_id,
        task_id=task_id,
        task_type="content",
        runtime_state="running",
        message="正文生成中",
    )

    async def _run():
        try:
            task_manager.update_stage(
                task_id,
                "🧠 响应情况正文生成中" if workflow_name == "response_content_writer" else "🔍 知识检索与工作流执行中",
            )

            wants_diagram = (
                workflow_name == "content_writer"
                and
                enable_diagrams
                and need_diagram
                and bool(diagram_brief.strip())
                and max_diagrams > 0
            )
            diagram_key = _get_diagram_workflow_key(_r) if wants_diagram else ""
            can_defer_diagram = bool(wants_diagram and diagram_key)
            should_report_diagram_skip = (
                workflow_name == "content_writer"
                and bool(request.get("enable_diagrams", False))
                and bool(request.get("need_diagram", False))
            )
            diagram_skip = None
            if should_report_diagram_skip and not can_defer_diagram:
                diagram_skip = _build_diagram_skip_payload(
                    workflow_name=workflow_name,
                    enable_diagrams=enable_diagrams,
                    need_diagram=need_diagram,
                    diagram_brief=diagram_brief,
                    max_diagrams=max_diagrams,
                    diagram_key=diagram_key,
                )
            if diagram_skip:
                logger.info(
                    "[Task %s] 图表生成未进入独立任务: section=%s; mode=%s; reasons=%s",
                    task_id,
                    (section_title or "").strip() or "<unknown>",
                    diagram_skip.get("mode"),
                    ", ".join(diagram_skip.get("reasons") or []),
                )

            # 仅在模型输出后做占位符还原（不在发送给外部模型前复原）
            replace_map: dict[str, str] = {}
            replace_report: list[dict[str, str]] = []

            task_manager.update_stage(
                task_id,
                "🧠 响应情况正文生成中" if workflow_name == "response_content_writer" else "🔍 知识检索与工作流执行中",
            )

            # 哑流（Silent Streaming）模式：使用 streaming 与 Dify 建立长连接
            # - 可获取 dify_task_id 支持 Stop API 真正中断
            # - 忽略 text_chunk（不累积，避免 think 标签跨 chunk 的清洗问题）
            # - 仅捕获 workflow_finished 的完整 outputs，处理逻辑与原 blocking 模式完全相同
            outputs = {}
            got_finished = False
            async for chunk in _r._call_dify_workflow_stream(dify_key, inputs):
                _ensure_task_running(task_id)
                if isinstance(chunk, str):
                    # text_chunk：哑流模式下忽略，不累积
                    pass
                elif isinstance(chunk, dict):
                    if chunk.get("dify_task_id"):
                        # 注册 dify_task_id（仅首次有效），用于 Stop API
                        task_manager.set_dify_task_id(task_id, chunk["dify_task_id"])
                    if chunk.get("__stage__"):
                        task_manager.update_stage(task_id, chunk["__stage__"])
                    elif chunk.get("__finished__"):
                        got_finished = True
                        outputs = chunk.get("outputs", {})
                        break  # 拿到完整结果，退出循环
            if not got_finished:
                raise RuntimeError("内容工作流异常中断（未收到 finished 事件）")

            task_manager.update_stage(task_id, "📝 解析生成结果")

            # 提取正文内容（兼容多种输出变量名）
            raw_content = (
                outputs.get("text")
                or outputs.get("result")
                or outputs.get("structured_output")
                or ""
            )
            # 去除 <think>...</think> 标签（完整字符串，无跨 chunk 问题）
            import re
            content = re.sub(r'<think>.*?</think>', '', raw_content, flags=re.DOTALL).strip()
            content = _finalize_generated_body(
                content,
                section_title,
                strip_structural_numbering=strip_structural_numbering,
            )

            feedback = outputs.get("feedback") or ""
            diagram_specs = (
                outputs.get("diagram_specs")
                or outputs.get("diagram_spec")
                or outputs.get("diagram")
                or None
            )

            # 清洗：仅当 content 完整地以 feedback 文本开头时才移除（精确前缀匹配，避免误删正文）
            if feedback:
                fb_clean = feedback.strip()
                if fb_clean and len(fb_clean) > 10 and content.startswith(fb_clean):
                    logger.info(f"[Task {task_id}] 检测到 content 混入 feedback（{len(fb_clean)} 字符），已清除")
                    content = content[len(fb_clean):].strip()
                    content = _finalize_generated_body(
                        content,
                        section_title,
                        strip_structural_numbering=strip_structural_numbering,
                    )

            # 提取质量评分
            raw_score = outputs.get("quality_score")
            quality_score = None
            if raw_score is not None:
                try:
                    quality_score = int(float(raw_score))
                except (ValueError, TypeError):
                    pass

            # 输出侧占位符：模型正文中残留的 {{__PIPT__}}/{{__BIDDER__}} 与入参侧同一套解析
            db = SessionLocal()
            try:
                content, replace_map, replace_report = resolve_body_placeholders(
                    content,
                    replace_map,
                    request_mapping_flat,
                    db_session=db,
                    audit_source="task.start_content",
                )
                db.commit()
            except Exception:
                db.rollback()
                content, replace_map, replace_report = resolve_body_placeholders(
                    content,
                    replace_map,
                    request_mapping_flat,
                    audit_source="task.start_content",
                )
            finally:
                db.close()
            content, referenced_images = _normalize_referenced_images(content)
            placeholder_issues = sorted(find_illegal_pipt_bidder_placeholders(content))
            unresolved_placeholders = _unresolved_placeholder_tokens(replace_report)
            if unresolved_placeholders:
                placeholder_issues.extend(unresolved_placeholders)
            if placeholder_issues:
                raise RuntimeError("占位符格式异常且无法可靠还原")
            word_count = _count_visible_chars(content)

            diagrams_generated: list[dict[str, Any]] = []
            diagram_error = None
            if can_defer_diagram and not defer_diagram:
                diagrams_generated, diagram_slot_reserved, diagram_error = await _execute_diagram_for_section(
                    task_id,
                    project_id,
                    _r,
                    diagram_key,
                    enable_diagrams,
                    need_diagram,
                    diagram_brief,
                    max_diagrams,
                    diagram_type_hint,
                    section_title,
                    writing_hint,
                    raw_keywords,
                    raw_global_outline,
                    content,
                    diagram_specs,
                )
                if not diagrams_generated and diagram_slot_reserved:
                    await task_manager.release_diagram_slot(project_id)
                if diagrams_generated:
                    diagram_html_blocks = [_build_diagram_reference_tag(d) for d in diagrams_generated]
                    content = content + "\n" + "\n".join(diagram_html_blocks)
                    word_count = _count_visible_chars(content)

            # 正文默认内联执行图表；只有显式 defer_diagram=true 时才交给独立图表任务。
            if can_defer_diagram and defer_diagram:
                task_manager.update_stage(task_id, "✅ 正文已生成（图表将在独立任务中生成）")
            elif not can_defer_diagram:
                task_manager.update_stage(task_id, "✅ 正文已生成")
            else:
                task_manager.update_stage(
                    task_id,
                    f"✅ 正文与图表已生成（{len(diagrams_generated)} 张）" if diagrams_generated else "✅ 正文已生成",
                )
            partial_payload = {
                "partial": True,
                "phase": "diagram_ready" if diagrams_generated else "text_ready",
                "section_id": section_id,
                "content": content,
                "word_count": word_count,
                "quality_score": quality_score,
                "feedback": feedback or None,
                "replace_report": replace_report,
                "referenced_images": referenced_images,
                "diagrams_count": len(diagrams_generated),
            }
            if diagram_skip:
                partial_payload["diagram_skip"] = diagram_skip
            if diagram_error:
                partial_payload["diagram_error"] = diagram_error
            task_manager.set_partial_result(task_id, partial_payload)

            done_payload: dict = {
                "done": True,
                "section_id": section_id,
                "content": content,
                "word_count": word_count,
                "quality_score": quality_score,
                "feedback": feedback or None,
                "replace_report": replace_report,
                "referenced_images": referenced_images,
                "diagrams_count": len(diagrams_generated),
            }
            if diagram_skip:
                done_payload["diagram_skip"] = diagram_skip
            if diagram_error:
                done_payload["diagram_error"] = diagram_error
            if can_defer_diagram:
                if defer_diagram:
                    done_payload["diagram_deferred"] = True
                    done_payload["diagram_request"] = {
                        "section_id": section_id,
                        "section_title": section_title,
                        "base_content": content,
                        "writing_hint": writing_hint,
                        "keywords": raw_keywords,
                        "global_outline": raw_global_outline,
                        "diagram_brief": diagram_brief,
                        "diagram_type_hint": diagram_type_hint,
                        "diagram_specs": diagram_specs,
                        "quality_score": quality_score,
                        "feedback": feedback,
                        "replace_report": replace_report,
                    }
                    if diagram_specs:
                        done_payload["diagram_specs"] = diagram_specs
                elif diagram_specs:
                    done_payload["diagram_specs"] = diagram_specs
            _persist_content_result_to_project(project_id, section_id, done_payload, status="done")
            task_manager.set_result(task_id, done_payload)
            _sync_project_runtime_from_task(task_manager.get_task(task_id))
        except asyncio.CancelledError:
            await _best_effort_stop_dify_by_task_id(task_id)
            if project_id:
                await task_manager.release_diagram_slot(project_id)
            logger.info(f"[Task {task_id}] 内容生成任务被用户取消")
            task_manager.set_cancelled(task_id)
            _sync_project_runtime_from_task(task_manager.get_task(task_id))
        except Exception as e:
            if project_id:
                await task_manager.release_diagram_slot(project_id)
            logger.error(f"[Task {task_id}] 内容生成后台任务失败: {e}", exc_info=True)
            _persist_content_result_to_project(
                project_id,
                section_id,
                {},
                status="error",
                error=_format_dify_runtime_error(e),
            )
            task_manager.set_error(task_id, _format_dify_runtime_error(e))
            _sync_project_runtime_from_task(task_manager.get_task(task_id))

    import asyncio
    bg = asyncio.create_task(_run())
    task_manager.set_async_task(task_id, bg)
    return {"task_id": task_id, "section_id": section_id}


@router.post("/tasks/start-content-rewrite", summary="发起单章节重生成后台任务")
async def start_content_rewrite_task(request: dict):
    try:
        validate_required_bidder_info(request.get("bidder_info", {}) or {})
    except BidderInfoRequiredError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    _r = _get_deps()
    dify_key = _r._get_workflow_key("content_rewrite")
    if not dify_key:
        raise HTTPException(status_code=500, detail="content_rewrite 工作流 API Key 未配置")

    project_id = str(request.get("project_id", "") or "").strip()
    await _ensure_project_slot(project_id, "content")
    section_id = str(request.get("section_id", "") or "").strip()
    section_title = str(request.get("section_title", "") or "").strip()
    current_content = str(request.get("current_content", "") or "")
    current_text, diagram_suffix = _split_diagram_blocks(current_content)
    if not current_text.strip():
        raise HTTPException(status_code=400, detail="current_content 不能为空")

    expected_words = int(request.get("expected_words", 0) or 0)
    rewrite_instruction = str(request.get("rewrite_instruction", "") or "").strip()
    task_id = task_manager.create_task("content", project_id, workflow_name="content_rewrite")
    _persist_project_runtime(
        project_id,
        task_id=task_id,
        task_type="content",
        runtime_state="running",
        message=f"{section_title or section_id or '章节'} 重生成中",
    )

    request_mapping_flat = request.get("mapping_table", {}) or {}
    if not isinstance(request_mapping_flat, dict):
        request_mapping_flat = {}
    db = SessionLocal()
    try:
        request_mapping_flat, rewrite_placeholder_hint, _bidder_context = merge_bidder_pipt_context(
            mapping_table=request_mapping_flat,
            placeholder_hint=request.get("placeholder_hint", ""),
            bidder_info=request.get("bidder_info", {}) or {},
            db=db,
        )
        db.commit()
    except Exception:
        db.rollback()
        logger.warning("投标人信息 PIPT 归一化失败，重生成任务使用请求原始占位符上下文", exc_info=True)
        rewrite_placeholder_hint = request.get("placeholder_hint", "")
    finally:
        db.close()
    strip_structural_numbering = str(request.get("generation_strategy", "general") or "general").strip() == "response_special"

    async def _run():
        try:
            inputs = {
                "section_id": section_id,
                "section_title": section_title,
                "current_content": current_text,
                "rewrite_instruction": rewrite_instruction,
                "expected_words": expected_words,
                "project_summary": request.get("project_summary", ""),
                "global_outline": request.get("global_outline", ""),
                "section_outline_slice": request.get("section_outline_slice", ""),
                "analysis_context": request.get("analysis_context", ""),
                "placeholder_hint": rewrite_placeholder_hint,
            }
            outputs = await _collect_workflow_outputs(
                task_id,
                dify_key,
                inputs,
                _r=_r,
                initial_stage=f"🪄 正在重生成：{section_title or section_id or '未命名章节'}",
            )
            payload = _finalize_single_content_result(
                section_title or section_id,
                outputs,
                request_mapping_flat,
                strip_structural_numbering=strip_structural_numbering,
            )
            if payload.get("placeholder_issues"):
                raise RuntimeError("占位符格式异常且无法可靠还原")
            rewritten = str(payload.get("content") or "").strip()
            if diagram_suffix:
                rewritten = f"{rewritten}\n{diagram_suffix}".strip() if rewritten else diagram_suffix
            payload["content"] = rewritten
            payload["word_count"] = _count_visible_chars(rewritten)
            payload["done"] = True
            payload["section_id"] = section_id
            task_manager.set_result(task_id, payload)
            _sync_project_runtime_from_task(task_manager.get_task(task_id))
        except asyncio.CancelledError:
            await _best_effort_stop_dify_by_task_id(task_id)
            logger.info(f"[Task {task_id}] 单章节重生成任务被用户取消")
            task_manager.set_cancelled(task_id)
            _sync_project_runtime_from_task(task_manager.get_task(task_id))
        except Exception as e:
            logger.error(f"[Task {task_id}] 单章节重生成任务失败: {e}", exc_info=True)
            task_manager.set_error(task_id, _format_dify_runtime_error(e))
            _sync_project_runtime_from_task(task_manager.get_task(task_id))

    import asyncio
    bg = asyncio.create_task(_run())
    task_manager.set_async_task(task_id, bg)
    return {"task_id": task_id, "section_id": section_id}


@router.post("/tasks/start-content-group", summary="发起 H2 分组正文生成后台任务")
async def start_content_group_task(request: dict):
    """
    按 H2 分组批量生成其下子章节。
    content_group_writer 未配置或批量结果校验失败时直接失败，避免静默退化为慢速逐章生成。
    """
    try:
        validate_required_bidder_info(request.get("bidder_info", {}) or {})
    except BidderInfoRequiredError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    _r = _get_deps()
    project_id = str(request.get("project_id", "") or "").strip()
    await _ensure_project_slot(project_id, "content")

    group_id = str(request.get("group_id", "") or "").strip() or uuid.uuid4().hex[:8]
    group_title = str(request.get("group_title", "") or "").strip() or "未命名分组"
    children = _build_group_writing_children(request.get("children") or [])
    if not children:
        raise HTTPException(status_code=400, detail="children 不能为空")

    request_mapping_flat = request.get("mapping_table", {}) or {}
    if not isinstance(request_mapping_flat, dict):
        request_mapping_flat = {}
    db = SessionLocal()
    try:
        request_mapping_flat, group_placeholder_hint, _bidder_context = merge_bidder_pipt_context(
            mapping_table=request_mapping_flat,
            placeholder_hint=request.get("placeholder_hint", ""),
            bidder_info=request.get("bidder_info", {}) or {},
            db=db,
        )
        db.commit()
    except Exception:
        db.rollback()
        logger.warning("投标人信息 PIPT 归一化失败，分组正文任务使用请求原始占位符上下文", exc_info=True)
        group_placeholder_hint = request.get("placeholder_hint", "")
    finally:
        db.close()

    group_key = _r._get_workflow_key("content_group_writer")
    if not group_key:
        raise HTTPException(status_code=500, detail="content_group_writer 工作流 API Key 未配置，请在 .env 中设置 DIFY_WORKFLOW_CONTENT_GROUP_WRITER")

    task_id = task_manager.create_task("content", project_id, workflow_name="content_group_writer")
    _persist_project_runtime(
        project_id,
        task_id=task_id,
        task_type="content",
        runtime_state="running",
        message=f"{group_title} 正文批量生成中",
    )

    async def _run():
        try:
            shared_analysis_context = _dedupe_join([child["analysis_context"] for child in children], max_len=9000)
            group_outline_slice = _dedupe_join(
                [str(request.get("global_outline", "") or "").strip()] + [child["section_outline_slice"] for child in children],
                max_len=2600,
            )
            group_search_query = _build_group_search_query(group_title, children)
            enable_diagrams = bool(request.get("enable_diagrams", False) and _diagram_generation_enabled())
            max_diagrams = int(request.get("max_diagrams", 0) or 0) if enable_diagrams else 0
            diagram_key = _get_diagram_workflow_key(_r) if enable_diagrams and max_diagrams > 0 else ""
            results: list[dict] = []
            failed_sections: list[dict] = []

            group_inputs = {
                "group_id": group_id,
                "group_title": group_title,
                "expected_total_words": sum(max(0, int(child["expected_words"] or 0)) for child in children),
                "project_summary": request.get("project_summary", ""),
                "global_outline": group_outline_slice,
                "placeholder_hint": group_placeholder_hint,
                "requires_search": "true" if bool(request.get("requires_search", False)) else "false",
                "group_analysis_context": shared_analysis_context,
                "search_query": group_search_query,
                "children_json": json.dumps([
                    {
                        "section_id": child["section_id"],
                        "section_title": child["section_title"],
                        "keywords": child["keywords"],
                        "expected_words": child["expected_words"],
                        "writing_hint": child["writing_hint"],
                    }
                    for child in children
                ], ensure_ascii=False),
            }
            outputs = await _collect_workflow_outputs(
                task_id,
                group_key,
                group_inputs,
                _r=_r,
                initial_stage=f"📦 H2 批量生成中：{group_title}",
            )
            parsed = _parse_group_content_results(outputs, children, request_mapping_flat)
            results = list(parsed.get("sections") or [])
            failed_sections = list(parsed.get("failed_sections") or [])
            parse_error = str(parsed.get("parse_error") or "").strip()
            if parse_error:
                summary = _summarize_workflow_outputs(outputs)
                logger.warning(
                    "[Task %s] H2 批量正文解析存在缺失: %s; 返回摘要: %s",
                    task_id,
                    parse_error,
                    summary,
                )
                if results:
                    task_manager.update_stage(task_id, f"⚠️ 批量结果不完整，已保留成功章节（{len(results)}/{len(children)}）")
                else:
                    task_manager.update_stage(task_id, "⚠️ 批量结果无可用正文，已标记章节失败")

            repaired_sections, failed_sections = await _repair_group_failed_sections(
                task_id=task_id,
                _r=_r,
                children=children,
                failed_sections=failed_sections,
                request=request,
                request_mapping_flat=request_mapping_flat,
                group_placeholder_hint=group_placeholder_hint,
                group_outline_slice=group_outline_slice,
            )
            if repaired_sections:
                repaired_ids = {str(row.get("section_id") or "") for row in repaired_sections}
                results = [row for row in results if str(row.get("section_id") or "") not in repaired_ids]
                results.extend(repaired_sections)
                task_manager.update_stage(
                    task_id,
                    f"🩹 已补生成缺失子章节（{len(repaired_sections)} 个）",
                )

            child_map = {child["section_id"]: child for child in children}
            ordered_results = sorted(
                results,
                key=lambda row: int(child_map.get(row["section_id"], {}).get("diagram_priority", 0)),
                reverse=True,
            )
            final_by_id: dict[str, dict[str, Any]] = {row["section_id"]: dict(row) for row in results}
            for done_count, row in enumerate(ordered_results, start=1):
                child = child_map.get(row["section_id"])
                if not child:
                    continue
                content = str(row.get("content") or "")
                child_need_diagram = bool(child.get("need_diagram"))
                child_diagram_brief = str(child.get("diagram_brief") or "").strip()
                child_wants_diagram = enable_diagrams and child_need_diagram and bool(child_diagram_brief) and max_diagrams > 0
                child_can_generate_diagram = bool(child_wants_diagram and diagram_key)
                child_should_report_diagram_skip = (
                    bool(request.get("enable_diagrams", False))
                    and child_need_diagram
                )
                child_diagram_skip = None
                if child_should_report_diagram_skip and not child_can_generate_diagram:
                    child_diagram_skip = _build_diagram_skip_payload(
                        workflow_name="content_writer",
                        enable_diagrams=enable_diagrams,
                        need_diagram=child_need_diagram,
                        diagram_brief=child_diagram_brief,
                        max_diagrams=max_diagrams,
                        diagram_key=diagram_key if child_wants_diagram else "",
                    )
                diagrams_generated: list[dict[str, Any]] = []
                if child_can_generate_diagram:
                    diagram_specs = row.get("diagram_specs") or row.get("diagram_spec")
                    diagrams_generated, diagram_slot_reserved, diagram_error = await _execute_diagram_for_section(
                        task_id,
                        project_id,
                        _r,
                        diagram_key,
                        enable_diagrams,
                        child_need_diagram,
                        child_diagram_brief,
                        max_diagrams,
                        str(child.get("diagram_type_hint") or "architecture"),
                        str(child.get("section_title") or ""),
                        str(child.get("writing_hint") or ""),
                        str(child.get("keywords") or ""),
                        group_outline_slice,
                        content,
                        diagram_specs,
                    )
                    if not diagrams_generated and diagram_slot_reserved:
                        await task_manager.release_diagram_slot(project_id)
                    if diagram_error:
                        row["diagram_error"] = diagram_error
                    if diagrams_generated:
                        content = content + "\n" + "\n".join(_build_diagram_reference_tag(d) for d in diagrams_generated)
                        row["content"] = content
                        row["word_count"] = _count_visible_chars(content)
                if child_diagram_skip:
                    row["diagram_skip"] = child_diagram_skip
                final_by_id[row["section_id"]] = row
                task_manager.append_partial_event(task_id, {
                    "partial": True,
                    "phase": "group_child_done",
                    "group_id": group_id,
                    "section_id": row["section_id"],
                    "content": row.get("content") or "",
                    "word_count": row.get("word_count") or 0,
                    "quality_score": row.get("quality_score"),
                    "feedback": row.get("feedback"),
                    "replace_report": row.get("replace_report") or [],
                    "diagrams_count": len(diagrams_generated),
                    "diagram_error": row.get("diagram_error"),
                    "diagram_skip": row.get("diagram_skip"),
                    "done_count": done_count,
                    "total_count": len(children),
                })

            rank = {child["section_id"]: idx for idx, child in enumerate(children)}
            results = sorted(final_by_id.values(), key=lambda row: rank.get(row["section_id"], 9999))
            failed_sections.sort(key=lambda row: rank.get(str(row.get("section_id") or ""), 9999))

            task_manager.set_result(task_id, {
                "done": True,
                "group_id": group_id,
                "group_title": group_title,
                "sections": results,
                "sections_count": len(results),
                "failed_sections": failed_sections,
                "failed_count": len(failed_sections),
                "partial_success": bool(results) and bool(failed_sections),
            })
            _persist_group_content_result_to_project(project_id, results, failed_sections)
            _sync_project_runtime_from_task(task_manager.get_task(task_id))
        except asyncio.CancelledError:
            await _best_effort_stop_dify_by_task_id(task_id)
            logger.info(f"[Task {task_id}] H2 批量正文任务被用户取消")
            task_manager.set_cancelled(task_id)
            _sync_project_runtime_from_task(task_manager.get_task(task_id))
        except Exception as e:
            logger.error(f"[Task {task_id}] H2 批量正文任务失败: {e}", exc_info=True)
            task_manager.set_error(task_id, _format_dify_runtime_error(e))
            _sync_project_runtime_from_task(task_manager.get_task(task_id))

    import asyncio
    bg = asyncio.create_task(_run())
    task_manager.set_async_task(task_id, bg)
    return {"task_id": task_id, "group_id": group_id}


@router.post("/tasks/start-group-review", summary="发起 H2 分组手动评估任务")
async def start_group_review_task(request: dict):
    _r = _get_deps()
    dify_key = _r._get_workflow_key("group_review_writer")
    if not dify_key:
        raise HTTPException(status_code=500, detail="group_review_writer 工作流 API Key 未配置")

    project_id = str(request.get("project_id", "") or "").strip()
    await _ensure_project_slot(project_id, "content")
    group_id = str(request.get("group_id", "") or "").strip() or uuid.uuid4().hex[:8]
    group_title = str(request.get("group_title", "") or "").strip() or "未命名章节"
    sections = request.get("sections") or []
    if not isinstance(sections, list) or not sections:
        raise HTTPException(status_code=400, detail="sections 不能为空")

    task_id = task_manager.create_task("content", project_id, workflow_name="group_review_writer")
    _persist_project_runtime(
        project_id,
        task_id=task_id,
        task_type="content",
        runtime_state="running",
        message=f"{group_title} 评估中",
    )

    async def _run():
        try:
            inputs = {
                "group_id": group_id,
                "group_title": group_title,
                "project_summary": request.get("project_summary", ""),
                "group_outline": request.get("group_outline", ""),
                "group_analysis_context": request.get("group_analysis_context", ""),
                "sections_json": json.dumps(sections, ensure_ascii=False),
            }
            outputs = await _collect_workflow_outputs(
                task_id,
                dify_key,
                inputs,
                _r=_r,
                initial_stage=f"🧾 H2 章节评估中：{group_title}",
            )
            payload = _parse_group_review_result(outputs)
            payload.update({
                "done": True,
                "group_id": group_id,
                "group_title": group_title,
            })
            task_manager.set_result(task_id, payload)
            _sync_project_runtime_from_task(task_manager.get_task(task_id))
        except asyncio.CancelledError:
            await _best_effort_stop_dify_by_task_id(task_id)
            logger.info(f"[Task {task_id}] H2 分组评估任务被用户取消")
            task_manager.set_cancelled(task_id)
            _sync_project_runtime_from_task(task_manager.get_task(task_id))
        except Exception as e:
            logger.error(f"[Task {task_id}] H2 分组评估任务失败: {e}", exc_info=True)
            task_manager.set_error(task_id, _format_dify_runtime_error(e))
            _sync_project_runtime_from_task(task_manager.get_task(task_id))

    import asyncio
    bg = asyncio.create_task(_run())
    task_manager.set_async_task(task_id, bg)
    return {"task_id": task_id, "group_id": group_id}


# ═══════════════════════════════════════════════════════════════
#  POST /tasks/start-diagram — 独立图表任务（与 defer_diagram 正文衔接）
# ═══════════════════════════════════════════════════════════════

@router.post("/tasks/start-diagram", summary="独立图表生成后台任务")
async def start_diagram_task(request: dict):
    """在正文任务完成（diagram_deferred）后调用：仅跑图表工作流并拼回 base_content。"""
    project_id = str(request.get("project_id", "") or "").strip()
    section_id = request.get("section_id", "")
    base_content = str(request.get("base_content", "") or "")
    if not _diagram_generation_enabled():
        task_id = task_manager.create_task("diagram", project_id)
        _persist_project_runtime(
            project_id,
            task_id=task_id,
            task_type="diagram",
            runtime_state="succeeded",
            message="图表生成已禁用，保留正文",
        )
        task_manager.set_result(task_id, {
            "done": True,
            "section_id": section_id,
            "content": base_content,
            "word_count": _count_visible_chars(base_content),
            "quality_score": request.get("quality_score"),
            "feedback": request.get("feedback"),
            "replace_report": request.get("replace_report", []) or [],
            "diagrams_count": 0,
        })
        _sync_project_runtime_from_task(task_manager.get_task(task_id))
        return {"task_id": task_id, "section_id": section_id}

    _r = _get_deps()
    diagram_key = _get_diagram_workflow_key(_r)
    if not diagram_key:
        raise HTTPException(status_code=500, detail=f"{_get_diagram_workflow_name()} 工作流 API Key 未配置")

    await _ensure_project_slot(project_id, "diagram")
    section_title = request.get("section_title", "")
    enable_diagrams = bool(request.get("enable_diagrams", False) and _diagram_generation_enabled())

    task_id = task_manager.create_task("diagram", project_id)
    _persist_project_runtime(
        project_id,
        task_id=task_id,
        task_type="diagram",
        runtime_state="running",
        message="图表生成中",
    )

    async def _run():
        try:
            task_manager.update_stage(task_id, "🎨 独立图表任务启动")
            result_payload = await _run_diagram_request(
                task_id,
                {**request, "enable_diagrams": enable_diagrams},
                _r,
                diagram_key,
            )
            if result_payload.get("diagram_error"):
                task_manager.update_stage(task_id, "⚠️ 图表生成失败，已保留正文")
            task_manager.set_result(task_id, result_payload)
            _sync_project_runtime_from_task(task_manager.get_task(task_id))
        except asyncio.CancelledError:
            if project_id:
                await task_manager.release_diagram_slot(project_id)
            logger.info(f"[Task {task_id}] 图表任务被用户取消")
            task_manager.set_cancelled(task_id)
            _sync_project_runtime_from_task(task_manager.get_task(task_id))
        except Exception as e:
            if project_id:
                await task_manager.release_diagram_slot(project_id)
            logger.error(f"[Task {task_id}] 图表后台任务失败: {e}", exc_info=True)
            task_manager.set_result(task_id, {
                "done": True,
                "section_id": section_id,
                "content": base_content,
                "word_count": _count_visible_chars(base_content),
                "quality_score": request.get("quality_score"),
                "feedback": request.get("feedback"),
                "replace_report": request.get("replace_report", []) or [],
                "diagrams_count": 0,
                "diagram_error": _build_diagram_error_payload(e, section_title),
            })
            _sync_project_runtime_from_task(task_manager.get_task(task_id))

    import asyncio
    bg = asyncio.create_task(_run())
    task_manager.set_async_task(task_id, bg)
    return {"task_id": task_id, "section_id": section_id}


@router.post("/tasks/start-diagram-batch", summary="批量独立图表生成后台任务")
async def start_diagram_batch_task(request: dict):
    """将多个正文后的图表请求放入同一后台任务，后端按队列逐节补图。"""
    project_id = str(request.get("project_id", "") or "").strip()
    raw_requests = request.get("diagram_requests") or request.get("requests") or []
    if not isinstance(raw_requests, list):
        raise HTTPException(status_code=400, detail="diagram_requests 必须是数组")
    diagram_requests = [item for item in raw_requests if isinstance(item, dict)]
    if not diagram_requests:
        raise HTTPException(status_code=400, detail="diagram_requests 不能为空")

    if not _diagram_generation_enabled():
        task_id = task_manager.create_task("diagram", project_id)
        sections = []
        for item in diagram_requests:
            item_project_id = str(item.get("project_id") or project_id or "").strip()
            base_content = str(item.get("base_content", "") or "")
            sections.append(_build_diagram_task_result(
                {**item, "project_id": item_project_id},
                base_content,
                [],
                None,
            ))
        task_manager.set_result(task_id, {
            "done": True,
            "project_id": project_id,
            "sections": sections,
            "failed_sections": [],
            "diagrams_count": 0,
        })
        _sync_project_runtime_from_task(task_manager.get_task(task_id))
        return {"task_id": task_id, "count": len(sections)}

    _r = _get_deps()
    diagram_key = _get_diagram_workflow_key(_r)
    if not diagram_key:
        raise HTTPException(status_code=500, detail=f"{_get_diagram_workflow_name()} 工作流 API Key 未配置")

    await _ensure_project_slot(project_id, "diagram")
    task_id = task_manager.create_task("diagram", project_id)
    _persist_project_runtime(
        project_id,
        task_id=task_id,
        task_type="diagram",
        runtime_state="running",
        message="批量图表生成中",
    )

    async def _run():
        sections: list[dict] = []
        failed_sections: list[dict] = []
        try:
            total = len(diagram_requests)
            for idx, item in enumerate(diagram_requests, start=1):
                _ensure_task_running(task_id)
                section_id = str(item.get("section_id", "") or "")
                section_title = str(item.get("section_title", "") or section_id or "未命名章节")
                task_manager.update_stage(task_id, f"🎨 图表生成中 {idx}/{total}: {section_title}")
                merged_request = {
                    **item,
                    "project_id": str(item.get("project_id") or project_id or "").strip(),
                    "enable_diagrams": bool(item.get("enable_diagrams", request.get("enable_diagrams", True))),
                    "max_diagrams": int(item.get("max_diagrams", request.get("max_diagrams", 0)) or 0),
                    "mapping_table": item.get("mapping_table", request.get("mapping_table", {}) or {}),
                }
                result_payload = await _run_diagram_request(task_id, merged_request, _r, diagram_key)
                sections.append(result_payload)
                if result_payload.get("diagram_error"):
                    failed_sections.append({
                        "section_id": section_id,
                        "error": result_payload["diagram_error"],
                    })
                task_manager.append_partial_event(task_id, {
                    "partial": True,
                    "phase": "diagram_section_done",
                    "section_id": section_id,
                    "content": result_payload.get("content", ""),
                    "word_count": result_payload.get("word_count", 0),
                    "quality_score": result_payload.get("quality_score"),
                    "feedback": result_payload.get("feedback"),
                    "replace_report": result_payload.get("replace_report", []),
                    "diagrams_count": result_payload.get("diagrams_count", 0),
                    "diagram_error": result_payload.get("diagram_error"),
                    "done_count": idx,
                    "total_count": total,
                })
            task_manager.set_result(task_id, {
                "done": True,
                "project_id": project_id,
                "sections": sections,
                "failed_sections": failed_sections,
                "diagrams_count": sum(int(row.get("diagrams_count") or 0) for row in sections),
            })
            _sync_project_runtime_from_task(task_manager.get_task(task_id))
        except asyncio.CancelledError:
            if project_id:
                await task_manager.release_diagram_slot(project_id)
            logger.info(f"[Task {task_id}] 批量图表任务被用户取消")
            task_manager.set_cancelled(task_id)
            _sync_project_runtime_from_task(task_manager.get_task(task_id))
        except Exception as e:
            if project_id:
                await task_manager.release_diagram_slot(project_id)
            logger.error(f"[Task {task_id}] 批量图表后台任务失败: {e}", exc_info=True)
            task_manager.set_result(task_id, {
                "done": True,
                "project_id": project_id,
                "sections": sections,
                "failed_sections": failed_sections,
                "diagrams_count": sum(int(row.get("diagrams_count") or 0) for row in sections),
                "diagram_error": _build_diagram_error_payload(e, "批量图表"),
            })
            _sync_project_runtime_from_task(task_manager.get_task(task_id))

    import asyncio
    bg = asyncio.create_task(_run())
    task_manager.set_async_task(task_id, bg)
    return {"task_id": task_id, "count": len(diagram_requests)}


# ═══════════════════════════════════════════════════════════════
#  POST /tasks/{task_id}/cancel — 强制取消任务
# ═══════════════════════════════════════════════════════════════

@router.post("/tasks/{task_id}/cancel", summary="强制取消后台任务")
async def cancel_task(task_id: str, project_id: Optional[str] = Query(default=None)):
    """取消正在运行的后台任务。
    - 对 streaming 任务（outline/content/diagram/analyze）：调用 Dify Stop API 真正终止工作流，再取消本地协程。
    - 对非 streaming 任务（extract）：仅取消本地协程（放弃等待）。
    """
    task = _require_task_owner(task_id, project_id)
    if task.status != "running":
        raise HTTPException(status_code=404, detail="任务不存在或已完成")

    # 先落盘 cancelling，前端立即可见“正在取消”状态
    _persist_project_runtime(
        task.project_id,
        task_id=task.task_id,
        task_type=task.task_type,
        runtime_state="cancelling",
        message=task.current_stage or "任务取消中",
        started_at=datetime.utcfromtimestamp(float(task.created_at or time.time())).isoformat(),
        cancellable=False,
    )

    # 对 streaming 任务尝试调用 Dify Stop API（若 task_id 尚未绑定，短暂等待再试）
    dify_stopped = False
    remote_stop_status = "not_applicable"
    if task.task_type in {"outline", "content", "diagram", "analyze"}:
        remote_stop_status = "not_bound"
        if not (task.dify_task_id or getattr(task, "dify_task_ids", None)):
            import asyncio
            for _ in range(8):  # 最长等待约 2s，覆盖刚起流时 task_id 还未回传的窗口
                await asyncio.sleep(0.25)
                task = task_manager.get_task(task_id) or task
                if task.dify_task_id or getattr(task, "dify_task_ids", None):
                    break
        if task.dify_task_id or getattr(task, "dify_task_ids", None):
            dify_stopped, remote_stop_status = await _stop_dify_workflows(task)

    # 取消本地 asyncio 协程
    ok = task_manager.cancel_task(task_id)
    if not ok:
        # 如果 Dify 已 stop 成功但本地 cancel 失败（任务刚好结束），也视为成功
        if not dify_stopped:
            raise HTTPException(status_code=404, detail="任务不存在或已完成")
    latest_task = task_manager.get_task(task_id)
    _sync_project_runtime_from_task(latest_task)
    cancelled_at = datetime.utcnow().isoformat()
    _push_task_event(task_id, "cancelled", {
        "phase": str((latest_task.current_stage if latest_task else "") or ""),
        "dify_stopped": bool(dify_stopped),
        "cancelled_at": cancelled_at,
    })
    return {
        "cancelled": True,
        "task_id": task_id,
        "dify_stopped": dify_stopped,
        "remote_stop_status": remote_stop_status,
        "task_state": _task_status_to_api_state((latest_task.status if latest_task else "cancelled")),
        "phase": str((latest_task.current_stage if latest_task else "") or ""),
        "cancelled_at": cancelled_at,
    }


async def _stop_dify_workflows(task) -> tuple[bool, str]:
    """调用 Dify Stop API 终止 streaming 工作流，支持一个后台任务绑定多个 Dify 子任务。"""
    _r = _get_deps()
    # task_type → dify workflow key 映射
    type_key_map = {
        "outline": "structure_generator",
        "content": "content_writer",
        "diagram": "diagram_generator",
        "analyze": "doc_analysis",
    }
    workflow_key = str(getattr(task, "workflow_name", "") or "").strip() or type_key_map.get(task.task_type)
    if not workflow_key:
        return False, "not_applicable"
    dify_key = _r._get_workflow_key(workflow_key)
    if not dify_key:
        return False, "missing_key"

    task_ids = [
        str(item).strip()
        for item in ([task.dify_task_id] + list(getattr(task, "dify_task_ids", []) or []))
        if str(item or "").strip()
    ]
    task_ids = list(dict.fromkeys(task_ids))
    if not task_ids:
        return False, "not_bound"

    import os, httpx
    dify_base = os.environ.get("DIFY_API_URL", "http://localhost/v1").rstrip("/")
    stopped = 0
    failed = 0
    async with httpx.AsyncClient(timeout=10) as client:
        for dify_task_id in task_ids:
            try:
                resp = await client.post(
                    f"{dify_base}/workflows/tasks/{dify_task_id}/stop",
                    headers={"Authorization": f"Bearer {dify_key}"},
                    json={"user": "pro-engine-backend"},
                )
                logger.info(f"[Dify Stop] task_type={task.task_type} dify_task_id={dify_task_id} status={resp.status_code}")
                if resp.status_code == 200:
                    stopped += 1
                else:
                    failed += 1
            except Exception as e:
                failed += 1
                logger.warning(f"[Dify Stop] 调用失败 dify_task_id={dify_task_id}: {e}")

    if stopped == len(task_ids):
        return True, "stopped"
    if stopped > 0:
        return True, "partial"
    if failed > 0:
        return False, "failed"
    return False, "not_bound"


# ═══════════════════════════════════════════════════════════════
#  GET /tasks/{task_id}/status — 轻量轮询端点
# ═══════════════════════════════════════════════════════════════

@router.get("/tasks/{task_id}/status", summary="轮询任务状态")
async def get_task_status(
    task_id: str,
    project_id: Optional[str] = Query(default=None),
    after_event_id: int = Query(default=0),
):
    """轻量 JSON 轮询：返回任务当前状态、阶段列表和结果。"""
    task = _require_task_owner(task_id, project_id)
    started_at = datetime.utcfromtimestamp(float(task.created_at or time.time())).isoformat()
    updated_at = datetime.utcfromtimestamp(float(task.updated_at or time.time())).isoformat()
    normalized_after_event_id = max(0, int(after_event_id or 0))
    partial_events = [
        event for event in (task.partial_events or [])
        if int(event.get("event_id") or 0) > normalized_after_event_id
    ]
    return {
        "task_id": task_id,
        "status": task.status,
        "state": _task_status_to_api_state(task.status),
        "progress": 100 if task.status == "done" else 0,
        "current_stage": task.current_stage,
        "stages": [s for s in task.stages if not s.startswith("__text__")],
        "result": task.result if task.status == "done" else None,
        "partial_result": task.partial_result if task.status == "running" else None,
        "partial_events": partial_events,
        "last_partial_event_id": int(task.partial_event_seq or 0),
        "error": task.error if task.status in {"error", "timeout"} else None,
        "cancelled": task.status == "cancelled",
        "timed_out": task.status == "timeout",
        "cancellable": task.status == "running",
        "started_at": started_at,
        "updated_at": updated_at,
    }


@router.get("/diagram-artifacts/{diagram_id}.svg", summary="获取 SVG 图表 artifact")
async def get_diagram_artifact(diagram_id: str, project_id: str = Query(default="")):
    safe_id = _safe_diagram_artifact_id(diagram_id)
    project = re.sub(r"[^a-zA-Z0-9_.-]+", "_", str(project_id or "default"))
    path = DIAGRAM_ARTIFACT_DIR / project / f"{safe_id}.svg"
    if not path.exists():
        for candidate in DIAGRAM_ARTIFACT_DIR.glob(f"*/{safe_id}.svg"):
            path = candidate
            break
    if not path.exists():
        mermaid_path = DIAGRAM_ARTIFACT_DIR / project / f"{safe_id}.mmd"
        if not mermaid_path.exists():
            for candidate in DIAGRAM_ARTIFACT_DIR.glob(f"*/{safe_id}.mmd"):
                mermaid_path = candidate
                break
        if not mermaid_path.exists():
            raise HTTPException(status_code=404, detail="图表 artifact 不存在")
        rendered_svg_path = mermaid_path.with_suffix(".svg")
        if rendered_svg_path.exists() or _render_mermaid_to_svg_file(mermaid_path, rendered_svg_path):
            return StreamingResponse(
                iter([rendered_svg_path.read_text(encoding="utf-8")]),
                media_type="image/svg+xml",
                headers={"Cache-Control": "public, max-age=86400"},
            )
        mermaid = mermaid_path.read_text(encoding="utf-8")
        svg = _mermaid_to_fallback_svg(mermaid, title="Mermaid 数据流图")
        return StreamingResponse(
            iter([svg]),
            media_type="image/svg+xml",
            headers={"Cache-Control": "public, max-age=86400"},
        )
    return StreamingResponse(
        iter([path.read_text(encoding="utf-8")]),
        media_type="image/svg+xml",
        headers={"Cache-Control": "public, max-age=86400"},
    )


@router.get("/diagram-artifacts/{diagram_id}.mmd", summary="获取 Mermaid 图表 artifact")
async def get_mermaid_diagram_artifact(diagram_id: str, project_id: str = Query(default="")):
    safe_id = _safe_diagram_artifact_id(diagram_id)
    project = re.sub(r"[^a-zA-Z0-9_.-]+", "_", str(project_id or "default"))
    path = DIAGRAM_ARTIFACT_DIR / project / f"{safe_id}.mmd"
    if not path.exists():
        for candidate in DIAGRAM_ARTIFACT_DIR.glob(f"*/{safe_id}.mmd"):
            path = candidate
            break
    if not path.exists():
        raise HTTPException(status_code=404, detail="Mermaid 图表 artifact 不存在")
    return StreamingResponse(
        iter([path.read_text(encoding="utf-8")]),
        media_type="text/plain; charset=utf-8",
        headers={"Cache-Control": "public, max-age=86400"},
    )


# ═══════════════════════════════════════════════════════════════
#  GET /tasks/{task_id}/progress — 通用进度 SSE（outline/extract 用）
# ═══════════════════════════════════════════════════════════════

@router.get("/tasks/{task_id}/progress", summary="SSE 获取任务进度（支持重连）")
async def get_task_progress(task_id: str, request: Request, project_id: Optional[str] = Query(default=None)):
    """
    SSE 端点：推送后台任务的阶段进度和最终结果。
    重连后补发所有历史 stages，然后继续推送新事件。
    """
    import asyncio

    async def progress_stream():
        try:
            task = _require_task_owner(task_id, project_id)
        except HTTPException as exc:
            yield f"data: {json.dumps({'error': str(exc.detail)}, ensure_ascii=False)}\n\n"
            return

        start_ts = task.started_at if isinstance(getattr(task, "started_at", None), datetime) else datetime.utcnow()

        def _elapsed_sec() -> int:
            return max(0, int((datetime.utcnow() - start_ts).total_seconds()))

        # 补发历史
        sent = 0
        for stage in task.stages:
            if request is not None and await request.is_disconnected():
                logger.info("[Task %s] 客户端已断开（历史重放阶段）", task_id)
                return
            if stage.startswith("__text__"):
                yield f"data: {json.dumps({'text': stage[8:]}, ensure_ascii=False)}\n\n"
            elif stage.startswith("__node__"):
                # 解析报告节点结果，推送为 node_complete 事件
                try:
                    node_data = json.loads(stage[8:])
                    yield f"event: node_complete\ndata: {json.dumps(node_data, ensure_ascii=False)}\n\n"
                except Exception:
                    pass
            elif stage.startswith(_BID_ATTACH_STAGE_PREFIX):
                # 投标文件附件列表：将 JSON 抛回给前端持久化
                try:
                    bid_data = json.loads(stage[len(_BID_ATTACH_STAGE_PREFIX):])
                    yield f"event: bid_attachments\ndata: {json.dumps(bid_data, ensure_ascii=False)}\n\n"
                except Exception as e:
                    logger.warning(f"[Task {task_id}] 历史 bid_attachments 解析失败: {e}")
            elif stage.startswith(_ANALYSIS_V2_STAGE_PREFIX):
                try:
                    analysis_data = json.loads(stage[len(_ANALYSIS_V2_STAGE_PREFIX):])
                    yield f"event: analysis_v2\ndata: {json.dumps(analysis_data, ensure_ascii=False)}\n\n"
                except Exception as e:
                    logger.warning(f"[Task {task_id}] 历史 analysis_v2 解析失败: {e}")
            elif stage.startswith(_TASK_EVENT_STAGE_PREFIX):
                try:
                    evt = json.loads(stage[len(_TASK_EVENT_STAGE_PREFIX):])
                    evt["event_id"] = f"{task_id}:{sent}"
                    evt_name = str(evt.get("event") or "task_event")
                    yield f"event: {evt_name}\ndata: {json.dumps(evt, ensure_ascii=False)}\n\n"
                except Exception as e:
                    logger.warning(f"[Task {task_id}] 历史 task_event 解析失败: {e}")
            else:
                phase, percent = _outline_stage_meta_from_label(stage)
                stage_payload = {"event_id": f"{task_id}:{sent}", "stage": stage, "phase": phase, "percent": percent, "elapsed_sec": _elapsed_sec()}
                yield f"event: stage\ndata: {json.dumps(stage_payload, ensure_ascii=False)}\n\n"
                yield f"data: {json.dumps(stage_payload, ensure_ascii=False)}\n\n"
            sent += 1

        if task.status == "done":
            yield f"event: done\ndata: {json.dumps(task.result, ensure_ascii=False)}\n\n"
            yield f"data: {json.dumps(task.result, ensure_ascii=False)}\n\n"
            return
        if task.status == "error":
            yield f"event: error\ndata: {json.dumps({'error': task.error}, ensure_ascii=False)}\n\n"
            yield f"data: {json.dumps({'error': task.error}, ensure_ascii=False)}\n\n"
            return
        if task.status == "timeout":
            yield f"event: error\ndata: {json.dumps({'error': task.error, 'timed_out': True}, ensure_ascii=False)}\n\n"
            yield f"data: {json.dumps({'error': task.error, 'timed_out': True}, ensure_ascii=False)}\n\n"
            return
        if task.status == "cancelled":
            yield f"event: cancelled\ndata: {json.dumps({'cancelled': True}, ensure_ascii=False)}\n\n"
            yield f"data: {json.dumps({'cancelled': True}, ensure_ascii=False)}\n\n"
            return

        # 等待新事件
        while True:
            if request is not None and await request.is_disconnected():
                logger.info("[Task %s] 客户端已断开（增量推送阶段）", task_id)
                return
            try:
                await asyncio.wait_for(task._event.wait(), timeout=30)
            except asyncio.TimeoutError:
                hb_stage = "⏳ 仍在生成大纲，请稍候…"
                phase, percent = _outline_stage_meta_from_label(task.current_stage or hb_stage)
                yield (
                    f"data: {json.dumps({'stage': hb_stage, 'heartbeat': True, 'phase': phase, 'percent': percent or 50, 'elapsed_sec': _elapsed_sec()}, ensure_ascii=False)}\n\n"
                )
                continue

            try:
                task = _require_task_owner(task_id, project_id)
            except HTTPException:
                return

            for idx, stage in enumerate(task.stages[sent:], start=sent):
                if request is not None and await request.is_disconnected():
                    logger.info("[Task %s] 客户端已断开（增量事件循环）", task_id)
                    return
                if stage.startswith("__text__"):
                    yield f"data: {json.dumps({'text': stage[8:]}, ensure_ascii=False)}\n\n"
                elif stage.startswith("__node__"):
                    try:
                        node_data = json.loads(stage[8:])
                        yield f"event: node_complete\ndata: {json.dumps(node_data, ensure_ascii=False)}\n\n"
                    except Exception:
                        pass
                elif stage.startswith(_BID_ATTACH_STAGE_PREFIX):
                    try:
                        bid_data = json.loads(stage[len(_BID_ATTACH_STAGE_PREFIX):])
                        yield f"event: bid_attachments\ndata: {json.dumps(bid_data, ensure_ascii=False)}\n\n"
                    except Exception as e:
                        logger.warning(f"[Task {task_id}] 增量 bid_attachments 解析失败: {e}")
                elif stage.startswith(_ANALYSIS_V2_STAGE_PREFIX):
                    try:
                        analysis_data = json.loads(stage[len(_ANALYSIS_V2_STAGE_PREFIX):])
                        yield f"event: analysis_v2\ndata: {json.dumps(analysis_data, ensure_ascii=False)}\n\n"
                    except Exception as e:
                        logger.warning(f"[Task {task_id}] 增量 analysis_v2 解析失败: {e}")
                elif stage.startswith(_TASK_EVENT_STAGE_PREFIX):
                    try:
                        evt = json.loads(stage[len(_TASK_EVENT_STAGE_PREFIX):])
                        evt["event_id"] = f"{task_id}:{idx}"
                        evt_name = str(evt.get("event") or "task_event")
                        yield f"event: {evt_name}\ndata: {json.dumps(evt, ensure_ascii=False)}\n\n"
                    except Exception as e:
                        logger.warning(f"[Task {task_id}] 增量 task_event 解析失败: {e}")
                else:
                    phase, percent = _outline_stage_meta_from_label(stage)
                    stage_payload = {"event_id": f"{task_id}:{idx}", "stage": stage, "phase": phase, "percent": percent, "elapsed_sec": _elapsed_sec()}
                    yield f"event: stage\ndata: {json.dumps(stage_payload, ensure_ascii=False)}\n\n"
                    yield f"data: {json.dumps(stage_payload, ensure_ascii=False)}\n\n"
            sent = len(task.stages)

            if task.status == "done":
                yield f"event: done\ndata: {json.dumps(task.result, ensure_ascii=False)}\n\n"
                yield f"data: {json.dumps(task.result, ensure_ascii=False)}\n\n"
                return
            if task.status == "error":
                yield f"event: error\ndata: {json.dumps({'error': task.error}, ensure_ascii=False)}\n\n"
                yield f"data: {json.dumps({'error': task.error}, ensure_ascii=False)}\n\n"
                return
            if task.status == "timeout":
                yield f"event: error\ndata: {json.dumps({'error': task.error, 'timed_out': True}, ensure_ascii=False)}\n\n"
                yield f"data: {json.dumps({'error': task.error, 'timed_out': True}, ensure_ascii=False)}\n\n"
                return
            if task.status == "cancelled":
                yield f"event: cancelled\ndata: {json.dumps({'cancelled': True}, ensure_ascii=False)}\n\n"
                yield f"data: {json.dumps({'cancelled': True}, ensure_ascii=False)}\n\n"
                return

    return StreamingResponse(
        progress_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
    )


# ═══════════════════════════════════════════════════════════════
#  工具函数
# ═══════════════════════════════════════════════════════════════

def _build_sections_list(sections_raw, max_diagrams: int = 0) -> list:
    """将 Dify 返回的原始大纲数据转换为标准 sections 列表"""
    sections = []
    for i, s in enumerate(sections_raw if isinstance(sections_raw, list) else []):
        if isinstance(s, str):
            sections.append({"id": f"s{i+1}", "title": s, "wordCount": 1500, "writingHint": "", "keywords": [], "headingLevel": 2, "children": []})
        elif isinstance(s, dict):
            children = []
            for j, c in enumerate(s.get("children", s.get("subsections", s.get("subSections", s.get("sections", []))))):
                if isinstance(c, str):
                    children.append({"id": f"s{i+1}_{j+1}", "title": c, "wordCount": 500, "writingHint": "", "keywords": [], "headingLevel": 3})
                elif isinstance(c, dict):
                    children.append({
                        "id": c.get("id", f"s{i+1}_{j+1}"),
                        "title": c.get("title", ""),
                        "wordCount": c.get("wordCount", c.get("word_count", 500)),
                        "writingHint": c.get("writingHint", c.get("writing_hint", "")),
                        "keywords": c.get("keywords", []),
                        "relatedAnalysisIds": c.get("relatedAnalysisIds", c.get("related_analysis_ids", [])),
                        "needDiagram": c.get("needDiagram", c.get("need_diagram", False)),
                        "diagramBrief": c.get("diagramBrief", c.get("diagram_brief", "")),
                        "diagramPlan": c.get("diagramPlan", c.get("diagram_plan", {})),
                        "headingLevel": 3,
                    })
            sec_obj = {
                "id": s.get("id", f"s{i+1}"),
                "title": s.get("title", ""),
                "wordCount": s.get("wordCount", s.get("word_count", 1500)),
                "writingHint": s.get("writingHint", s.get("writing_hint", "")),
                "keywords": s.get("keywords", []),
                "relatedAnalysisIds": s.get("relatedAnalysisIds", s.get("related_analysis_ids", [])),
                "needDiagram": s.get("needDiagram", s.get("need_diagram", False)),
                "diagramBrief": s.get("diagramBrief", s.get("diagram_brief", "")),
                "diagramPlan": s.get("diagramPlan", s.get("diagram_plan", {})),
                "headingLevel": 2,
                "children": children,
            }
            sections.append(sec_obj)
    _r = _get_deps()
    return _r._normalize_outline_diagram_flags(sections, max_diagrams=max_diagrams, enable_diagrams=max_diagrams != 0)


# ═══════════════════════════════════════════════════════════════
#  POST /tasks/start-analyze — 解析报告后台任务（支持断连恢复）
# ═══════════════════════════════════════════════════════════════

@router.post("/tasks/start-analyze", summary="发起解析报告后台任务（支持重连恢复）")
async def start_analyze_task(
    raw_document: str = Form(default=""),
    project_id: str = Form(default=""),
    selected_node_ids: str = Form(default=""),
):
    """
    将 /projects/analyze 的分组并行提取迁移到后台任务系统。
    每个节点完成后以 __node__{id}__:{json} 格式持久化到 stages，
    前端重连 /tasks/{task_id}/progress 时可补发已完成节点。
    """
    project_id = (project_id or "").strip()
    await _ensure_project_slot(project_id, "analyze")
    import asyncio
    from pathlib import Path as _Path
    import json as _json
    import re as _re

    config_path = _Path(__file__).parent.parent.parent / "config" / "analysis_framework.json"
    if not config_path.exists():
        from fastapi import HTTPException as _HTTP
        raise _HTTP(status_code=404, detail="analysis_framework.json 不存在")
    system_prompt_base, all_nodes = load_docanalysis_framework(config_path)

    # 读取 Dify key + streaming 调用依赖
    _r = _get_deps()
    from .routes import _get_workflow_key
    dify_key = _get_workflow_key("doc_analysis") or _get_workflow_key("requirement_extractor")
    if not dify_key:
        from fastapi import HTTPException as _HTTP
        raise _HTTP(status_code=500, detail="需求提取工作流 API Key 未配置")

    # 解析选中节点
    selected_ids = set(
        nid.strip() for nid in selected_node_ids.split(",") if nid.strip()
    ) if selected_node_ids.strip() else None

    doc_source = (raw_document or "").strip()
    if doc_source:
        _r._persist_raw_document(project_id, doc_source[:300000])
    else:
        doc_source = _r._load_raw_document(project_id)
    if not doc_source:
        raise HTTPException(status_code=404, detail="未找到项目原文缓存，请先上传并解析文档")
    doc_text = doc_source[:300000]
    task_id = task_manager.create_task("analyze", project_id)
    _persist_project_runtime(
        project_id,
        task_id=task_id,
        task_type="analyze",
        runtime_state="running",
        message="解析报告生成中",
    )

    async def _run():
        try:
            existing_data = _load_existing_project_data(project_id)
            existing_report = existing_data.get("analysisReport") or existing_data.get("analysis_report") or []
            existing_content_map = _collect_analysis_content_map(existing_report) if isinstance(existing_report, list) else {}
            results_by_id = dict(existing_content_map)
            existing_bid_items = existing_data.get("bidAttachmentList") or []
            latest_bid_items = [item for item in existing_bid_items if isinstance(item, dict)]

            # ── 构建分组：全量模式固定 2 批，批量重提取保持单批 ──
            groups = build_docanalysis_groups(all_nodes, selected_ids)

            if not groups or not any(g.get("nodes") for g in groups):
                raise RuntimeError("未找到可提取节点，请检查解析框架配置")

            total_nodes = sum(len(g["nodes"]) for g in groups)
            task_manager.update_stage(task_id, f"开始分析，共 {total_nodes} 个节点")
            _push_task_event(task_id, "structure_stage", {"phase": "attachments_generating", "label": "附件结构生成中"})

            # ── 单组提取 ──
            async def extract_group(group: dict) -> list:
                nodes = group["nodes"]
                group_label = group["group_label"]

                async def _do_extract(subset_nodes: list, subset_label: str) -> str:
                    combined_system = build_docanalysis_system_prompt(system_prompt_base, subset_nodes, subset_label)

                    outputs = {}
                    got_finished = False
                    async for chunk in _r._call_dify_workflow_stream(dify_key, {
                        "system_prompt": combined_system,
                        "raw_document": doc_text,
                        "node_label": subset_label,
                    }):
                        _ensure_task_running(task_id)
                        if isinstance(chunk, dict):
                            if chunk.get("dify_task_id"):
                                task_manager.set_dify_task_id(task_id, chunk["dify_task_id"])
                            if chunk.get("__finished__"):
                                got_finished = True
                                outputs = chunk.get("outputs", {}) or {}
                                break
                    if not got_finished:
                        raise RuntimeError(f"解析工作流异常中断（未收到 finished 事件）")
                    return extract_docanalysis_text_output(outputs)

                try:
                    raw_text = await _do_extract(nodes, group_label)

                    # 提取并剥离 <BID_ATTACHMENTS>
                    bid_items: list[dict] = []
                    raw_text, attachments_payload = split_bid_attachments_tag(raw_text)
                    if attachments_payload:
                        bid_items = parse_bid_attachments_payload(attachments_payload)
                        if bid_items:
                            bid_items = _enrich_bid_attachments_with_doc_blocks(_r, project_id, bid_items)
                            latest_bid_items.clear()
                            latest_bid_items.extend(bid_items)
                            task_manager.update_stage(task_id, f"{_BID_ATTACH_STAGE_PREFIX}{_json.dumps(bid_items, ensure_ascii=False)}")
                            logger.info(f"[Task {task_id}] 投标文件目录提取: {len(bid_items)} 条")

                    result_map = parse_docanalysis_result_map(raw_text)

                    if not bid_items and any(n.get("id") == "structure_attachments" for n in nodes):
                        form_toc_raw = str(result_map.get("structure_attachments", "") or "")
                        if form_toc_raw:
                            fallback_names = _extract_chapter_names_from_text(form_toc_raw)
                            fallback_items = [{"name": nm, "start_locator": "", "end_locator": "", "description": ""} for nm in fallback_names]
                            if fallback_items:
                                fallback_items = _enrich_bid_attachments_with_doc_blocks(_r, project_id, fallback_items)
                                latest_bid_items.clear()
                                latest_bid_items.extend(fallback_items)
                                task_manager.update_stage(task_id, f"{_BID_ATTACH_STAGE_PREFIX}{_json.dumps(fallback_items, ensure_ascii=False)}")

                    results = []
                    for n in nodes:
                        content = extract_docanalysis_node_content(result_map, n["id"])
                        if isinstance(content, (dict, list)):
                            content = _json.dumps(content, ensure_ascii=False, indent=2)
                        content_str = str(content)
                        results_by_id[n["id"]] = content_str
                        results.append({"node_id": n["id"], "label": n["label"], "content": content_str})
                    return results

                except Exception as e:
                    logger.warning(f"[分组 extract] 【{group_label}】首次完整提取失败 ({e})。启用降级拆分...")

                # 降级：节点单点提取（避免子节点太大互相污染和格式冲突）
                fallback_results = []
                for n in nodes:
                    task_manager.update_stage(task_id, f"正在进行节点重试: {n['label']}...")
                    try:
                        single_raw = await _do_extract([n], f"{group_label} - 单独抽取 {n['label']}")

                        bid_items = []
                        single_raw, attachments_payload = split_bid_attachments_tag(single_raw)
                        if attachments_payload:
                            bid_items = parse_bid_attachments_payload(attachments_payload)
                            if bid_items:
                                bid_items = _enrich_bid_attachments_with_doc_blocks(_r, project_id, bid_items)
                                latest_bid_items.clear()
                                latest_bid_items.extend(bid_items)
                                task_manager.update_stage(task_id, f"{_BID_ATTACH_STAGE_PREFIX}{_json.dumps(bid_items, ensure_ascii=False)}")

                        json_match = _re.search(r'(\{.*\})', single_raw, _re.DOTALL)
                        if json_match:
                            json_str = json_match.group(1)
                        else:
                            json_str = _re.sub(r'^```(?:json)?\s*', '', single_raw).rstrip('`').strip()

                        try:
                            s_map = parse_docanalysis_result_map(json_str)
                            content = extract_docanalysis_node_content(s_map, n["id"])
                        except Exception:
                            # 终极保护：如果依旧解析失败，不再抛错，直接把整个字符串存进来
                            content = single_raw or "**提取异常**"
                            # 但如果是附件结构节点需要降级
                            if n.get("id") == "structure_attachments" and not bid_items:
                                fallback_names = _extract_chapter_names_from_text(single_raw)
                                fallback_items = [{"name": nm, "start_locator": "", "end_locator": "", "description": ""} for nm in fallback_names]
                                if fallback_items:
                                    fallback_items = _enrich_bid_attachments_with_doc_blocks(_r, project_id, fallback_items)
                                    latest_bid_items.clear()
                                    latest_bid_items.extend(fallback_items)
                                    task_manager.update_stage(task_id, f"{_BID_ATTACH_STAGE_PREFIX}{_json.dumps(fallback_items, ensure_ascii=False)}")
                        
                        if isinstance(content, (dict, list)):
                            content = _json.dumps(content, ensure_ascii=False, indent=2)
                        content_str = str(content)
                        results_by_id[n["id"]] = content_str
                        fallback_results.append({"node_id": n["id"], "label": n["label"], "content": content_str})
                        await asyncio.sleep(0.5)
                    except Exception as single_e:
                        logger.error(f"[Task {task_id}] 降级提取节点 {n['id']} 彻底失败: {single_e}")
                        fallback_results.append({"node_id": n["id"], "label": n["label"], "content": "**提取失败，请重新生成**"})

                return fallback_results


            # ── 串行执行所有组：保证 cancel 时可稳定 stop 当前 Dify 工作流 ──
            done_count = 0
            success_count = 0
            for group in groups:
                results = await extract_group(group)
                done_count += 1
                group_label = group["group_label"]
                task_manager.update_stage(task_id, f"完成: {group_label} ({done_count}/{len(groups)})")
                for r in results:
                    node_payload = _json.dumps(
                        {"node_id": r["node_id"], "label": r["label"], "content": r["content"]},
                        ensure_ascii=False
                    )
                    task_manager.update_stage(task_id, f"__node__{node_payload}")
                    success_count += 1
            _push_task_event(task_id, "structure_stage", {"phase": "business_generating", "label": "商务部分生成中"})
            _push_task_event(task_id, "structure_stage", {"phase": "technical_generating", "label": "技术部分生成中"})
            analysis_v2 = _build_analysis_v2(results_by_id, latest_bid_items)
            analysis_report = _inflate_analysis_tree(all_nodes, results_by_id)
            analysis_report = _inject_analysis_report_derived_nodes(analysis_report, analysis_v2)
            _persist_analysis_state(project_id, analysis_report, analysis_v2)
            if bool(analysis_v2.get("enable_response_branch")):
                task_manager.update_stage(task_id, "response_branch_enabled")
            else:
                task_manager.update_stage(task_id, "response_branch_skipped")
            task_manager.update_stage(task_id, f"{_ANALYSIS_V2_STAGE_PREFIX}{_json.dumps(analysis_v2, ensure_ascii=False)}")
            _push_task_event(task_id, "structure_stage", {"phase": "structure_ready", "label": "商务与技术结构已生成"})
            task_manager.set_result(
                task_id,
                {
                    "total_nodes": total_nodes,
                    "success_count": success_count,
                    "done": True,
                    "analysis_report": analysis_report,
                    "analysis_v2": analysis_v2,
                },
            )
            _sync_project_runtime_from_task(task_manager.get_task(task_id))

        except asyncio.CancelledError:
            await _best_effort_stop_dify_by_task_id(task_id)
            logger.info(f"[Task {task_id}] 解析任务被用户取消")
            task_manager.set_cancelled(task_id)
            _sync_project_runtime_from_task(task_manager.get_task(task_id))
        except Exception as e:
            logger.error(f"[Task {task_id}] 解析后台任务失败: {e}", exc_info=True)
            task_manager.set_error(task_id, str(e))
            _sync_project_runtime_from_task(task_manager.get_task(task_id))

    bg = asyncio.create_task(_run())
    task_manager.set_async_task(task_id, bg)
    return {"task_id": task_id}
