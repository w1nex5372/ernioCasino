from fastapi import APIRouter

from app.api.routes import auth, rooms, root, stats, users

api_router = APIRouter(prefix="/api")
api_router.include_router(root.router)
api_router.include_router(auth.router)
api_router.include_router(users.router)
api_router.include_router(rooms.router)
api_router.include_router(stats.router)

__all__ = ["api_router"]
