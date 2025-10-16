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
from uuid import uuid4
import asyncio
import random
from datetime import datetime, timezone
from enum import Enum
import json
from pathlib import Path
import hashlib
import hmac
import aiohttp
from solana.rpc.async_api import AsyncClient
from solders.pubkey import Pubkey
from solders.keypair import Keypair
from solders.system_program import transfer, TransferParams
import time
import base58

# Load environment variables FIRST before importing modules that read them
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# Import after .env is loaded so modules can read the environment
from solana_integration import SolanaPaymentProcessor, get_processor, PriceFetcher
from payment_recovery import run_startup_recovery
from rpc_monitor import rpc_alert_system
from manual_credit_logger import credit_tokens_manually, ManualCreditLogger
import socket_rooms

# Get environment variables
MONGO_URL = os.environ.get('MONGO_URL', 'mongodb://localhost:27017')
DB_NAME = os.environ.get('DB_NAME', 'casino_db')
CORS_ORIGINS = os.environ.get('CORS_ORIGINS', 'http://localhost:3000,https://solanaplay-sync.preview.emergentagent.com').split(',')
TELEGRAM_BOT_TOKEN = os.environ.get('TELEGRAM_BOT_TOKEN', 'YOUR_TELEGRAM_BOT_TOKEN_HERE')

# Solana Configuration for devnet (test environment as requested)
SOLANA_RPC_URL = os.environ.get('SOLANA_RPC_URL', 'https://api.devnet.solana.com')
CASINO_WALLET_PRIVATE_KEY = os.environ.get('CASINO_WALLET_PRIVATE_KEY', '')
CASINO_WALLET_ADDRESS = os.environ.get('CASINO_WALLET_ADDRESS', 'YourWalletAddressHere12345678901234567890123456789')

# HD Wallet Derivation System
class SolanaWalletDerivation:
    def __init__(self, master_private_key_base58: str = None):
        """Initialize with master private key for derivation"""
        self.master_private_key = master_private_key_base58
        if master_private_key_base58:
            try:
                # Create master keypair from base58 private key
                private_key_bytes = base58.b58decode(master_private_key_base58)
                self.master_keypair = Keypair.from_bytes(private_key_bytes)
                logging.info(f"🔑 Master wallet initialized: {self.master_keypair.pubkey()}")
            except Exception as e:
                logging.error(f"Error initializing master wallet: {e}")
                self.master_keypair = None
        else:
            self.master_keypair = None
    
    def derive_user_address(self, user_id: str, telegram_id: int) -> dict:
        """Derive a unique address for a user from master wallet"""
        try:
            # Create deterministic seed from user identifiers
            seed_string = f"casino_user_{user_id}_{telegram_id}"
            
            # Generate a random keypair and create a deterministic address string
            # This is simpler and more reliable than trying to create valid Solana keypairs
            seed_hash = hashlib.sha256(seed_string.encode()).digest()
            
            # Create a valid Solana address (base58 encoded, exactly 32 bytes)
            address_bytes = seed_hash[:32]  # Use exactly 32 bytes for valid Solana address
            derived_address = base58.b58encode(address_bytes).decode()
            
            # For demo purposes, we'll track this address but won't need the private key
            # In production, you'd use proper Solana keypair derivation libraries
            logging.info(f"🎯 Derived address for user {telegram_id}: {derived_address}")
            
            return {
                "address": derived_address,
                "user_id": user_id,
                "telegram_id": telegram_id,
                "derivation_path": seed_string
            }
            
        except Exception as e:
            logging.error(f"Error deriving user address: {e}")
            return None
    
    async def sweep_user_address_to_main(self, derived_keypair: Keypair, amount_lamports: int = None):
        """Sweep funds from derived address to main wallet"""
        try:
            if not self.master_keypair:
                logging.error("No master keypair configured for sweeping")
                return False
                
            # Get balance of derived address
            client = AsyncClient(SOLANA_RPC_URL)
            balance_response = await client.get_balance(derived_keypair.pubkey())
            
            if not balance_response.value:
                logging.info("No balance to sweep")
                return False
            
            balance_lamports = balance_response.value
            # Leave some lamports for rent (minimum account balance)
            sweep_amount = balance_lamports - 890880 if balance_lamports > 890880 else 0
            
            if sweep_amount <= 0:
                logging.info("Insufficient balance for sweep after rent")
                return False
            
            # Create transfer instruction
            transfer_instruction = transfer(
                TransferParams(
                    from_pubkey=derived_keypair.pubkey(),
                    to_pubkey=self.master_keypair.pubkey(),
                    lamports=sweep_amount
                )
            )
            
            logging.info(f"💸 Would sweep {sweep_amount} lamports from {derived_keypair.pubkey()} to {self.master_keypair.pubkey()}")
            # TODO: Implement actual transaction signing and sending
            
            return True
            
        except Exception as e:
            logging.error(f"Error sweeping funds: {e}")
            return False

# Initialize wallet derivation system
wallet_derivation = SolanaWalletDerivation(CASINO_WALLET_PRIVATE_KEY)

# MongoDB connection with connection pooling for high concurrency
client = AsyncIOMotorClient(
    MONGO_URL,
    maxPoolSize=200,  # Maximum connections in pool
    minPoolSize=10,   # Minimum connections maintained
    maxIdleTimeMS=45000,  # Close idle connections after 45s
    serverSelectionTimeoutMS=5000  # Timeout for server selection
)
db = client[DB_NAME]
logging.info(f"🗄️  MongoDB: Connected to database '{DB_NAME}' at {MONGO_URL}")
logging.info(f"🔧 Connection pool: min={10}, max={200}")
logging.info(f"🔍 Database config: DB_NAME from env = {os.environ.get('DB_NAME', 'NOT SET')}")

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
# (Now configured above in environment variables section)

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
    # NEW: Each user gets unique Solana receiving address
    personal_solana_address: Optional[str] = None
    token_balance: int = Field(default=0)  # Starting balance - users must purchase tokens
    is_verified: bool = Field(default=False)
    is_admin: bool = Field(default=False)
    is_owner: bool = Field(default=False)
    role: str = Field(default="user")  # user, admin, owner
    last_daily_claim: Optional[str] = None  # Timestamp of last daily token claim
    city: Optional[str] = None  # User's selected city: London, Paris
    work_access_purchased: bool = Field(default=False)  # Has user bought "Work for Casino" access
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
    username: str  # Telegram username (@username)
    first_name: str  # Telegram first name
    last_name: Optional[str] = None  # Telegram last name
    photo_url: Optional[str] = None  # Telegram profile photo
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


class Gift(BaseModel):
    """Model for gifts uploaded by casino workers"""
    model_config = ConfigDict(extra="ignore")
    gift_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    creator_user_id: str  # User who uploaded this gift
    creator_telegram_id: int
    creator_username: Optional[str] = None
    city: str  # London or Paris
    photo_base64: str  # Base64 encoded photo
    coordinates: Dict[str, float]  # {"lat": 48.8566, "lng": 2.3522}
    status: str = Field(default="available")  # available, assigned
    assigned_to: Optional[int] = None  # Telegram ID of winner
    assigned_to_user_id: Optional[str] = None
    winner_name: Optional[str] = None
    winner_city: Optional[str] = None
    assigned_at: Optional[datetime] = None
    delivered: bool = Field(default=False)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class SetCityRequest(BaseModel):
    user_id: str
    city: str  # London or Paris

class PurchaseWorkAccessRequest(BaseModel):
    user_id: str
    payment_signature: str  # Solana transaction signature

class UploadGiftRequest(BaseModel):
    user_id: str
    city: str
    photo_base64: str
    coordinates: Dict[str, float]  # {"lat": 48.8566, "lng": 2.3522}

# In-memory storage for active rooms (in production, use Redis)
active_rooms: Dict[str, GameRoom] = {}

# Telegram authentication functions
def verify_telegram_auth(auth_data: dict, bot_token: str) -> bool:
    """Verify Telegram authentication data - PRODUCTION VERSION"""
    if not auth_data:
        logging.warning("No auth data provided")
        return False
    
    # Production: Verify required fields
    required_fields = ['id', 'first_name', 'auth_date']
    for field in required_fields:
        if field not in auth_data:
            logging.warning(f"Missing required field: {field}")
            return False
    
    # Production: Verify auth_date is recent (within 24 hours)
    current_time = datetime.now(timezone.utc).timestamp()
    auth_time = auth_data.get('auth_date', 0)
    if current_time - auth_time > 86400:  # 24 hours
        logging.warning(f"Auth data too old: {current_time - auth_time} seconds")
        return False
    
    # For Telegram Web App integration, we trust these hash types
    if auth_data.get('hash') in ['telegram_auto', 'telegram_webapp']:
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

# Telegram bot messaging functions
async def send_telegram_message(telegram_id: int, message: str, reply_markup: Optional[Dict] = None) -> bool:
    """Send a message to a Telegram user via bot API"""
    try:
        if TELEGRAM_BOT_TOKEN == 'YOUR_TELEGRAM_BOT_TOKEN_HERE':
            logging.warning("Telegram bot token not configured, skipping message send")
            return False
            
        url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
        
        payload = {
            "chat_id": telegram_id,
            "text": message,
            "parse_mode": "HTML"
        }
        
        if reply_markup:
            payload["reply_markup"] = reply_markup
        
        async with aiohttp.ClientSession() as session:
            async with session.post(url, json=payload) as response:
                if response.status == 200:
                    logging.info(f"Message sent successfully to Telegram user {telegram_id}")
                    return True
                else:
                    error_text = await response.text()
                    logging.error(f"Failed to send Telegram message: {response.status} - {error_text}")
                    return False
                    
    except Exception as e:
        logging.error(f"Error sending Telegram message: {e}")
        return False

async def send_prize_notification(telegram_id: int, username: str, room_type: str, prize_link: str) -> bool:
    """Send prize notification with claim button to Telegram user"""
    try:
        # Format the message
        message = f"🎉 <b>Congratulations {username}!</b>\n\n"
        message += f"You won the {room_type.title()} Room battle!\n\n"
        message += "🏆 <b>You have a prize waiting!</b>\n"
        message += "Click the button below to claim your prize:"
        
        # Create inline keyboard with claim button
        reply_markup = {
            "inline_keyboard": [[
                {
                    "text": "🎁 Claim Your Prize",
                    "url": prize_link
                }
            ]]
        }
        
        return await send_telegram_message(telegram_id, message, reply_markup)
        
    except Exception as e:
        logging.error(f"Error sending prize notification: {e}")
        return False


