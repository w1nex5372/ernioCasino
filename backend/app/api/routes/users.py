from datetime import datetime

from fastapi import APIRouter, HTTPException

from app.db.mongo import db
from app.models import TokenPurchase, User

router = APIRouter()


@router.get("/users/{user_id}", response_model=User)
async def get_user(user_id: str):
    user_doc = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not user_doc:
        raise HTTPException(status_code=404, detail="User not found")

    if isinstance(user_doc.get("created_at"), str):
        user_doc["created_at"] = datetime.fromisoformat(user_doc["created_at"])

    if isinstance(user_doc.get("last_login"), str):
        user_doc["last_login"] = datetime.fromisoformat(user_doc["last_login"])

    return User(**user_doc)


@router.post("/purchase-tokens")
async def purchase_tokens(purchase: TokenPurchase):
    """Mock token purchase - in real implementation, verify Solana transaction."""

    expected_tokens = int(purchase.sol_amount * 1000)

    if purchase.token_amount != expected_tokens:
        raise HTTPException(status_code=400, detail="Invalid token amount")

    result = await db.users.update_one(
        {"id": purchase.user_id},
        {"$inc": {"token_balance": purchase.token_amount}},
    )

    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")

    return {"success": True, "tokens_added": purchase.token_amount}
