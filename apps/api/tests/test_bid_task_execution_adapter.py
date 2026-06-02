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

from app.services import bid_task_execution_adapter as adapter


def test_call_legacy_task_route_normalizes_dict_payload() -> None:
    async def fake_start(body: dict[str, object]) -> dict[str, object]:
        return {"task_id": "task-1", "project_id": body.get("project_id")}

    module = SimpleNamespace(start_outline_task=fake_start)

    with patch.object(adapter, "_ensure_legacy_imported", return_value=module):
        payload = _run_async(adapter.call_legacy_task_route("start_outline_task", {"project_id": "proj-1"}))

    assert payload == {"task_id": "task-1", "project_id": "proj-1"}


def test_call_legacy_task_route_wraps_non_dict_payload() -> None:
    async def fake_start() -> str:
        return "ok"

    module = SimpleNamespace(start_outline_task=fake_start)

    with patch.object(adapter, "_ensure_legacy_imported", return_value=module):
        payload = _run_async(adapter.call_legacy_task_route("start_outline_task"))

    assert payload == {"data": "ok"}


def test_call_legacy_task_route_maps_http_exception() -> None:
    async def fake_start() -> None:
        raise HTTPException(status_code=403, detail="项目并发受限")

    module = SimpleNamespace(start_outline_task=fake_start)

    with patch.object(adapter, "_ensure_legacy_imported", return_value=module):
        try:
            _run_async(adapter.call_legacy_task_route("start_outline_task"))
        except Exception as exc:
            assert getattr(exc, "status_code", None) == 403
            assert getattr(exc, "code", "") == "PERMISSION_DENIED"
            assert "项目并发受限" in str(exc)
        else:
            raise AssertionError("expected PlatformError")


def _run_async(awaitable):
    import asyncio

    return asyncio.run(awaitable)
