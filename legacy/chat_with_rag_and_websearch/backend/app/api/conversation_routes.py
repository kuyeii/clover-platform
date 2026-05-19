import asyncio
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response

from app.config import Settings, get_settings
from app.schemas.conversations import (
    ConversationsBootstrapResponse,
    ConversationsSyncRequest,
)
from app.services.conversation_store import apply_sync, read_bootstrap

router = APIRouter(prefix="/api/v1")


@router.get("/conversations", response_model=ConversationsBootstrapResponse)
async def get_conversations(
    settings: Annotated[Settings, Depends(get_settings)],
) -> ConversationsBootstrapResponse:
    return await asyncio.to_thread(read_bootstrap, settings)


@router.put("/conversations/sync")
async def sync_conversations(
    body: ConversationsSyncRequest,
    settings: Annotated[Settings, Depends(get_settings)],
) -> Response:
    try:
        await asyncio.to_thread(apply_sync, settings, body)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return Response(status_code=204)
