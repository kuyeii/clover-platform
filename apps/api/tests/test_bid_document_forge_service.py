from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import patch


API_ROOT = Path(__file__).resolve().parents[1]
API_ROOT_VALUE = str(API_ROOT)
if API_ROOT_VALUE not in sys.path:
    sys.path.insert(0, API_ROOT_VALUE)

from app.services import bid_document_forge_service as service


def test_create_document_forge_loads_forge_at_service_boundary() -> None:
    class FakeForge:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

    with patch.object(service, "DocumentForge", FakeForge):
        forge = service.create_document_forge(
            mapping_table={"a": "b"},
            bidder_info={"companyName": "某公司"},
            image_map={"img": {}},
            project_id="proj-1",
        )

    assert isinstance(forge, FakeForge)
    assert forge.kwargs["mapping_table"] == {"a": "b"}
    assert forge.kwargs["project_id"] == "proj-1"


def test_add_scoring_table_and_attachments_delegates_at_service_boundary() -> None:
    calls: list[str] = []

    with (
        patch.object(service, "_add_scoring_table", lambda *_: calls.append("scoring")),
        patch.object(service, "_add_attachments", lambda *_: calls.append("attachments")),
    ):
        service.add_scoring_table_and_attachments(object(), [{"name": "评分"}], [{"name": "附件"}])

    assert calls == ["scoring", "attachments"]


def test_forge_service_has_no_legacy_src_import_boundary() -> None:
    assert not hasattr(service, "_ensure_forge_runtime")
    assert not hasattr(service, "_extend_src_package_namespace")
