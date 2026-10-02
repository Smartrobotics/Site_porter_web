import logging
import os

LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()

FORMAT = "%(asctime)s %(levelname)-8s %(name)s: %(message)s"


def setup_logging() -> None:
    logging.basicConfig(level=LOG_LEVEL, format=FORMAT, force=True)

    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        logger = logging.getLogger(name)
        logger.handlers.clear()
        logger.propagate = True
