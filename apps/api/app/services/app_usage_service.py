from __future__ import annotations

import asyncio
from contextlib import suppress
from typing import Any

from fastapi import WebSocket

from app.core.errors import PlatformError
from app.services import portal_store as store


def usage_summary(user: dict[str, Any]) -> dict[str, Any]:
    with store.connect() as conn:
        return {"summaries": store.build_usage_summary(conn, user["id"])}


async def enter_app(
    *,
    app_code: str,
    user: dict[str, Any],
    client_id: str,
    confirmed_conflict: bool,
) -> dict[str, Any]:
    _ensure_app_access(app_code, user)
    with store.connect() as conn:
        store.upsert_app_usage_session(conn, user, app_code, client_id, confirmed_conflict)
        store.audit(
            conn,
            user,
            "app.enter",
            {"appId": app_code, "clientId": client_id, "confirmedConflict": confirmed_conflict},
        )
        summaries = store.build_usage_summary(conn, user["id"])
    await app_usage_ws_manager.broadcast_usage()
    return {"summaries": summaries}


def heartbeat_app(*, app_code: str, user: dict[str, Any], client_id: str) -> dict[str, Any]:
    _ensure_app_access(app_code, user)
    with store.connect() as conn:
        store.upsert_app_usage_session(conn, user, app_code, client_id, False)
        return {"summaries": store.build_usage_summary(conn, user["id"])}


async def leave_app(*, app_code: str, user: dict[str, Any], client_id: str) -> dict[str, Any]:
    with store.connect() as conn:
        store.leave_app(conn, user, app_code, client_id)
        store.audit(conn, user, "app.leave", {"appId": app_code, "clientId": client_id})
        summaries = store.build_usage_summary(conn, user["id"])
    await app_usage_ws_manager.broadcast_usage()
    return {"summaries": summaries}


async def leave_all_apps(*, user: dict[str, Any], client_id: str) -> dict[str, Any]:
    with store.connect() as conn:
        store.leave_all_for_user_client(conn, user, client_id)
        store.audit(conn, user, "app.leave_all", {"clientId": client_id})
        summaries = store.build_usage_summary(conn, user["id"])
    await app_usage_ws_manager.broadcast_usage()
    return {"summaries": summaries}


async def leave_all_apps_beacon(*, token: str, client_id: str) -> dict[str, bool]:
    from app.services.auth_service import get_user_by_raw_token

    user = get_user_by_raw_token(token)
    if not user:
        return {"ok": False}

    with store.connect() as conn:
        store.leave_all_for_user_client(conn, user, client_id)
        store.audit(conn, user, "app.leave_all_beacon", {"clientId": client_id})
    await app_usage_ws_manager.broadcast_usage()
    return {"ok": True}


def _ensure_app_access(app_code: str, user: dict[str, Any]) -> None:
    if app_code not in store.app_ids():
        raise PlatformError(code="APP_NOT_FOUND", message="应用不存在。", status_code=404)
    if not store.can_access_app(user, app_code):
        raise PlatformError(code="APP_FORBIDDEN", message="当前用户没有访问该应用的权限。", status_code=403)


class AppUsageWebSocketManager:
    def __init__(self) -> None:
        self._connections: dict[WebSocket, dict[str, Any]] = {}
        self._pending_usage_cleanups: dict[tuple[str, str], asyncio.Task[None]] = {}
        self._lock = asyncio.Lock()

    def _connection_key(self, user: dict[str, Any], client_id: str) -> tuple[str, str]:
        return (str(user["id"]), str(client_id))

    async def register(self, websocket: WebSocket, user: dict[str, Any], client_id: str) -> None:
        key = self._connection_key(user, client_id)
        async with self._lock:
            pending_cleanup = self._pending_usage_cleanups.pop(key, None)
            if pending_cleanup:
                pending_cleanup.cancel()
            self._connections[websocket] = {"user": user, "clientId": client_id, "key": key}

    async def unregister(self, websocket: WebSocket, release_usage: bool = True) -> None:
        async with self._lock:
            meta = self._connections.pop(websocket, None)

        if release_usage and meta:
            await self.schedule_usage_cleanup(meta)

    async def schedule_usage_cleanup(self, meta: dict[str, Any]) -> None:
        user = meta.get("user") or {}
        client_id = str(meta.get("clientId") or "unknown-client")[:160]
        user_id = str(user.get("id") or "")
        if not user_id:
            return

        key = (user_id, client_id)
        async with self._lock:
            if any(connection_meta.get("key") == key for connection_meta in self._connections.values()):
                return
            previous_task = self._pending_usage_cleanups.pop(key, None)
            if previous_task:
                previous_task.cancel()
            self._pending_usage_cleanups[key] = asyncio.create_task(
                self._cleanup_usage_after_disconnect(user, client_id, key)
            )

    async def _cleanup_usage_after_disconnect(
        self,
        user: dict[str, Any],
        client_id: str,
        key: tuple[str, str],
    ) -> None:
        try:
            await asyncio.sleep(5)
            async with self._lock:
                if any(meta.get("key") == key for meta in self._connections.values()):
                    self._pending_usage_cleanups.pop(key, None)
                    return
                self._pending_usage_cleanups.pop(key, None)

            with store.connect() as conn:
                usage_count = store.count_usage_sessions_for_user_client(conn, user, client_id)
                if usage_count:
                    store.leave_all_for_user_client(conn, user, client_id)
                    store.audit(conn, user, "app.websocket_disconnect_cleanup", {"clientId": client_id})

            if usage_count:
                await self.broadcast_usage("app_usage_changed")
        except asyncio.CancelledError:
            raise
        except Exception:
            return

    async def _snapshot_for_user(self, user_id: str) -> list[dict[str, Any]]:
        with store.connect() as conn:
            return store.build_usage_summary(conn, user_id)

    async def send_snapshot(
        self,
        websocket: WebSocket,
        user: dict[str, Any],
        message_type: str = "snapshot",
    ) -> bool:
        try:
            await websocket.send_json(
                {
                    "type": message_type,
                    "summaries": await self._snapshot_for_user(user["id"]),
                }
            )
            return True
        except Exception:
            await self.unregister(websocket)
            return False

    async def broadcast_usage(self, message_type: str = "app_usage_changed") -> None:
        async with self._lock:
            connections = list(self._connections.items())

        stale_connections: list[WebSocket] = []
        for websocket, meta in connections:
            user = meta.get("user") or {}
            ok = await self.send_snapshot(websocket, user, message_type)
            if not ok:
                stale_connections.append(websocket)

        if stale_connections:
            async with self._lock:
                for websocket in stale_connections:
                    self._connections.pop(websocket, None)


app_usage_ws_manager = AppUsageWebSocketManager()


async def cleanup_expired_usage_loop() -> None:
    while True:
        await asyncio.sleep(30)
        try:
            with store.connect() as conn:
                before_count = store.count_usage_sessions(conn)
                store.build_usage_summary(conn, "system")
                after_count = store.count_usage_sessions(conn)
            if after_count != before_count:
                await app_usage_ws_manager.broadcast_usage()
        except asyncio.CancelledError:
            raise
        except Exception:
            continue


async def shutdown_usage_cleanup_task(task: asyncio.Task[Any] | None) -> None:
    if task:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task
