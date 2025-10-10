import logging


def configure_logging() -> logging.Logger:
    """Configure application-wide logging and return a module logger."""

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    )
    return logging.getLogger(__name__)
