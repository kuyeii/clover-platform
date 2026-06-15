# -*- coding: utf-8 -*-
"""math_render 联调脚本（需 matplotlib；仅跑通渲染，不做断言）。"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

_SOFTMAX_BLOCK = r"P(z_i) = \frac{\exp(z_i / T)}{\sum_j \exp(z_j / T)}"
_INLINE_COMPLEX = r"\sum_{j=1}^{n} w_j \cdot \exp(z_j / T)"
# 交底书常见、matplotlib 需归一化的简写
_INLINE_GE_LE = r"a_{cpu,j} \le 0"
_INLINE_PAREN = r"T_r"
_BLOCK_LOGIC = (
    r"t - t_{last} \ge T_r \quad \land \quad |\sigma_{now} - \sigma_{last}| \ge \Delta s"
)
_SCORE_BLOCK = (
    r"Score(\mathbf{d},\mathbf{p}) = w_{cpu}\cdot d_{cpu}\cdot p_{cpu} + w_{mem}\cdot "
    r"\min\left(1,\frac{p_{mem}}{\max(1,d_{mem})}\right) + w_{io}\cdot(1-p_{io\_busy})\cdot d_{io} "
    r"- \lambda\cdot n_{inflight}\n\tag{1}"
)


def test_block_and_inline() -> None:
    try:
        import matplotlib  # noqa: F401
    except ImportError:
        return

    from math_render import render_markdown_math

    md = (
        f"温度参数 $T$ 下，加权 logits 为 ${_INLINE_COMPLEX}$，"
        f"约束 ${_INLINE_GE_LE}$ 与 \\({_INLINE_PAREN}\\)。\n\n"
        f"$$\n{_SOFTMAX_BLOCK}\n$$\n\n"
        f"$$\n{_BLOCK_LOGIC}\n$$\n\n"
        f"$$\n{_SCORE_BLOCK}\n$$\n"
    )
    new_md, ok, failed = render_markdown_math(
        md,
        out_md_path=ROOT / "tests" / "_math_test_out.md",
        assets_rel="_math_test_figures",
    )
    assert ok >= 7
    assert failed == 0
    assert "![公式]" in new_md
    assert "![公式·行内]" in new_md
    assert "<!-- ![公式" not in new_md


def test_fallback_on_bad_latex() -> None:
    try:
        import matplotlib  # noqa: F401
    except ImportError:
        return

    from math_render import render_markdown_math

    new_md, ok, failed = render_markdown_math(
        "$$\\notacommand{x}$$\n",
        out_md_path=ROOT / "tests" / "_math_test_bad.md",
        assets_rel="_math_test_figures",
    )
    assert ok == 0
    assert failed == 1
    assert "\\notacommand{x}" in new_md


def test_big_delimiters_block_renders(tmp_path: Path) -> None:
    try:
        import matplotlib  # noqa: F401
    except ImportError:
        return

    from math_render import render_markdown_math

    md = (
        "\\[\n"
        "\\Theta(E) = \\theta\\Bigl(\\theta\\bigl(\\theta(C_{\\mathrm{default}}, C_{\\mathrm{apps}}), "
        "C_{\\mathrm{workflows}}(E)\\bigr), C_{\\mathrm{local}}\\Bigr)\n"
        "\\]\n"
    )

    new_md, ok, failed = render_markdown_math(
        md,
        out_md_path=tmp_path / "out.md",
        assets_rel="math_figures",
    )

    assert ok == 1
    assert failed == 0
    assert "![公式](math_figures/eq_001.png)" in new_md
    assert "\\Theta(E)" not in new_md
    assert (tmp_path / "math_figures" / "eq_001.png").is_file()


def test_inline_paren_with_internal_parentheses_renders(tmp_path: Path) -> None:
    try:
        import matplotlib  # noqa: F401
    except ImportError:
        return

    from math_render import render_markdown_math

    md = (
        "- \\(C_{\\mathrm{workflows}}(E)\\) 为环境 \\(E\\) 下的工作流配置\n"
        "- \\(\\theta(\\cdot, \\cdot)\\) 为深度合并函数\n"
        "其中 \\(\\mathcal{F}_{\\lambda}(q)\\) 为过滤后的结果集。\n"
    )

    new_md, ok, failed = render_markdown_math(
        md,
        out_md_path=tmp_path / "out.md",
        assets_rel="math_figures",
    )

    assert ok == 4
    assert failed == 0
    assert "![公式·行内](math_figures/inline_001.png)" in new_md
    assert "![公式·行内](math_figures/inline_003.png)" in new_md
    assert "![公式·行内](math_figures/inline_004.png)" in new_md
    assert "\\(C_{\\mathrm{workflows}}(E)\\)" not in new_md


def test_rerender_skips_existing_inline_images_and_uses_free_number(tmp_path: Path) -> None:
    try:
        import matplotlib  # noqa: F401
    except ImportError:
        return

    from math_render import render_markdown_math

    assets = tmp_path / "math_figures"
    assets.mkdir()
    (assets / "inline_036.png").write_bytes(b"old")
    md = (
        "\\(E\\)<!-- ![公式·行内](math_figures/inline_036.png) --> "
        "\\(C_{\\mathrm{workflows}}(E)\\)\n"
    )

    new_md, ok, failed = render_markdown_math(
        md,
        out_md_path=tmp_path / "out.md",
        assets_rel="math_figures",
    )

    assert ok == 1
    assert failed == 0
    assert new_md.count("inline_036.png") == 1
    assert "math_figures/inline_001.png" in new_md
    assert "\\(E\\)" not in new_md
    assert (assets / "inline_036.png").read_bytes() == b"old"
    assert (assets / "inline_001.png").is_file()


def test_hidden_images_mode_keeps_latex_source_for_docx_pipeline(tmp_path: Path) -> None:
    try:
        import matplotlib  # noqa: F401
    except ImportError:
        return

    from math_render import render_markdown_math

    new_md, ok, failed = render_markdown_math(
        "\\(E\\) 与 \\[C_{\\mathrm{eff}} = C_{\\mathrm{base}}\\]\n",
        out_md_path=tmp_path / "out.md",
        assets_rel="math_figures",
        visible_images=False,
    )

    assert ok == 2
    assert failed == 0
    assert "\\(E\\)<!-- ![公式·行内](math_figures/inline_001.png) -->" in new_md
    assert "\\[C_{\\mathrm{eff}} = C_{\\mathrm{base}}\\]" in new_md
    assert "<!-- ![公式](math_figures/eq_001.png) -->" in new_md


def test_texttt_underbrace_block_renders_for_docx_pipeline(tmp_path: Path) -> None:
    try:
        import matplotlib  # noqa: F401
    except ImportError:
        return

    from math_render import render_markdown_math

    md = (
        "\\[\n"
        "\\phi(e) = \\texttt{@@PIPT:}v\\texttt{:e}"
        "\\underbrace{00\\cdots0}_{\\text{6-digit serial}}"
        "\\texttt{:k}\\underbrace{h_1h_2\\cdots h_8}_{\\text{SHA-256 prefix, }"
        "L_{\\text{checksum}}=8}\\texttt{@@}\n"
        "\\tag{4}\n"
        "\\]\n"
    )

    new_md, ok, failed = render_markdown_math(
        md,
        out_md_path=tmp_path / "out.md",
        assets_rel="math_figures",
        visible_images=False,
    )

    assert ok == 1
    assert failed == 0
    assert "<!-- ![公式](math_figures/eq_001.png) -->" in new_md
    assert (tmp_path / "math_figures" / "eq_001.png").is_file()


if __name__ == "__main__":
    test_block_and_inline()
    test_fallback_on_bad_latex()
    print("ok")
