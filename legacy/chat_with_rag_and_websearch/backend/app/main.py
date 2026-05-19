from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.conversation_routes import router as conversations_router
from app.api.knowledge_routes import router as knowledge_router
from app.api.routes import router as api_router
from app.config import get_settings
from app.observability import setup_logging
from app.services import conversation_db


@asynccontextmanager
async def lifespan(_app: FastAPI):
    setup_logging()
    conversation_db.init_database(get_settings())
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="Chat RAG & Web Search API", lifespan=lifespan)

    origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins or ["http://localhost:5173"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(api_router)
    app.include_router(conversations_router)
    app.include_router(knowledge_router)
    return app


app = create_app()