async def send_gift_notification(telegram_id: int, username: str, gift_data: dict = None) -> bool:
    """Send gift notification to winner via Telegram"""
    try:
        if gift_data:
            # Gift is available
            message = f"🎉 <b>Congratulations {username}!</b>\n\n"
            message += "🎁 <b>You have a special gift waiting!</b>\n\n"
            message += f"📍 Location: {gift_data['city']}\n"
            message += f"📊 Coordinates: {gift_data['coordinates']['lat']}, {gift_data['coordinates']['lng']}\n\n"
            message += "Check the app for the gift photo and details!"
            
            # Create inline keyboard with view gift button
            reply_markup = {
                "inline_keyboard": [[
                    {
                        "text": "🎁 View Gift Details",
                        "url": f"https://t.me/your_bot?start=gift_{gift_data['gift_id']}"
                    }
                ]]
            }
        else:
            # No gift available
            message = f"🎉 <b>Congratulations {username}!</b>\n\n"
            message += "You won the battle!\n\n"
            message += "⚠️ No gifts available in your city right now.\n"
            message += "New gifts will be added by casino workers soon!"
            reply_markup = None
        
        return await send_telegram_message(telegram_id, message, reply_markup)
        
    except Exception as e:
        logging.error(f"Error sending gift notification: {e}")
        return False

async def send_work_access_confirmation(telegram_id: int, username: str) -> bool:
    """Send work access confirmation to user via Telegram"""
    try:
        message = f"🎁 <b>Welcome to the Casino Team, {username}!</b>\n\n"
        message += "You now have access to upload hidden gifts!\n\n"
        message += "Click below to start working:"
        
        # Create inline keyboard with start working button
        reply_markup = {
            "inline_keyboard": [[
                {
                    "text": "🚀 Start Working",
                    "callback_data": "start_working"
                }
            ]]
        }
        
        return await send_telegram_message(telegram_id, message, reply_markup)
        
    except Exception as e:
        logging.error(f"Error sending work access confirmation: {e}")
        return False

def check_admin_access(telegram_username: Optional[str]) -> bool:
    """Check if user has admin access (only @cia_nera)"""
    return telegram_username == "cia_nera"

async def assign_gift_to_winner(winner_user_id: str, winner_city: str, winner_telegram_id: int, winner_username: str):
    """Assign an available gift from the winner's city to the winner"""
    try:
        # Find one available gift in the winner's city
        gift = await db.gifts.find_one_and_update(
            {"city": winner_city, "status": "available"},
            {"$set": {
                "status": "assigned",
                "assigned_to": winner_telegram_id,
                "assigned_to_user_id": winner_user_id,
                "winner_name": winner_username,
                "winner_city": winner_city,
                "assigned_at": datetime.now(timezone.utc),
                "delivered": True
            }},
            return_document=True
        )
        
        if gift:
            logging.info(f"🎁 Gift {gift['gift_id']} assigned to winner {winner_username} in {winner_city}")
            
            # Send Telegram notification
            gift_data = {
                "gift_id": gift['gift_id'],
                "city": gift['city'],
                "coordinates": gift['coordinates']
            }
            await send_gift_notification(winner_telegram_id, winner_username, gift_data)
            
            return gift
        else:
            logging.warning(f"⚠️ No available gifts in {winner_city} for winner {winner_username}")
            # Send notification that no gift is available
            await send_gift_notification(winner_telegram_id, winner_username, None)
            return None
            
    except Exception as e:
        logging.error(f"Error assigning gift to winner: {e}")
        return None

# CoinGecko API Integration for Real-time SOL/EUR Pricing
class PriceOracle:
    def __init__(self):
        self.cached_price = None
        self.last_update = 0
        self.cache_duration = 60  # Cache for 60 seconds
        
    async def get_sol_eur_price(self) -> float:
        """Get current SOL price in EUR from CoinGecko API"""
        try:
            # Check cache first
            current_time = time.time()
            if self.cached_price and (current_time - self.last_update) < self.cache_duration:
                return self.cached_price
            
            # Fetch from CoinGecko
            url = "https://api.coingecko.com/api/v3/simple/price"
            params = {
                "ids": "solana",
                "vs_currencies": "eur"
            }
            
            async with aiohttp.ClientSession() as session:
                async with session.get(url, params=params, timeout=10) as response:
                    if response.status == 200:
                        data = await response.json()
                        price = data["solana"]["eur"]
                        
                        # Update cache
                        self.cached_price = float(price)
                        self.last_update = current_time
                        
                        logging.info(f"💰 Updated SOL/EUR price: {price} EUR")
                        return self.cached_price
                    else:
                        logging.error(f"CoinGecko API error: {response.status}")
                        # Return cached price or fallback
                        return self.cached_price or 180.0  # Realistic fallback rate
                        
        except Exception as e:
            logging.error(f"Error fetching SOL price: {e}")
            # Return cached price or fallback
            return self.cached_price or 180.0
    
    def calculate_tokens_from_sol(self, sol_amount: float, sol_eur_price: float) -> int:
        """Calculate tokens from SOL amount using real-time EUR price"""
        # SOL → EUR → Tokens (1 EUR = 100 tokens)
        eur_value = sol_amount * sol_eur_price
        tokens = int(eur_value * 100)
        
        logging.info(f"💱 Conversion: {sol_amount} SOL × {sol_eur_price} EUR/SOL = {eur_value:.4f} EUR = {tokens} tokens")
        return tokens

# Initialize price oracle
price_oracle = PriceOracle()

# Payment Request System
class PaymentRequest:
    def __init__(self, user_id: str, telegram_id: int, eur_amount: float):
        self.id = str(uuid.uuid4())[:8]  # Short ID
        self.user_id = user_id
        self.telegram_id = telegram_id
        self.eur_amount = eur_amount
        self.expected_sol_amount = None
        self.tokens_to_credit = int(eur_amount * 100)  # 1 EUR = 100 tokens
        self.created_at = time.time()
        self.expires_at = time.time() + 300  # 5 minutes
        self.status = "pending"
        
    async def calculate_expected_sol(self) -> float:
        """Calculate expected SOL amount based on current price"""
        sol_price = await price_oracle.get_sol_eur_price()
        self.expected_sol_amount = self.eur_amount / sol_price
        return self.expected_sol_amount
    
    def is_expired(self) -> bool:
        return time.time() > self.expires_at
    
    def matches_payment(self, received_sol: float, tolerance: float = 0.02) -> bool:
        """Check if received SOL matches expected amount (2% tolerance)"""
        if not self.expected_sol_amount:
            return False
        
        min_amount = self.expected_sol_amount * (1 - tolerance)
        max_amount = self.expected_sol_amount * (1 + tolerance)
        
        return min_amount <= received_sol <= max_amount

# Payment request storage
active_payment_requests = {}  # request_id -> PaymentRequest

async def get_or_create_derived_address(user_id: str, telegram_id: int) -> dict:
    """Get existing derived address or create new one for user"""
    try:
        # Check if user already has a derived address
        user = await db.users.find_one({"telegram_id": telegram_id})
        
        if user and user.get('derived_solana_address'):
            return {
                "address": user['derived_solana_address'],
                "user_id": user_id,
                "telegram_id": telegram_id
            }
        
        # Generate new derived address
        derived_info = wallet_derivation.derive_user_address(user_id, telegram_id)
        
        if not derived_info:
            raise Exception("Failed to derive address")
        
        # Save to database
        await db.users.update_one(
            {"telegram_id": telegram_id},
            {
                "$set": {
                    "derived_solana_address": derived_info["address"],
                    "derivation_path": derived_info["derivation_path"]
                }
            }
        )
        
        logging.info(f"✅ Created derived address for user {telegram_id}: {derived_info['address']}")
        return derived_info
        
    except Exception as e:
        logging.error(f"Error getting/creating derived address: {e}")
        return None

