from fastapi import APIRouter

from app.db.mongo import db

router = APIRouter()


@router.get("/leaderboard")
async def get_leaderboard():
    """Get top players by token balance."""

    pipeline = [
        {"$sort": {"token_balance": -1}},
        {"$limit": 10},
        {"$project": {"_id": 0, "first_name": 1, "token_balance": 1}},
    ]

    leaderboard = await db.users.aggregate(pipeline).to_list(10)
    return {"leaderboard": leaderboard}


@router.get("/game-history")
async def get_game_history(limit: int = 20):
    """Get recent completed games."""

    games = (
        await db.completed_games.find({}, {"_id": 0})
        .sort("finished_at", -1)
        .limit(limit)
        .to_list(limit)
    )

    return {"games": games}


@router.get("/user/{user_id}/prizes")
async def get_user_prizes(user_id: str):
    """Get all prize links won by a specific user."""

    prizes = (
        await db.winner_prizes.find({"user_id": user_id}, {"_id": 0})
        .sort("won_at", -1)
        .to_list(100)
    )

    return {"prizes": prizes}


@router.get("/check-winner/{user_id}")
async def check_if_winner(user_id: str):
    """Check if user has any unclaimed prizes."""

    recent_prizes = (
        await db.winner_prizes.find({"user_id": user_id}, {"_id": 0})
        .sort("won_at", -1)
        .limit(5)
        .to_list(5)
    )

    return {"recent_prizes": recent_prizes}
