from __future__ import annotations

import asyncio
import json
from contextlib import suppress
from typing import Any

from fastapi import APIRouter, Depends, Request, WebSocket, WebSocketDisconnect

from app.core.deps import get_client_id, get_current_user
from app.core.responses import ok
from app.schemas.portal import EnterAppInput
from app.services import app_usage_service
from app.services import portal_store as store
from app.services.auth_service import get_user_by_raw_token
from app.services.app_usage_service import app_usage_ws_manager

router = APIRouter(prefix="/app-usage")
websocket_router = APIRouter()


@router.get("", name="portal_app_usage")
def app_usage(request: Request, user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    return ok(request, app_usage_service.usage_summary(user))


@router.post("/{app_code}/enter", name="portal_app_usage_enter")
async def enter_app(
    request: Request,
    app_code: str,
    payload: EnterAppInput,
    user: dict[str, Any] = Depends(get_current_user),
    client_id: str = Depends(get_client_id),
) -> dict[str, Any]:
    data = await app_usage_service.enter_app(
        app_code=app_code,
        user=user,
        client_id=client_id,
        confirmed_conflict=payload.confirmedConflict,
    )
    return ok(request, data)


@router.post("/{app_code}/heartbeat", name="portal_app_usage_heartbeat")
def heartbeat_app(
    request: Request,
    app_code: str,
    user: dict[str, Any] = Depends(get_current_user),
    client_id: str = Depends(get_client_id),
) -> dict[str, Any]:
    data = app_usage_service.heartbeat_app(app_code=app_code, user=user, client_id=client_id)
    return ok(request, data)


@router.delete("/{app_code}/leave", name="portal_app_usage_leave")
async def leave_single_app(
    request: Request,
    app_code: str,
    user: dict[str, Any] = Depends(get_current_user),
    client_id: str = Depends(get_client_id),
) -> dict[str, Any]:
    data = await app_usage_service.leave_app(app_code=app_code, user=user, client_id=client_id)
    return ok(request, data)


@router.delete("/leave-all", name="portal_app_usage_leave_all")
async def leave_all_apps(
    request: Request,
    user: dict[str, Any] = Depends(get_current_user),
    client_id: str = Depends(get_client_id),
) -> dict[str, Any]:
    data = await app_usage_service.leave_all_apps(user=user, client_id=client_id)
    return ok(request, data)


@router.post("/leave-all-beacon", name="portal_app_usage_leave_all_beacon")
async def leave_all_apps_beacon(request: Request) -> dict[str, Any]:
    raw_body = await request.body()
    try:
        payload = json.loads(raw_body.decode("utf-8")) if raw_body else {}
    except (UnicodeDecodeError, json.JSONDecodeError):
        payload = {}

    token = str(payload.get("token") or "")
    client_id = str(payload.get("clientId") or "unknown-client")[:160]
    data = await app_usage_service.leave_all_apps_beacon(token=token, client_id=client_id)
    return ok(request, data)


@websocket_router.websocket("/ws/core/app-usage")
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
                app_code = str(message.get("appId") or "")
                if app_code in store.app_ids() and store.can_access_app(user, app_code):
                    with store.connect() as conn:
                        store.upsert_app_usage_session(conn, user, app_code, client_id, False)
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
