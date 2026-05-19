"""
后台任务管理器 —— 内存存储，支持轮询/SSE 重连 + 取消
将长时间运行的 Dify 调用从 HTTP 请求生命周期解耦，
前端刷新后可通过 task_id 重连获取进度和结果。
"""
import asyncio
import os
import time
import uuid
import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Optional

logger = logging.getLogger(__name__)


@dataclass
class Task:
    task_id: str
    task_type: str              # "extract" | "outline" | "content" | "diagram" | "analyze"
    project_id: str
    workflow_name: str = ""
    status: str = "running"     # "running" | "done" | "error" | "cancelled" | "timeout"
    stages: list = field(default_factory=list)       # 已完成的阶段标签列表
    current_stage: str = ""     # 当前进行中的阶段
    result: Optional[dict] = None   # 最终结果（仅 done 时非空）
    partial_result: Optional[dict] = None  # 进行中的阶段性结果（running 时可用）
    partial_events: list[dict] = field(default_factory=list)  # 增量阶段事件（供轮询端可靠补拉）
    partial_event_seq: int = 0
    error: Optional[str] = None
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    timeout_seconds: int = 900
    # 首个 Dify streaming 任务 ID（兼容旧逻辑）。
    dify_task_id: Optional[str] = None
    # 同一后台任务下可能会并发触发多个 Dify streaming 子任务（如大纲分批并发）。
    dify_task_ids: list[str] = field(default_factory=list)
    # 用于通知等待者有新进度的事件
    _event: asyncio.Event = field(default_factory=asyncio.Event, repr=False)
    # 后台 asyncio.Task 引用（用于取消）
    _async_task: Optional[asyncio.Task] = field(default=None, repr=False)


class TaskStore(ABC):
    """任务存储抽象，后续可替换为 Redis 等外部后端。"""

    @abstractmethod
    def create(self, task: Task) -> None:
        raise NotImplementedError

    @abstractmethod
    def get(self, task_id: str) -> Optional[Task]:
        raise NotImplementedError

    @abstractmethod
    def items(self) -> list[tuple[str, Task]]:
        raise NotImplementedError

    @abstractmethod
    def delete(self, task_id: str) -> None:
        raise NotImplementedError