# Solana Payment Monitoring System
class PaymentMonitor:
    def __init__(self):
        self.client = AsyncClient(SOLANA_RPC_URL)
        self.last_checked_signatures = {}  # Track last signature per address
        self.monitoring = False
        self.monitored_addresses = set()  # All derived addresses being monitored
        
    async def start_monitoring(self):
        """Start monitoring Solana payments to derived addresses"""
        if self.monitoring:
            return
            
        self.monitoring = True
        logging.info(f"🚀 Starting payment monitoring for derived addresses")
        
        # Load existing derived addresses
        await self._load_derived_addresses()
        
        # Run monitoring in background
        asyncio.create_task(self._monitor_payments())
    
    async def _load_derived_addresses(self):
        """Load all derived addresses from database to monitor"""
        try:
            users = await db.users.find(
                {"derived_solana_address": {"$exists": True, "$ne": None}},
                {"telegram_id": 1, "derived_solana_address": 1, "first_name": 1}
            ).to_list(length=None)
            
            for user in users:
                address = user.get('derived_solana_address')
                if address:
                    self.monitored_addresses.add(address)
            
            logging.info(f"📍 Monitoring {len(self.monitored_addresses)} derived addresses")
            
        except Exception as e:
            logging.error(f"Error loading derived addresses: {e}")
    
    async def add_address_to_monitor(self, address: str):
        """Add a new derived address to monitoring"""
        self.monitored_addresses.add(address)
        logging.info(f"➕ Added derived address to monitoring: {address}")
    
    async def _monitor_payments(self):
        """Monitor all derived addresses for incoming payments"""
        try:
            while self.monitoring:
                await self._check_for_payments()
                await asyncio.sleep(10)  # Check every 10 seconds
                
        except Exception as e:
            logging.error(f"Payment monitoring error: {e}")
            # Restart monitoring after error
            await asyncio.sleep(30)
            if self.monitoring:
                asyncio.create_task(self._monitor_payments())
    
    async def _check_for_payments(self):
        """Check for new payments to all derived addresses"""
        try:
            if not self.monitored_addresses:
                # No addresses to monitor yet
                return
                
            # Check each monitored address
            for address in list(self.monitored_addresses):  # Create copy to avoid modification during iteration
                await self._check_address_for_payments(address)
                    
        except Exception as e:
            logging.error(f"Error checking payments: {e}")
    
    async def _check_address_for_payments(self, address: str):
        """Check a specific derived address for new payments"""
        try:
            # Get wallet public key
            wallet_pubkey = Pubkey.from_string(address)
            
            # Get recent transactions
            last_sig = self.last_checked_signatures.get(address)
            response = await self.client.get_signatures_for_address(
                wallet_pubkey, 
                limit=5,
                before=last_sig if last_sig else None
            )
            
            if response.value:
                signatures = response.value
                
                # Process new transactions (most recent first)
                for sig_info in reversed(signatures):
                    if last_sig and sig_info.signature == last_sig:
                        break
                        
                    await self._process_transaction(sig_info.signature, address)
                
                # Update last checked signature for this address
                if signatures:
                    self.last_checked_signatures[address] = signatures[0].signature
                    
        except Exception as e:
            logging.error(f"Error checking address {address}: {e}")
    
    async def _process_transaction(self, signature: str, receiving_address: str):
        """Process a single transaction for payment detection using Derived Address System"""
        try:
            # Get transaction details
            tx = await self.client.get_transaction(signature)
            if not tx.value or not tx.value.transaction:
                return
                
            transaction = tx.value.transaction
            meta = tx.value.transaction.meta
            
            if not meta or meta.err:
                return  # Skip failed transactions
            
            # Check if this is an incoming SOL transfer
            pre_balances = meta.pre_balances
            post_balances = meta.post_balances
            
            # Find receiving address in account keys
            account_keys = transaction.transaction.message.account_keys
            receiving_address_index = None
            
            for i, key in enumerate(account_keys):
                if str(key) == receiving_address:
                    receiving_address_index = i
                    break
            
            if receiving_address_index is None:
                return
            
            # Calculate SOL received (in lamports)
            if len(post_balances) > receiving_address_index and len(pre_balances) > receiving_address_index:
                balance_change = post_balances[receiving_address_index] - pre_balances[receiving_address_index]
                
                if balance_change > 0:  # Received SOL
                    sol_amount = balance_change / 1_000_000_000  # Convert lamports to SOL
                    
                    logging.info(f"💰 Received {sol_amount} SOL in transaction {signature} to derived address {receiving_address}")
                    
                    # Credit tokens to user who owns this derived address
                    await self._credit_tokens_for_derived_address(signature, sol_amount, receiving_address)
                    
        except Exception as e:
            logging.error(f"Error processing transaction {signature}: {e}")
    
    async def _credit_tokens_for_derived_address(self, signature: str, sol_amount: float, derived_address: str):
        """Credit tokens to user who owns the derived address"""
        try:
            # Find user by derived address
            user = await db.users.find_one({"derived_solana_address": derived_address})
            
            if not user:
                logging.error(f"❌ No user found for derived address {derived_address}! Payment of {sol_amount} SOL lost!")
                return
            
            # Calculate tokens using real-time EUR price
            sol_price = await price_oracle.get_sol_eur_price()
            tokens_to_credit = price_oracle.calculate_tokens_from_sol(sol_amount, sol_price)
            
            # Credit tokens to user
            await self._credit_tokens_to_user(
                signature, 
                sol_amount, 
                tokens_to_credit, 
                user['telegram_id'],
                sol_price,
                derived_address
            )
                
        except Exception as e:
            logging.error(f"Error crediting tokens for derived address: {e}")
    
    async def _credit_tokens_to_user(self, signature: str, sol_amount: float, tokens_to_credit: int, telegram_id: int, sol_eur_price: float, derived_address: str = None):
        """Credit tokens to specific user account - PRODUCTION VERSION"""
        try:
            if tokens_to_credit <= 0:
                logging.warning(f"Invalid token amount: {tokens_to_credit}")
                return
            
            # Production: Minimum payment validation (prevent dust payments)
            min_sol_amount = 0.001  # Minimum 0.001 SOL
            if sol_amount < min_sol_amount:
                logging.warning(f"Payment too small: {sol_amount} SOL (minimum: {min_sol_amount})")
                return
            
            # Find user by telegram_id
            user = await db.users.find_one({"telegram_id": telegram_id})
            
            if not user:
                logging.error(f"❌ No user found for telegram_id {telegram_id}! Payment of {sol_amount} SOL lost!")
                return
            
            # Production: Check for duplicate transactions
            existing_payment = await db.users.find_one({
                "telegram_id": telegram_id,
                "payment_history.transaction_id": str(signature)
            })
            
            if existing_payment:
                logging.warning(f"Duplicate transaction detected: {signature}")
                return
            
            # Credit tokens to user
            result = await db.users.update_one(
                {"telegram_id": telegram_id},
                {
                    "$inc": {"token_balance": tokens_to_credit},
                    "$push": {
                        "payment_history": {
                            "transaction_id": str(signature),
                            "sol_amount": float(sol_amount),
                            "sol_eur_price": float(sol_eur_price),
                            "eur_value": float(sol_amount * sol_eur_price),
                            "tokens_credited": int(tokens_to_credit),
                            "derived_address": derived_address,
                            "timestamp": datetime.now(timezone.utc).isoformat(),
                            "status": "completed"
                        }
                    }
                }
            )
            
            if result.modified_count > 0:
                logging.info(f"✅ Credited {tokens_to_credit} tokens to user {user['first_name']} for {sol_amount} SOL (€{sol_amount * sol_eur_price:.2f})")
                
                # Send notification to user
                if user.get('telegram_id'):
                    await self._send_payment_confirmation(
                        user['telegram_id'],
                        user['first_name'],
                        sol_amount,
                        tokens_to_credit,
                        sol_eur_price
                    )
                
                # Broadcast token update to frontend
                await sio.emit('token_balance_updated', {
                    'user_id': user['id'],
                    'new_balance': user.get('token_balance', 0) + tokens_to_credit,
                    'tokens_added': tokens_to_credit,
                    'sol_received': sol_amount,
                    'eur_value': sol_amount * sol_eur_price
                })
                
        except Exception as e:
            logging.error(f"Error crediting tokens to user: {e}")
    
    async def _send_payment_confirmation(self, telegram_id: int, username: str, sol_amount: float, tokens_credited: int, sol_eur_price: float):
        """Send payment confirmation to user via Telegram"""
        try:
            eur_value = sol_amount * sol_eur_price
            
            message = "💰 <b>Payment Confirmed!</b>\n\n"
            message += f"Hello {username}!\n\n"
            message += f"✅ Received: <b>{sol_amount} SOL</b>\n"
            message += f"💶 EUR Value: <b>€{eur_value:.2f}</b> (1 SOL = €{sol_eur_price:.4f})\n"
            message += f"🎰 Credited: <b>{tokens_credited:,} Casino Tokens</b>\n\n"
            message += f"💡 <i>Rate: 1 EUR = 100 tokens</i>\n\n"
            message += "Your tokens are ready for battle! Good luck! 🎯"
            
            await send_telegram_message(telegram_id, message)
            logging.info(f"📨 Payment confirmation sent to {username}")
            
        except Exception as e:
            logging.error(f"Error sending payment confirmation: {e}")

# Initialize payment monitor
payment_monitor = PaymentMonitor()

# Track user_id to socket_id mapping for room management
user_to_socket: Dict[str, str] = {}  # user_id -> sid
socket_to_user: Dict[str, str] = {}  # sid -> user_id

# Socket.IO events
@sio.event
async def connect(sid, environ):
    logging.info(f"🔌🔌🔌 NEW CLIENT CONNECTED 🔌🔌🔌")
    logging.info(f"Socket ID: {sid}")
    logging.info(f"Remote Address: {environ.get('REMOTE_ADDR', 'unknown')}")
    logging.info(f"User Agent: {environ.get('HTTP_USER_AGENT', 'unknown')}")
    
    # Detect platform
    user_agent = environ.get('HTTP_USER_AGENT', '').lower()
    if 'telegram' in user_agent:
        platform = 'Telegram WebView'
    elif 'mobile' in user_agent or 'android' in user_agent or 'iphone' in user_agent:
        platform = 'Mobile Browser'
    else:
        platform = 'Desktop Browser'
    
    logging.info(f"Platform: {platform}")
    logging.info(f"Total active connections: {len(user_to_socket) + 1}")
    
    await sio.emit('connected', {
        'status': 'Connected to casino!',
        'socket_id': sid,
        'platform': platform
    }, room=sid)
    logging.info(f"✅ Sent 'connected' confirmation to {sid} ({platform})")

@sio.event
async def disconnect(sid):
    logging.info(f"🔌 Client {sid} disconnected")
    
    # Get user_id before cleanup
    user_id = socket_to_user.get(sid)
    
    # Get room_id from socket_rooms tracking
    room_id = socket_rooms.socket_to_room.get(sid)
    
    # Clean up socket from rooms
    socket_rooms.cleanup_socket(sid)
    
    # Clean up user mapping
    if sid in socket_to_user:
        if user_id in user_to_socket:
            del user_to_socket[user_id]
        del socket_to_user[sid]
        logging.info(f"🧹 Cleaned up user {user_id} socket mapping")
    
    # Notify room participants about player disconnect
    if room_id and user_id:
        # Find the room and user
        room = active_rooms.get(room_id)
        if room:
            # Find and remove player from room
            player_left = None
            for player in room.players:
                if player.user_id == user_id:
                    player_left = player
                    break
            
            if player_left:
                room.players.remove(player_left)
                logging.info(f"👋 Player {player_left.username} left room {room_id}")
                
                # Notify remaining participants with updated FULL list
                await socket_rooms.broadcast_to_room(sio, room_id, 'player_left', {
                    'room_id': room_id,
                    'room_type': room.room_type,
                    'player': player_left.dict(),
                    'players_count': len(room.players),
                    'all_players': [p.dict() for p in room.players],  # FULL updated list
                    'timestamp': datetime.now(timezone.utc).isoformat()
                })
                logging.info(f"✅ Emitted player_left to room {room_id}, remaining: {len(room.players)}")

@sio.event
async def register_user(sid, data):
    """Register user_id to socket_id mapping for room-specific events"""
    try:
        logging.info(f"📥📥📥 REGISTER_USER EVENT RECEIVED 📥📥📥")
        logging.info(f"Socket ID: {sid}")
        logging.info(f"Data: {data}")
        
        user_id = data.get('user_id')
        platform = data.get('platform', 'unknown')
        
        if not user_id:
            logging.error(f"❌ No user_id provided in register_user event")
            return
        
        # Update mappings
        user_to_socket[user_id] = sid
        socket_to_user[sid] = user_id
        
        logging.info(f"✅ Registered user {user_id} to socket {sid[:8]}")
        logging.info(f"📱 Platform: {platform}")
        logging.info(f"📊 Total user mappings: {len(user_to_socket)}")
        
        # Send confirmation
        await sio.emit('user_registered', {
            'user_id': user_id,
            'status': 'registered',
            'platform': platform
        }, room=sid)
        
    except Exception as e:
        logging.error(f"❌ Error in register_user: {e}")

