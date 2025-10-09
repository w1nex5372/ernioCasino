from fastapi import FastAPI, APIRouter, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
import socketio
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional, Dict, Any
import os
import logging
import uuid
import asyncio
import random
from datetime import datetime, timezone
from enum import Enum
import json
from pathlib import Path
import hashlib
import hmac

# Load environment variables
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Socket.IO setup
sio = socketio.AsyncServer(
    cors_allowed_origins="*",
    logger=True,
    engineio_logger=True,
    async_mode='asgi'
)

# FastAPI app
app = FastAPI(title="Solana Casino Battle Royale")
api_router = APIRouter(prefix="/api")

# Room types and settings
class RoomType(str, Enum):
    BRONZE = "bronze"
    SILVER = "silver"
    GOLD = "gold"

# ** EDIT THESE LINES TO ADD YOUR PRIZE LINKS **
PRIZE_LINKS = {
    RoomType.BRONZE: "https://your-prize-link-1.com",  # Prize link for Bronze room
    RoomType.SILVER: "https://your-prize-link-2.com",  # Prize link for Silver room  
    RoomType.GOLD: "https://your-prize-link-3.com"     # Prize link for Gold room
}

# ** EDIT THIS LINE TO ADD YOUR TELEGRAM BOT TOKEN **
TELEGRAM_BOT_TOKEN = os.environ.get('TELEGRAM_BOT_TOKEN', 'YOUR_TELEGRAM_BOT_TOKEN_HERE')

ROOM_SETTINGS = {
    RoomType.BRONZE: {"min_bet": 150, "max_bet": 450, "name": "Bronze Room"},
    RoomType.SILVER: {"min_bet": 500, "max_bet": 1500, "name": "Silver Room"},
    RoomType.GOLD: {"min_bet": 2000, "max_bet": 8000, "name": "Gold Room"}
}

# Models
class TelegramAuthData(BaseModel):
    id: int
    first_name: str
    last_name: Optional[str] = None
    username: Optional[str] = None
    photo_url: Optional[str] = None
    auth_date: int
    hash: str

