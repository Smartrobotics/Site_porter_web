import os
import sqlite3
from pathlib import Path

DB_PATH = os.getenv("DB_PATH", "./app.db")

SCHEMA_PATH = Path(__file__).parent / "schema.sql"


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout = 5000")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def get_db():
    conn = connect()
    try:
        yield conn
    finally:
        conn.close()


_ADDED_COLUMNS = [
    ("request", "from_home", "INTEGER NOT NULL DEFAULT 0"),
    ("robot", "floor", "INTEGER NOT NULL DEFAULT 2"),
    ("robot", "homing_floor", "INTEGER"),
    ("robot", "stuck_reason", "TEXT"),
    ("robot", "action", "TEXT"),
    ("robot", "action_index", "INTEGER"),
    ("robot", "action_since", "TEXT"),
    ("robot", "pause_reason", "TEXT"),
]


def _add_missing_columns(conn: sqlite3.Connection) -> None:
    for table, column, decl in _ADDED_COLUMNS:
        cols = {r[1] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()}
        if column not in cols:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {decl}")


def init_db() -> None:
    with connect() as conn:
        conn.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
        _add_missing_columns(conn)
