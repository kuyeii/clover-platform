from __future__ import annotations

import asyncio
import logging
import os
import time
import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any


logger = logging.getLogger(__name__)


@dataclass
class Task:
    task_id: str
    task_type: str
    project_id: str
    workflow_name: str = ""
    status: str = "running"
    stages: list[str] = field(default_factory=list)
    current_stage: str = ""
    result: dict[str, Any] | None = None
    partial_result: dict[str, Any] | None = None
    partial_events: list[dict[str, Any]] = field(default_factory=list)
    partial_event_seq: int = 0
    error: str | None = None
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    timeout_seconds: int = 900
    dify_task_id: str | None = None
    dify_task_ids: list[str] = field(default_factory=list)
    _event: asyncio.Event = field(default_factory=asyncio.Event, repr=False)
    _async_task: asyncio.Task | None = field(default=None, repr=False)


class TaskStore(ABC):
    """任务存储抽象，后续可替换为 Redis。"""

    @abstractmethod
    def create(self, task: Task) -> None:
        raise NotImplementedError

    @abstractmethod
    def get(self, task_id: str) -> Task | None:
        raise NotImplementedError

    @abstractmethod
    def items(self) -> list[tuple[str, Task]]:
        raise NotImplementedError

    @abstractmethod
    def delete(self, task_id: str) -> None:
        raise NotImplementedError


class InMemoryTaskStore(TaskStore):
    """进程内任务存储实现。"""

    def __init__(self) -> None:
        self._tasks: dict[str, Task] = {}

    def create(self, task: Task) -> None:
        self._tasks[task.task_id] = task

    def get(self, task_id: str) -> Task | None:
        return self._tasks.get(task_id)

    def items(self) -> list[tuple[str, Task]]:
        return list(self._tasks.items())

    def delete(self, task_id: str) -> None:
        self._tasks.pop(task_id, None)


class ConcurrencyLimiter(ABC):
    """并发限制抽象，后续可替换为分布式限流。"""

    @abstractmethod
    def limits(self) -> dict[str, int]:
        raise NotImplementedError


class InProcessLimiter(ConcurrencyLimiter):
    """基于环境变量的进程内并发限流。"""

    def __init__(self) -> None:
        self.max_global_running = self._env_int("MAX_GLOBAL_RUNNING_TASKS", 4, minimum=1)
        self.max_project_running = self._env_int("MAX_PROJECT_RUNNING_TASKS", 1, minimum=1)
        self.max_project_content_running = self._env_int("MAX_PROJECT_CONTENT_RUNNING_TASKS", 2, minimum=1)
        self.max_kb_sync_running = self._env_int("MAX_KB_SYNC_TASKS", 1, minimum=1)

    @staticmethod
    def _env_int(name: str, default: int, minimum: int = 0) -> int:
        raw = (os.getenv(name, "") or "").strip()
        if not raw:
            return default
        try:
            return max(minimum, int(raw))
        except Exception:
            logger.warning("[TaskManager] 无效环境变量 %s=%r，回退默认值 %s", name, raw, default)
            return default

    def limits(self) -> dict[str, int]:
        return {
            "max_global_running": self.max_global_running,
            "max_project_running": self.max_project_running,
            "max_project_content_running": self.max_project_content_running,
            "max_kb_sync_running": self.max_kb_sync_running,
        }


