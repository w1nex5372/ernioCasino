import logging
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, HTTPException

from app.core.config import ROOM_SETTINGS
from app.db.mongo import db
from app.models import GameRoom, JoinRoomRequest, RoomPlayer
from app.services.game import active_rooms, start_game_round
from app.socket.server import sio

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/rooms")
async def get_active_rooms():
    """Get all active rooms with their current status."""

    rooms_data = []
    for room in active_rooms.values():
        rooms_data.append(
            {
                "id": room.id,
                "room_type": room.room_type,
                "players_count": len(room.players),
                "max_players": 2,
                "status": room.status,
                "prize_pool": room.prize_pool,
                "round_number": room.round_number,
                "settings": ROOM_SETTINGS[room.room_type],
            }
        )

    return {"rooms": rooms_data}


@router.post("/join-room")
async def join_room(request: JoinRoomRequest, background_tasks: BackgroundTasks):
    """Join a room with a bet."""

    logger.info("Join room request: %s", request.model_dump())

    target_room: Optional[GameRoom] = None
    for room in active_rooms.values():
        if room.room_type == request.room_type and room.status == "waiting":
            target_room = room
            break

    if not target_room:
        logger.error("No available room of type %s", request.room_type)
        raise HTTPException(status_code=404, detail="No available room of this type")

    settings = ROOM_SETTINGS[request.room_type]
    if request.bet_amount < settings["min_bet"] or request.bet_amount > settings["max_bet"]:
        raise HTTPException(
            status_code=400,
            detail=f"Bet amount must be between {settings['min_bet']} and {settings['max_bet']} tokens",
        )

    user_doc = await db.users.find_one({"id": request.user_id})
    if not user_doc:
        logger.error("User not found: %s", request.user_id)
        raise HTTPException(status_code=404, detail="User not found")

    logger.info("User balance: %s, Bet amount: %s", user_doc.get("token_balance", 0), request.bet_amount)

    if user_doc.get("token_balance", 0) < request.bet_amount:
        raise HTTPException(status_code=400, detail="Insufficient token balance")

    if any(p.user_id == request.user_id for p in target_room.players):
        raise HTTPException(status_code=400, detail="You are already in this room")

    if len(target_room.players) >= 2:
        raise HTTPException(status_code=400, detail="Room is full")

    await db.users.update_one(
        {"id": request.user_id},
        {"$inc": {"token_balance": -request.bet_amount}},
    )

    player = RoomPlayer(
        user_id=request.user_id,
        username=user_doc.get("first_name", "Player"),
        bet_amount=request.bet_amount,
    )
    target_room.players.append(player)
    target_room.prize_pool += request.bet_amount

    await sio.emit(
        "player_joined",
        {
            "room_id": target_room.id,
            "room_type": target_room.room_type,
            "player": player.model_dump(),
            "players_count": len(target_room.players),
            "prize_pool": target_room.prize_pool,
        },
    )

    if len(target_room.players) == 2:
        background_tasks.add_task(start_game_round, target_room, sio)

    return {
        "success": True,
        "room_id": target_room.id,
        "position": len(target_room.players),
        "players_needed": 2 - len(target_room.players),
    }


@router.get("/room/{room_id}")
async def get_room_details(room_id: str):
    """Get detailed information about a specific room."""

    room = active_rooms.get(room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    return {
        "id": room.id,
        "room_type": room.room_type,
        "players": [p.model_dump() for p in room.players],
        "status": room.status,
        "prize_pool": room.prize_pool,
        "round_number": room.round_number,
        "settings": ROOM_SETTINGS[room.room_type],
        "winner": room.winner.model_dump() if room.winner else None,
    }
