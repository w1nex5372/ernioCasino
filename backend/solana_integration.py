"""
Solana Blockchain Integration for Automatic Token Purchase System
Handles wallet generation, payment monitoring, SOL forwarding, and live price fetching
"""

import asyncio
import os
import logging
from datetime import datetime, timezone
from typing import Optional, Dict, Any
import json
import time
from decimal import Decimal
import aiohttp

from solders.keypair import Keypair
from solders.pubkey import Pubkey
from solders.signature import Signature
from solana.rpc.async_api import AsyncClient
from solana.rpc.commitment import Confirmed, Finalized
from solana.rpc.types import TxOpts
from solders.transaction import Transaction, VersionedTransaction
from solders.message import MessageV0
from solders.system_program import TransferParams, transfer
from solders.hash import Hash
from motor.motor_asyncio import AsyncIOMotorDatabase
import base58

# Configuration
SOLANA_RPC_URL = os.environ.get('SOLANA_RPC_URL', 'https://api.mainnet-beta.solana.com')
MAIN_WALLET_ADDRESS = os.environ.get('MAIN_WALLET_ADDRESS', 'EC2cPxi4VbyzGoWMucHQ6LwkWz1W9vZE7ZApcY9PFsMy')
CASINO_WALLET_PRIVATE_KEY = os.environ.get('CASINO_WALLET_PRIVATE_KEY', '')
SOL_TO_TOKEN_RATE = int(os.environ.get('SOL_TO_TOKEN_RATE', 100))  # 1 EUR = 100 tokens
LAMPORTS_PER_SOL = 1_000_000_000  # 1 SOL = 1 billion lamports

logger = logging.getLogger(__name__)

class PriceFetcher:
    """Fetches live SOL/EUR exchange rate"""
    
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
                async with session.get(url, params=params, timeout=aiohttp.ClientTimeout(total=10)) as response:
                    if response.status == 200:
                        data = await response.json()
                        price = data["solana"]["eur"]
                        
                        # Update cache
                        self.cached_price = float(price)
                        self.last_update = current_time
                        
                        logger.info(f"💰 Updated SOL/EUR price: {price} EUR")
                        return self.cached_price
                    else:
                        logger.error(f"CoinGecko API error: {response.status}")
                        # Return cached price or fallback
                        return self.cached_price or 180.0  # Realistic fallback rate
                        
        except Exception as e:
            logger.error(f"Error fetching SOL price: {e}")
            # Return cached price or fallback
            return self.cached_price or 180.0
    
    def calculate_tokens_from_sol(self, sol_amount: float, sol_eur_price: float) -> int:
        """Calculate tokens from SOL amount using real-time EUR price"""
        # SOL → EUR → Tokens (1 EUR = 100 tokens)
        eur_value = sol_amount * sol_eur_price
        tokens = int(eur_value * 100)
        
        logger.info(f"💱 Conversion: {sol_amount} SOL × {sol_eur_price} EUR/SOL = {eur_value:.4f} EUR = {tokens} tokens")
        return tokens

logger = logging.getLogger(__name__)

