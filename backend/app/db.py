import os
import sqlite3
from pathlib import Path

DB_PATH = os.getenv("DB_PATH", "./app.db")

SCHEMA_PATH = Path(__file__).parent / "schema.sql"


def connect() -> sqlite3.Connection:
    # check_same_thread=False が要る。FastAPI は同期の依存関係をスレッドプールで
    # 動かすので、接続を開いたスレッドと閉じるスレッドが別になることがある。
    # 接続はリクエストごとに作って捨てるため、同時に2つのスレッドが
    # 同じ接続を触ることはない。
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    # 行をカラム名で引けるようにする（row["title"] や dict(row) が使える）
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def get_db():
    """FastAPI の Depends 用。リクエストごとに接続を開いて閉じる。"""
    conn = connect()
    try:
        yield conn
    finally:
        conn.close()


def init_db() -> None:
    with connect() as conn:
        conn.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
