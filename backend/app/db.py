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
    # 書き込み中(エンジンの tick は毎秒書く)に別の接続が触ったとき、すぐ
    # "database is locked" にせず最大 5000 ms 待って再試行する
    conn.execute("PRAGMA busy_timeout = 5000")
    # WAL: 書き込み中でも他の接続の読み込みを止めない(API の GET がエンジンの
    # 書き込みに待たされない)。DB ファイルに永続する設定で、app.db-wal / app.db-shm が
    # 同じディレクトリにできる。ローカルディスク前提(ネットワーク FS では使わない)
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def get_db():
    """FastAPI の Depends 用。リクエストごとに接続を開いて閉じる。"""
    conn = connect()
    try:
        yield conn
    finally:
        conn.close()


# 既存の DB に後から足した列。CREATE TABLE IF NOT EXISTS は既存テーブルを変えないので、
# 無ければここで ALTER TABLE する(README 10 章の作り直しをせずに済む範囲: 制約なしの追加だけ)
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
