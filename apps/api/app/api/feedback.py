from __future__ import annotations

from typing import Annotated, Any, Optional

from fastapi import APIRouter, Cookie, Depends, File, Form, Request, Response, UploadFile, status

from app.core.deps import get_current_user
from app.core.responses import ok
from app.services.feedback_service import (
    build_submission_context,
    captcha_cookie_name,
    create_captcha_challenge,
    submit_feedback,
)

router = APIRouter()


@router.get("/tickets/submission-context", name="portal_feedback_ticket_submission_context")
def ticket_submission_context(
    request: Request,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    return ok(request, build_submission_context(user, "ticket"))


@router.get("/tickets/captcha", name="portal_feedback_ticket_captcha")
def ticket_captcha(
    request: Request,
    response: Response,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    return ok(request, create_captcha_challenge(response, user, "ticket"))


@router.post("/tickets", name="portal_feedback_create_ticket", status_code=status.HTTP_201_CREATED)
async def create_ticket(
    request: Request,
    response: Response,
    overview: Annotated[str, Form()],
    description: Annotated[str, Form()],
    contact_email: Annotated[str, Form(alias="contactEmail")],
    captcha: Annotated[Optional[str], Form()] = None,
    attachments: Annotated[Optional[list[UploadFile]], File()] = None,
    captcha_cookie: Annotated[Optional[str], Cookie(alias=captcha_cookie_name("ticket"))] = None,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    data = await submit_feedback(
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
    return ok(request, data)


@router.get("/feature-requests/submission-context", name="portal_feedback_feature_submission_context")
def feature_request_submission_context(
    request: Request,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    return ok(request, build_submission_context(user, "feature_request"))


@router.get("/feature-requests/captcha", name="portal_feedback_feature_captcha")
def feature_request_captcha(
    request: Request,
    response: Response,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    return ok(request, create_captcha_challenge(response, user, "feature_request"))


@router.post(
    "/feature-requests",
    name="portal_feedback_create_feature_request",
    status_code=status.HTTP_201_CREATED,
)
async def create_feature_request(
    request: Request,
    response: Response,
    overview: Annotated[str, Form()],
    description: Annotated[str, Form()],
    contact_email: Annotated[str, Form(alias="contactEmail")],
    captcha: Annotated[Optional[str], Form()] = None,
    attachments: Annotated[Optional[list[UploadFile]], File()] = None,
    captcha_cookie: Annotated[Optional[str], Cookie(alias=captcha_cookie_name("feature_request"))] = None,
    user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    data = await submit_feedback(
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
    return ok(request, data)
