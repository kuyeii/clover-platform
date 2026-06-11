# -*- coding: utf-8 -*-
"""
SVG 导出前预处理：注册中文字体（ReportLab）、替换 font-family、收紧 viewBox 减少白边。
字体路径：环境变量 PROENGINE_SVG_FONT_TTF，或 gateway-out/fonts/NotoSansSC-Regular.ttf，
或常见 Linux Noto 路径（若存在）。
"""

from __future__ import annotations

import logging
import os
import re
from pathlib import Path
from typing import Optional, Tuple

logger = logging.getLogger(__name__)

_REGISTERED_NAME = "ProEngineCJK"
_FONT_REGISTERED = False


def _candidate_font_paths() -> list[Path]:
    raw = os.environ.get("PROENGINE_SVG_FONT_TTF", "").strip()
    here = Path(__file__).resolve()
    gw_root = here.parent.parent
    candidates: list[Path] = []
    if raw:
        candidates.append(Path(raw))
    # 优先项目内 SimSun（如已手动放置），其次 Noto
    candidates.append(gw_root / "fonts" / "SimSun.ttf")
    candidates.append(gw_root / "fonts" / "NotoSansSC-Regular.ttf")
    candidates.append(gw_root / "fonts" / "NotoSansSC-VF.ttf")
    # 常见 Linux 发行版
    for p in (
        "/mnt/c/Windows/Fonts/simsun.ttc",
        "/mnt/c/Windows/Fonts/simsun.ttf",
        "/mnt/c/Windows/Fonts/simfang.ttf",
        "/mnt/c/Windows/Fonts/msyh.ttc",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/truetype/noto/NotoSansSC-Regular.ttf",
    ):
        candidates.append(Path(p))
    return candidates


def ensure_cjk_font_registered() -> Optional[str]:
    """注册 ReportLab 字体，返回注册后的 family 名；失败返回 None。"""
    global _FONT_REGISTERED
    if _FONT_REGISTERED:
        return _REGISTERED_NAME

    try:
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.ttfonts import TTFont
    except ImportError:
        logger.warning("reportlab 未安装，无法注册中文字体")
        return None

    for path in _candidate_font_paths():
        if not path.is_file():
            continue
        try:
            # ttf/otf 直接注册；ttc 尝试多个 subfont 索引
            suffix = path.suffix.lower()
            if suffix == ".ttc":
                for idx in (0, 1, 2, 3, 4):
                    try:
                        font_name = f"{_REGISTERED_NAME}_{idx}"
                        pdfmetrics.registerFont(TTFont(font_name, str(path), subfontIndex=idx))
                        _FONT_REGISTERED = True
                        logger.info("SVG 导出：已注册中文字体 %s (subfontIndex=%s)", path, idx)
                        return font_name
                    except Exception:
                        continue
            else:
                pdfmetrics.registerFont(TTFont(_REGISTERED_NAME, str(path)))
                _FONT_REGISTERED = True
                logger.info("SVG 导出：已注册中文字体 %s", path)
                return _REGISTERED_NAME
        except Exception as e:
            logger.debug("字体加载跳过 %s: %s", path, e)
            continue

    logger.warning(
        "SVG 导出：未找到可用中文字体。可优先使用 SimSun（simsun.ttf/ttc），"
        "或将字体放入 gateway-out/fonts/，或设置环境变量 PROENGINE_SVG_FONT_TTF"
    )
    return None


def replace_svg_font_families(svg: str, family: str) -> str:
    """将 SVG 内 font-family 统一为已注册的 ReportLab 字体名。"""
    if not svg or not family:
        return svg

    def _sub(m: re.Match) -> str:
        return f'font-family="{family}"'

    out = re.sub(
        r'font-family\s*=\s*["\'][^"\']*["\']',
        _sub,
        svg,
        flags=re.IGNORECASE,
    )
    # 兜底：插入统一 text 字体规则，覆盖样式块中的字体声明
    style_snippet = (
        f"<style>"
        f"text,tspan{{font-family:'{family}' !important;"
        f"paint-order:stroke;stroke:#ffffff;stroke-width:0.8;stroke-linejoin:round;}}"
        f"</style>"
    )
    if "<defs>" in out:
        out = out.replace("<defs>", f"<defs>{style_snippet}", 1)
    elif "<svg" in out:
        out = re.sub(r"(<svg[^>]*>)", r"\1" + style_snippet, out, count=1, flags=re.IGNORECASE)
    return out


