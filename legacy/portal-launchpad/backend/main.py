from __future__ import annotations

import asyncio
import json
import logging
from contextlib import suppress
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from .config import (
    API_PORT,
    APP_IDS,
    CORS_ORIGINS,
    DIST_DIR,
    FEATURE_REQUEST_EMAIL_TO,
    ROLE_VALUES,
    SMTP_FROM,
    SMTP_HOST,
    TICKET_EMAIL_TO,
)
from .database import (
    account_exists,
    audit,
    build_usage_summary,
    can_access_app,
    connect,
    count_usage_sessions,
    count_usage_sessions_for_user_client,
    create_auth_session,
    create_user,
    delete_auth_session,
    get_user_by_account,
    get_user_by_id,
    get_user_by_session_token,
    init_database,
    leave_all_for_user_client,
    leave_app,
    list_users,
    normalize_permissions,
    update_user,
    upsert_app_usage_session,
    would_remove_last_enabled_admin,
)
from .deps import (
    api_error,
    get_client_id,
    get_current_user,
    get_current_user_with_token,
    require_admin,
)
from .routers.feedback import router as feedback_router
from .runtime_apps import get_runtime_apps_payload
from .schemas import ChangePasswordInput, EnterAppInput, LoginInput, UserCreateInput, UserUpdateInput
from .security import create_token, normalize_account, sanitize_user, sanitize_users, verify_password

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)

app = FastAPI(title="Portal Launchpad API", version="0.3.0")

if CORS_ORIGINS:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=CORS_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

app.include_router(feedback_router)


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
            # Give the browser a short reconnect window. This avoids releasing a module
            # during Vite proxy hiccups, page reloads, or temporary network switches.
            await asyncio.sleep(5)
            async with self._lock:
                if any(meta.get("key") == key for meta in self._connections.values()):
                    self._pending_usage_cleanups.pop(key, None)
                    return
                self._pending_usage_cleanups.pop(key, None)

            with connect() as conn:
                usage_count = count_usage_sessions_for_user_client(conn, user, client_id)
                if usage_count:
                    leave_all_for_user_client(conn, user, client_id)
                    audit(conn, user, "app.websocket_disconnect_cleanup", {"clientId": client_id})

            if usage_count:
                await self.broadcast_usage("app_usage_changed")
        except asyncio.CancelledError:
            raise
        except Exception:
            # Disconnect cleanup is best effort. The regular TTL cleanup loop still
            # removes stale rows if an unexpected error happens here.
            return

    async def _snapshot_for_user(self, user_id: str) -> list[dict[str, Any]]:
        with connect() as conn:
            return build_usage_summary(conn, user_id)

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
    """Periodically clear expired module-usage sessions and push changes to clients."""
    while True:
        await asyncio.sleep(30)
        try:
            with connect() as conn:
                before_count = count_usage_sessions(conn)
                build_usage_summary(conn, "system")
                after_count = count_usage_sessions(conn)
            if after_count != before_count:
                await app_usage_ws_manager.broadcast_usage()
        except asyncio.CancelledError:
            raise
        except Exception:
            # Cleanup is a best-effort background task. API requests will still purge expired rows.
            continue


@app.exception_handler(HTTPException)
async def http_exception_handler(_: Request, exc: HTTPException) -> JSONResponse:
    if isinstance(exc.detail, dict) and "message" in exc.detail:
        payload = exc.detail
    else:
        payload = {"code": "ERROR", "message": str(exc.detail)}
    return JSONResponse(status_code=exc.status_code, content={"error": payload})


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    return JSONResponse(
        status_code=422,
        content={
            "error": {
                "code": "VALIDATION_ERROR",
                "message": "请求参数不合法。",
                "details": exc.errors(),
            }
        },
    )


@app.on_event("startup")
async def on_startup() -> None:
    init_database()
    logging.getLogger("portal.bootstrap").info("Portal backend is using PostgreSQL; SQLite is disabled.")
    app.state.usage_cleanup_task = asyncio.create_task(cleanup_expired_usage_loop())
    bootstrap_log = logging.getLogger("portal.bootstrap")
    if not SMTP_HOST or not SMTP_FROM:
        bootstrap_log.warning(
            "SMTP 尚未配全：请设置 PORTAL_SMTP_HOST、PORTAL_SMTP_FROM（通常还需 PORTAL_SMTP_USERNAME / PORTAL_SMTP_PASSWORD）。"
            " 当前默认收件：工单=%s，愿望单=%s。",
            TICKET_EMAIL_TO,
            FEATURE_REQUEST_EMAIL_TO,
        )
    else:
        bootstrap_log.info(
            "反馈邮件发件已配置 SMTP。工单收件=%s，愿望单收件=%s。",
            TICKET_EMAIL_TO,
            FEATURE_REQUEST_EMAIL_TO,
        )


