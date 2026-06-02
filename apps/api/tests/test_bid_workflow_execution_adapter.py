from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException


API_ROOT = Path(__file__).resolve().parents[1]
API_ROOT_VALUE = str(API_ROOT)
if API_ROOT_VALUE not in sys.path:
    sys.path.insert(0, API_ROOT_VALUE)

from app.services import bid_workflow_execution_adapter as adapter


def test_generate_template_architecture_payload_normalizes_legacy_model_response() -> None:
    captured: dict[str, object] = {}

    class FakeRequest:
        def __init__(self, **kwargs: object) -> None:
            captured.update(kwargs)

    class FakeResponse:
        def model_dump(self) -> dict[str, object]:
            return {"outline": [{"id": "1", "title": "第一章"}]}

    async def fake_generate(request: FakeRequest) -> FakeResponse:
        assert isinstance(request, FakeRequest)
        return FakeResponse()

    schemas = SimpleNamespace(GenerateStructureRequest=FakeRequest)
    routes = SimpleNamespace(generate_template_architecture=fake_generate)

    with patch.object(adapter, "_ensure_legacy_imported", side_effect=[routes, schemas]):
        payload = _run_async(adapter.generate_template_architecture_payload({"project_id": "proj-1", "sections": []}))

    assert payload == {"outline": [{"id": "1", "title": "第一章"}]}
    assert captured["project_id"] == "proj-1"


def test_export_report_response_returns_legacy_binary_response() -> None:
    captured: dict[str, object] = {}

    class FakeRequest:
        def __init__(self, **kwargs: object) -> None:
            captured.update(kwargs)

    async def fake_export(request: FakeRequest) -> object:
        return SimpleNamespace(kind="pdf", payload=request)

    routes = SimpleNamespace(_ExportReportRequest=FakeRequest, export_report_pdf=fake_export)

    with patch.object(adapter, "_ensure_legacy_imported", return_value=routes):
        response = _run_async(adapter.export_report_response({"project_name": "项目一", "nodes": []}))

    assert response.kind == "pdf"
    assert captured["project_name"] == "项目一"


def test_forge_document_response_maps_http_exception() -> None:
    class FakeRequest:
        def __init__(self, **kwargs: object) -> None:
            self.payload = kwargs

    async def fake_forge(_: FakeRequest) -> None:
        raise HTTPException(status_code=404, detail="项目不存在")

    routes = SimpleNamespace(_ForgeDocumentRequest=FakeRequest, forge_document=fake_forge)

    with patch.object(adapter, "_ensure_legacy_imported", return_value=routes):
        try:
            _run_async(adapter.forge_document_response({"project_id": "missing"}))
        except Exception as exc:
            assert getattr(exc, "status_code", None) == 404
            assert getattr(exc, "code", "") == "RESOURCE_NOT_FOUND"
            assert "项目不存在" in str(exc)
        else:
            raise AssertionError("expected PlatformError")


def _run_async(awaitable):
    import asyncio

    return asyncio.run(awaitable)
