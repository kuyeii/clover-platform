from __future__ import annotations

from typing import Annotated, Any, List, Optional

from fastapi import APIRouter, Cookie, Depends, File, Form, Response, UploadFile

from ..deps import get_current_user
from ..feedback.captcha import captcha_cookie_name
from ..feedback.service import (
    build_submission_context,
    create_captcha_challenge,
    submit_feedback,
)

router = APIRouter(prefix="/api", tags=["feedback"])


@router.get("/tickets/submission-context")
def ticket_submission_context(
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    return build_submission_context(user, "ticket")


@router.get("/tickets/captcha")
def ticket_captcha(
    response: Response,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, str]:
    return create_captcha_challenge(response, user, "ticket")


@router.post("/tickets", status_code=201)
async def create_ticket(
    response: Response,
    overview: Annotated[str, Form()],
    description: Annotated[str, Form()],
    contact_email: Annotated[str, Form(alias="contactEmail")],
    captcha: Annotated[Optional[str], Form()] = None,
    attachments: Annotated[Optional[List[UploadFile]], File()] = None,
    captcha_cookie: Annotated[Optional[str], Cookie(alias=captcha_cookie_name("ticket"))] = None,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    return await submit_feedback(
        kind="ticket",
        user=user,
        overview=overview,
        description=description,
        contact_email=contact_email,
        captcha=captcha,
        attachments=attachments,
        response=response,
        captcha_cookie=captcha_cookie,
    )


@router.get("/feature-requests/submission-context")
def feature_request_submission_context(
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    return build_submission_context(user, "feature_request")


@router.get("/feature-requests/captcha")
def feature_request_captcha(
    response: Response,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, str]:
    return create_captcha_challenge(response, user, "feature_request")


@router.post("/feature-requests", status_code=201)
async def create_feature_request(
    response: Response,
    overview: Annotated[str, Form()],
    description: Annotated[str, Form()],
    contact_email: Annotated[str, Form(alias="contactEmail")],
    captcha: Annotated[Optional[str], Form()] = None,
    attachments: Annotated[Optional[List[UploadFile]], File()] = None,
    captcha_cookie: Annotated[Optional[str], Cookie(alias=captcha_cookie_name("feature_request"))] = None,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    return await submit_feedback(
        kind="feature_request",
        user=user,
        overview=overview,
        description=description,
        contact_email=contact_email,
        captcha=captcha,
        attachments=attachments,
        response=response,
        captcha_cookie=captcha_cookie,
    )
