"""
Solana Blockchain Integration for Automatic Token Purchase System
Handles wallet generation, payment monitoring, and SOL forwarding
"""

import asyncio
import os
import logging
from datetime import datetime, timezone
from typing import Optional, Dict, Any
import json
import time
from decimal import Decimal

from solders.keypair import Keypair
from solders.pubkey import Pubkey
from solana.rpc.async_api import AsyncClient
from solana.rpc.commitment import Confirmed, Finalized
from solana.rpc.types import TxOpts
from solana.transaction import Transaction
from solders.system_program import TransferParams, transfer
from solders.hash import Hash
from motor.motor_asyncio import AsyncIOMotorDatabase

# Configuration
SOLANA_RPC_URL = os.environ.get('SOLANA_RPC_URL', 'https://api.devnet.solana.com')
MAIN_WALLET_ADDRESS = os.environ.get('MAIN_WALLET_ADDRESS', 'EC2cPxi4VbyzGoWMucHQ6LwkWz1W9vZE7ZApcY9PFsMy')
SOL_TO_TOKEN_RATE = int(os.environ.get('SOL_TO_TOKEN_RATE', 100))  # 1 SOL = 100 tokens
LAMPORTS_PER_SOL = 1_000_000_000  # 1 SOL = 1 billion lamports

logger = logging.getLogger(__name__)

