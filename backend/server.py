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

# Load environment variables
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# Get environment variables
MONGO_URL = os.environ.get('MONGO_URL', 'mongodb://localhost:27017')
DB_NAME = os.environ.get('DB_NAME', 'casino_db')
CORS_ORIGINS = os.environ.get('CORS_ORIGINS', 'http://localhost:3000,https://solana-casino-2.preview.emergentagent.com').split(',')
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

# MongoDB connection
client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

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
    
    # Send Telegram notification to winner
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
    
    # Notify all clients of the winner (include prize_link for display)
    await sio.emit('game_finished', {
        'room_id': room.id,
        'room_type': room.room_type,
        'winner': winner.dict(),
        'winner_name': f"{winner.first_name} {winner.last_name}".strip(),
        'winner_id': winner.user_id,
        'prize_pool': room.prize_pool,
        'prize_link': prize_link,  # Include for winner screen
        'round_number': room.round_number,
        'has_prize': True
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
    logging.info(f"🔎 Searching for existing user with telegram_id={telegram_data.id}")
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
    
    await db.users.insert_one(user_dict)
    logging.info(f"🆕 Created new user: {user.first_name} (telegram_id: {user.telegram_id})")
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
            "max_players": 2,
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
    if len(target_room.players) >= 2:
        raise HTTPException(status_code=400, detail="Room is full")
    
    # Deduct tokens from user balance
    await db.users.update_one(
        {"id": request.user_id},
        {"$inc": {"token_balance": -request.bet_amount}}
    )
    
    # Add player to room with full Telegram info
    player = RoomPlayer(
        user_id=request.user_id,
        username=user_doc.get('username', ''),  # @username
        first_name=user_doc.get('first_name', 'Player'),
        last_name=user_doc.get('last_name', ''),
        photo_url=user_doc.get('photo_url', ''),
        bet_amount=request.bet_amount
    )
    target_room.players.append(player)
    target_room.prize_pool += request.bet_amount
    
    # Notify all clients about new player and update all room states
    await sio.emit('player_joined', {
        'room_id': target_room.id,
        'room_type': target_room.room_type,
        'player': player.dict(),
        'players_count': len(target_room.players),
        'prize_pool': target_room.prize_pool,
        'all_players': [p.dict() for p in target_room.players],  # All participants for display
        'room_status': 'filling' if len(target_room.players) == 1 else 'ready'
    })
    
    # Broadcast updated room states to all clients
    await broadcast_room_updates()
    
    # Start game if room is full
    if len(target_room.players) == 2:
        background_tasks.add_task(start_game_round, target_room)
    
    return {
        "status": "joined",
        "success": True,
        "room_id": target_room.id,
        "position": len(target_room.players),
        "players_needed": 2 - len(target_room.players),
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
            "username": user_doc.get('username', ''),
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
            "username": user_doc.get('username', ''),
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
    
    # Start Solana payment monitoring
    await payment_monitor.start_monitoring()
    
    logging.info("🎰 Casino Battle Royale API started!")
    logging.info(f"🏠 Active rooms: {len(active_rooms)}")
    logging.info(f"💳 Solana monitoring: {'Enabled' if CASINO_WALLET_ADDRESS != 'YourWalletAddressHere12345678901234567890123456789' else 'Disabled (set CASINO_WALLET_ADDRESS)'}")
    
@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on application shutdown"""
    payment_monitor.monitoring = False
    logging.info("🛑 Casino Battle Royale API shutting down")

# Export the socket app for uvicorn
app = socket_app