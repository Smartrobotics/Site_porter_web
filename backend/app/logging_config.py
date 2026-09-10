"""ログ設定。

uvicorn は自分用のロガーしか設定しないため、これを呼ばないと
アプリ側の log.info() は表示されない（WARNING 以上だけが素の形で出る）。
出力先は標準エラー。ファイルには書かない（docker compose logs で見るため）。
"""

import logging
import os

# 本番は INFO、詳しく見たいときは docker-compose.yml で LOG_LEVEL=DEBUG にする
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()

FORMAT = "%(asctime)s %(levelname)-8s %(name)s: %(message)s"


def setup_logging() -> None:
    logging.basicConfig(level=LOG_LEVEL, format=FORMAT, force=True)

    # uvicorn のアクセスログも同じ書式に揃える
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        logger = logging.getLogger(name)
        logger.handlers.clear()
        logger.propagate = True