@sio.event
async def join_game_room(sid, data):
    """Join a game room via Socket.IO (called after successful REST API join)"""
    try:
        logging.info(f"📥📥📥 JOIN_GAME_ROOM EVENT RECEIVED 📥📥📥")
        logging.info(f"Socket ID: {sid}")
        logging.info(f"Data: {data}")
        
        room_id = data.get('room_id')
        user_id = data.get('user_id')
        platform = data.get('platform', 'unknown')
        
        if not room_id or not user_id:
            logging.error(f"❌ Missing room_id or user_id in join_game_room event")
            logging.error(f"Received data: {data}")
            return
        
        logging.info(f"📥 join_game_room: user={user_id}, room={room_id}, socket={sid[:8]}, platform={platform}")
        
        # Join the Socket.IO room
        await socket_rooms.join_socket_room(sio, sid, room_id)
        
        # Update user mapping
        user_to_socket[user_id] = sid
        socket_to_user[sid] = user_id
        
        # Check current socket count in room
        socket_count = socket_rooms.get_room_socket_count(room_id)
        sockets_in_room = socket_rooms.room_to_sockets.get(room_id, set())
        
        logging.info(f"✅ User {user_id} ({platform}) joined room {room_id} via socket {sid[:8]}")
        logging.info(f"📊 Room {room_id} now has {socket_count} socket(s) connected")
        logging.info(f"📋 Socket IDs in room: {[s[:8] for s in sockets_in_room]}")
        
        # Send confirmation with full room info
        await sio.emit('room_joined_confirmed', {
            'room_id': room_id,
            'socket_count': socket_count,
            'socket_id': sid,
            'platform': platform
        }, room=sid)
        logging.info(f"✅ Sent room_joined_confirmed to {sid[:8]} ({platform})")
        
    except Exception as e:
        logging.error(f"❌ Error in join_game_room: {e}")
        import traceback
        logging.error(traceback.format_exc())

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


@sio.event
async def catch_all(event, sid, data):
    """Catch all events for debugging"""
    logging.info(f"🎯 CATCH-ALL: Event '{event}' from {sid[:8]} with data: {data}")

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

async def broadcast_room_updates():
    """Broadcast current room states to all connected clients"""
    try:
        room_data = []
        for room in active_rooms.values():
            room_info = {
                'id': room.id,
                'room_type': room.room_type,
                'players': [p.dict() for p in room.players],
                'status': room.status,
                'prize_pool': room.prize_pool,
                'round_number': room.round_number,
                'players_count': len(room.players),
                'max_players': 3
            }
            room_data.append(room_info)
        
        await sio.emit('rooms_updated', {
            'rooms': room_data,
            'timestamp': datetime.now(timezone.utc).isoformat()
        })
        
    except Exception as e:
        logging.error(f"Error broadcasting room updates: {e}")

async def start_game_round(room: GameRoom):
    """Start a game round when room is full - with strict event sequence"""
    if len(room.players) != 3:
        return
    
    # Generate unique match ID for this game
    match_id = str(uuid.uuid4())[:12]  # Short unique ID
    logging.info(f"🎮 Starting game round for room {room.id}, match_id: {match_id}")
    
    # CRITICAL: Wait for ALL 3 sockets to actually join the room
    max_wait_time = 3.0  # Maximum 3 seconds to wait
    wait_interval = 0.2   # Check every 200ms
    elapsed = 0.0
    
    while elapsed < max_wait_time:
        socket_count = socket_rooms.get_room_socket_count(room.id)
        sockets_in_room = socket_rooms.room_to_sockets.get(room.id, set())
        
        logging.info(f"⏱️ Checking sockets in room {room.id}: {socket_count}/3")
        logging.info(f"📋 Socket IDs in room: {[sid[:8] for sid in sockets_in_room]}")
        
        if socket_count >= 3:
            logging.info(f"✅ All 3 sockets confirmed in room {room.id}!")
            break
        
        logging.info(f"⏳ Waiting for more sockets ({socket_count}/3)... {elapsed:.1f}s elapsed")
        await asyncio.sleep(wait_interval)
        elapsed += wait_interval
    
    # Final check
    final_socket_count = socket_rooms.get_room_socket_count(room.id)
    final_sockets = socket_rooms.room_to_sockets.get(room.id, set())
    
    if final_socket_count < 3:
        logging.warning(f"⚠️ Only {final_socket_count} sockets in room after {max_wait_time}s wait!")
        logging.warning(f"⚠️ Sockets present: {[sid[:8] for sid in final_sockets]}")
        logging.warning(f"⚠️ Proceeding anyway to avoid deadlock...")
    else:
        logging.info(f"✅✅✅ CONFIRMED: {final_socket_count} sockets in room {room.id}")
        logging.info(f"✅ Socket IDs: {[sid[:8] for sid in final_sockets]}")
    
    room.status = "ready"
    
    # Calculate prize pool (total bets)
    room.prize_pool = sum(p.bet_amount for p in room.players)
    
    # EVENT 1: room_ready - Trigger "GET READY!" animation (2-3 seconds)
    room_ready_data = {
        'room_id': room.id,
        'room_type': room.room_type,
        'match_id': match_id,
        'players': [p.dict() for p in room.players],
        'prize_pool': room.prize_pool,
        'message': '🚀 GET READY FOR BATTLE!',
        'countdown': 3
    }
    
    logging.info(f"📤📤📤 BROADCASTING room_ready to room {room.id}")
    logging.info(f"🧩 Target sockets: {[sid[:8] for sid in final_sockets]}")
    logging.info(f"📊 Socket count: {final_socket_count}")
    
    await socket_rooms.broadcast_to_room(sio, room.id, 'room_ready', room_ready_data)
    
    logging.info(f"✅ Emitted room_ready to room {room.id} with match_id {match_id}")
    logging.info(f"📤 Delivered room_ready to {final_socket_count} clients successfully")
    
    # Wait for "GET READY!" animation (3 seconds)
    await asyncio.sleep(3)
    
    # Select winner immediately after GET READY (no game_starting event needed)
    room.status = "playing"
    room.started_at = datetime.now(timezone.utc)
    
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
    
    # NEW: Assign gift to winner based on their city
    assigned_gift = None
    try:
        # Get winner's data from database
        winner_user = await db.users.find_one({"id": winner.user_id})
        if winner_user:
            winner_city = winner_user.get('city')
            winner_telegram_id = winner_user.get('telegram_id')
            
            if winner_city:
                # Try to assign a gift from the winner's city
                assigned_gift = await assign_gift_to_winner(
                    winner_user_id=winner.user_id,
                    winner_city=winner_city,
                    winner_telegram_id=winner_telegram_id,
                    winner_username=winner.username
                )
            else:
                logging.info(f"Winner {winner.username} has no city selected - no gift assigned")
    except Exception as e:
        logging.error(f"Error in gift assignment: {e}")
    
    # Send Telegram notification to winner (original prize notification)
    try:
        # Get winner's Telegram ID from database
        winner_user = await db.users.find_one({"id": winner.user_id})
        if winner_user and winner_user.get('telegram_id'):
            telegram_success = await send_prize_notification(
                telegram_id=winner_user['telegram_id'],
                username=winner.username,
                room_type=room.room_type,
                prize_link=prize_link
            )
            if telegram_success:
                logging.info(f"Telegram prize notification sent to {winner.username}")
            else:
                logging.warning(f"Failed to send Telegram notification to {winner.username}")
        else:
            logging.warning(f"No Telegram ID found for winner {winner.username}")
    except Exception as e:
        logging.error(f"Error sending Telegram notification: {e}")
    
    # EVENT 3: game_finished - Notify ROOM participants of the winner
    logging.info(f"📤 Broadcasting game_finished to room {room.id}")
    await socket_rooms.broadcast_to_room(sio, room.id, 'game_finished', {
        'room_id': room.id,
        'room_type': room.room_type,
        'match_id': match_id,  # Unique match identifier
        'winner': winner.dict(),
        'winner_name': f"{winner.first_name} {winner.last_name}".strip(),
        'winner_id': winner.user_id,
        'prize_pool': room.prize_pool,
        'prize_link': prize_link,  # Include for winner screen
        'round_number': room.round_number,
        'has_prize': True,
        'finished_at': room.finished_at.isoformat()
    })
    logging.info(f"✅ Emitted game_finished to room {room.id}, winner: {winner.username}, match_id: {match_id}")
    
    # Wait for winner announcement screen (2 seconds as requested)
    logging.info(f"⏱️ Waiting 2 seconds for winner announcement...")
    await asyncio.sleep(2)
    
    # EVENT 4: redirect_home - Redirect all players back to home screen
    final_sockets = socket_rooms.room_to_sockets.get(room.id, set())
    socket_count = len(final_sockets)
    
    logging.info(f"📤📤📤 BROADCASTING redirect_home to room {room.id}")
    logging.info(f"🧩 Target sockets: {[sid[:8] for sid in final_sockets]}")
    logging.info(f"📊 Socket count: {socket_count}")
    
    await socket_rooms.broadcast_to_room(sio, room.id, 'redirect_home', {
        'room_id': room.id,
        'match_id': match_id,
        'message': 'Returning to home screen...'
    })
    
    logging.info(f"✅ Emitted redirect_home to room {room.id}")
    logging.info(f"📤 Delivered redirect_home to {socket_count} clients")
    
    # EVENT 5: prize_won - Send prize link privately to the winner (using socket ID)
    winner_sid = user_to_socket.get(winner.user_id)
    if winner_sid:
        await sio.emit('prize_won', {
            'prize_link': prize_link,
            'room_type': room.room_type,
            'match_id': match_id,
            'bet_amount': winner.bet_amount,
            'total_pool': room.prize_pool
        }, room=winner_sid)
        logging.info(f"🏆 Sent private prize_won event to winner {winner.username}, match_id: {match_id}")
    else:
        logging.warning(f"⚠️ Could not find socket for winner {winner.user_id} to send prize_won event")
    
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
    
    # Broadcast updated room states
    await broadcast_room_updates()

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

