from motor.motor_asyncio import AsyncIOMotorClient

from app.core.config import DB_NAME, MONGO_URL

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

__all__ = ["client", "db"]