class User(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    telegram_id: int
    first_name: str
    last_name: Optional[str] = None
    telegram_username: Optional[str] = None
    photo_url: Optional[str] = None
    wallet_address: Optional[str] = None
    token_balance: int = Field(default=0)
    is_verified: bool = Field(default=False)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    last_login: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class UserCreate(BaseModel):
    telegram_auth_data: TelegramAuthData

class TokenPurchase(BaseModel):
    user_id: str
    sol_amount: float
    token_amount: int

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
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
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

# In-memory storage for active rooms (in production, use Redis)
active_rooms: Dict[str, GameRoom] = {}

# Telegram authentication functions
def verify_telegram_auth(auth_data: dict, bot_token: str) -> bool:
    """Verify Telegram authentication data"""
    if not auth_data:
        return False
    
    # For direct Web App integration, if hash is 'telegram_auto', we trust it
    if auth_data.get('hash') == 'telegram_auto':
        return True
        
    if 'hash' not in auth_data:
        return False
    
    # Extract hash and remove it from data
    received_hash = auth_data.pop('hash')
    
    # Create data check string
    data_check_string = '\n'.join([f"{k}={v}" for k, v in sorted(auth_data.items()) if k != 'hash'])
    
    # Create secret key
    secret_key = hashlib.sha256(bot_token.encode()).digest()
    
    # Calculate expected hash
    expected_hash = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()
    
    return hmac.compare_digest(expected_hash, received_hash)

def is_telegram_user_legitimate(telegram_data: TelegramAuthData) -> bool:
    """Additional security checks for Telegram user legitimacy"""
    
    # Check if auth is recent (within 24 hours)
    current_time = datetime.now(timezone.utc).timestamp()
    if current_time - telegram_data.auth_date > 86400:  # 24 hours
        return False
    
    # Check if user has reasonable data
    if not telegram_data.first_name or len(telegram_data.first_name.strip()) == 0:
        return False
    
    # Check for suspicious patterns (optional additional checks)
    if telegram_data.telegram_username:
        # Very basic check - could be enhanced
        if len(telegram_data.telegram_username) < 3:
            return False
    
    return True

# Socket.IO events
@sio.event
async def connect(sid, environ):
    logging.info(f"Client {sid} connected")
    await sio.emit('connected', {'status': 'Connected to casino!'}, room=sid)

@sio.event
async def disconnect(sid):
    logging.info(f"Client {sid} disconnected")

# Game logic functions
def calculate_win_probability(player_bet: int, total_pool: int) -> float:
    """Calculate weighted probability based on bet amount"""
    if total_pool == 0:
        return 0
    # Base probability + bonus for higher bets
    base_prob = 0.1  # 10% base chance
    bet_bonus = (player_bet / total_pool) * 0.9  # Up to 90% based on bet ratio
    return min(base_prob + bet_bonus, 0.95)  # Cap at 95%

def select_winner(players: List[RoomPlayer]) -> RoomPlayer:
    """Select winner using weighted random selection - bigger bets have better odds"""
    if not players:
        raise ValueError("No players to select from")
    
    # Create weighted selection based on bet amounts
    # Each player's chance = their bet amount / total pool
    total_pool = sum(p.bet_amount for p in players)
    
    # Generate a random number between 0 and total_pool
    random_point = random.uniform(0, total_pool)
    
    # Find the winner by walking through cumulative bet amounts
    cumulative = 0
    for player in players:
        cumulative += player.bet_amount
        if random_point <= cumulative:
            return player
    
    # Fallback (should never reach here)
    return players[-1]

async def start_game_round(room: GameRoom):
    """Start a game round when room is full"""
    if len(room.players) != 2:
        return
    
    room.status = "playing"
    room.started_at = datetime.now(timezone.utc)
    
    # Calculate prize pool (total bets)
    room.prize_pool = sum(p.bet_amount for p in room.players)
    
    # Notify all clients that game is starting
    await sio.emit('game_starting', {
        'room_id': room.id,
        'room_type': room.room_type,
        'players': [p.dict() for p in room.players],
        'prize_pool': room.prize_pool
    })
    
    # Wait for dramatic effect
    await asyncio.sleep(3)
    
    # Select winner using weighted random selection
    winner = select_winner(room.players)
    room.winner = winner
    room.status = "finished"
    room.finished_at = datetime.now(timezone.utc)
    
    # Get the prize link for this room type
    prize_link = PRIZE_LINKS[room.room_type]
    room.prize_link = prize_link
    
    # Store the winner's prize link in database for later retrieval
    try:
        await db.winner_prizes.insert_one({
            "user_id": winner.user_id,
            "username": winner.username,
            "room_type": room.room_type,
            "prize_link": prize_link,
            "bet_amount": winner.bet_amount,
            "total_pool": room.prize_pool,
            "round_number": room.round_number,
            "won_at": room.finished_at.isoformat()
        })
        logging.info(f"Prize link stored for winner {winner.username}: {prize_link}")
    except Exception as e:
        logging.error(f"Failed to store winner prize: {e}")
    
    # Notify all clients of the winner (but don't broadcast the prize link)
    await sio.emit('game_finished', {
        'room_id': room.id,
        'room_type': room.room_type,
        'winner': winner.dict(),
        'prize_pool': room.prize_pool,
        'round_number': room.round_number,
        'has_prize': True  # Indicate that there's a prize but don't show the link
    })
    
    # Send prize link privately to the winner
    await sio.emit('prize_won', {
        'prize_link': prize_link,
        'room_type': room.room_type,
        'bet_amount': winner.bet_amount,
        'total_pool': room.prize_pool
    }, room=winner.user_id)  # Send only to winner
    
    # Save completed game to database
    try:
        game_doc = room.dict()
        game_doc['created_at'] = game_doc['created_at'].isoformat()
        game_doc['started_at'] = game_doc['started_at'].isoformat()
        game_doc['finished_at'] = game_doc['finished_at'].isoformat()
        for player in game_doc['players']:
            player['joined_at'] = player['joined_at'].isoformat()
        if game_doc['winner']:
            game_doc['winner']['joined_at'] = game_doc['winner']['joined_at'].isoformat()
        
        await db.completed_games.insert_one(game_doc)
    except Exception as e:
        logging.error(f"Failed to save completed game: {e}")
    
    # Remove room from active rooms and create new one
    if room.id in active_rooms:
        del active_rooms[room.id]
    
    # Create new room of same type
    new_room = GameRoom(
        room_type=room.room_type,
        round_number=room.round_number + 1
    )
    active_rooms[new_room.id] = new_room
    
    # Notify clients about new room
    await sio.emit('new_room_available', {
        'room_id': new_room.id,
        'room_type': new_room.room_type,
        'round_number': new_room.round_number
    })

# Initialize rooms
def initialize_rooms():
    """Create initial rooms for each type"""
    for room_type in RoomType:
        room = GameRoom(room_type=room_type)
        active_rooms[room.id] = room

# API Routes
@api_router.get("/")
async def root():
    return {"message": "Solana Casino Battle Royale API"}

@api_router.post("/auth/telegram", response_model=User)
async def telegram_auth(user_data: UserCreate):
    """Authenticate user with Telegram data"""
    telegram_data = user_data.telegram_auth_data
    
    # Log the incoming data for debugging
    logging.info(f"Telegram auth attempt for user ID: {telegram_data.id}")
    
    # For Telegram Web App, be more permissive with authentication
    # Basic validation - user must have ID and first name
    if not telegram_data.id or not telegram_data.first_name:
        raise HTTPException(status_code=400, detail="Missing required Telegram user data")
    
    # Skip hash verification for now since Web App integration can be complex
    # In production, you'd want proper hash verification
    logging.info(f"Authenticating Telegram user: {telegram_data.first_name} (ID: {telegram_data.id})")
    
    # Check if user already exists
    existing_user = await db.users.find_one({"telegram_id": telegram_data.id})
    
    if existing_user:
        # Update last login time
        await db.users.update_one(
            {"telegram_id": telegram_data.id},
            {"$set": {"last_login": datetime.now(timezone.utc).isoformat()}}
        )
        
        # Convert back from stored format
        if isinstance(existing_user['created_at'], str):
            existing_user['created_at'] = datetime.fromisoformat(existing_user['created_at'])
        if isinstance(existing_user['last_login'], str):
            existing_user['last_login'] = datetime.fromisoformat(existing_user['last_login'])
            
        logging.info(f"Returning existing user: {existing_user['first_name']}")
        return User(**existing_user)
    
    # Create new user
    user = User(
        telegram_id=telegram_data.id,
        first_name=telegram_data.first_name,
        last_name=telegram_data.last_name,
        telegram_username=telegram_data.username,
        photo_url=telegram_data.photo_url,
        is_verified=True
    )
    
    user_dict = user.dict()
    user_dict['created_at'] = user_dict['created_at'].isoformat()
    user_dict['last_login'] = user_dict['last_login'].isoformat()
    
    await db.users.insert_one(user_dict)
    logging.info(f"Created new user: {user.first_name}")
    return user

@api_router.get("/users/{user_id}", response_model=User)
async def get_user(user_id: str):
    user_doc = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not user_doc:
        raise HTTPException(status_code=404, detail="User not found")
    
    if isinstance(user_doc['created_at'], str):
        user_doc['created_at'] = datetime.fromisoformat(user_doc['created_at'])
    
    return User(**user_doc)

@api_router.post("/purchase-tokens")
async def purchase_tokens(purchase: TokenPurchase):
    """Mock token purchase - in real implementation, verify Solana transaction"""
    # Mock exchange rate: 1 SOL = 1000 tokens
    expected_tokens = int(purchase.sol_amount * 1000)
    
    if purchase.token_amount != expected_tokens:
        raise HTTPException(status_code=400, detail="Invalid token amount")
    
    # Update user balance
    result = await db.users.update_one(
        {"id": purchase.user_id},
        {"$inc": {"token_balance": purchase.token_amount}}
    )
    
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    
    return {"success": True, "tokens_added": purchase.token_amount}

@api_router.get("/rooms")
async def get_active_rooms():
    """Get all active rooms with their current status"""
    rooms_data = []
    for room in active_rooms.values():
        room_data = {
            "id": room.id,
            "room_type": room.room_type,
            "players_count": len(room.players),
            "max_players": 10,
            "status": room.status,
            "prize_pool": room.prize_pool,
            "round_number": room.round_number,
            "settings": ROOM_SETTINGS[room.room_type]
        }
        rooms_data.append(room_data)
    
    return {"rooms": rooms_data}

@api_router.post("/join-room")
async def join_room(request: JoinRoomRequest, background_tasks: BackgroundTasks):
    """Join a room with a bet"""
    # Find room of the requested type
    target_room = None
    for room in active_rooms.values():
        if room.room_type == request.room_type and room.status == "waiting":
            target_room = room
            break
    
    if not target_room:
        raise HTTPException(status_code=404, detail="No available room of this type")
    
    # Validate bet amount
    settings = ROOM_SETTINGS[request.room_type]
    if request.bet_amount < settings["min_bet"] or request.bet_amount > settings["max_bet"]:
        raise HTTPException(
            status_code=400, 
            detail=f"Bet amount must be between {settings['min_bet']} and {settings['max_bet']} tokens"
        )
    
    # Check if user exists and has enough tokens
    user_doc = await db.users.find_one({"id": request.user_id})
    if not user_doc:
        raise HTTPException(status_code=404, detail="User not found")
    
    if user_doc.get('token_balance', 0) < request.bet_amount:
        raise HTTPException(status_code=400, detail="Insufficient token balance")
    
    # Check if user is already in the room
    if any(p.user_id == request.user_id for p in target_room.players):
        raise HTTPException(status_code=400, detail="You are already in this room")
    
    # Check if room is full
    if len(target_room.players) >= 2:
        raise HTTPException(status_code=400, detail="Room is full")
    
    # Deduct tokens from user balance
    await db.users.update_one(
        {"id": request.user_id},
        {"$inc": {"token_balance": -request.bet_amount}}
    )
    
    # Add player to room
    player = RoomPlayer(
        user_id=request.user_id,
        username=user_doc['username'],
        bet_amount=request.bet_amount
    )
    target_room.players.append(player)
    target_room.prize_pool += request.bet_amount
    
    # Notify all clients about new player
    await sio.emit('player_joined', {
        'room_id': target_room.id,
        'room_type': target_room.room_type,
        'player': player.dict(),
        'players_count': len(target_room.players),
        'prize_pool': target_room.prize_pool
    })
    
    # Start game if room is full
    if len(target_room.players) == 2:
        background_tasks.add_task(start_game_round, target_room)
    
    return {
        "success": True,
        "room_id": target_room.id,
        "position": len(target_room.players),
        "players_needed": 10 - len(target_room.players)
    }

@api_router.get("/room/{room_id}")
async def get_room_details(room_id: str):
    """Get detailed information about a specific room"""
    room = active_rooms.get(room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    
    return {
        "id": room.id,
        "room_type": room.room_type,
        "players": [p.dict() for p in room.players],
        "status": room.status,
        "prize_pool": room.prize_pool,
        "round_number": room.round_number,
        "settings": ROOM_SETTINGS[room.room_type],
        "winner": room.winner.dict() if room.winner else None
    }

@api_router.get("/leaderboard")
async def get_leaderboard():
    """Get top players by token balance"""
    pipeline = [
        {"$sort": {"token_balance": -1}},
        {"$limit": 10},
        {"$project": {"_id": 0, "username": 1, "token_balance": 1}}
    ]
    
    leaderboard = await db.users.aggregate(pipeline).to_list(10)
    return {"leaderboard": leaderboard}

@api_router.get("/game-history")
async def get_game_history(limit: int = 20):
    """Get recent completed games"""
    games = await db.completed_games.find(
        {}, {"_id": 0}
    ).sort("finished_at", -1).limit(limit).to_list(limit)
    
    return {"games": games}

@api_router.get("/user/{user_id}/prizes")
async def get_user_prizes(user_id: str):
    """Get all prize links won by a specific user"""
    prizes = await db.winner_prizes.find(
        {"user_id": user_id}, {"_id": 0}
    ).sort("won_at", -1).to_list(100)
    
    return {"prizes": prizes}

@api_router.get("/check-winner/{user_id}")
async def check_if_winner(user_id: str):
    """Check if user has any unclaimed prizes"""
    recent_prizes = await db.winner_prizes.find(
        {"user_id": user_id}, {"_id": 0}
    ).sort("won_at", -1).limit(5).to_list(5)
    
    return {"recent_prizes": recent_prizes}

# Include the router
app.include_router(api_router)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount Socket.IO
socket_app = socketio.ASGIApp(sio, app)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("startup")
async def startup_event():
    """Initialize the application"""
    initialize_rooms()
    logger.info("Casino application started")

@app.on_event("shutdown")
async def shutdown_event():
    """Clean up resources"""
    client.close()
    logger.info("Casino application shutdown")

# Export the socket app for uvicorn
app = socket_app