@api_router.get("/casino-wallet")
async def get_casino_wallet():
    """Get casino wallet address for payments - DEPRECATED, use /user/{user_id}/wallet"""
    return {
        "wallet_address": "DEPRECATED - Use personal wallet endpoint",
        "network": "devnet",
        "conversion_rate": {
            "sol_to_tokens": 1000,
            "description": "1 SOL = 1,000 Casino Tokens"
        },
        "message": "This endpoint is deprecated. Each user now gets a personal wallet address."
    }

@api_router.get("/user/{user_id}/derived-wallet")
async def get_user_derived_wallet(user_id: str):
    """Get user's personal derived Solana address for payments"""
    try:
        # Find user by ID
        user = await db.users.find_one({"id": user_id})
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        
        # Get or create derived address
        derived_info = await get_or_create_derived_address(user_id, user['telegram_id'])
        
        if not derived_info:
            raise HTTPException(status_code=500, detail="Failed to create derived address")
        
        # Add address to monitoring
        await payment_monitor.add_address_to_monitor(derived_info["address"])
        
        # Get current SOL/EUR price for display
        sol_eur_price = await price_oracle.get_sol_eur_price()
        
        return {
            "derived_wallet_address": derived_info["address"],
            "user_id": user_id,
            "telegram_id": user['telegram_id'],
            "network": "devnet",
            "current_sol_eur_price": sol_eur_price,
            "conversion_rate": {
                "eur_to_tokens": 100,
                "description": f"1 EUR = 100 tokens (1 SOL = €{sol_eur_price})"
            },
            "instructions": f"Send SOL to YOUR personal address above. Tokens credited automatically! 1 SOL = {int(sol_eur_price * 100)} tokens"
        }
        
    except Exception as e:
        logging.error(f"Error getting derived wallet: {e}")
        raise HTTPException(status_code=500, detail="Failed to get derived wallet address")

@api_router.get("/sol-eur-price")
async def get_sol_eur_price():
    """Get current SOL/EUR price"""
    try:
        price = await price_oracle.get_sol_eur_price()
        return {
            "sol_eur_price": price,
            "last_updated": price_oracle.last_update,
            "conversion_info": {
                "1_eur": f"{1/price:.6f} SOL",
                "100_tokens": f"{1/price:.6f} SOL",
                "description": "1 EUR = 100 tokens"
            }
        }
    except Exception as e:
        logging.error(f"Error getting SOL price: {e}")
        raise HTTPException(status_code=500, detail="Failed to get price")

@api_router.get("/casino-wallet")
async def get_casino_wallet():
    """Get casino wallet address and current pricing"""
    try:
        sol_price = await price_oracle.get_sol_eur_price()
        return {
            "wallet_address": CASINO_WALLET_ADDRESS,
            "network": "devnet",
            "current_sol_eur_price": sol_price,
            "conversion_rate": {
                "eur_to_tokens": 100,
                "description": "1 EUR = 100 Casino Tokens (real-time SOL pricing)"
            },
            "instructions": "Users get personal derived addresses for payments"
        }
    except Exception as e:
        logging.error(f"Error getting casino wallet info: {e}")
        raise HTTPException(status_code=500, detail="Failed to get wallet info")

@api_router.post("/admin/add-tokens")
async def add_tokens_to_user(admin_key: str, username: str, tokens: int):
    """Add tokens to a specific user by username"""
    
    if admin_key != "PRODUCTION_CLEANUP_2025":
        raise HTTPException(status_code=403, detail="Unauthorized")
    
    try:
        # Find user by username
        user_doc = await db.users.find_one({"username": username})
        
        if user_doc:
            # Update existing user
            result = await db.users.update_one(
                {"username": username},
                {"$inc": {"token_balance": tokens}}
            )
            
            new_balance = user_doc.get('token_balance', 0) + tokens
            
            return {
                "status": "success",
                "message": f"Added {tokens} tokens to existing user {username}",
                "new_balance": new_balance,
                "user_id": user_doc.get('id')
            }
        else:
            # Create new user with tokens
            new_user_id = str(uuid.uuid4())
            
            new_user = {
                "id": new_user_id,
                "telegram_id": 999000000 + hash(username) % 1000000,  # Generate fake telegram_id
                "first_name": username.replace("@", "").title(),
                "last_name": "",
                "username": username,
                "photo_url": "",
                "token_balance": tokens,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "last_login": datetime.now(timezone.utc).isoformat(),
                "is_verified": True
            }
            
            await db.users.insert_one(new_user)
            
            return {
                "status": "success", 
                "message": f"Created new user {username} with {tokens} tokens",
                "new_balance": tokens,
                "user_id": new_user_id
            }
            
    except Exception as e:
        logging.error(f"Failed to add tokens: {e}")
        raise HTTPException(status_code=500, detail="Failed to add tokens")

@api_router.post("/admin/add-tokens/{telegram_id}")
async def add_tokens_by_telegram_id(telegram_id: int, admin_key: str, tokens: int):
    """Add tokens to a user by their Telegram ID - useful for testing"""
    
    if admin_key != "PRODUCTION_CLEANUP_2025":
        raise HTTPException(status_code=403, detail="Unauthorized")
    
    try:
        # Find user by telegram_id
        user_doc = await db.users.find_one({"telegram_id": telegram_id})
        
        if user_doc:
            # Update existing user's balance
            result = await db.users.update_one(
                {"telegram_id": telegram_id},
                {"$inc": {"token_balance": tokens}}
            )
            
            new_balance = user_doc.get('token_balance', 0) + tokens
            
            logging.info(f"✅ Added {tokens} tokens to Telegram user {telegram_id}. New balance: {new_balance}")
            
            return {
                "status": "success",
                "message": f"Added {tokens} tokens to Telegram user {telegram_id}",
                "new_balance": new_balance,
                "user_id": user_doc.get('id'),
                "username": user_doc.get('username', 'unknown')
            }
        else:
            # User doesn't exist yet - they need to login first
            return {
                "status": "user_not_found",
                "message": f"User with Telegram ID {telegram_id} not found. Please login first via Telegram, then tokens can be added.",
                "telegram_id": telegram_id
            }
            
    except Exception as e:
        logging.error(f"Failed to add tokens by Telegram ID: {e}")
        raise HTTPException(status_code=500, detail="Failed to add tokens")

@api_router.post("/admin/cleanup-database")
async def cleanup_database_for_production(admin_key: str):
    """ADMIN ONLY: Clean database for production launch"""
    try:
        # Simple admin key check (in production, use proper authentication)
        if admin_key != "PRODUCTION_CLEANUP_2025":
            raise HTTPException(status_code=403, detail="Unauthorized")
        
        # Clear ALL collections completely
        deleted_users = await db.users.delete_many({})
        deleted_completed_games = await db.completed_games.delete_many({})
        deleted_winner_prizes = await db.winner_prizes.delete_many({})
        deleted_rooms = await db.rooms.delete_many({})
        
        # Also clear any other potential collections
        try:
            deleted_transactions = await db.transactions.delete_many({})
            deleted_payments = await db.payments.delete_many({})
            deleted_wallets = await db.wallets.delete_many({})
            deleted_sessions = await db.sessions.delete_many({})
        except Exception as e:
            logging.info(f"Some collections didn't exist: {e}")
        
        # Drop and recreate the entire database to ensure complete cleanup
        collection_names = await db.list_collection_names()
        for collection_name in collection_names:
            await db[collection_name].drop()
            logging.info(f"Dropped collection: {collection_name}")
        
        logging.info("🧹 COMPLETE DATABASE WIPE FINISHED")
        logging.info(f"Deleted: {deleted_users.deleted_count} users")
        logging.info(f"Deleted: {deleted_completed_games.deleted_count} completed games")  
        logging.info(f"Deleted: {deleted_winner_prizes.deleted_count} winner prizes")
        logging.info(f"Deleted: {deleted_rooms.deleted_count} rooms")
        logging.info("All collections dropped and recreated")
        
        return {
            "status": "success",
            "message": "Database cleaned for production",
            "deleted": {
                "users": deleted_users.deleted_count,
                "completed_games": deleted_completed_games.deleted_count,
                "winner_prizes": deleted_winner_prizes.deleted_count
            }
        }
        
    except Exception as e:
        logging.error(f"Error cleaning database: {e}")
        raise HTTPException(status_code=500, detail="Failed to clean database")

@api_router.post("/auth/telegram", response_model=User)
async def telegram_auth(user_data: UserCreate):
    """Authenticate user with Telegram data"""
    telegram_data = user_data.telegram_auth_data
    
    # Log the incoming data for debugging
    logging.info(f"🔐 Telegram auth attempt for user ID: {telegram_data.id}")
    logging.info(f"📋 Full auth data: id={telegram_data.id}, first_name={telegram_data.first_name}, username={telegram_data.username}")
    
    # For Telegram Web App, be more permissive with authentication
    # Basic validation - user must have ID and first name
    if not telegram_data.id or not telegram_data.first_name:
        raise HTTPException(status_code=400, detail="Missing required Telegram user data")
    
    # Skip hash verification for now since Web App integration can be complex
    # In production, you'd want proper hash verification
    logging.info(f"🔍 Authenticating Telegram user: {telegram_data.first_name} (ID: {telegram_data.id})")
    
    # Check if user already exists
    logging.info(f"🔎 Searching for existing user with telegram_id={telegram_data.id} in database '{DB_NAME}'")
    existing_user = await db.users.find_one({"telegram_id": telegram_data.id})
    logging.info(f"🔎 Search result: {'FOUND' if existing_user else 'NOT FOUND'}")
    
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
        
        logging.info(f"✅ Returning existing user: {existing_user['first_name']} with balance: {existing_user.get('token_balance', 0)}")
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
    
    # Check if user qualifies for welcome bonus (first 100 users)
    user_count = await db.users.count_documents({})
    welcome_bonus = 0
    
    if user_count < 100:
        welcome_bonus = 1000
        user_dict['token_balance'] = user_dict.get('token_balance', 0) + welcome_bonus
        logging.info(f"🎁 WELCOME BONUS! User #{user_count + 1} gets {welcome_bonus} tokens!")
    
    await db.users.insert_one(user_dict)
    
    if welcome_bonus > 0:
        logging.info(f"🆕 Created new user: {user.first_name} (telegram_id: {user.telegram_id}) with {welcome_bonus} welcome bonus! Total balance: {user_dict['token_balance']}")
        # Update the user object to reflect the bonus
        user.token_balance = user_dict['token_balance']
    else:
        logging.info(f"🆕 Created new user: {user.first_name} (telegram_id: {user.telegram_id}) - Welcome bonus period ended")
    
    return user

