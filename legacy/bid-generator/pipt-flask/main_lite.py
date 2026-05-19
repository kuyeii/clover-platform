# -*- coding: utf-8 -*-
"""
pipt-flask (zeshouan-lite 分支) — 精简版 FastAPI 入口

仅保留 NER 识别 + 脱敏核心功能，裁剪了 CMS、权限管理、CLI 等非核心模块。
用于 ProEngine 系统的敏感信息脱敏服务。
"""

import logging
import os
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api_lite.routes import router as api_router
from app.api_lite.project_routes import router as project_router
from app.api_lite.task_routes import router as task_router

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("pipt-lite")


def _resolve_cors_origins() -> list[str]:
    raw = os.environ.get("PIPT_CORS_ORIGINS", "*").strip()
    if not raw or raw == "*":
        return ["*"]
    origins = [item.strip() for item in raw.split(",") if item.strip()]
    return origins or ["*"]

# 创建 FastAPI 应用
app = FastAPI(
    title="pipt-lite",
    description="ProEngine 脱敏服务 — NER 识别 + 数据脱敏 API",
    version="0.1.0",
    docs_url="/apidoc",
    redoc_url="/redoc",
)

# CORS 中间件
app.add_middleware(
    CORSMiddleware,
    allow_origins=_resolve_cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health_check():
    """健康检查接口"""
    return {"status": "ok", "service": "pipt-lite"}


@app.get("/")
async def root():
    """根路径"""
    return {
        "service": "pipt-lite",
        "description": "ProEngine 脱敏服务 — NER 识别 + 数据脱敏",
        "docs": "/apidoc",
    }


# 注册 API 路由
app.include_router(api_router, prefix="/api")
app.include_router(project_router, prefix="/api")
app.include_router(task_router, prefix="/api")

@app.on_event("startup")
async def startup_event():
    from app.api_lite.database import init_db
    init_db()
    logger.info("数据库初始化检查完毕。")

    # 预加载脱敏引擎 + NER 模型，避免首次请求冷启动
    try:
        from app.api_lite.routes import get_engine
        engine = get_engine()
        engine._try_load_ner_model()
        logger.info("NER 模型预加载完成。")
    except Exception as e:
        logger.warning(f"NER 预加载失败（不影响启动）: {e}")


if __name__ == "__main__":
    uvicorn.run(
        "main_lite:app",
        host=os.environ.get("HOST", "0.0.0.0"),
        port=int(os.environ.get("PORT", "5000")),
        reload=True,
    )
