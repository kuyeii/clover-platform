from __future__ import annotations

import base64
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

from md_to_docx import convert_md_to_docx  # noqa: E402


_ONE_PIXEL_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="
)


def test_inline_paren_math_image_with_internal_parentheses_embeds_without_latex_source(tmp_path: Path) -> None:
    assets = tmp_path / "math_figures"
    assets.mkdir()
    (assets / "inline_001.png").write_bytes(_ONE_PIXEL_PNG)

    doc = convert_md_to_docx(
        "\\(C_{\\mathrm{workflows}}(E)\\)<!-- ![公式·行内](math_figures/inline_001.png) --> 为环境配置。",
        base_dir=tmp_path,
    )
    out = tmp_path / "math-inline.docx"
    doc.save(out)

    with zipfile.ZipFile(out) as docx:
        media = [name for name in docx.namelist() if name.startswith("word/media/")]
        document_xml = docx.read("word/document.xml").decode("utf-8", errors="replace")

    assert media
    assert "C_{\\mathrm{workflows}}" not in document_xml
    assert "为环境配置" in document_xml


def test_single_line_bracket_block_math_embeds_without_latex_source(tmp_path: Path) -> None:
    assets = tmp_path / "math_figures"
    assets.mkdir()
    (assets / "eq_001.png").write_bytes(_ONE_PIXEL_PNG)

    doc = convert_md_to_docx(
        "\\[C_{\\mathrm{eff}} = C_{\\mathrm{base}} \\tag{1}\\]\n"
        "<!-- ![公式](math_figures/eq_001.png) -->\n",
        base_dir=tmp_path,
    )
    out = tmp_path / "math-block.docx"
    doc.save(out)

    with zipfile.ZipFile(out) as docx:
        media = [name for name in docx.namelist() if name.startswith("word/media/")]
        document_xml = docx.read("word/document.xml").decode("utf-8", errors="replace")

    assert media
    assert "\\[" not in document_xml
    assert "C_{\\mathrm{eff}}" not in document_xml


def test_table_with_math_images_stays_table_and_embeds_all_formulas(tmp_path: Path) -> None:
    assets = tmp_path / "math_figures"
    assets.mkdir()
    for idx in range(1, 4):
        (assets / f"inline_{idx:03d}.png").write_bytes(_ONE_PIXEL_PNG + bytes([idx]))

    doc = convert_md_to_docx(
        "| 符号 | 含义 | 取值 |\n"
        "|:---|:---|:---|\n"
        "| \\(i\\)<!-- ![公式·行内](math_figures/inline_001.png) --> | 索引 | "
        "\\(i=1\\)<!-- ![公式·行内](math_figures/inline_002.png) --> |\n"
        "| \\(M\\)<!-- ![公式·行内](math_figures/inline_003.png) --> | 总数 | - |\n",
        base_dir=tmp_path,
    )
    out = tmp_path / "math-table.docx"
    doc.save(out)

    with zipfile.ZipFile(out) as docx:
        media = [name for name in docx.namelist() if name.startswith("word/media/")]
        document_xml = docx.read("word/document.xml").decode("utf-8", errors="replace")

    assert len(media) == 3
    assert "<w:tbl>" in document_xml
    assert "\\(" not in document_xml