class SolanaPaymentProcessor:
    """Handles Solana payment processing for automatic token purchases"""
    
    def __init__(self, db: AsyncIOMotorDatabase):
        self.db = db
        self.client = AsyncClient(SOLANA_RPC_URL)
        self.main_wallet = Pubkey.from_string(MAIN_WALLET_ADDRESS)
        self.active_monitors = set()  # Track active payment monitors
        
    async def create_payment_wallet(self, user_id: str, token_amount: int) -> Dict[str, Any]:
        """
        Generate a unique wallet address for a token purchase
        
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
            
            # Calculate required SOL amount (with some buffer for fees)
            required_sol = Decimal(token_amount) / Decimal(SOL_TO_TOKEN_RATE)
            required_lamports = int(required_sol * LAMPORTS_PER_SOL)
            
            # Store temporary wallet in database (encrypt private key in production)
            wallet_data = {
                "wallet_address": wallet_address,
                "private_key": keypair.secret().hex(),  # In production: encrypt this!
                "user_id": user_id,
                "token_amount": token_amount,
                "required_sol": float(required_sol),
                "required_lamports": required_lamports,
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
            
            logger.info(f"Created payment wallet {wallet_address} for user {user_id} ({token_amount} tokens, {required_sol} SOL)")
            
            return {
                "wallet_address": wallet_address,
                "required_sol": float(required_sol),
                "token_amount": token_amount,
                "expires_at": wallet_data["expires_at"].isoformat(),
                "instructions": f"Send exactly {required_sol} SOL to address {wallet_address}. Tokens will be credited automatically within 1-2 minutes."
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
            max_checks = 180  # Monitor for 30 minutes (180 * 10 seconds)
            
            while check_count < max_checks:
                try:
                    check_count += 1
                    
                    # Get recent signatures for this address
                    response = await self.client.get_signatures_for_address(
                        pubkey, 
                        commitment=Confirmed,
                        limit=10
                    )
                    
                    if response.value:
                        signatures = response.value
                        
                        # Check for new signatures
                        for sig_info in signatures:
                            signature = str(sig_info.signature)
                            
                            if signature != last_signature:
                                # New transaction detected, check if it's an incoming payment
                                await self.process_detected_payment(wallet_address, signature)
                                last_signature = signature
                    
                    # Check if wallet has been processed (payment found and handled)
                    wallet_doc = await self.db.temporary_wallets.find_one(
                        {"wallet_address": wallet_address}
                    )
                    
                    if wallet_doc and wallet_doc.get("tokens_credited"):
                        logger.info(f"✅ Wallet {wallet_address} successfully processed, stopping monitor")
                        break
                        
                    # Wait 10 seconds before next check
                    await asyncio.sleep(10)
                    
                except Exception as e:
                    logger.warning(f"Error checking wallet {wallet_address}: {str(e)}")
                    await asyncio.sleep(10)
                    continue
            
            if check_count >= max_checks:
                logger.warning(f"⏰ Payment monitoring timeout for wallet {wallet_address}")
                # Mark wallet as expired
                await self.db.temporary_wallets.update_one(
                    {"wallet_address": wallet_address},
                    {"$set": {"status": "expired", "updated_at": datetime.now(timezone.utc)}}
                )
                
        except Exception as e:
            logger.error(f"Error in payment monitoring for {wallet_address}: {str(e)}")
        finally:
            self.active_monitors.discard(wallet_address)
            logger.info(f"🛑 Stopped monitoring wallet: {wallet_address}")
    
    async def process_detected_payment(self, wallet_address: str, signature: str):
        """
        Process a detected payment transaction
        
        Args:
            wallet_address: The wallet that received payment
            signature: The transaction signature to analyze
        """
        try:
            # Get transaction details
            transaction = await self.client.get_transaction(
                signature, 
                commitment=Finalized,
                max_supported_transaction_version=0
            )
            
            if not transaction.value:
                return
                
            # Get wallet record from database
            wallet_doc = await self.db.temporary_wallets.find_one(
                {"wallet_address": wallet_address}
            )
            
            if not wallet_doc:
                logger.warning(f"No wallet record found for {wallet_address}")
                return
                
            if wallet_doc.get("payment_detected"):
                return  # Already processed this wallet
            
            # Calculate received amount
            tx_data = transaction.value
            
            # Check if this is an incoming transfer to our wallet
            wallet_pubkey = Pubkey.from_string(wallet_address)
            received_lamports = 0
            
            # Parse transaction for SOL transfers to our address
            if tx_data.transaction.meta and tx_data.transaction.meta.post_balances:
                # Find our wallet in the account keys
                account_keys = tx_data.transaction.transaction.message.account_keys
                
                for i, account_key in enumerate(account_keys):
                    if account_key == wallet_pubkey:
                        # This is our wallet, check balance change
                        pre_balance = tx_data.transaction.meta.pre_balances[i] if i < len(tx_data.transaction.meta.pre_balances) else 0
                        post_balance = tx_data.transaction.meta.post_balances[i] if i < len(tx_data.transaction.meta.post_balances) else 0
                        
                        if post_balance > pre_balance:
                            received_lamports = post_balance - pre_balance
                            break
            
            if received_lamports == 0:
                return  # No SOL received in this transaction
            
            received_sol = Decimal(received_lamports) / Decimal(LAMPORTS_PER_SOL)
            required_sol = Decimal(wallet_doc["required_sol"])
            
            logger.info(f"💰 Payment detected: {received_sol} SOL received (required: {required_sol} SOL)")
            
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
            
            # Check if payment is sufficient
            if received_sol >= required_sol:
                # Credit tokens to user
                await self.credit_tokens_to_user(wallet_doc, received_sol)
                
                # Forward SOL to main wallet
                await self.forward_sol_to_main_wallet(wallet_address, wallet_doc["private_key"], received_lamports)
            else:
                logger.warning(f"Insufficient payment: {received_sol} SOL < {required_sol} SOL required")
                await self.db.temporary_wallets.update_one(
                    {"wallet_address": wallet_address},
                    {"$set": {"status": "insufficient_payment"}}
                )
                
        except Exception as e:
            logger.error(f"Error processing payment for {wallet_address}: {str(e)}")
    
    async def credit_tokens_to_user(self, wallet_doc: Dict, received_sol: Decimal):
        """Credit tokens to user account based on payment received"""
        try:
            user_id = wallet_doc["user_id"]
            expected_tokens = wallet_doc["token_amount"]
            
            # Calculate actual tokens based on payment (handle overpayment)
            actual_tokens = min(expected_tokens, int(received_sol * SOL_TO_TOKEN_RATE))
            
            # Update user balance
            result = await self.db.users.update_one(
                {"id": user_id},
                {"$inc": {"token_balance": actual_tokens}}
            )
            
            if result.modified_count > 0:
                logger.info(f"✅ Credited {actual_tokens} tokens to user {user_id}")
                
                # Mark wallet as tokens credited
                await self.db.temporary_wallets.update_one(
                    {"wallet_address": wallet_doc["wallet_address"]},
                    {
                        "$set": {
                            "tokens_credited": True,
                            "actual_tokens_credited": actual_tokens,
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
                    "sol_amount": wallet_doc["received_sol"],
                    "tokens_purchased": actual_tokens,
                    "purchase_date": datetime.now(timezone.utc),
                    "status": "completed"
                })
                
            else:
                logger.error(f"Failed to update balance for user {user_id}")
                
        except Exception as e:
            logger.error(f"Error crediting tokens to user: {str(e)}")
    
    async def forward_sol_to_main_wallet(self, wallet_address: str, private_key_hex: str, amount_lamports: int):
        """Forward received SOL to the main project wallet"""
        try:
            # Reconstruct keypair from private key
            private_key_bytes = bytes.fromhex(private_key_hex)
            keypair = Keypair.from_bytes(private_key_bytes)
            
            # Reserve some lamports for transaction fee (5000 lamports = 0.000005 SOL)
            fee_lamports = 5000
            transfer_amount = amount_lamports - fee_lamports
            
            if transfer_amount <= 0:
                logger.warning(f"Insufficient balance to forward after fees: {amount_lamports} lamports")
                return
            
            # Create transfer instruction
            transfer_instruction = transfer(
                TransferParams(
                    from_pubkey=keypair.pubkey(),
                    to_pubkey=self.main_wallet,
                    lamports=transfer_amount
                )
            )
            
            # Get recent blockhash
            recent_blockhash_response = await self.client.get_latest_blockhash()
            recent_blockhash = recent_blockhash_response.value.blockhash
            
            # Create and sign transaction
            transaction = Transaction(recent_blockhash=recent_blockhash)
            transaction.add(transfer_instruction)
            transaction.sign(keypair)
            
            # Send transaction
            response = await self.client.send_transaction(transaction)
            
            if response.value:
                signature = str(response.value)
                logger.info(f"🚀 SOL forwarded to main wallet. Signature: {signature}")
                
                # Update wallet record
                await self.db.temporary_wallets.update_one(
                    {"wallet_address": wallet_address},
                    {
                        "$set": {
                            "sol_forwarded": True,
                            "forward_signature": signature,
                            "forwarded_at": datetime.now(timezone.utc),
                            "status": "completed"
                        }
                    }
                )
                
                # Clean up wallet data after successful forwarding (optional delay)
                await asyncio.sleep(60)  # Wait 1 minute before cleanup
                await self.cleanup_wallet_data(wallet_address)
                
            else:
                logger.error("Failed to forward SOL - no transaction signature returned")
                
        except Exception as e:
            logger.error(f"Error forwarding SOL from {wallet_address}: {str(e)}")
            # Mark for manual review
            await self.db.temporary_wallets.update_one(
                {"wallet_address": wallet_address},
                {"$set": {"status": "forward_failed", "forward_error": str(e)}}
            )
    
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

# Global processor instance
processor = None

def get_processor(db: AsyncIOMotorDatabase) -> SolanaPaymentProcessor:
    """Get or create the global payment processor instance"""
    global processor
    if processor is None:
        processor = SolanaPaymentProcessor(db)
    return processor