def enforce_min_text_size(svg: str, min_px: float = 16.0) -> str:
    """强制提升过小文字字号，改善导出到 Word 后可读性。"""
    if not svg:
        return svg

    def _raise_font(m: re.Match) -> str:
        raw = m.group(1)
        try:
            num = float(raw)
        except Exception:
            return m.group(0)
        if num >= min_px:
            return m.group(0)
        return f'font-size="{min_px:g}"'

    out = re.sub(
        r'font-size\s*=\s*["\']\s*([0-9]+(?:\.[0-9]+)?)\s*(?:px)?\s*["\']',
        _raise_font,
        svg,
        flags=re.IGNORECASE,
    )
    # 样式块里的 font-size:xxpx 也一并抬升
    def _raise_css(m: re.Match) -> str:
        try:
            num = float(m.group(1))
        except Exception:
            return m.group(0)
        if num >= min_px:
            return m.group(0)
        return f"font-size:{min_px:g}px"
    out = re.sub(r'font-size\s*:\s*([0-9]+(?:\.[0-9]+)?)px', _raise_css, out, flags=re.IGNORECASE)
    return out


def _parse_float(s: Optional[str]) -> Optional[float]:
    if s is None:
        return None
    try:
        return float(s.strip())
    except ValueError:
        return None


def tighten_svg_viewbox(svg: str, margin: float = 36.0) -> str:
    """
    根据带 x/y/width/height/cx/cy/r 的元素估算包围盒，重写 viewBox（缓解固定大画布留白）。
    对纯文本节点用粗略宽度估算。
    """
    if not svg or "viewBox" not in svg and "width" not in svg.lower():
        return svg

    try:
        import xml.etree.ElementTree as ET
    except ImportError:
        return svg

    def _local(tag: str) -> str:
        return tag.rsplit("}", 1)[-1] if "}" in tag else tag

    try:
        root = ET.fromstring(svg)
    except ET.ParseError:
        return svg

    min_x = min_y = float("inf")
    max_x = max_y = float("-inf")

    def _expand(x0: float, y0: float, x1: float, y1: float) -> None:
        nonlocal min_x, min_y, max_x, max_y
        min_x = min(min_x, x0, x1)
        min_y = min(min_y, y0, y1)
        max_x = max(max_x, x0, x1)
        max_y = max(max_y, y0, y1)

    stack = [root]
    while stack:
        el = stack.pop()
        stack.extend(list(el))
        tag = _local(el.tag)
        a = el.attrib
        if tag == "rect":
            x, y = _parse_float(a.get("x", "0")) or 0.0, _parse_float(a.get("y", "0")) or 0.0
            w, h = _parse_float(a.get("width")), _parse_float(a.get("height"))
            if w and h:
                _expand(x, y, x + w, y + h)
        elif tag == "circle":
            cx, cy = _parse_float(a.get("cx")), _parse_float(a.get("cy"))
            r = _parse_float(a.get("r"))
            if cx is not None and cy is not None and r:
                _expand(cx - r, cy - r, cx + r, cy + r)
        elif tag == "text":
            x = _parse_float(a.get("x", "0")) or 0.0
            y = _parse_float(a.get("y", "0")) or 0.0
            fs = _parse_float(a.get("font-size")) or 13.0
            text_len = len((el.text or "").strip()) + sum(len((t.tail or "").strip()) for t in el)
            est_w = max(fs * text_len * 0.65, fs * 2)
            est_h = fs * 1.4
            _expand(x, y - est_h, x + est_w, y + 4)
        elif tag in ("line",):
            x1, y1 = _parse_float(a.get("x1")), _parse_float(a.get("y1"))
            x2, y2 = _parse_float(a.get("x2")), _parse_float(a.get("y2"))
            if None not in (x1, y1, x2, y2):
                _expand(x1, y1, x2, y2)

    if min_x == float("inf") or max_x <= min_x:
        return svg

    pad = margin
    nx0 = max(0.0, min_x - pad)
    ny0 = max(0.0, min_y - pad)
    nx1 = max_x + pad
    ny1 = max_y + pad
    nw = nx1 - nx0
    nh = ny1 - ny0
    if nw < 50 or nh < 50:
        return svg

    new_vb = f"{nx0:.1f} {ny0:.1f} {nw:.1f} {nh:.1f}"

    out = re.sub(
        r'viewBox\s*=\s*["\'][^"\']+["\']',
        f'viewBox="{new_vb}"',
        svg,
        count=1,
        flags=re.IGNORECASE,
    )
    out = re.sub(
        r'width\s*=\s*["\'][^"\']+["\']',
        f'width="{nw:.1f}"',
        out,
        count=1,
        flags=re.IGNORECASE,
    )
    out = re.sub(
        r'height\s*=\s*["\'][^"\']+["\']',
        f'height="{nh:.1f}"',
        out,
        count=1,
        flags=re.IGNORECASE,
    )
    return out


def preprocess_svg_for_png(svg_text: str) -> str:
    """字体替换 + viewBox 收紧。"""
    s = svg_text.strip()
    if not s:
        return s
    fam = ensure_cjk_font_registered()
    if fam:
        s = replace_svg_font_families(s, fam)
    s = enforce_min_text_size(s, min_px=16.0)
    s = tighten_svg_viewbox(s)
    return s
