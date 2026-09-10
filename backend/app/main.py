import asyncio
import logging
import os
import sqlite3
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .ca import router as ca_router
from .db import DB_PATH, get_db, init_db
from .engine import run_engine
from .logging_config import setup_logging
from .schemas import (
    AddressOut,
    AreaOut,
    CancelIn,
    RackOut,
    RequestCreate,
    RequestOut,
    UserOut,
)

setup_logging()
log = logging.getLogger(__name__)

# 許可するオリジンは docker-compose.yml の CORS_ORIGINS で指定する（カンマ区切り）
origins = [
    o.strip() for o in os.getenv("CORS_ORIGINS", "https://localhost:5173").split(",") if o.strip()
]


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    log.info("起動しました db=%s origins=%s", DB_PATH, origins)
    engine = asyncio.create_task(run_engine())
    yield
    engine.cancel()
    log.info("終了します")


# app = FastAPI(title="Task API", lifespan=lifespan)
app = FastAPI(title="SitePorter API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ローカルCAの配布と /setup ページ
app.include_router(ca_router)


@app.exception_handler(Exception)
async def unhandled_exception(request: Request, exc: Exception):
    # ここに来る = 想定外のバグ。トレース付きで残す
    log.exception("未処理の例外 %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"detail": "Internal Server Error"})


@app.get("/api/health")
def health():
    return {"status": "ok"}
    

# 依頼一覧。エリア名と荷台マーカーは JOIN でここに寄せる。
# テーブル構造をAPIに漏らさず、フロント側で結合させない（N+1を避ける）
REQUEST_COLUMNS = """
       r.id, r.kind, r.created_by, r.tracking_no, r.item,
       r.receiver_name, r.priority, r.status, r.created_at,
       r.rack_id, r.from_area_id, r.to_area_id,
       r.from_address_id, r.to_address_id,
       r.started_at, r.delivered_at, r.confirmed_at,
       fa.label AS from_area, ta.label AS to_area, rk.marker_id AS rack_marker_id,
       rb.phase AS robot_phase, rb.step_index, rb.step_total
"""

# 走行中の依頼にだけロボットの現在位置をぶら下げる。
# ON に status を入れているので、走っていない行では NULL になる。
REQUEST_FROM_SQL = """
FROM request r
JOIN area fa ON fa.id = r.from_area_id
JOIN area ta ON ta.id = r.to_area_id
JOIN rack rk ON rk.id = r.rack_id
LEFT JOIN robot rb ON rb.id = r.assigned_robot_id AND r.status = 'running'
"""

REQUEST_LIST_SQL = f"""
SELECT {REQUEST_COLUMNS}
{REQUEST_FROM_SQL}
WHERE r.is_deleted = 0
ORDER BY r.created_at DESC, r.id DESC
"""

REQUEST_ONE_SQL = f"""
SELECT {REQUEST_COLUMNS}
{REQUEST_FROM_SQL}
WHERE r.id = ? AND r.is_deleted = 0
"""


@app.get("/api/request", response_model=list[RequestOut])
def list_requests(db: sqlite3.Connection = Depends(get_db)):
    rows = db.execute(REQUEST_LIST_SQL).fetchall()
    log.debug("依頼一覧を返しました count=%s", len(rows))
    return [dict(row) for row in rows]


# ---------------------------------------------------------------- マスタ
# 画面の選択肢になるデータ。起動時に一度だけ読めばよい。

AREA_LIST_SQL = """
SELECT id, floor, map_no, label
FROM area
WHERE is_deleted = 0
ORDER BY id
"""


@app.get("/api/area", response_model=list[AreaOut])
def list_areas(db: sqlite3.Connection = Depends(get_db)):
    rows = db.execute(AREA_LIST_SQL).fetchall()
    return [dict(row) for row in rows]


ADDRESS_LIST_SQL = """
SELECT sa.id, sa.area_id, sa.address_no, sa.path_no, a.label AS area_label
FROM street_address sa
JOIN area a ON a.id = sa.area_id
WHERE sa.is_deleted = 0 AND a.is_deleted = 0
ORDER BY sa.area_id, sa.address_no
"""


@app.get("/api/address", response_model=list[AddressOut])
def list_addresses(db: sqlite3.Connection = Depends(get_db)):
    rows = db.execute(ADDRESS_LIST_SQL).fetchall()
    return [
        {**dict(row), "label": f"{row['area_label']} 番地{row['address_no']}"}
        for row in rows
    ]


RACK_LIST_SQL = """
SELECT rk.id, rk.marker_id, rk.street_address_id, rk.is_empty,
       sa.area_id, sa.address_no
FROM rack rk
LEFT JOIN street_address sa ON sa.id = rk.street_address_id
WHERE rk.is_deleted = 0
ORDER BY rk.marker_id
"""


@app.get("/api/rack", response_model=list[RackOut])
def list_racks(db: sqlite3.Connection = Depends(get_db)):
    rows = db.execute(RACK_LIST_SQL).fetchall()
    return [{**dict(row), "label": f"荷台{row['marker_id']}"} for row in rows]


USER_LIST_SQL = """
SELECT id, name
FROM user
WHERE is_deleted = 0
ORDER BY id
"""


@app.get("/api/user", response_model=list[UserOut])
def list_user(db: sqlite3.Connection = Depends(get_db)):
    rows = db.execute(USER_LIST_SQL).fetchall()
    return [dict(row) for row in rows]


@app.get("/api/request/{request_id}", response_model=RequestOut)
def get_request(request_id: int, db: sqlite3.Connection = Depends(get_db)):
    row = db.execute(REQUEST_ONE_SQL, (request_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Request not found")
    return dict(row)


@app.post("/api/request", response_model=RequestOut, status_code=201)
def create_request(payload: RequestCreate, db: sqlite3.Connection = Depends(get_db)):
    """
    搬送依頼の受付。必ず受け付ける。
    搬送先に空き場所がなくても(E7)、ロボットが実行中でも(E9)エラーにせず
    status='queued' で積む。走らせる判断はエンジン側が毎秒行う。
    """
    # 出発の番地は「荷台が今どこにあるか」で決まる。人は選ばない
    rack = db.execute(
        "SELECT id, street_address_id FROM rack WHERE id = ? AND is_deleted = 0",
        (payload.rack_id,),
    ).fetchone()
    if rack is None:
        raise HTTPException(status_code=400, detail="荷台が見つかりません")
    if rack["street_address_id"] is None:
        # 搬送中の荷台は指定できない(E8)
        raise HTTPException(status_code=409, detail="指定された荷台は使用中です。別の荷台を選んでください。")

    # 送り状番号は二重送信の検査キー。同じ番号が既にあれば受け付けない
    if payload.tracking_no:
        dup = db.execute(
            "SELECT id FROM request WHERE tracking_no = ?", (payload.tracking_no,)
        ).fetchone()
        if dup is not None:
            raise HTTPException(status_code=409, detail="この送り状番号はすでに受け付けています。")

    # 受取人の名前が名簿にあれば紐づける。無くても依頼は通す
    receiver_user_id = None
    if payload.receiver_name:
        user = db.execute(
            "SELECT id FROM user WHERE name = ? AND is_deleted = 0", (payload.receiver_name,)
        ).fetchone()
        if user is not None:
            receiver_user_id = user["id"]

    try:
        row = db.execute(
            """
            INSERT INTO request
                (kind, created_by, tracking_no, item, receiver_name, receiver_user_id,
                 rack_id, from_area_id, from_address_id, to_area_id,
                 priority, status)
            VALUES ('delivery', 'user', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued')
            RETURNING id
            """,
            (
                payload.tracking_no,
                payload.item,
                payload.receiver_name,
                receiver_user_id,
                payload.rack_id,
                payload.from_area_id,
                rack["street_address_id"],
                payload.to_area_id,
                payload.priority,
            ),
        ).fetchone()
        # 受付で荷台は「荷あり」になる
        db.execute("UPDATE rack SET is_empty = 0 WHERE id = ?", (payload.rack_id,))
        db.commit()
    except sqlite3.IntegrityError as e:
        log.exception("依頼の登録に失敗しました")
        raise HTTPException(status_code=400, detail=f"登録できませんでした: {e}")

    log.info("依頼を受け付けました id=%s", row["id"])
    created = db.execute(REQUEST_ONE_SQL, (row["id"],)).fetchone()
    return dict(created)


@app.post("/api/request/{request_id}/confirm", response_model=RequestOut)
def confirm_receipt(request_id: int, db: sqlite3.Connection = Depends(get_db)):
    """
    受取人が荷物を受け取ったことを確認する。
    ここで荷台は空になり、次の回収の対象になる(docs/siteporter-db.ja.md §11)。
    """
    row = db.execute(
        "SELECT id, kind, status, rack_id FROM request WHERE id = ? AND is_deleted = 0",
        (request_id,),
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Request not found")
    if row["kind"] != "delivery":
        raise HTTPException(status_code=400, detail="荷台回収に受取確認はありません")
    if row["status"] != "delivered":
        raise HTTPException(status_code=409, detail="搬送が完了していません")

    db.execute(
        "UPDATE request SET status = 'confirmed', confirmed_at = datetime('now') WHERE id = ?",
        (request_id,),
    )
    db.execute("UPDATE rack SET is_empty = 1 WHERE id = ?", (row["rack_id"],))
    db.commit()
    log.info("受取確認を記録しました id=%s", request_id)
    return dict(db.execute(REQUEST_ONE_SQL, (request_id,)).fetchone())


@app.post("/api/request/{request_id}/cancel", response_model=RequestOut)
def cancel_request(
    request_id: int, payload: CancelIn, db: sqlite3.Connection = Depends(get_db)
):
    """
    管理者による取消。エレベータ側のキャンセルは別システムなので、ここでは行えない。
    走行中だった場合は荷台がロボットの下にあるため、番地に戻す判断はしない
    (どこに置いたか分からないので、荷台配置初期設定で人が直す)。
    """
    row = db.execute(
        "SELECT id, status, rack_id FROM request WHERE id = ? AND is_deleted = 0",
        (request_id,),
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Request not found")

    if payload.mode == "delete":
        db.execute(
            """UPDATE request SET status = 'cancelled', is_deleted = 1,
                                  cancelled_at = datetime('now'), assigned_robot_id = NULL
               WHERE id = ?""",
            (request_id,),
        )
    elif payload.mode == "abort":
        db.execute(
            """UPDATE request SET status = 'failed',
                                  cancelled_at = datetime('now'), assigned_robot_id = NULL
               WHERE id = ?""",
            (request_id,),
        )
    else:  # reset
        db.execute(
            """UPDATE request SET status = 'queued', assigned_robot_id = NULL,
                                  started_at = NULL, to_address_id = NULL
               WHERE id = ?""",
            (request_id,),
        )

    # 走行中だったならロボットを解放する
    if row["status"] == "running":
        db.execute(
            """UPDATE robot SET phase = 'idle', scenario_name = NULL,
                                step_index = NULL, step_total = NULL
               WHERE id = 1"""
        )
    db.commit()
    log.info("依頼を取消しました id=%s mode=%s", request_id, payload.mode)

    if payload.mode == "delete":
        # is_deleted = 1 なので REQUEST_ONE_SQL では取れない。消える前の姿を返す
        return dict(
            db.execute(
                REQUEST_ONE_SQL.replace("AND r.is_deleted = 0", ""), (request_id,)
            ).fetchone()
        )
    return dict(db.execute(REQUEST_ONE_SQL, (request_id,)).fetchone())
