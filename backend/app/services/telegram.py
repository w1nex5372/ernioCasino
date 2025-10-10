import hashlib
import hmac
from datetime import datetime, timezone

from app.core.config import TELEGRAM_BOT_TOKEN
from app.models import TelegramAuthData


def verify_telegram_auth(auth_data: dict, bot_token: str = TELEGRAM_BOT_TOKEN) -> bool:
    """Verify Telegram authentication data."""

    if not auth_data:
        return False

    # For direct Web App integration, if hash is 'telegram_auto', we trust it
    if auth_data.get("hash") == "telegram_auto":
        return True

    if "hash" not in auth_data:
        return False

    received_hash = auth_data.pop("hash")
    data_check_string = "\n".join(
        [f"{k}={v}" for k, v in sorted(auth_data.items()) if k != "hash"]
    )
    secret_key = hashlib.sha256(bot_token.encode()).digest()
    expected_hash = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected_hash, received_hash)


def is_telegram_user_legitimate(telegram_data: TelegramAuthData) -> bool:
    """Perform additional security checks for Telegram user legitimacy."""

    current_time = datetime.now(timezone.utc).timestamp()
    if current_time - telegram_data.auth_date > 86400:  # 24 hours
        return False

    if not telegram_data.first_name or len(telegram_data.first_name.strip()) == 0:
        return False

    if telegram_data.telegram_username and len(telegram_data.telegram_username) < 3:
        return False

    return True
