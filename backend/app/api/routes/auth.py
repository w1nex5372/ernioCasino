import logging
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

from app.db.mongo import db
from app.models import User, UserCreate

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/auth/telegram", response_model=User)
async def telegram_auth(user_data: UserCreate):
    """Authenticate user with Telegram data."""

    telegram_data = user_data.telegram_auth_data
    logger.info("Telegram auth attempt for user ID: %s", telegram_data.id)

    if not telegram_data.id or not telegram_data.first_name:
        raise HTTPException(status_code=400, detail="Missing required Telegram user data")

    logger.info(
        "Authenticating Telegram user: %s (ID: %s)",
        telegram_data.first_name,
        telegram_data.id,
    )

    existing_user = await db.users.find_one({"telegram_id": telegram_data.id})

    if existing_user:
        await db.users.update_one(
            {"telegram_id": telegram_data.id},
            {"$set": {"last_login": datetime.now(timezone.utc).isoformat()}},
        )

        if isinstance(existing_user.get("created_at"), str):
            existing_user["created_at"] = datetime.fromisoformat(existing_user["created_at"])
        if isinstance(existing_user.get("last_login"), str):
            existing_user["last_login"] = datetime.fromisoformat(existing_user["last_login"])

        logger.info("Returning existing user: %s", existing_user.get("first_name"))
        return User(**existing_user)

    user = User(
        telegram_id=telegram_data.id,
        first_name=telegram_data.first_name,
        last_name=telegram_data.last_name,
        telegram_username=telegram_data.username,
        photo_url=telegram_data.photo_url,
        is_verified=True,
    )

    user_doc = user.model_dump()
    user_doc["created_at"] = user.created_at.isoformat()
    user_doc["last_login"] = user.last_login.isoformat()

    await db.users.insert_one(user_doc)
    logger.info("Created new user: %s", user.first_name)
    return user