class SolanaPaymentProcessor:
    """Handles Solana payment processing for automatic token purchases"""
    
    def __init__(self, db: AsyncIOMotorDatabase):
        self.db = db
        self.client = AsyncClient(SOLANA_RPC_URL)
        self.main_wallet = Pubkey.from_string(MAIN_WALLET_ADDRESS)
        self.active_monitors = set()  # Track active payment monitors
        self.price_fetcher = PriceFetcher()  # Initialize price fetcher
        
        logger.info(f"🔧 Solana RPC URL: {SOLANA_RPC_URL}")
        logger.info(f"🔧 Main wallet: {MAIN_WALLET_ADDRESS}")
        
        # Load forwarding keypair from private key
        if CASINO_WALLET_PRIVATE_KEY:
            try:
                private_key_bytes = base58.b58decode(CASINO_WALLET_PRIVATE_KEY)
                self.forwarding_keypair = Keypair.from_bytes(private_key_bytes)
                logger.info(f"🔑 Forwarding wallet initialized: {self.forwarding_keypair.pubkey()}")
            except Exception as e:
                logger.error(f"Failed to load forwarding keypair: {e}")
                self.forwarding_keypair = None
        else:
            logger.warning("No CASINO_WALLET_PRIVATE_KEY configured!")
            self.forwarding_keypair = None
        
    async def create_payment_wallet(self, user_id: str, token_amount: int) -> Dict[str, Any]:
        """
        Generate a unique wallet address for a token purchase with dynamic SOL/EUR pricing
        
        Args:
            user_id: ID of the user making the purchase
            token_amount: Number of tokens to purchase
            
        Returns:
            Dict containing wallet address and payment details
        """
        try:
            # Generate new keypair for this purchase
            keypair = Keypair()
            wallet_address = str(keypair.pubkey())
            
            # Get current SOL/EUR price
            sol_eur_price = await self.price_fetcher.get_sol_eur_price()
            
            # Calculate required EUR amount (1 EUR = 100 tokens)
            required_eur = Decimal(token_amount) / Decimal(100)
            
            # Calculate required SOL amount using live price
            required_sol = float(required_eur / Decimal(sol_eur_price))
            required_lamports = int(required_sol * LAMPORTS_PER_SOL)
            
            # Store temporary wallet in database
            wallet_data = {
                "wallet_address": wallet_address,
                "private_key": list(bytes(keypair)),  # Store as byte array
                "user_id": user_id,
                "token_amount": token_amount,
                "required_eur": float(required_eur),
                "required_sol": required_sol,
                "required_lamports": required_lamports,
                "sol_eur_price_at_creation": sol_eur_price,
                "status": "pending",
                "created_at": datetime.now(timezone.utc),
                "expires_at": datetime.now(timezone.utc).replace(hour=23, minute=59, second=59),  # Expires at end of day
                "payment_detected": False,
                "tokens_credited": False,
                "sol_forwarded": False
            }
            
            # Insert into temporary_wallets collection
            await self.db.temporary_wallets.insert_one(wallet_data)
            
            # Start monitoring this wallet for payments
            asyncio.create_task(self.monitor_wallet_payments(wallet_address))
            
            logger.info(f"✅ Created payment wallet {wallet_address} for user {user_id} ({token_amount} tokens = {required_eur} EUR = {required_sol:.6f} SOL at {sol_eur_price} EUR/SOL)")
            
            return {
                "wallet_address": wallet_address,
                "required_sol": required_sol,
                "required_eur": float(required_eur),
                "sol_eur_price": sol_eur_price,
                "token_amount": token_amount,
                "expires_at": wallet_data["expires_at"].isoformat(),
                "instructions": f"Send {required_sol:.6f} SOL to address {wallet_address}. Current rate: 1 SOL = €{sol_eur_price:.2f}. Tokens will be credited automatically within 1-2 minutes."
            }
            
        except Exception as e:
            logger.error(f"Failed to create payment wallet for user {user_id}: {str(e)}")
            raise Exception(f"Failed to create payment wallet: {str(e)}")
    
    async def monitor_wallet_payments(self, wallet_address: str):
        """
        Monitor a specific wallet address for incoming SOL payments
        
        Args:
            wallet_address: The wallet address to monitor
        """
        if wallet_address in self.active_monitors:
            return  # Already monitoring this wallet
            
        self.active_monitors.add(wallet_address)
        logger.info(f"🔍 Starting payment monitoring for wallet: {wallet_address}")
        
        try:
            pubkey = Pubkey.from_string(wallet_address)
            last_signature = None
            check_count = 0
            max_checks = 360  # Monitor for 30 minutes (360 * 5 seconds)
            
            while check_count < max_checks:
                try:
                    check_count += 1
                    
                    logger.info(f"🔍 [{wallet_address[:8]}...] Check #{check_count}/{max_checks}")
                    
                    # Get recent signatures for this address
                    response = await self.client.get_signatures_for_address(
                        pubkey, 
                        commitment=Confirmed,
                        limit=10
                    )
                    
                    logger.info(f"📡 [{wallet_address[:8]}...] RPC response: {response.value is not None}, signatures: {len(response.value) if response.value else 0}")
                    
                    if response.value:
                        signatures = response.value
                        
                        # Check for new signatures
                        for sig_info in signatures:
                            signature = str(sig_info.signature)
                            
                            logger.info(f"🔔 [{wallet_address[:8]}...] Found signature: {signature[:16]}...")
                            
                            if signature != last_signature:
                                logger.info(f"✨ [{wallet_address[:8]}...] NEW transaction detected! Processing...")
                                # New transaction detected, check if it's an incoming payment
                                await self.process_detected_payment(wallet_address, signature)
                                last_signature = signature
                            else:
                                logger.info(f"⏭️  [{wallet_address[:8]}...] Already processed this signature")
                    else:
                        logger.info(f"💤 [{wallet_address[:8]}...] No transactions found yet")
                    
                    # Check if wallet has been processed (payment found and handled)
                    wallet_doc = await self.db.temporary_wallets.find_one(
                        {"wallet_address": wallet_address}
                    )
                    
                    if wallet_doc and wallet_doc.get("tokens_credited"):
                        logger.info(f"✅ Wallet {wallet_address} successfully processed, stopping monitor")
                        break
                        
                    # Wait 5 seconds before next check (faster detection)
                    await asyncio.sleep(5)
                    
                except Exception as e:
                    import traceback
                    error_details = traceback.format_exc()
                    logger.error(f"❌ Error checking wallet {wallet_address}:")
                    logger.error(f"   Error type: {type(e).__name__}")
                    logger.error(f"   Error message: {str(e)}")
                    logger.error(f"   Traceback:\n{error_details}")
                    await asyncio.sleep(5)
                    continue
            
            if check_count >= max_checks:
                logger.warning(f"⏰ Payment monitoring timeout for wallet {wallet_address}")
                # Mark wallet as expired
                await self.db.temporary_wallets.update_one(
                    {"wallet_address": wallet_address},
                    {"$set": {"status": "expired", "updated_at": datetime.now(timezone.utc)}}
                )
                
        except Exception as e:
            import traceback
            error_details = traceback.format_exc()
            logger.error(f"❌ FATAL: Error in payment monitoring for {wallet_address}:")
            logger.error(f"   Error type: {type(e).__name__}")
            logger.error(f"   Error message: {str(e)}")
            logger.error(f"   Traceback:\n{error_details}")
        finally:
            self.active_monitors.discard(wallet_address)
            logger.info(f"🛑 Stopped monitoring wallet: {wallet_address}")
    
    async def process_detected_payment(self, wallet_address: str, signature: str):
        """
        Process a detected payment transaction
        
        Args:
            wallet_address: The wallet that received payment
            signature: The transaction signature to analyze (string)
        """
        try:
            logger.info(f"💳 [{wallet_address[:8]}...] Processing payment signature: {signature[:16]}...")
            
            # Convert string signature to Signature object
            logger.info(f"🔐 [{wallet_address[:8]}...] Converting signature string to Signature object...")
            try:
                sig_obj = Signature.from_string(signature)
                logger.info(f"✅ [{wallet_address[:8]}...] Signature object created successfully")
            except Exception as sig_error:
                logger.error(f"❌ [{wallet_address[:8]}...] Failed to create Signature object: {sig_error}")
                import traceback
                logger.error(traceback.format_exc())
                raise
            
            # Get transaction details
            logger.info(f"🌐 [{wallet_address[:8]}...] Fetching transaction from RPC...")
            logger.info(f"🌐 [{wallet_address[:8]}...] RPC URL: {self.client._provider.endpoint_uri}")
            
            try:
                transaction = await self.client.get_transaction(
                    sig_obj, 
                    commitment=Confirmed,
                    max_supported_transaction_version=0
                )
                logger.info(f"✅ [{wallet_address[:8]}...] RPC call successful")
            except Exception as rpc_error:
                logger.error(f"❌ [{wallet_address[:8]}...] RPC call failed: {rpc_error}")
                import traceback
                logger.error(traceback.format_exc())
                raise
            
            logger.info(f"📦 [{wallet_address[:8]}...] Raw response type: {type(transaction)}")
            logger.info(f"📦 [{wallet_address[:8]}...] Response: {str(transaction)[:200]}...")
            logger.info(f"📦 [{wallet_address[:8]}...] Has value attr: {hasattr(transaction, 'value')}")
            
            if hasattr(transaction, 'value'):
                logger.info(f"📦 [{wallet_address[:8]}...] Value type: {type(transaction.value)}")
                logger.info(f"📦 [{wallet_address[:8]}...] Value is None: {transaction.value is None}")
                logger.info(f"📦 [{wallet_address[:8]}...] Value bool: {bool(transaction.value)}")
            
            if not transaction.value:
                logger.warning(f"⚠️  [{wallet_address[:8]}...] Transaction not found or not confirmed yet")
                return
                
            # Get wallet record from database
            wallet_doc = await self.db.temporary_wallets.find_one(
                {"wallet_address": wallet_address}
            )
            
            if not wallet_doc:
                logger.error(f"❌ [{wallet_address[:8]}...] No wallet record found in database!")
                return
            
            logger.info(f"📄 [{wallet_address[:8]}...] Wallet record found. User: {wallet_doc['user_id']}, Required: {wallet_doc['required_sol']} SOL")
                
            if wallet_doc.get("payment_detected"):
                logger.info(f"⏭️  [{wallet_address[:8]}...] Payment already detected and processed")
                return  # Already processed this wallet
            
            # Calculate received amount
            tx_data = transaction.value
            
            logger.info(f"🔍 [{wallet_address[:8]}...] Parsing transaction data...")
            
            # Check if this is an incoming transfer to our wallet
            wallet_pubkey = Pubkey.from_string(wallet_address)
            received_lamports = 0
            
            # Parse transaction for SOL transfers to our address
            if tx_data.transaction.meta and tx_data.transaction.meta.post_balances:
                # Find our wallet in the account keys
                account_keys = tx_data.transaction.transaction.message.account_keys
                
                logger.info(f"🔑 [{wallet_address[:8]}...] Transaction has {len(account_keys)} accounts")
                
                for i, account_key in enumerate(account_keys):
                    if account_key == wallet_pubkey:
                        # This is our wallet, check balance change
                        pre_balance = tx_data.transaction.meta.pre_balances[i] if i < len(tx_data.transaction.meta.pre_balances) else 0
                        post_balance = tx_data.transaction.meta.post_balances[i] if i < len(tx_data.transaction.meta.post_balances) else 0
                        
                        logger.info(f"💵 [{wallet_address[:8]}...] Balance change: {pre_balance} → {post_balance} lamports")
                        
                        if post_balance > pre_balance:
                            received_lamports = post_balance - pre_balance
                            logger.info(f"✅ [{wallet_address[:8]}...] Received {received_lamports} lamports!")
                            break
                else:
                    logger.warning(f"⚠️  [{wallet_address[:8]}...] Wallet not found in transaction accounts")
            else:
                logger.warning(f"⚠️  [{wallet_address[:8]}...] No transaction metadata or balance data")
            
            if received_lamports == 0:
                logger.warning(f"⚠️  [{wallet_address[:8]}...] No SOL received in this transaction")
                return  # No SOL received in this transaction
            
            received_sol = Decimal(received_lamports) / Decimal(LAMPORTS_PER_SOL)
            required_sol = Decimal(wallet_doc["required_sol"])
            
            logger.info(f"💰 [{wallet_address[:8]}...] Payment detected: {received_sol} SOL received (required: {required_sol} SOL)")
            
            # Update wallet record
            await self.db.temporary_wallets.update_one(
                {"wallet_address": wallet_address},
                {
                    "$set": {
                        "payment_detected": True,
                        "received_lamports": received_lamports,
                        "received_sol": float(received_sol),
                        "transaction_signature": signature,
                        "payment_detected_at": datetime.now(timezone.utc),
                        "status": "payment_received"
                    }
                }
            )
            
            # Check if payment is sufficient (with 0.001 SOL tolerance)
            tolerance = Decimal("0.001")
            if received_sol >= (required_sol - tolerance):
                logger.info(f"✅ [{wallet_address[:8]}...] Payment sufficient! Crediting tokens...")
                # Credit tokens to user
                await self.credit_tokens_to_user(wallet_doc, received_sol)
                
                logger.info(f"💸 [{wallet_address[:8]}...] Forwarding SOL to main wallet...")
                # Forward SOL to main wallet
                await self.forward_sol_to_main_wallet(wallet_address, wallet_doc["private_key"], received_lamports)
            else:
                logger.warning(f"❌ [{wallet_address[:8]}...] Insufficient payment: {received_sol} SOL < {required_sol} SOL required (tolerance: {tolerance} SOL)")
                await self.db.temporary_wallets.update_one(
                    {"wallet_address": wallet_address},
                    {"$set": {"status": "insufficient_payment"}}
                )
                
        except Exception as e:
            import traceback
            logger.error(f"❌ Error processing payment for {wallet_address}:")
            logger.error(f"   {str(e)}")
            logger.error(f"   Traceback:\n{traceback.format_exc()}")
    
    async def credit_tokens_to_user(self, wallet_doc: Dict, received_sol: Decimal):
        """Credit tokens to user account based on payment received using dynamic pricing"""
        try:
            user_id = wallet_doc["user_id"]
            wallet_address = wallet_doc["wallet_address"]
            expected_tokens = wallet_doc["token_amount"]
            
            logger.info(f"🎁 [Credit] User: {user_id}, Expected tokens: {expected_tokens}")
            
            # Get current SOL/EUR price for accurate token calculation
            sol_eur_price = await self.price_fetcher.get_sol_eur_price()
            
            # Calculate actual tokens based on received payment and live price
            # Formula: SOL amount × SOL/EUR price × 100 tokens/EUR
            actual_tokens = self.price_fetcher.calculate_tokens_from_sol(float(received_sol), sol_eur_price)
            
            logger.info(f"💎 [Credit] Calculated tokens: {actual_tokens} (at {sol_eur_price} EUR/SOL)")
            
            # Don't credit more than requested (handle overpayment gracefully)
            actual_tokens = min(actual_tokens, expected_tokens)
            
            logger.info(f"💳 [Credit] Updating user balance: +{actual_tokens} tokens")
            
            # Update user balance
            result = await self.db.users.update_one(
                {"id": user_id},
                {"$inc": {"token_balance": actual_tokens}}
            )
            
            logger.info(f"📊 [Credit] Database update result: modified={result.modified_count}, matched={result.matched_count}")
            
            if result.modified_count > 0:
                eur_value = float(received_sol) * sol_eur_price
                logger.info(f"✅ [Credit] SUCCESS! Credited {actual_tokens} tokens to user {user_id} for {received_sol} SOL (€{eur_value:.2f} at {sol_eur_price} EUR/SOL)")
                
                # Mark wallet as tokens credited
                await self.db.temporary_wallets.update_one(
                    {"wallet_address": wallet_doc["wallet_address"]},
                    {
                        "$set": {
                            "tokens_credited": True,
                            "actual_tokens_credited": actual_tokens,
                            "sol_eur_price_at_credit": sol_eur_price,
                            "eur_value": eur_value,
                            "tokens_credited_at": datetime.now(timezone.utc),
                            "status": "tokens_credited"
                        }
                    }
                )
                
                # Create transaction history record
                await self.db.token_purchases.insert_one({
                    "user_id": user_id,
                    "wallet_address": wallet_doc["wallet_address"],
                    "transaction_signature": wallet_doc.get("transaction_signature"),
                    "sol_amount": float(received_sol),
                    "sol_eur_price": sol_eur_price,
                    "eur_value": eur_value,
                    "tokens_purchased": actual_tokens,
                    "purchase_date": datetime.now(timezone.utc),
                    "status": "completed"
                })
                
            else:
                logger.error(f"Failed to update balance for user {user_id}")
                
        except Exception as e:
            logger.error(f"Error crediting tokens to user: {str(e)}")
    
    async def forward_sol_to_main_wallet(self, wallet_address: str, private_key_bytes_list: list, amount_lamports: int):
        """
        Forward received SOL to the main project wallet with retry logic
        
        Args:
            wallet_address: Source wallet address
            private_key_bytes_list: Private key as byte array
            amount_lamports: Amount to forward in lamports
        """
        max_retries = 3
        retry_delay = 5  # seconds
        
        for attempt in range(1, max_retries + 1):
            try:
                logger.info(f"💸 [Sweep] Attempt {attempt}/{max_retries} - Forwarding from {wallet_address[:8]}...")
                logger.info(f"💸 [Sweep] Amount: {amount_lamports} lamports ({amount_lamports/LAMPORTS_PER_SOL:.6f} SOL)")
                logger.info(f"💸 [Sweep] Destination: {self.main_wallet}")
                logger.info(f"💸 [Sweep] RPC: {self.client._provider.endpoint_uri}")
                
                # Reconstruct keypair from stored byte array
                private_key_bytes = bytes(private_key_bytes_list)
                temp_keypair = Keypair.from_bytes(private_key_bytes)
                
                source_wallet = str(temp_keypair.pubkey())
                logger.info(f"💸 [Sweep] Source wallet (reconstructed): {source_wallet}")
                
                # Verify it matches
                if source_wallet != wallet_address:
                    logger.error(f"❌ [Sweep] Wallet mismatch! Expected {wallet_address}, got {source_wallet}")
                    raise ValueError("Wallet address mismatch")
                
                # Reserve lamports for transaction fee (5000 lamports = 0.000005 SOL)
                fee_lamports = 5000
                transfer_amount = amount_lamports - fee_lamports
                
                if transfer_amount <= 0:
                    logger.warning(f"💸 [Sweep] Insufficient balance after fees: {amount_lamports} lamports")
                    return
                
                logger.info(f"💸 [Sweep] Transfer amount (after fee): {transfer_amount} lamports ({transfer_amount/LAMPORTS_PER_SOL:.6f} SOL)")
                
                # Create transfer instruction
                transfer_instruction = transfer(
                    TransferParams(
                        from_pubkey=temp_keypair.pubkey(),
                        to_pubkey=self.main_wallet,
                        lamports=transfer_amount
                    )
                )
                
                logger.info(f"💸 [Sweep] Getting recent blockhash...")
                # Get recent blockhash
                recent_blockhash_response = await self.client.get_latest_blockhash()
                recent_blockhash = recent_blockhash_response.value.blockhash
                logger.info(f"💸 [Sweep] Blockhash obtained: {recent_blockhash}")
                
                # Create transaction message
                message = MessageV0.try_compile(
                    payer=temp_keypair.pubkey(),
                    instructions=[transfer_instruction],
                    address_lookup_table_accounts=[],
                    recent_blockhash=recent_blockhash
                )
                
                # Create and sign versioned transaction
                transaction = VersionedTransaction(message, [temp_keypair])
                logger.info(f"💸 [Sweep] Transaction created and signed")
                
                # Send transaction
                logger.info(f"💸 [Sweep] Sending transaction to network...")
                response = await self.client.send_transaction(transaction)
                
                if response.value:
                    signature = str(response.value)
                    transfer_sol = transfer_amount / LAMPORTS_PER_SOL
                    
                    logger.info(f"✅ [Sweep] SUCCESS!")
                    logger.info(f"✅ [Sweep] From: {wallet_address}")
                    logger.info(f"✅ [Sweep] To: {self.main_wallet}")
                    logger.info(f"✅ [Sweep] Amount: {transfer_sol:.6f} SOL")
                    logger.info(f"✅ [Sweep] TxSig: {signature}")
                    logger.info(f"✅ [Sweep] Explorer: https://explorer.solana.com/tx/{signature}?cluster=devnet")
                    
                    # Update wallet record
                    await self.db.temporary_wallets.update_one(
                        {"wallet_address": wallet_address},
                        {
                            "$set": {
                                "sol_forwarded": True,
                                "forward_signature": signature,
                                "forwarded_amount_lamports": transfer_amount,
                                "forwarded_at": datetime.now(timezone.utc),
                                "status": "completed",
                                "sweep_attempts": attempt
                            }
                        }
                    )
                    
                    # Clean up wallet data after successful forwarding
                    await asyncio.sleep(60)  # Wait 1 minute before cleanup
                    await self.cleanup_wallet_data(wallet_address)
                    
                    return  # Success! Exit retry loop
                    
                else:
                    logger.error(f"❌ [Sweep] No transaction signature returned on attempt {attempt}")
                    if attempt < max_retries:
                        logger.info(f"⏳ [Sweep] Retrying in {retry_delay} seconds...")
                        await asyncio.sleep(retry_delay)
                    else:
                        logger.error(f"❌ [Sweep] All {max_retries} attempts failed - no signature")
                        raise Exception("Failed to get transaction signature")
                    
            except Exception as e:
                logger.error(f"❌ [Sweep] Attempt {attempt} failed: {type(e).__name__}: {str(e)}")
                import traceback
                logger.error(f"❌ [Sweep] Traceback:\n{traceback.format_exc()}")
                
                if attempt < max_retries:
                    logger.info(f"⏳ [Sweep] Retrying in {retry_delay} seconds...")
                    await asyncio.sleep(retry_delay)
                else:
                    logger.error(f"❌ [Sweep] All {max_retries} attempts exhausted!")
                    # Mark for manual review
                    await self.db.temporary_wallets.update_one(
                        {"wallet_address": wallet_address},
                        {
                            "$set": {
                                "status": "forward_failed",
                                "forward_error": str(e),
                                "sweep_attempts": attempt
                            }
                        }
                    )
                    raise
    
    async def cleanup_wallet_data(self, wallet_address: str):
        """Clean up temporary wallet data after successful processing"""
        try:
            # Remove private key and mark as cleaned up
            await self.db.temporary_wallets.update_one(
                {"wallet_address": wallet_address},
                {
                    "$unset": {"private_key": ""},
                    "$set": {
                        "cleaned_up": True,
                        "cleaned_up_at": datetime.now(timezone.utc),
                        "status": "cleaned_up"
                    }
                }
            )
            logger.info(f"🧹 Cleaned up wallet data for {wallet_address}")
            
        except Exception as e:
            logger.error(f"Error cleaning up wallet {wallet_address}: {str(e)}")
    
    async def get_purchase_status(self, user_id: str, wallet_address: str) -> Dict[str, Any]:
        """Get the status of a token purchase"""
        try:
            wallet_doc = await self.db.temporary_wallets.find_one({
                "wallet_address": wallet_address,
                "user_id": user_id
            })
            
            if not wallet_doc:
                return {"status": "not_found", "message": "Purchase not found"}
            
            status_info = {
                "status": wallet_doc.get("status", "pending"),
                "wallet_address": wallet_address,
                "required_sol": wallet_doc["required_sol"],
                "token_amount": wallet_doc["token_amount"],
                "created_at": wallet_doc["created_at"].isoformat(),
                "payment_detected": wallet_doc.get("payment_detected", False),
                "tokens_credited": wallet_doc.get("tokens_credited", False),
                "sol_forwarded": wallet_doc.get("sol_forwarded", False)
            }
            
            if wallet_doc.get("received_sol"):
                status_info["received_sol"] = wallet_doc["received_sol"]
                
            if wallet_doc.get("transaction_signature"):
                status_info["transaction_signature"] = wallet_doc["transaction_signature"]
                
            return status_info
            
        except Exception as e:
            logger.error(f"Error getting purchase status: {str(e)}")
            return {"status": "error", "message": str(e)}
    
    async def get_sol_eur_price(self) -> float:
        """Get current SOL/EUR exchange rate"""
        return await self.price_fetcher.get_sol_eur_price()
    
    async def rescan_pending_payments(self):
        """
        Redundant payment detection system - periodically checks all pending wallets
        This catches payments that were missed by the real-time monitoring system
        """
        try:
            logger.info("🔍 [Rescan] Starting periodic payment rescan...")
            
            # Get all pending wallets (not expired, not already processed)
            pending_wallets = await self.db.temporary_wallets.find({
                "status": {"$in": ["pending", "monitoring"]},
                "payment_detected": False,
                "tokens_credited": False
            }).to_list(length=None)
            
            if not pending_wallets:
                logger.info("🔍 [Rescan] No pending wallets to check")
                return
            
            logger.info(f"🔍 [Rescan] Found {len(pending_wallets)} pending wallets to check")
            
            for wallet_doc in pending_wallets:
                try:
                    wallet_address = wallet_doc["wallet_address"]
                    expected_sol = Decimal(str(wallet_doc["required_sol"]))
                    user_id = wallet_doc["user_id"]
                    
                    # Check wallet balance on-chain
                    pubkey = Pubkey.from_string(wallet_address)
                    balance_response = await self.client.get_balance(pubkey, commitment=Confirmed)
                    
                    if not balance_response.value:
                        continue
                    
                    balance_lamports = balance_response.value
                    balance_sol = Decimal(balance_lamports) / Decimal(LAMPORTS_PER_SOL)
                    
                    if balance_sol == 0:
                        continue  # No payment received yet
                    
                    logger.info(f"💰 [Rescan] Wallet {wallet_address[:8]}... has balance: {balance_sol} SOL (expected: {expected_sol} SOL)")
                    
                    # Check if payment amount matches (with tolerance)
                    tolerance = Decimal("0.001")
                    if balance_sol >= (expected_sol - tolerance):
                        logger.info(f"✅ [Rescan] PAYMENT DETECTED! Wallet: {wallet_address[:8]}... | Amount: {balance_sol} SOL | User: {user_id}")
                        
                        # Use atomic update to prevent duplicate processing
                        update_result = await self.db.temporary_wallets.update_one(
                            {
                                "wallet_address": wallet_address,
                                "payment_detected": False,  # Only update if not already processed
                                "tokens_credited": False
                            },
                            {
                                "$set": {
                                    "payment_detected": True,
                                    "status": "detected_by_rescan",
                                    "detected_at": datetime.now(timezone.utc)
                                }
                            }
                        )
                        
                        # If we successfully marked it as detected, process the payment
                        if update_result.modified_count > 0:
                            logger.info(f"🎁 [Rescan] Processing payment for user {user_id}...")
                            
                            # Credit tokens to user
                            await self.credit_tokens_to_user(wallet_doc, balance_sol)
                            
                            # Forward SOL to main wallet
                            logger.info(f"💸 [Rescan] Forwarding {balance_lamports} lamports to main wallet...")
                            await self.forward_sol_to_main_wallet(
                                wallet_address,
                                wallet_doc["private_key"],
                                balance_lamports
                            )
                            
                            logger.info(f"✅ [Rescan] Payment processing complete for wallet {wallet_address[:8]}...")
                        else:
                            logger.info(f"⏭️  [Rescan] Wallet {wallet_address[:8]}... already being processed by another task")
                    else:
                        logger.info(f"⚠️  [Rescan] Insufficient payment: {balance_sol} SOL < {expected_sol} SOL (tolerance: {tolerance})")
                        
                except Exception as wallet_error:
                    logger.error(f"❌ [Rescan] Error checking wallet {wallet_doc.get('wallet_address', 'unknown')}: {wallet_error}")
                    import traceback
                    logger.error(traceback.format_exc())
                    continue
            
            logger.info(f"🔍 [Rescan] Scan complete")
            
        except Exception as e:
            logger.error(f"❌ [Rescan] Error in payment rescan: {e}")
            import traceback
            logger.error(traceback.format_exc())

# Global processor instance
processor = None

def get_processor(db: AsyncIOMotorDatabase) -> SolanaPaymentProcessor:
    """Get or create the global payment processor instance"""
    global processor
    if processor is None:
        processor = SolanaPaymentProcessor(db)
    return processor