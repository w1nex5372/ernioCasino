"""
Manual Token Credit Logging System
Tracks all manual token adjustments for audit purposes
"""

import logging
from datetime import datetime, timezone
from typing import Optional
from motor.motor_asyncio import AsyncIOMotorDatabase

logger = logging.getLogger(__name__)

class ManualCreditLogger:
    """Logs all manual token credits for audit trail"""
    
    def __init__(self, db: AsyncIOMotorDatabase):
        self.db = db
        self.log_path = "/app/backend/logs/manual_credits.log"
        
    async def log_manual_credit(self, 
                               user_id: str,
                               telegram_id: int,
                               amount: int,
                               reason: str,
                               admin_id: Optional[str] = None,
                               transaction_reference: Optional[str] = None):
        """
        Log a manual token credit operation
        
        Args:
            user_id: User's unique ID
            telegram_id: User's Telegram ID
            amount: Amount of tokens credited
            reason: Reason for manual credit
            admin_id: ID of admin who performed the credit
            transaction_reference: Reference to related transaction (if any)
        """
        try:
            timestamp = datetime.now(timezone.utc)
            
            # Create log entry
            log_entry = {
                "timestamp": timestamp,
                "user_id": user_id,
                "telegram_id": telegram_id,
                "tokens_credited": amount,
                "reason": reason,
                "admin_id": admin_id,
                "transaction_reference": transaction_reference,
                "log_type": "manual_credit"
            }
            
            # Store in database
            await self.db.manual_credit_log.insert_one(log_entry)
            
            # Write to file log
            log_message = (
                f"[{timestamp.isoformat()}] MANUAL CREDIT\n"
                f"  User ID: {user_id}\n"
                f"  Telegram ID: {telegram_id}\n"
                f"  Amount: {amount} tokens\n"
                f"  Reason: {reason}\n"
                f"  Admin: {admin_id or 'system'}\n"
                f"  Transaction Ref: {transaction_reference or 'N/A'}\n"
                "  " + "-" * 60
            )
            
            import os
            os.makedirs("/app/backend/logs", exist_ok=True)
            
            with open(self.log_path, 'a') as f:
                f.write(log_message + "\n")
            
            logger.info(f"📝 Manual credit logged: {amount} tokens to user {telegram_id}")
            
            return True
            
        except Exception as e:
            logger.error(f"❌ Failed to log manual credit: {e}")
            return False
    
    async def get_user_manual_credits(self, user_id: str, limit: int = 10):
        """Get manual credit history for a specific user"""
        try:
            credits = await self.db.manual_credit_log.find(
                {"user_id": user_id}
            ).sort("timestamp", -1).limit(limit).to_list(length=limit)
            
            return credits
            
        except Exception as e:
            logger.error(f"Error fetching manual credits: {e}")
            return []
    
    async def get_recent_manual_credits(self, limit: int = 50):
        """Get recent manual credits across all users"""
        try:
            credits = await self.db.manual_credit_log.find().sort(
                "timestamp", -1
            ).limit(limit).to_list(length=limit)
            
            return credits
            
        except Exception as e:
            logger.error(f"Error fetching recent credits: {e}")
            return []


async def credit_tokens_manually(db: AsyncIOMotorDatabase,
                                 telegram_id: int,
                                 amount: int,
                                 reason: str,
                                 transaction_signature: Optional[str] = None):
    """
    Safely credit tokens to a user with full logging
    
    Args:
        db: Database connection
        telegram_id: User's Telegram ID
        amount: Tokens to credit
        reason: Reason for manual credit
        transaction_signature: Solana transaction signature (if recovering payment)
    
    Returns:
        Dictionary with result
    """
    try:
        # Find user
        user = await db.users.find_one({"telegram_id": telegram_id})
        
        if not user:
            return {
                "success": False,
                "error": f"User with Telegram ID {telegram_id} not found"
            }
        
        user_id = user.get('user_id')
        old_balance = user.get('token_balance', 0)
        
        # Credit tokens
        result = await db.users.update_one(
            {"telegram_id": telegram_id},
            {"$inc": {"token_balance": amount}}
        )
        
        if result.modified_count == 0:
            return {
                "success": False,
                "error": "Failed to update user balance"
            }
        
        # Log the manual credit
        credit_logger = ManualCreditLogger(db)
        await credit_logger.log_manual_credit(
            user_id=user_id,
            telegram_id=telegram_id,
            amount=amount,
            reason=reason,
            admin_id="system",
            transaction_reference=transaction_signature
        )
        
        # Get new balance
        updated_user = await db.users.find_one({"telegram_id": telegram_id})
        new_balance = updated_user.get('token_balance', 0)
        
        logger.info(
            f"✅ Manual credit successful: {amount} tokens to user {telegram_id} "
            f"(balance: {old_balance} → {new_balance})"
        )
        
        return {
            "success": True,
            "user_id": user_id,
            "telegram_id": telegram_id,
            "tokens_credited": amount,
            "old_balance": old_balance,
            "new_balance": new_balance,
            "reason": reason
        }
        
    except Exception as e:
        logger.error(f"❌ Manual credit failed: {e}")
        return {
            "success": False,
            "error": str(e)
        }
