from __future__ import annotations

from typing import Any

from app.services.bid_document_forge_engine import DocumentForge, _add_attachments, _add_scoring_table


def create_document_forge(
    *,
    mapping_table: dict[str, Any],
    bidder_info: dict[str, Any],
    image_map: dict[str, Any],
    project_id: str,
) -> Any:
    """创建标书 DOCX forge 实例；入参为拼装上下文，出参为兼容 DocumentForge 的对象。"""
    return DocumentForge(
        mapping_table=mapping_table,
        bidder_info=bidder_info,
        image_map=image_map,
        project_id=project_id,
    )


def add_scoring_table_and_attachments(doc: Any, scoring_rows: list[dict[str, Any]], attachments: list[dict[str, Any]]) -> None:
    """向 DOCX 文档追加评分表和附件；保持 forge 辅助函数兼容。"""

    if scoring_rows:
        _add_scoring_table(doc, scoring_rows)
    if attachments:
        _add_attachments(doc, attachments)
