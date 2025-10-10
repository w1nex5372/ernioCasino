from enum import Enum
import os
from pathlib import Path
from typing import List

from dotenv import load_dotenv

# Load environment variables from backend/.env if present
BACKEND_DIR = Path(__file__).resolve().parents[2]
load_dotenv(BACKEND_DIR / '.env')


class RoomType(str, Enum):
    """Available casino room tiers."""

    BRONZE = "bronze"
    SILVER = "silver"
    GOLD = "gold"


# ** EDIT THESE LINES TO ADD YOUR PRIZE LINKS **
PRIZE_LINKS = {
    RoomType.BRONZE: "https://your-prize-link-1.com",  # Prize link for Bronze room
    RoomType.SILVER: "https://your-prize-link-2.com",  # Prize link for Silver room
    RoomType.GOLD: "https://your-prize-link-3.com",  # Prize link for Gold room
}

# ** EDIT THIS LINE TO ADD YOUR TELEGRAM BOT TOKEN **
TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "YOUR_TELEGRAM_BOT_TOKEN_HERE")

ROOM_SETTINGS = {
    RoomType.BRONZE: {"min_bet": 150, "max_bet": 450, "name": "Bronze Room"},
    RoomType.SILVER: {"min_bet": 500, "max_bet": 1500, "name": "Silver Room"},
    RoomType.GOLD: {"min_bet": 2000, "max_bet": 8000, "name": "Gold Room"},
}

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]


def get_cors_origins() -> List[str]:
    """Return the list of allowed CORS origins."""

    return os.environ.get("CORS_ORIGINS", "*").split(",")
