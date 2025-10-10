from datetime import datetime, timezone
from typing import List, Optional
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field

from app.core.config import RoomType


class RoomPlayer(BaseModel):
    user_id: str
    username: str
    bet_amount: int
    joined_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class GameResult(BaseModel):
    winner: RoomPlayer
    prize_link: str
    total_bet_amount: int


class GameRoom(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=lambda: str(uuid4()))
    room_type: RoomType
    players: List[RoomPlayer] = Field(default_factory=list)
    status: str = "waiting"  # waiting, playing, finished
    prize_pool: int = Field(default=0)
    winner: Optional[RoomPlayer] = None
    prize_link: Optional[str] = None
    round_number: int = Field(default=1)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    started_at: Optional[datetime] = None
    finished_at: Optional[datetime] = None


class JoinRoomRequest(BaseModel):
    room_type: RoomType
    user_id: str
    bet_amount: int
