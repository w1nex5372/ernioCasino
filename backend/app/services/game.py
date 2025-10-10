import asyncio
import logging
import random
from datetime import datetime, timezone
from typing import Dict, List

from socketio import AsyncServer

from app.core.config import PRIZE_LINKS, RoomType
from app.db.mongo import db
from app.models import GameRoom, RoomPlayer

logger = logging.getLogger(__name__)

# In-memory storage for active rooms (in production, use Redis)
active_rooms: Dict[str, GameRoom] = {}


def calculate_win_probability(player_bet: int, total_pool: int) -> float:
    """Calculate weighted probability based on bet amount."""

    if total_pool == 0:
        return 0

    base_prob = 0.1  # 10% base chance
    bet_bonus = (player_bet / total_pool) * 0.9  # Up to 90% based on bet ratio
    return min(base_prob + bet_bonus, 0.95)  # Cap at 95%


def select_winner(players: List[RoomPlayer]) -> RoomPlayer:
    """Select winner using weighted random selection - bigger bets have better odds."""

    if not players:
        raise ValueError("No players to select from")

    total_pool = sum(p.bet_amount for p in players)
    random_point = random.uniform(0, total_pool)

    cumulative = 0
    for player in players:
        cumulative += player.bet_amount
        if random_point <= cumulative:
            return player

    return players[-1]


async def start_game_round(room: GameRoom, sio: AsyncServer) -> None:
    """Start a game round when room is full."""

    if len(room.players) != 2:
        return

    room.status = "playing"
    room.started_at = datetime.now(timezone.utc)
    room.prize_pool = sum(p.bet_amount for p in room.players)

    await sio.emit(
        "game_starting",
        {
            "room_id": room.id,
            "room_type": room.room_type,
            "players": [p.model_dump() for p in room.players],
            "prize_pool": room.prize_pool,
        },
    )

    await asyncio.sleep(3)

    winner = select_winner(room.players)
    room.winner = winner
    room.status = "finished"
    room.finished_at = datetime.now(timezone.utc)
    prize_link = PRIZE_LINKS[room.room_type]
    room.prize_link = prize_link

    try:
        await db.winner_prizes.insert_one(
            {
                "user_id": winner.user_id,
                "username": winner.username,
                "room_type": room.room_type,
                "prize_link": prize_link,
                "bet_amount": winner.bet_amount,
                "total_pool": room.prize_pool,
                "round_number": room.round_number,
                "won_at": room.finished_at.isoformat(),
            }
        )
        logger.info("Prize link stored for winner %s: %s", winner.username, prize_link)
    except Exception as exc:  # pragma: no cover - best effort logging
        logger.error("Failed to store winner prize: %s", exc)

    await sio.emit(
        "game_finished",
        {
            "room_id": room.id,
            "room_type": room.room_type,
            "winner": room.winner.model_dump(),
            "prize_pool": room.prize_pool,
            "round_number": room.round_number,
            "has_prize": True,
        },
    )

    await sio.emit(
        "prize_won",
        {
            "prize_link": prize_link,
            "room_type": room.room_type,
            "bet_amount": winner.bet_amount,
            "total_pool": room.prize_pool,
        },
        room=winner.user_id,
    )

    try:
        game_doc = room.model_dump()
        game_doc["created_at"] = room.created_at.isoformat()
        if room.started_at:
            game_doc["started_at"] = room.started_at.isoformat()
        if room.finished_at:
            game_doc["finished_at"] = room.finished_at.isoformat()
        for player in game_doc["players"]:
            player["joined_at"] = player["joined_at"].isoformat()
        if game_doc.get("winner"):
            game_doc["winner"]["joined_at"] = game_doc["winner"]["joined_at"].isoformat()

        await db.completed_games.insert_one(game_doc)
    except Exception as exc:  # pragma: no cover - best effort logging
        logger.error("Failed to save completed game: %s", exc)

    active_rooms.pop(room.id, None)

    new_room = GameRoom(room_type=room.room_type, round_number=room.round_number + 1)
    active_rooms[new_room.id] = new_room

    await sio.emit(
        "new_room_available",
        {
            "room_id": new_room.id,
            "room_type": new_room.room_type,
            "round_number": new_room.round_number,
        },
    )


def initialize_rooms() -> None:
    """Create initial rooms for each type."""

    active_rooms.clear()
    for room_type in RoomType:
        room = GameRoom(room_type=room_type)
        active_rooms[room.id] = room


__all__ = [
    "active_rooms",
    "calculate_win_probability",
    "initialize_rooms",
    "select_winner",
    "start_game_round",
]
