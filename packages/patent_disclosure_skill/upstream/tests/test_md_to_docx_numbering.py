from __future__ import annotations

import sys
import zipfile
from pathlib import Path
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

from md_to_docx import convert_md_to_docx  # noqa: E402


NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}


def test_ordered_lists_restart_after_heading(tmp_path: Path) -> None:
    doc = convert_md_to_docx(
        "\n".join(
            [
                "# 第一节",
                "1. 第一项",
                "2. 第二项",
                "3. 第三项",
                "# 第二节",
                "1. 新第一项",
                "2. 新第二项",
                "3. 新第三项",
            ]
        ),
        base_dir=tmp_path,
    )
    out = tmp_path / "numbering.docx"
    doc.save(out)

    list_items = _list_number_paragraphs(out)
    assert [item["text"] for item in list_items] == ["第一项", "第二项", "第三项", "新第一项", "新第二项", "新第三项"]
    first_num_ids = {item["numId"] for item in list_items[:3]}
    second_num_ids = {item["numId"] for item in list_items[3:]}
    assert len(first_num_ids) == 1
    assert len(second_num_ids) == 1
    assert first_num_ids != second_num_ids
    assert _start_overrides(out)[next(iter(first_num_ids))] == "1"
    assert _start_overrides(out)[next(iter(second_num_ids))] == "1"


def test_blank_lines_inside_ordered_list_keep_same_numbering(tmp_path: Path) -> None:
    doc = convert_md_to_docx(
        "\n".join(
            [
                "1. 第一项",
                "",
                "2. 第二项",
                "",
                "3. 第三项",
            ]
        ),
        base_dir=tmp_path,
    )
    out = tmp_path / "blank-lines.docx"
    doc.save(out)

    list_items = _list_number_paragraphs(out)
    assert [item["text"] for item in list_items] == ["第一项", "第二项", "第三项"]
    assert len({item["numId"] for item in list_items}) == 1


def test_paragraph_break_starts_new_ordered_list(tmp_path: Path) -> None:
    doc = convert_md_to_docx(
        "\n".join(
            [
                "1. 第一项",
                "2. 第二项",
                "普通正文段落。",
                "1. 新列表第一项",
                "2. 新列表第二项",
            ]
        ),
        base_dir=tmp_path,
    )
    out = tmp_path / "paragraph-break.docx"
    doc.save(out)

    list_items = _list_number_paragraphs(out)
    assert [item["text"] for item in list_items] == ["第一项", "第二项", "新列表第一项", "新列表第二项"]
    assert {item["numId"] for item in list_items[:2]} != {item["numId"] for item in list_items[2:]}


def _list_number_paragraphs(docx_path: Path) -> list[dict[str, str]]:
    with zipfile.ZipFile(docx_path) as docx:
        document_xml = docx.read("word/document.xml")
    root = ET.fromstring(document_xml)
    items: list[dict[str, str]] = []
    for paragraph in root.findall(".//w:p", NS):
        text = "".join(t.text or "" for t in paragraph.findall(".//w:t", NS)).strip()
        if not text:
            continue
        style = paragraph.find("./w:pPr/w:pStyle", NS)
        if style is None or style.get(f"{{{NS['w']}}}val") != "ListNumber":
            continue
        num_id = paragraph.find("./w:pPr/w:numPr/w:numId", NS)
        assert num_id is not None
        items.append({"text": text, "numId": num_id.get(f"{{{NS['w']}}}val") or ""})
    return items


def _start_overrides(docx_path: Path) -> dict[str, str]:
    with zipfile.ZipFile(docx_path) as docx:
        numbering_xml = docx.read("word/numbering.xml")
    root = ET.fromstring(numbering_xml)
    starts: dict[str, str] = {}
    for num in root.findall(".//w:num", NS):
        num_id = num.get(f"{{{NS['w']}}}numId")
        start = num.find("./w:lvlOverride/w:startOverride", NS)
        if num_id and start is not None:
            starts[num_id] = start.get(f"{{{NS['w']}}}val") or ""
    return starts