class InMemoryTaskStore(TaskStore):
    """进程内任务存储实现。"""

    def __init__(self):
        self._tasks: dict[str, Task] = {}

    def create(self, task: Task) -> None:
        self._tasks[task.task_id] = task

    def get(self, task_id: str) -> Optional[Task]:
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

    def __init__(self):
        self.max_global_running = self._env_int("MAX_GLOBAL_RUNNING_TASKS", 4, minimum=1)
        self.max_project_running = self._env_int("MAX_PROJECT_RUNNING_TASKS", 1, minimum=1)
        # 内容生成支持项目内并行（默认 2）；其余任务仍走 MAX_PROJECT_RUNNING_TASKS。
        self.max_project_content_running = self._env_int("MAX_PROJECT_CONTENT_RUNNING_TASKS", 2, minimum=1)
        self.max_kb_sync_running = self._env_int("MAX_KB_SYNC_TASKS", 1, minimum=1)

    @staticmethod
    def _env_int(name: str, default: int, minimum: int = 0) -> int:
        raw = (os.getenv(name, "") or "").strip()
        if not raw:
            return default
        try:
            value = int(raw)
            return max(minimum, value)
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
    """线程安全的内存任务管理器"""

    def __init__(
        self,
        max_age: int = 7200,
        store: Optional[TaskStore] = None,
        limiter: Optional[ConcurrencyLimiter] = None,
        backend_error: str = "",
    ):
        self._store = store or InMemoryTaskStore()
        self._limiter = limiter or InProcessLimiter()
        self._backend_error = backend_error
        self._max_age = max_age  # 自动清理超过此秒数的任务
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

    def ensure_backend_ready(self):
        """当配置为未支持后端时，提供清晰报错。"""
        if self._backend_error:
            raise RuntimeError(self._backend_error)

    def create_task(self, task_type: str, project_id: str, workflow_name: str = "") -> str:
        """创建新任务，返回 task_id"""
        self.ensure_backend_ready()
        self._cleanup_old()
        task_id = uuid.uuid4().hex[:12]
        self._store.create(Task(
            task_id=task_id,
            task_type=task_type,
            project_id=project_id,
            workflow_name=str(workflow_name or "").strip(),
            timeout_seconds=self._timeout_by_type.get(task_type, 900),
        ))
        logger.info(f"[TaskManager] 创建任务 {task_id} type={task_type} project={project_id}")
        return task_id

    def get_limits(self) -> dict[str, int]:
        return dict(self._limiter.limits())

    async def try_acquire_task_slot(
        self,
        project_id: str,
        task_type: str,
        *,
        enforce_project_limit: bool = True,
        max_project_running: Optional[int] = None,
        max_type_running: Optional[int] = None,
    ) -> tuple[bool, dict[str, Any]]:
        """
        受限并发检查：
        - 全局运行任务上限
        - 可选项目运行任务上限
        - 可选任务类型运行上限（如 knowledge_sync）
        """
        self.ensure_backend_ready()
        pid = (project_id or "").strip()
        if not pid:
            return False, {"reason": "invalid_project", "requested_project_id": pid}
        limits = self.get_limits()
        project_limit = int(max_project_running or 0) if max_project_running else limits["max_project_running"]
        type_limit = max_type_running if max_type_running is not None else 0
        self._expire_timeouts()
        async with self._project_lock:
            running_tasks = [t for _, t in self._store.items() if t.status == "running"]
            running_global = len(running_tasks)
            running_project = sum(1 for t in running_tasks if (t.project_id or "").strip() == pid)
            running_type = sum(1 for t in running_tasks if (t.task_type or "").strip() == (task_type or "").strip())

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

    async def try_acquire_project_slot(self, project_id: str) -> tuple[bool, Optional[str]]:
        """兼容旧逻辑：内部转为项目并发上限判定。"""
        allowed, details = await self.try_acquire_task_slot(
            project_id=project_id,
            task_type="legacy",
            enforce_project_limit=True,
        )
        if allowed:
            return True, None
        return False, details.get("requested_project_id")

    def set_async_task(self, task_id: str, async_task: asyncio.Task):
        """关联后台 asyncio.Task（用于取消）"""
        self._expire_timeouts()
        task = self._store.get(task_id)
        if task:
            task._async_task = async_task

    def set_dify_task_id(self, task_id: str, dify_task_id: str):
        """记录 Dify streaming 任务的 task_id（SSE 事件中携带），用于调用 Stop API。"""
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
            logger.debug(f"[TaskManager] 任务 {task_id} 绑定 dify_task_id={normalized}")

    def get_task(self, task_id: str) -> Optional[Task]:
        self._expire_timeouts()
        return self._store.get(task_id)

    def update_stage(self, task_id: str, stage: str):
        """更新当前阶段，同时追加到历史列表"""
        self._expire_timeouts()
        task = self._store.get(task_id)
        if not task:
            return
        task.current_stage = stage
        task.stages.append(stage)
        task.updated_at = time.time()
        task._event.set()   # 唤醒等待者
        task._event = asyncio.Event()  # 重置

    def set_result(self, task_id: str, result: dict):
        """标记任务完成"""
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
        logger.info(f"[TaskManager] 任务 {task_id} 完成")

    def set_partial_result(self, task_id: str, partial: dict):
        """更新阶段性结果（任务仍保持 running）。"""
        self._expire_timeouts()
        task = self._store.get(task_id)
        if not task or task.status != "running":
            return
        task.partial_result = partial
        task.updated_at = time.time()
        task._event.set()

    def append_partial_event(self, task_id: str, partial: dict, *, max_events: int = 256) -> Optional[dict]:
        """追加可增量消费的阶段事件，并同步刷新最新 partial_result。"""
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

    def set_error(self, task_id: str, error: str):
        """标记任务失败"""
        self._expire_timeouts()
        task = self._store.get(task_id)
        if not task:
            return
        task.status = "error"
        task.error = error
        task.current_stage = ""
        task.updated_at = time.time()
        task._event.set()
        logger.warning(f"[TaskManager] 任务 {task_id} 失败: {error}")

    def set_cancelled(self, task_id: str):
        """标记任务被用户取消（与 error 区分，前端不应重试）"""
        self._expire_timeouts()
        task = self._store.get(task_id)
        if not task:
            return
        task.status = "cancelled"
        task.error = None
        task.current_stage = ""
        task.updated_at = time.time()
        task._event.set()
        logger.info(f"[TaskManager] 任务 {task_id} 被用户取消")

    def cancel_task(self, task_id: str) -> bool:
        """取消任务：中断后台 asyncio.Task 并标记为 cancelled"""
        self._expire_timeouts()
        task = self._store.get(task_id)
        if not task or task.status != "running":
            return False
        # 取消后台协程（会触发 CancelledError，关闭 httpx 连接）
        if task._async_task and not task._async_task.done():
            task._async_task.cancel()
        task.status = "cancelled"
        task.error = None
        task.current_stage = ""
        task.updated_at = time.time()
        task._event.set()
        logger.info(f"[TaskManager] 任务 {task_id} 已被用户取消")
        return True

    def _cleanup_old(self):
        """清理过期任务"""
        self._expire_timeouts()
        now = time.time()
        expired = [
            tid for tid, t in self._store.items()
            if now - t.created_at > self._max_age
        ]
        for tid in expired:
            self._store.delete(tid)
        if expired:
            logger.info(f"[TaskManager] 清理 {len(expired)} 个过期任务")

    def _expire_timeouts(self):
        """将超时运行中的任务标记为 timeout，并尽力取消后台协程。"""
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
        """并发安全地为项目预占一个图表名额。"""
        if not project_id or max_diagrams <= 0:
            return False
        async with self._quota_lock:
            used = self._diagram_reserved.get(project_id, 0)
            if used >= max_diagrams:
                return False
            self._diagram_reserved[project_id] = used + 1
            return True

    async def release_diagram_slot(self, project_id: str):
        """释放预占图表名额（失败或取消时调用）。"""
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
    err = (
        f"未启用任务后端: TASK_BACKEND={backend}。"
        "当前版本仅支持 memory，实现 Redis 后端后再启用该配置。"
    )
    logger.error("[TaskManager] %s", err)
    return TaskManager(backend_error=err)


# 全局单例
task_manager = _build_task_manager()