@app.on_event("shutdown")
async def on_shutdown() -> None:
    cleanup_task = getattr(app.state, "usage_cleanup_task", None)
    if cleanup_task:
        cleanup_task.cancel()
        with suppress(asyncio.CancelledError):
            await cleanup_task


def get_user_by_raw_token(token: str) -> dict[str, Any] | None:
    if not token:
        return None
    with connect() as conn:
        user = get_user_by_session_token(conn, token)
    return sanitize_user(user) if user else None


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {"ok": True, "database": "postgresql", "apiPort": API_PORT}


@app.get("/api/runtime/apps")
def runtime_apps() -> dict[str, Any]:
    return get_runtime_apps_payload()


@app.post("/api/auth/login")
def login(payload: LoginInput, client_id: str = Depends(get_client_id)) -> dict[str, Any]:
    account = normalize_account(payload.account)
    password = payload.password

    if not account or not password:
        raise api_error(400, "INVALID_LOGIN_INPUT", "请输入账号和密码。")

    with connect() as conn:
        user = get_user_by_account(conn, account)
        if not user or not user.get("enabled") or not verify_password(password, user):
            raise api_error(401, "INVALID_CREDENTIALS", "账号或密码不正确，或该账号已停用。")
        token = create_token()
        create_auth_session(conn, user, client_id, token)
        refreshed_user = get_user_by_id(conn, user["id"]) or user
        return {"token": token, "user": sanitize_user(refreshed_user)}


