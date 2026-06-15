from __future__ import annotations

from fastapi import APIRouter

from app.api import (
    app_usage,
    auth,
    bid_generator_proxy,
    competitor_analysis,
    contract_review_proxy,
    feedback,
    health,
    modules,
    patent_disclosure,
    pipt_gateway,
    rag_proxy,
    runtime,
    users,
)

router = APIRouter(prefix="/core")
router.include_router(health.router, tags=["health"])
router.include_router(modules.router, tags=["modules"])
router.include_router(runtime.router, tags=["runtime"])
router.include_router(auth.router, tags=["portal-auth"])
router.include_router(users.router, tags=["portal-users"])
router.include_router(app_usage.router, tags=["portal-app-usage"])
router.include_router(feedback.router, tags=["portal-feedback"])
router.include_router(pipt_gateway.router, tags=["pipt-gateway"])

api_router = APIRouter()
api_router.include_router(router)
api_router.include_router(competitor_analysis.router, tags=["competitor-analysis"])
api_router.include_router(rag_proxy.router, tags=["rag"])
api_router.include_router(contract_review_proxy.router, tags=["contract-review"])
api_router.include_router(bid_generator_proxy.router, tags=["bid-generator"])
api_router.include_router(patent_disclosure.router, tags=["patent-disclosure"])