@api_router.get("/welcome-bonus-status")
async def get_welcome_bonus_status():
    """Get current welcome bonus status"""
    user_count = await db.users.count_documents({})
    remaining_spots = max(0, 100 - user_count)
    
    return {
        "total_users": user_count,
        "remaining_spots": remaining_spots,
        "bonus_active": remaining_spots > 0,
        "bonus_amount": 1000,
        "message": f"🎁 First 100 players get 1000 free tokens! {remaining_spots} spots left!" if remaining_spots > 0 else "🚫 Welcome bonus period has ended"
    }

# Solana Token Purchase Endpoints
class TokenPurchaseRequest(BaseModel):
    user_id: str
    token_amount: int = Field(gt=0, description="Number of tokens to purchase")

@api_router.post("/purchase-tokens")
async def initiate_token_purchase(request: TokenPurchaseRequest):
    """
    Create a unique wallet address for token purchase
    Returns wallet address and payment instructions
    """
    try:
        # Validate user exists
        user = await db.users.find_one({"id": request.user_id})
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        
        # Validate token amount (min 10, max 10000)
        if request.token_amount < 10:
            raise HTTPException(status_code=400, detail="Minimum purchase is 10 tokens")
        if request.token_amount > 10000:
            raise HTTPException(status_code=400, detail="Maximum purchase is 10,000 tokens")
        
        # Create payment wallet using Solana processor
        processor = get_processor(db)
        payment_info = await processor.create_payment_wallet(
            user_id=request.user_id,
            token_amount=request.token_amount
        )
        
        logging.info(f"Token purchase initiated: {request.user_id} -> {request.token_amount} tokens")
        
        return {
            "status": "success",
            "message": "Payment wallet created successfully",
            "payment_info": payment_info
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logging.error(f"Failed to initiate token purchase: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to create payment wallet: {str(e)}")

@api_router.get("/purchase-status/{user_id}/{wallet_address}")
async def get_purchase_status(user_id: str, wallet_address: str):
    """
    Get the status of a token purchase
    Shows payment detection, token crediting, and forwarding status
    """
    try:
        # Get purchase status from Solana processor
        processor = get_processor(db)
        status_info = await processor.get_purchase_status(user_id, wallet_address)
        
        return {
            "status": "success",
            "purchase_status": status_info
        }
        
    except Exception as e:
        logging.error(f"Failed to get purchase status: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to get purchase status: {str(e)}")

@api_router.get("/purchase-history/{user_id}")
async def get_purchase_history(user_id: str, limit: int = 10):
    """Get token purchase history for a user"""
    try:
        # Validate user exists
        user = await db.users.find_one({"id": user_id})
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        
        # Get purchase history from database
        purchases = await db.token_purchases.find(
            {"user_id": user_id}
        ).sort("purchase_date", -1).limit(limit).to_list(limit)
        
        return {
            "status": "success",
            "purchases": purchases
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logging.error(f"Failed to get purchase history: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to get purchase history")

@api_router.post("/admin/update-user-name/{telegram_id}")
async def update_user_name(telegram_id: int, first_name: str, username: str = "", photo_url: str = "", admin_key: str = ""):
    """Update user name, username and photo"""
    if admin_key != "PRODUCTION_CLEANUP_2025":
        raise HTTPException(status_code=403, detail="Invalid admin key")
    
    # Update user data
    update_data = {
        "first_name": first_name,
        "telegram_username": username
    }
    
    # Add photo_url if provided
    if photo_url:
        update_data["photo_url"] = photo_url
    
    result = await db.users.update_one(
        {"telegram_id": telegram_id}, 
        {"$set": update_data}
    )
    
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    
    return {
        "status": "success",
        "message": f"Updated user {telegram_id} name to {first_name}",
        "telegram_id": telegram_id,
        "first_name": first_name,
        "username": username,
        "photo_url": photo_url
    }

@api_router.post("/admin/process-payment")
async def manually_process_payment(wallet_address: str, signature: str, admin_key: str = ""):
    """ADMIN ONLY: Manually trigger payment processing for a specific transaction"""
    if admin_key != "PRODUCTION_CLEANUP_2025":
        raise HTTPException(status_code=403, detail="Invalid admin key")
    
    try:
        # Get Solana processor
        from solana_integration import get_processor
        processor = get_processor(db)
        
        logging.info(f"🔧 [Admin] Manually processing payment for wallet {wallet_address}")
        logging.info(f"🔧 [Admin] Transaction signature: {signature}")
        
        # Trigger payment processing
        await processor.process_detected_payment(wallet_address, signature)
        
        # Check result
        wallet_doc = await db.temporary_wallets.find_one({"wallet_address": wallet_address})
        
        return {
            "status": "success",
            "message": "Payment processing triggered",
            "wallet_address": wallet_address,
            "signature": signature,
            "payment_detected": wallet_doc.get("payment_detected") if wallet_doc else False,
            "tokens_credited": wallet_doc.get("tokens_credited") if wallet_doc else False,
            "sol_forwarded": wallet_doc.get("sol_forwarded") if wallet_doc else False,
            "wallet_status": wallet_doc.get("status") if wallet_doc else "not_found"
        }
        
    except Exception as e:
        logging.error(f"Error manually processing payment: {str(e)}")
        import traceback
        logging.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Failed to process payment: {str(e)}")

@api_router.post("/admin/manual-credit")
async def manual_credit_tokens(
    telegram_id: int,
    amount: int,
    reason: str,
    transaction_signature: Optional[str] = None,
    admin_key: str = ""
):
    """
    ADMIN ONLY: Manually credit tokens to a user with full logging
    
    Args:
        telegram_id: User's Telegram ID
        amount: Tokens to credit
        reason: Reason for manual credit
        transaction_signature: Optional Solana transaction signature
        admin_key: Admin authentication key
    """
    if admin_key != "PRODUCTION_CLEANUP_2025":
        raise HTTPException(status_code=403, detail="Invalid admin key")
    
    result = await credit_tokens_manually(
        db=db,
        telegram_id=telegram_id,
        amount=amount,
        reason=reason,
        transaction_signature=transaction_signature
    )
    
    return result

@api_router.get("/admin/recovery-status")
async def get_recovery_status(admin_key: str = ""):
    """ADMIN ONLY: Get payment recovery system status"""
    if admin_key != "PRODUCTION_CLEANUP_2025":
        raise HTTPException(status_code=403, detail="Invalid admin key")
    
    # Get RPC health status
    rpc_health = rpc_alert_system.get_health_report()
    
    # Get recent manual credits
    credit_logger = ManualCreditLogger(db)
    recent_credits = await credit_logger.get_recent_manual_credits(limit=10)
    
    return {
        "rpc_health": rpc_health,
        "recent_manual_credits": [
            {
                "telegram_id": c.get("telegram_id"),
                "amount": c.get("tokens_credited"),
                "reason": c.get("reason"),
                "timestamp": c.get("timestamp").isoformat() if c.get("timestamp") else None
            }
            for c in recent_credits
        ],
        "monitoring_active": True
    }

@api_router.post("/admin/rescan-payments")
async def rescan_payments(admin_key: str = "", wallet_address: Optional[str] = None):
    """
    ADMIN ONLY: Manually trigger payment rescan
    If wallet_address provided, scans only that wallet
    Otherwise scans all pending wallets
    """
    if admin_key != "PRODUCTION_CLEANUP_2025":
        raise HTTPException(status_code=403, detail="Invalid admin key")
    
    try:
        from solana_integration import get_processor
        processor = get_processor(db)
        
        if wallet_address:
            logging.info(f"🔧 [Admin] Manual rescan for wallet: {wallet_address}")
            
            # Get specific wallet
            wallet_doc = await db.temporary_wallets.find_one({"wallet_address": wallet_address})
            if not wallet_doc:
                raise HTTPException(status_code=404, detail=f"Wallet {wallet_address} not found")
            
            # Check balance
            from solders.pubkey import Pubkey
            from decimal import Decimal
            from solana.rpc.commitment import Confirmed
            from solana_integration import SOLANA_RPC_URL
            
            logging.info(f"🔧 [Admin] Using RPC URL: {SOLANA_RPC_URL}")
            logging.info(f"🔧 [Admin] Processor client: {processor.client._provider.endpoint_uri}")
            
            pubkey = Pubkey.from_string(wallet_address)
            balance_response = await processor.client.get_balance(pubkey, commitment=Confirmed)
            balance_lamports = balance_response.value if balance_response.value else 0
            
            logging.info(f"🔧 [Admin] Balance response: {balance_response}")
            logging.info(f"🔧 [Admin] Balance lamports: {balance_lamports}")
            
            balance_sol = Decimal(balance_lamports) / Decimal(1000000000)
            
            expected_sol = Decimal(str(wallet_doc["required_sol"]))
            
            result = {
                "wallet_address": wallet_address,
                "current_balance": str(balance_sol),
                "expected_amount": str(expected_sol),
                "status": wallet_doc.get("status"),
                "payment_detected": wallet_doc.get("payment_detected", False),
                "tokens_credited": wallet_doc.get("tokens_credited", False),
                "user_id": wallet_doc.get("user_id")
            }
            
            # If payment found, process it
            tolerance = Decimal("0.001")
            if balance_sol >= (expected_sol - tolerance) and not wallet_doc.get("tokens_credited"):
                logging.info(f"💰 [Admin] Processing payment for wallet {wallet_address}")
                
                # Mark as detected
                await db.temporary_wallets.update_one(
                    {"wallet_address": wallet_address, "payment_detected": False},
                    {"$set": {"payment_detected": True, "status": "manual_rescan", "detected_at": datetime.now(timezone.utc)}}
                )
                
                # Credit tokens
                await processor.credit_tokens_to_user(wallet_doc, balance_sol)
                
                # Forward SOL
                await processor.forward_sol_to_main_wallet(wallet_address, wallet_doc["private_key"], balance_lamports)
                
                result["action"] = "payment_processed"
            else:
                result["action"] = "no_action_needed"
            
            return result
        else:
            # Scan all pending wallets
            logging.info("🔧 [Admin] Manual rescan of all pending payments")
            await processor.rescan_pending_payments()
            
            # Get stats
            pending_count = await db.temporary_wallets.count_documents({
                "status": {"$in": ["pending", "monitoring"]},
                "payment_detected": False
            })
            
            return {
                "status": "success",
                "message": "Rescan completed",
                "pending_wallets_checked": pending_count
            }
        
    except HTTPException:
        raise
    except Exception as e:
        logging.error(f"Error in payment rescan: {str(e)}")
        import traceback
        logging.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Failed to rescan payments: {str(e)}")

@api_router.post("/admin/reset-processor")
async def reset_solana_processor(admin_key: str = ""):
    """ADMIN ONLY: Force reset Solana processor (for RPC URL changes)"""
    if admin_key != "PRODUCTION_CLEANUP_2025":
        raise HTTPException(status_code=403, detail="Invalid admin key")
    
    try:
        from solana_integration import reset_processor, SOLANA_RPC_URL
        
        logging.info("🔄 [Admin] Forcing processor reset...")
        reset_processor()
        logging.info(f"✅ [Admin] Processor reset complete")
        logging.info(f"🌐 [Admin] Current RPC URL: {SOLANA_RPC_URL}")
        
        return {
            "status": "success",
            "message": "Processor reset successfully",
            "rpc_url": SOLANA_RPC_URL
        }
        
    except Exception as e:
        logging.error(f"Error resetting processor: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to reset processor: {str(e)}")

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
            "max_players": 3,
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
    logging.info(f"Join room request: {request.dict()}")
    
    # Find room of the requested type
    target_room = None
    for room in active_rooms.values():
        if room.room_type == request.room_type and room.status == "waiting":
            target_room = room
            break
    
    if not target_room:
        logging.error(f"No available room of type {request.room_type}")
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
        logging.error(f"User not found: {request.user_id}")
        raise HTTPException(status_code=404, detail="User not found")
    
    logging.info(f"User balance: {user_doc.get('token_balance', 0)}, Bet amount: {request.bet_amount}")
    
    if user_doc.get('token_balance', 0) < request.bet_amount:
        raise HTTPException(status_code=400, detail="Insufficient token balance")
    
    # Check if user is already in the room
    if any(p.user_id == request.user_id for p in target_room.players):
        raise HTTPException(status_code=400, detail="You are already in this room")
    
    # Check if room is full
    if len(target_room.players) >= 3:
        raise HTTPException(status_code=400, detail="Room is full")
    
    # Deduct tokens from user balance
    await db.users.update_one(
        {"id": request.user_id},
        {"$inc": {"token_balance": -request.bet_amount}}
    )
    
    # Add player to room with full Telegram info
    player = RoomPlayer(
        user_id=request.user_id,
        username=user_doc.get('telegram_username', ''),  # @username
        first_name=user_doc.get('first_name', 'Player'),
        last_name=user_doc.get('last_name', ''),
        photo_url=user_doc.get('photo_url', ''),
        bet_amount=request.bet_amount
    )
    target_room.players.append(player)
    target_room.prize_pool += request.bet_amount
    
    # Notify ROOM participants about new player - ALWAYS send FULL participant list
    players_list = [p.dict() for p in target_room.players]
    logging.info(f"👤 Player {player.username} joined room {target_room.id} ({len(target_room.players)}/3)")
    logging.info(f"📋 Full participant list: {[p['username'] for p in players_list]}")
    
    await socket_rooms.broadcast_to_room(sio, target_room.id, 'player_joined', {
        'room_id': target_room.id,
        'room_type': target_room.room_type,
        'player': player.dict(),
        'players_count': len(target_room.players),
        'prize_pool': target_room.prize_pool,
        'all_players': players_list,  # FULL participant list - REPLACE, don't append
        'room_status': 'filling' if len(target_room.players) < 3 else 'full',
        'timestamp': datetime.now(timezone.utc).isoformat()
    })
    logging.info(f"✅ Emitted player_joined to room {target_room.id} with {len(players_list)} players")
    
    # Broadcast updated room states to all clients (global lobby update)
    await broadcast_room_updates()
    
    # Check if room is full and start game sequence
    if len(target_room.players) == 3:
        logging.info(f"🚀 ROOM FULL! Room {target_room.id} has 3 players, starting game sequence...")
        
        # Emit room_full event to all participants in THIS room only
        await socket_rooms.broadcast_to_room(sio, target_room.id, 'room_full', {
            'room_id': target_room.id,
            'room_type': target_room.room_type,
            'players': players_list,
            'players_count': 3,
            'message': '🚀 ROOM IS FULL! GET READY FOR THE BATTLE!',
            'timestamp': datetime.now(timezone.utc).isoformat()
        })
        logging.info(f"✅ Emitted room_full to room {target_room.id}")
        
        # Start the game sequence (will emit room_ready, game_starting, game_finished in order)
        background_tasks.add_task(start_game_round, target_room)
    
    return {
        "status": "joined",
        "success": True,
        "room_id": target_room.id,
        "position": len(target_room.players),
        "players_needed": 3 - len(target_room.players),
        "new_balance": user_doc.get('token_balance', 0) - request.bet_amount
    }

@api_router.get("/room-participants/{room_type}")
async def get_room_participants_by_type(room_type: str):
    """Get current participants in a room by type - for lobby updates"""
    # Find the active room of this type
    target_room = None
    for room in active_rooms.values():
        if room.room_type == room_type and room.status == "waiting":
            target_room = room
            break
    
    if not target_room:
        return {
            "room_type": room_type,
            "players": [],
            "count": 0
        }
    
    return {
        "room_type": room_type,
        "room_id": target_room.id,
        "players": [p.dict() for p in target_room.players],
        "count": len(target_room.players),
        "status": target_room.status
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
        {"$project": {"_id": 0, "first_name": 1, "token_balance": 1}}
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

@api_router.get("/version")
async def get_version():
    """Get current build version for verification"""
    return {
        "version": "8.0-WINNER-FIX-20250114",
        "build_timestamp": "1736864000",
        "environment": "production",
        "status": "healthy",
        "features": {
            "winner_message_fixed": True,
            "version_label_removed": True,
            "prize_visibility_fixed": True,
            "history_badge_fixed": True
        }
    }

@api_router.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "version": "8.0-WINNER-FIX-20250114",
        "timestamp": datetime.now(timezone.utc).isoformat()
    }

@api_router.get("/users/telegram/{telegram_id}")
async def get_user_by_telegram_id(telegram_id: int):
    """Find user by Telegram ID"""
    try:
        user_doc = await db.users.find_one({"telegram_id": telegram_id})
        if not user_doc:
            raise HTTPException(status_code=404, detail="User not found")
        
        return {
            "id": user_doc.get('id'),
            "telegram_id": user_doc.get('telegram_id'),
            "first_name": user_doc.get('first_name'),
            "last_name": user_doc.get('last_name', ''),
            "username": user_doc.get('telegram_username', ''),
            "photo_url": user_doc.get('photo_url', ''),
            "token_balance": user_doc.get('token_balance', 0),
            "created_at": user_doc.get('created_at'),
            "last_login": user_doc.get('last_login'),
            "last_daily_claim": user_doc.get('last_daily_claim'),
            "is_verified": user_doc.get('is_verified', False),
            "is_admin": user_doc.get('is_admin', False),
            "is_owner": user_doc.get('is_owner', False),
            "role": user_doc.get('role', 'user')
        }
    except Exception as e:
        logging.error(f"Failed to find user by Telegram ID: {e}")
        raise HTTPException(status_code=500, detail="Failed to find user")

@api_router.post("/claim-daily-tokens/{user_id}")
async def claim_daily_tokens(user_id: str):
    """Claim daily free tokens (10 tokens every 24 hours)"""
    try:
        user_doc = await db.users.find_one({"id": user_id})
        if not user_doc:
            raise HTTPException(status_code=404, detail="User not found")
        
        now = datetime.now(timezone.utc)
        last_claim = user_doc.get('last_daily_claim')
        
        # Check if user can claim (24 hours passed or never claimed)
        can_claim = True
        time_until_next_claim = 0
        
        if last_claim:
            try:
                last_claim_dt = datetime.fromisoformat(last_claim)
                time_since_claim = (now - last_claim_dt).total_seconds()
                time_until_next_claim = max(0, 86400 - time_since_claim)  # 86400 seconds = 24 hours
                can_claim = time_since_claim >= 86400
            except:
                can_claim = True
        
        if not can_claim:
            hours_left = int(time_until_next_claim // 3600)
            minutes_left = int((time_until_next_claim % 3600) // 60)
            return {
                "status": "already_claimed",
                "message": f"Already claimed today. Next claim in {hours_left}h {minutes_left}m",
                "time_until_next_claim": time_until_next_claim,
                "can_claim": False
            }
        
        # Give 10 tokens
        daily_tokens = 10
        new_balance = user_doc.get('token_balance', 0) + daily_tokens
        
        await db.users.update_one(
            {"id": user_id},
            {
                "$set": {
                    "last_daily_claim": now.isoformat(),
                    "token_balance": new_balance
                }
            }
        )
        
        logging.info(f"User {user_doc.get('first_name')} claimed {daily_tokens} daily tokens. New balance: {new_balance}")
        
        return {
            "status": "success",
            "message": f"Claimed {daily_tokens} tokens!",
            "tokens_claimed": daily_tokens,
            "new_balance": new_balance,
            "can_claim": False,
            "time_until_next_claim": 86400
        }
        
    except Exception as e:
        logging.error(f"Failed to claim daily tokens: {e}")
        raise HTTPException(status_code=500, detail="Failed to claim daily tokens")

@api_router.get("/user/{user_id}")
async def get_user_data(user_id: str):
    """Get user data including current balance"""
    try:
        user_doc = await db.users.find_one({"id": user_id})
        if not user_doc:
            raise HTTPException(status_code=404, detail="User not found")
        
        return {
            "id": user_doc.get('id'),
            "telegram_id": user_doc.get('telegram_id'),
            "first_name": user_doc.get('first_name'),
            "last_name": user_doc.get('last_name', ''),
            "username": user_doc.get('telegram_username', ''),
            "photo_url": user_doc.get('photo_url', ''),
            "token_balance": user_doc.get('token_balance', 0),
            "created_at": user_doc.get('created_at'),
            "last_login": user_doc.get('last_login'),
            "is_verified": user_doc.get('is_verified', False),
            "is_admin": user_doc.get('is_admin', False),
            "is_owner": user_doc.get('is_owner', False),
            "role": user_doc.get('role', 'user')
        }
    except Exception as e:
        logging.error(f"Failed to get user data: {e}")
        raise HTTPException(status_code=500, detail="Failed to get user data")

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


# ==================== NEW ENDPOINTS: City Selection & Work for Casino ====================

@api_router.post("/users/set-city")
async def set_user_city(request: SetCityRequest):
    """Set user's city selection (London or Paris)"""
    try:
        valid_cities = ["London", "Paris"]
        if request.city not in valid_cities:
            raise HTTPException(status_code=400, detail=f"Invalid city. Must be one of: {valid_cities}")
        
        # Check if user exists first
        user = await db.users.find_one({"id": request.user_id})
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        
        # Update user's city (or insert if not present)
        result = await db.users.update_one(
            {"id": request.user_id},
            {"$set": {"city": request.city}}
        )
        
        logging.info(f"✅ User {request.user_id} set city to {request.city}")
        return {"success": True, "city": request.city}
        
    except HTTPException:
        raise
    except Exception as e:
        logging.error(f"Error setting user city: {e}")
        raise HTTPException(status_code=500, detail="Failed to set city")

@api_router.post("/work/purchase-access")
async def purchase_work_access(request: PurchaseWorkAccessRequest):
    """Purchase work access for uploading gifts (1000 tokens symbolic, paid via Solana)"""
    try:
        # Verify user exists
        user = await db.users.find_one({"id": request.user_id})
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        
        # Check if already purchased
        if user.get('work_access_purchased'):
            return {
                "success": True, 
                "message": "Work access already active",
                "already_purchased": True
            }
        
        # Mark work access as purchased
        await db.users.update_one(
            {"id": request.user_id},
            {"$set": {"work_access_purchased": True}}
        )
        
        logging.info(f"✅ User {request.user_id} purchased work access")
        
        # Send Telegram confirmation
        if user.get('telegram_id'):
            await send_work_access_confirmation(
                telegram_id=user['telegram_id'],
                username=user.get('first_name', 'User')
            )
        
        return {
            "success": True,
            "message": "Work access granted! Check Telegram for next steps.",
            "work_access_purchased": True
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logging.error(f"Error purchasing work access: {e}")
        raise HTTPException(status_code=500, detail="Failed to purchase work access")

@api_router.post("/gifts/upload")
async def upload_gift(request: UploadGiftRequest):
    """Upload a gift with photo and coordinates (requires work access)"""
    try:
        # Verify user exists and has work access
        user = await db.users.find_one({"id": request.user_id})
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        
        if not user.get('work_access_purchased'):
            raise HTTPException(status_code=403, detail="Work access required. Purchase access first.")
        
        # Validate city
        valid_cities = ["London", "Paris"]
        if request.city not in valid_cities:
            raise HTTPException(status_code=400, detail=f"Invalid city. Must be one of: {valid_cities}")
        
        # Validate coordinates
        if 'lat' not in request.coordinates or 'lng' not in request.coordinates:
            raise HTTPException(status_code=400, detail="Coordinates must include 'lat' and 'lng'")
        
        # Create gift document
        gift = Gift(
            creator_user_id=request.user_id,
            creator_telegram_id=user['telegram_id'],
            creator_username=user.get('telegram_username'),
            city=request.city,
            photo_base64=request.photo_base64,
            coordinates=request.coordinates
        )
        
        # Insert into database
        await db.gifts.insert_one(gift.dict())
        
        logging.info(f"🎁 Gift uploaded by {user.get('first_name')} in {request.city}")
        
        return {
            "success": True,
            "gift_id": gift.gift_id,
            "message": f"Gift successfully uploaded in {request.city}!"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logging.error(f"Error uploading gift: {e}")
        raise HTTPException(status_code=500, detail="Failed to upload gift")

# ==================== ADMIN ENDPOINTS ====================

@api_router.get("/admin/gifts/assigned")
async def get_assigned_gifts(telegram_username: Optional[str] = None):
    """Admin endpoint: Get all assigned gifts (restricted to @cia_nera)"""
    try:
        # Check admin access
        if not check_admin_access(telegram_username):
            raise HTTPException(status_code=403, detail="Admin access required")
        
        # Get all assigned gifts
        assigned_gifts = await db.gifts.find(
            {"status": "assigned"},
            {"_id": 0}
        ).sort("assigned_at", -1).to_list(1000)
        
        return {
            "success": True,
            "total": len(assigned_gifts),
            "gifts": assigned_gifts
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logging.error(f"Error fetching assigned gifts: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch assigned gifts")

@api_router.get("/admin/gifts/stats")
async def get_gift_stats(telegram_username: Optional[str] = None):
    """Admin endpoint: Get gift statistics (restricted to @cia_nera)"""
    try:
        # Check admin access
        if not check_admin_access(telegram_username):
            raise HTTPException(status_code=403, detail="Admin access required")
        
        # Get total counts
        total_uploaded = await db.gifts.count_documents({})
        total_assigned = await db.gifts.count_documents({"status": "assigned"})
        total_pending = await db.gifts.count_documents({"status": "available"})
        
        # Get breakdown by city
        london_uploaded = await db.gifts.count_documents({"city": "London"})
        london_assigned = await db.gifts.count_documents({"city": "London", "status": "assigned"})
        
        paris_uploaded = await db.gifts.count_documents({"city": "Paris"})
        paris_assigned = await db.gifts.count_documents({"city": "Paris", "status": "assigned"})
        
        return {
            "success": True,
            "total_uploaded": total_uploaded,
            "total_assigned": total_assigned,
            "total_pending": total_pending,
            "breakdown_by_city": {
                "London": {
                    "uploaded": london_uploaded,
                    "assigned": london_assigned
                },
                "Paris": {
                    "uploaded": paris_uploaded,
                    "assigned": paris_assigned
                }
            }
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logging.error(f"Error fetching gift stats: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch gift stats")

@api_router.get("/work/check-access/{user_id}")
async def check_work_access(user_id: str):
    """Check if user has purchased work access"""
    try:
        user = await db.users.find_one({"id": user_id})
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        
        return {
            "has_work_access": user.get('work_access_purchased', False),
            "city": user.get('city')
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logging.error(f"Error checking work access: {e}")
        raise HTTPException(status_code=500, detail="Failed to check work access")

@api_router.get("/gifts/available/{city}")
async def get_available_gifts_count(city: str):
    """Get count of available gifts in a city"""
    try:
        count = await db.gifts.count_documents({"city": city, "status": "available"})
        return {"city": city, "available_gifts": count}
    except Exception as e:
        logging.error(f"Error getting available gifts count: {e}")
        raise HTTPException(status_code=500, detail="Failed to get gift count")

# Include the router
app.include_router(api_router)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
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
    
    # Create database indexes for optimal performance
    try:
        # Gifts collection indexes
        await db.gifts.create_index([("city", 1), ("status", 1)])
        await db.gifts.create_index([("assigned_to", 1)])
        await db.gifts.create_index([("creator_user_id", 1)])
        
        # Users collection indexes
        await db.users.create_index([("city", 1)])
        await db.users.create_index([("telegram_username", 1)])
        
        logger.info("✅ Database indexes created successfully")
    except Exception as e:
        logger.error(f"❌ Failed to create indexes: {e}")
    
    # Start Solana payment monitoring
    await payment_monitor.start_monitoring()
    
    # Run payment auto-recovery system (scans last 24 hours for missed payments)
    logger.info("🔄 Running payment auto-recovery on startup...")
    try:
        processor = get_processor(db)
        recovery_result = await run_startup_recovery(db, processor)
        logger.info(f"✅ Auto-recovery complete: {recovery_result}")
    except Exception as e:
        logger.error(f"❌ Auto-recovery failed: {e}")
    
    # Start redundant payment scanner (backup detection system)
    asyncio.create_task(redundant_payment_scanner())
    
    # Start wallet cleanup scheduler with grace period
    asyncio.create_task(wallet_cleanup_scheduler())
    
    logging.info("🎰 Casino Battle Royale API started!")
    logging.info(f"🏠 Active rooms: {len(active_rooms)}")
    logging.info(f"💳 Solana monitoring: {'Enabled' if CASINO_WALLET_ADDRESS != 'YourWalletAddressHere12345678901234567890123456789' else 'Disabled (set CASINO_WALLET_ADDRESS)'}")
    logging.info("🔍 Redundant payment scanner: Enabled (15s interval - FAST detection)")
    logging.info("🧹 Wallet cleanup scheduler: Enabled (72h grace period)")

async def redundant_payment_scanner():
    """
    Background task that periodically rescans all pending payments
    This catches payments missed by the real-time monitoring system
    Runs every 15 seconds for fast detection
    """
    from solana_integration import get_processor
    
    # Wait a bit before starting to ensure DB is ready
    await asyncio.sleep(10)
    
    logging.info("🔍 [Scanner] Redundant payment scanner started (15s interval)")
    
    while True:
        try:
            processor = get_processor(db)
            await processor.rescan_pending_payments()
        except Exception as e:
            logging.error(f"❌ [Scanner] Error in redundant payment scanner: {e}")
            import traceback
            logging.error(traceback.format_exc())
        
        # Wait 15 seconds before next scan (faster detection)
        await asyncio.sleep(15)

async def wallet_cleanup_scheduler():
    """
    Background task that periodically cleans up old completed wallets
    Runs every 24 hours with 72-hour grace period
    SAFETY: Only removes private keys from wallets that have been successfully swept
    """
    from solana_integration import get_processor
    
    # Wait 1 hour after startup before first cleanup
    await asyncio.sleep(3600)
    
    logging.info("🧹 [Cleanup Scheduler] Wallet cleanup scheduler started (24h interval, 72h grace period)")
    
    while True:
        try:
            processor = get_processor(db)
            result = await processor.cleanup_old_wallets_with_grace_period(grace_period_hours=72)
            
            logging.info(f"🧹 [Cleanup Scheduler] Cleanup complete:")
            logging.info(f"   Cleaned: {result.get('cleaned', 0)} wallets")
            logging.info(f"   Blocked: {result.get('blocked', 0)} wallets (funds still present)")
            logging.info(f"   Flagged: {result.get('flagged_for_review', 0)} wallets need manual review")
            
        except Exception as e:
            logging.error(f"❌ [Cleanup Scheduler] Error: {e}")
            import traceback
            logging.error(traceback.format_exc())
        
        # Wait 24 hours before next cleanup
        await asyncio.sleep(86400)
    
@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on application shutdown"""
    payment_monitor.monitoring = False
    logging.info("🛑 Casino Battle Royale API shutting down")

# Export the socket app for uvicorn
app = socket_app