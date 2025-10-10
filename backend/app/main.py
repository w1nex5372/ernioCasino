from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import socketio

from app.api import api_router
from app.core.config import get_cors_origins
from app.core.logging import configure_logging
from app.db.mongo import client
from app.services.game import initialize_rooms
from app.socket.server import sio

logger = configure_logging()


def create_fastapi_app() -> FastAPI:
    app = FastAPI(title="Solana Casino Battle Royale")
    app.include_router(api_router)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=get_cors_origins(),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.on_event("startup")
    async def on_startup():
        initialize_rooms()
        logger.info("Casino application started")

    @app.on_event("shutdown")
    async def on_shutdown():
        client.close()
        logger.info("Casino application shutdown")

    return app


fastapi_app = create_fastapi_app()
socket_app = socketio.ASGIApp(sio, fastapi_app)

# Export the socket app for uvicorn
app = socket_app
