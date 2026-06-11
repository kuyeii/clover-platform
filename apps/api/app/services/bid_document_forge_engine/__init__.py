"""统一后端标书 DOCX 组装引擎。"""

from app.services.bid_document_forge_engine.forge import (
    DocumentForge,
    _add_attachments,
    _add_scoring_table,
)

__all__ = ["DocumentForge", "_add_attachments", "_add_scoring_table"]
