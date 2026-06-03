from __future__ import annotations

import asyncio
import sys
from pathlib import Path


API_ROOT = Path(__file__).resolve().parents[1]
API_ROOT_VALUE = str(API_ROOT)
if API_ROOT_VALUE not in sys.path:
    sys.path.insert(0, API_ROOT_VALUE)

from app.services.bid_task_runtime_service import InMemoryTaskStore, InProcessLimiter, TaskManager


def test_task_manager_tracks_stage_partial_event_and_result() -> None:
    manager = TaskManager(store=InMemoryTaskStore(), limiter=InProcessLimiter())
    task_id = manager.create_task("content", "proj-1", workflow_name="content_writer")

    manager.update_stage(task_id, "生成中")
    event = manager.append_partial_event(task_id, {"phase": "chunk", "content": "片段"})
    manager.set_partial_result(task_id, {"phase": "text_ready"})
    manager.set_result(task_id, {"done": True})

    task = manager.get_task(task_id)
    assert task is not None
    assert task.workflow_name == "content_writer"
    assert task.stages == ["生成中"]
    assert event == {"phase": "chunk", "content": "片段", "event_id": 1}
    assert task.status == "done"
    assert task.result == {"done": True}
    assert task.partial_result is None


def test_task_manager_enforces_project_limit() -> None:
    manager = TaskManager(store=InMemoryTaskStore(), limiter=InProcessLimiter())
    manager.create_task("content", "proj-1")

    allowed, details = asyncio.run(
        manager.try_acquire_task_slot(
            "proj-1",
            "content",
            enforce_project_limit=True,
            max_project_running=1,
        )
    )

    assert allowed is False
    assert details["reason"] == "project_limit"


def test_task_manager_cancel_task_cancels_async_task() -> None:
    async def run_case() -> None:
        manager = TaskManager(store=InMemoryTaskStore(), limiter=InProcessLimiter())
        task_id = manager.create_task("outline", "proj-1")
        async_task = asyncio.create_task(asyncio.sleep(30))
        manager.set_async_task(task_id, async_task)

        try:
            assert manager.cancel_task(task_id) is True
            task = manager.get_task(task_id)
            assert task is not None
            assert task.status == "cancelled"
            assert async_task.cancelled() or async_task.done() or async_task.cancelling() > 0
        finally:
            if not async_task.done():
                async_task.cancel()

    asyncio.run(run_case())