class TaskManager:
    """统一后端进程内任务管理器；保持 legacy 轮询/SSE/取消协议兼容。"""

    def __init__(
        self,
        max_age: int = 7200,
        store: TaskStore | None = None,
        limiter: ConcurrencyLimiter | None = None,
        backend_error: str = "",
    ) -> None:
        self._store = store or InMemoryTaskStore()
        self._limiter = limiter or InProcessLimiter()
        self._backend_error = backend_error
        self._max_age = max_age
        self._timeout_by_type = {
            "extract": 900,
            "analyze": 900,
            "outline": 900,
            "content": 1800,
            "diagram": 900,
            "knowledge_sync": 1800,
        }
        self._diagram_reserved: dict[str, int] = {}
        self._quota_lock = asyncio.Lock()
        self._project_lock = asyncio.Lock()

    def ensure_backend_ready(self) -> None:
        if self._backend_error:
            raise RuntimeError(self._backend_error)

    def create_task(self, task_type: str, project_id: str, workflow_name: str = "") -> str:
        self.ensure_backend_ready()
        self._cleanup_old()
        task_id = uuid.uuid4().hex[:12]
        self._store.create(
            Task(
                task_id=task_id,
                task_type=task_type,
                project_id=project_id,
                workflow_name=str(workflow_name or "").strip(),
                timeout_seconds=self._timeout_by_type.get(task_type, 900),
            )
        )
        logger.info("[TaskManager] 创建任务 %s type=%s project=%s", task_id, task_type, project_id)
        return task_id

    def get_limits(self) -> dict[str, int]:
        return dict(self._limiter.limits())

    async def try_acquire_task_slot(
        self,
        project_id: str,
        task_type: str,
        *,
        enforce_project_limit: bool = True,
        max_project_running: int | None = None,
        max_type_running: int | None = None,
    ) -> tuple[bool, dict[str, Any]]:
        self.ensure_backend_ready()
        pid = (project_id or "").strip()
        if not pid:
            return False, {"reason": "invalid_project", "requested_project_id": pid}
        limits = self.get_limits()
        project_limit = int(max_project_running or 0) if max_project_running else limits["max_project_running"]
        type_limit = max_type_running if max_type_running is not None else 0
        self._expire_timeouts()
        async with self._project_lock:
            running_tasks = [task for _, task in self._store.items() if task.status == "running"]
            running_global = len(running_tasks)
            running_project = sum(1 for task in running_tasks if (task.project_id or "").strip() == pid)
            running_type = sum(1 for task in running_tasks if (task.task_type or "").strip() == (task_type or "").strip())

            if running_global >= limits["max_global_running"]:
                return False, {
                    "reason": "global_limit",
                    "running_global": running_global,
                    "max_global_running": limits["max_global_running"],
                    "requested_project_id": pid,
                    "task_type": task_type,
                }
            if enforce_project_limit and running_project >= project_limit:
                return False, {
                    "reason": "project_limit",
                    "running_project": running_project,
                    "max_project_running": project_limit,
                    "requested_project_id": pid,
                    "task_type": task_type,
                }
            if type_limit > 0 and running_type >= type_limit:
                return False, {
                    "reason": "type_limit",
                    "running_type": running_type,
                    "max_type_running": type_limit,
                    "requested_project_id": pid,
                    "task_type": task_type,
                }
            return True, {
                "reason": "ok",
                "running_global": running_global,
                "running_project": running_project,
                "running_type": running_type,
            }

    async def try_acquire_project_slot(self, project_id: str) -> tuple[bool, str | None]:
        allowed, details = await self.try_acquire_task_slot(
            project_id=project_id,
            task_type="legacy",
            enforce_project_limit=True,
        )
        if allowed:
            return True, None
        return False, details.get("requested_project_id")

    def set_async_task(self, task_id: str, async_task: asyncio.Task) -> None:
        self._expire_timeouts()
        task = self._store.get(task_id)
        if task:
            task._async_task = async_task

    def set_dify_task_id(self, task_id: str, dify_task_id: str) -> None:
        self._expire_timeouts()
        task = self._store.get(task_id)
        if not task:
            return
        normalized = str(dify_task_id or "").strip()
        if not normalized:
            return
        if not task.dify_task_id:
            task.dify_task_id = normalized
        if normalized not in task.dify_task_ids:
            task.dify_task_ids.append(normalized)
            logger.debug("[TaskManager] 任务 %s 绑定 dify_task_id=%s", task_id, normalized)

    def get_task(self, task_id: str) -> Task | None:
        self._expire_timeouts()
        return self._store.get(task_id)

    def update_stage(self, task_id: str, stage: str) -> None:
        self._expire_timeouts()
        task = self._store.get(task_id)
        if not task:
            return
        task.current_stage = stage
        task.stages.append(stage)
        task.updated_at = time.time()
        task._event.set()
        task._event = asyncio.Event()

    def set_result(self, task_id: str, result: dict[str, Any]) -> None:
        self._expire_timeouts()
        task = self._store.get(task_id)
        if not task:
            return
        task.status = "done"
        task.result = result
        task.partial_result = None
        task.current_stage = ""
        task.updated_at = time.time()
        task._event.set()
        logger.info("[TaskManager] 任务 %s 完成", task_id)

    def set_partial_result(self, task_id: str, partial: dict[str, Any]) -> None:
        self._expire_timeouts()
        task = self._store.get(task_id)
        if not task or task.status != "running":
            return
        task.partial_result = partial
        task.updated_at = time.time()
        task._event.set()

    def append_partial_event(self, task_id: str, partial: dict[str, Any], *, max_events: int = 256) -> dict[str, Any] | None:
        self._expire_timeouts()
        task = self._store.get(task_id)
        if not task or task.status != "running":
            return None
        task.partial_event_seq += 1
        event = {
            **(partial or {}),
            "event_id": task.partial_event_seq,
        }
        task.partial_result = event
        task.partial_events.append(event)
        if max_events > 0 and len(task.partial_events) > max_events:
            task.partial_events = task.partial_events[-max_events:]
        task.updated_at = time.time()
        task._event.set()
        return event

    def set_error(self, task_id: str, error: str) -> None:
        self._expire_timeouts()
        task = self._store.get(task_id)
        if not task:
            return
        task.status = "error"
        task.error = error
        task.current_stage = ""
        task.updated_at = time.time()
        task._event.set()
        logger.warning("[TaskManager] 任务 %s 失败: %s", task_id, error)

    def set_cancelled(self, task_id: str) -> None:
        self._expire_timeouts()
        task = self._store.get(task_id)
        if not task:
            return
        task.status = "cancelled"
        task.error = None
        task.current_stage = ""
        task.updated_at = time.time()
        task._event.set()
        logger.info("[TaskManager] 任务 %s 被用户取消", task_id)

    def cancel_task(self, task_id: str) -> bool:
        self._expire_timeouts()
        task = self._store.get(task_id)
        if not task or task.status != "running":
            return False
        if task._async_task and not task._async_task.done():
            task._async_task.cancel()
        task.status = "cancelled"
        task.error = None
        task.current_stage = ""
        task.updated_at = time.time()
        task._event.set()
        logger.info("[TaskManager] 任务 %s 已被用户取消", task_id)
        return True

    def _cleanup_old(self) -> None:
        self._expire_timeouts()
        now = time.time()
        expired = [task_id for task_id, task in self._store.items() if now - task.created_at > self._max_age]
        for task_id in expired:
            self._store.delete(task_id)
        if expired:
            logger.info("[TaskManager] 清理 %s 个过期任务", len(expired))

    def _expire_timeouts(self) -> None:
        now = time.time()
        for _, task in self._store.items():
            if task.status != "running":
                continue
            timeout_seconds = max(60, int(task.timeout_seconds or 900))
            if now - task.created_at <= timeout_seconds:
                continue
            if task._async_task and not task._async_task.done():
                task._async_task.cancel()
            task.status = "timeout"
            task.error = f"任务执行超过 {timeout_seconds} 秒，已自动标记为超时"
            task.current_stage = ""
            task.updated_at = now
            task._event.set()
            logger.warning(
                "[TaskManager] 任务 %s 超时: type=%s project=%s timeout=%ss",
                task.task_id,
                task.task_type,
                task.project_id,
                timeout_seconds,
            )

    async def reserve_diagram_slot(self, project_id: str, max_diagrams: int) -> bool:
        if not project_id or max_diagrams <= 0:
            return False
        async with self._quota_lock:
            used = self._diagram_reserved.get(project_id, 0)
            if used >= max_diagrams:
                return False
            self._diagram_reserved[project_id] = used + 1
            return True

    async def release_diagram_slot(self, project_id: str) -> None:
        if not project_id:
            return
        async with self._quota_lock:
            used = self._diagram_reserved.get(project_id, 0)
            if used <= 1:
                self._diagram_reserved.pop(project_id, None)
            else:
                self._diagram_reserved[project_id] = used - 1


def _build_task_manager() -> TaskManager:
    backend = (os.getenv("TASK_BACKEND", "memory") or "memory").strip().lower()
    if backend == "memory":
        return TaskManager()
    error = (
        f"未启用任务后端: TASK_BACKEND={backend}。"
        "当前版本仅支持 memory，实现 Redis 后端后再启用该配置。"
    )
    logger.error("[TaskManager] %s", error)
    return TaskManager(backend_error=error)


task_manager = _build_task_manager()