@app.get("/api/auth/me")
def me(user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    return {"user": user}


@app.post("/api/auth/logout")
async def logout(
    auth: tuple[str, dict[str, Any]] = Depends(get_current_user_with_token),
    client_id: str = Depends(get_client_id),
) -> dict[str, bool]:
    token, user = auth
    with connect() as conn:
        delete_auth_session(conn, token)
        leave_all_for_user_client(conn, user, client_id)
        audit(conn, user, "auth.logout", {"clientId": client_id})
    await app_usage_ws_manager.broadcast_usage()
    return {"ok": True}


@app.patch("/api/auth/password")
def change_current_user_password(
    payload: ChangePasswordInput,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    current_password = payload.currentPassword
    new_password = payload.newPassword

    if not current_password or not new_password:
        raise api_error(400, "INVALID_PASSWORD_INPUT", "当前密码和新密码不能为空。")
    if current_password == new_password:
        raise api_error(400, "PASSWORD_UNCHANGED", "新密码不能和当前密码相同。")

    with connect() as conn:
        fresh_user = get_user_by_id(conn, user["id"])
        if not fresh_user or not fresh_user.get("enabled"):
            raise api_error(401, "UNAUTHORIZED", "请先登录。")
        if not verify_password(current_password, fresh_user):
            raise api_error(400, "INVALID_CURRENT_PASSWORD", "当前密码不正确。")
        updated_user = update_user(conn, user["id"], {"password": new_password}, user)
        return {"user": sanitize_user(updated_user)}


@app.get("/api/users")
def users(actor: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    with connect() as conn:
        if actor.get("role") == "admin":
            return {"users": sanitize_users(list_users(conn))}
        current_user = get_user_by_id(conn, actor["id"])
        return {"users": sanitize_users([current_user] if current_user else [])}


@app.post("/api/users", status_code=201)
def create_portal_user(
    payload: UserCreateInput,
    actor: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    name = payload.name.strip()
    account = normalize_account(payload.account)
    password = payload.password
    role = payload.role

    if not name or not account or not password:
        raise api_error(400, "INVALID_USER_INPUT", "姓名、账号和初始密码不能为空。")
    if role not in ROLE_VALUES:
        raise api_error(400, "INVALID_ROLE", "用户角色不合法。")

    with connect() as conn:
        if account_exists(conn, account):
            raise api_error(409, "ACCOUNT_EXISTS", "账号已存在。")
        user = create_user(
            conn,
            {
                "name": name,
                "account": account,
                "password": password,
                "role": role,
                "appPermissions": payload.appPermissions,
            },
            actor,
        )
        return {"user": sanitize_user(user)}


@app.patch("/api/users/{user_id}")
def update_portal_user(
    user_id: str,
    payload: UserUpdateInput,
    actor: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    patch = payload.model_dump(exclude_unset=True)
    is_admin = actor.get("role") == "admin"
    is_self = actor.get("id") == user_id

    if not is_admin and not is_self:
        raise api_error(403, "FORBIDDEN", "当前用户没有权限修改该账号。")
    if not is_admin:
        forbidden_fields = set(patch) - {"name", "account"}
        if forbidden_fields:
            raise api_error(403, "FORBIDDEN", "普通用户只能修改自己的姓名和账号；修改密码请使用修改密码功能。")

    if "name" in patch:
        patch["name"] = str(patch["name"] or "").strip()
        if not patch["name"]:
            raise api_error(400, "INVALID_USER_INPUT", "姓名不能为空。")
    if "account" in patch:
        patch["account"] = normalize_account(str(patch["account"] or ""))
        if not patch["account"]:
            raise api_error(400, "INVALID_USER_INPUT", "账号不能为空。")
    if "role" in patch and patch["role"] not in ROLE_VALUES:
        raise api_error(400, "INVALID_ROLE", "用户角色不合法。")
    if not patch:
        raise api_error(400, "EMPTY_UPDATE", "没有需要更新的内容。")

    with connect() as conn:
        current = get_user_by_id(conn, user_id)
        if not current:
            raise api_error(404, "USER_NOT_FOUND", "用户不存在。")
        if "account" in patch and account_exists(conn, patch["account"], exclude_user_id=user_id):
            raise api_error(409, "ACCOUNT_EXISTS", "账号已存在。")
        if "role" in patch or "appPermissions" in patch:
            next_role = patch.get("role", current["role"])
            patch["appPermissions"] = normalize_permissions(
                next_role,
                patch.get("appPermissions", current.get("appPermissions")),
            )
        if would_remove_last_enabled_admin(conn, user_id, patch):
            raise api_error(400, "LAST_ADMIN_FORBIDDEN", "系统至少需要保留一个启用的管理员。")
        try:
            user = update_user(conn, user_id, patch, actor)
        except KeyError:
            raise api_error(404, "USER_NOT_FOUND", "用户不存在。")
        return {"user": sanitize_user(user)}


@app.get("/api/app-usage")
def app_usage(user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    with connect() as conn:
        return {"summaries": build_usage_summary(conn, user["id"])}


@app.websocket("/ws/app-usage")
async def app_usage_websocket(websocket: WebSocket) -> None:
    await websocket.accept()

    try:
        auth_message = await asyncio.wait_for(websocket.receive_json(), timeout=10)
    except Exception:
        await websocket.close(code=4401, reason="请先登录。")
        return

    if auth_message.get("type") != "auth":
        await websocket.close(code=4401, reason="请先登录。")
        return

    token = str(auth_message.get("token") or "")
    client_id = str(auth_message.get("clientId") or "unknown-client")[:160]
    user = get_user_by_raw_token(token)
    if not user:
        await websocket.close(code=4401, reason="请先登录。")
        return

    await app_usage_ws_manager.register(websocket, user, client_id)
    await app_usage_ws_manager.send_snapshot(websocket, user)

    try:
        while True:
            message = await websocket.receive_json()
            message_type = message.get("type")

            if message_type == "heartbeat":
                app_id = str(message.get("appId") or "")
                if app_id in APP_IDS and can_access_app(user, app_id):
                    with connect() as conn:
                        upsert_app_usage_session(conn, user, app_id, client_id, False)
                await websocket.send_json({"type": "heartbeat_ack"})
                continue

            if message_type == "refresh":
                await app_usage_ws_manager.send_snapshot(websocket, user)
                continue

            await websocket.send_json({"type": "error", "message": "不支持的消息类型。"})
    except WebSocketDisconnect:
        await app_usage_ws_manager.unregister(websocket)
    except Exception:
        await app_usage_ws_manager.unregister(websocket)
        with suppress(Exception):
            await websocket.close()


@app.post("/api/app-usage/{app_id}/enter")
async def enter_app(
    app_id: str,
    payload: EnterAppInput,
    user: dict[str, Any] = Depends(get_current_user),
    client_id: str = Depends(get_client_id),
) -> dict[str, Any]:
    if app_id not in APP_IDS:
        raise api_error(404, "APP_NOT_FOUND", "应用不存在。")
    if not can_access_app(user, app_id):
        raise api_error(403, "APP_FORBIDDEN", "当前用户没有访问该应用的权限。")

    with connect() as conn:
        upsert_app_usage_session(conn, user, app_id, client_id, payload.confirmedConflict)
        audit(
            conn,
            user,
            "app.enter",
            {"appId": app_id, "clientId": client_id, "confirmedConflict": payload.confirmedConflict},
        )
        summaries = build_usage_summary(conn, user["id"])
    await app_usage_ws_manager.broadcast_usage()
    return {"summaries": summaries}


@app.post("/api/app-usage/{app_id}/heartbeat")
def heartbeat_app(
    app_id: str,
    user: dict[str, Any] = Depends(get_current_user),
    client_id: str = Depends(get_client_id),
) -> dict[str, Any]:
    if app_id not in APP_IDS:
        raise api_error(404, "APP_NOT_FOUND", "应用不存在。")
    if not can_access_app(user, app_id):
        raise api_error(403, "APP_FORBIDDEN", "当前用户没有访问该应用的权限。")

    with connect() as conn:
        upsert_app_usage_session(conn, user, app_id, client_id, False)
        return {"summaries": build_usage_summary(conn, user["id"])}


@app.delete("/api/app-usage/{app_id}/leave")
async def leave_single_app(
    app_id: str,
    user: dict[str, Any] = Depends(get_current_user),
    client_id: str = Depends(get_client_id),
) -> dict[str, Any]:
    with connect() as conn:
        leave_app(conn, user, app_id, client_id)
        audit(conn, user, "app.leave", {"appId": app_id, "clientId": client_id})
        summaries = build_usage_summary(conn, user["id"])
    await app_usage_ws_manager.broadcast_usage()
    return {"summaries": summaries}


@app.delete("/api/app-usage/leave-all")
async def leave_all_apps(
    user: dict[str, Any] = Depends(get_current_user),
    client_id: str = Depends(get_client_id),
) -> dict[str, Any]:
    with connect() as conn:
        leave_all_for_user_client(conn, user, client_id)
        audit(conn, user, "app.leave_all", {"clientId": client_id})
        summaries = build_usage_summary(conn, user["id"])
    await app_usage_ws_manager.broadcast_usage()
    return {"summaries": summaries}


@app.post("/api/app-usage/leave-all-beacon")
async def leave_all_apps_beacon(request: Request) -> dict[str, bool]:
    """Release usage rows during pagehide/beforeunload.

    Browsers usually cancel normal fetch calls while a tab is closing, so the
    frontend uses navigator.sendBeacon or fetch(..., keepalive=True) for this
    endpoint. Because sendBeacon cannot attach custom Authorization headers,
    the short-lived portal session token is passed in the same-origin JSON body.
    """
    raw_body = await request.body()
    try:
        payload = json.loads(raw_body.decode("utf-8")) if raw_body else {}
    except (UnicodeDecodeError, json.JSONDecodeError):
        payload = {}

    token = str(payload.get("token") or "")
    client_id = str(payload.get("clientId") or "unknown-client")[:160]
    user = get_user_by_raw_token(token)
    if not user:
        return {"ok": False}

    with connect() as conn:
        leave_all_for_user_client(conn, user, client_id)
        audit(conn, user, "app.leave_all_beacon", {"clientId": client_id})
    await app_usage_ws_manager.broadcast_usage()
    return {"ok": True}


@app.get("/{full_path:path}", include_in_schema=False)
def serve_spa(full_path: str) -> FileResponse:
    if not DIST_DIR.exists():
        raise api_error(404, "DIST_NOT_FOUND", "前端构建产物不存在，请先执行 npm run build。")

    requested = (DIST_DIR / full_path).resolve()
    dist_root = DIST_DIR.resolve()

    try:
        requested.relative_to(dist_root)
    except ValueError:
        requested = dist_root / "index.html"
    else:
        if requested.is_dir():
            requested = requested / "index.html"
        elif not requested.exists():
            requested = dist_root / "index.html"

    if not requested.exists():
        raise api_error(404, "DIST_NOT_FOUND", "前端入口文件不存在。")
    return FileResponse(requested)
