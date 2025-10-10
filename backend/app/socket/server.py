import logging

import socketio

logger = logging.getLogger(__name__)

sio = socketio.AsyncServer(
    cors_allowed_origins="*",
    logger=True,
    engineio_logger=True,
    async_mode="asgi",
)


@sio.event
async def connect(sid, environ):
    logger.info("Client %s connected", sid)
    await sio.emit("connected", {"status": "Connected to casino!"}, room=sid)


@sio.event
async def disconnect(sid):
    logger.info("Client %s disconnected", sid)
