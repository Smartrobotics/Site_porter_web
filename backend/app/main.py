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
from .engine import ROBOT_ID, ROBOT_MODE, request_cancel, run_engine
from .scenario import home_floor, load_floors
from .logging_config import setup_logging
from .schemas import (
    AddressOut,
    AreaOut,
    CancelIn,
    PlacementIn,
    RackOut,
    RackPatch,
    RequestCreate,
    RequestOut,
    RobotOut,
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
       rb.phase AS robot_phase, rb.scenario_name AS robot_scenario, rb.floor AS robot_floor,
       rb.action AS robot_action, rb.action_index AS robot_action_index,
       rb.step_index, rb.step_total
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
        """SELECT rk.id, rk.street_address_id, rk.marker_id,
                  sa.area_id AS rack_area_id, a.label AS rack_area_label
           FROM rack rk
           LEFT JOIN street_address sa ON sa.id = rk.street_address_id
           LEFT JOIN area a ON a.id = sa.area_id
           WHERE rk.id = ? AND rk.is_deleted = 0""",
        (payload.rack_id,),
    ).fetchone()
    if rack is None:
        raise HTTPException(status_code=400, detail="荷台が見つかりません")
    # 1台の荷台が同時に持てる走行は1つ(E8)。
    # 搬送中(番地から外れている)でも、順番待ちが入っているでも同じく断る
    busy = db.execute(
        """SELECT id FROM request
           WHERE rack_id = ? AND is_deleted = 0 AND status IN ('queued', 'running')
           LIMIT 1""",
        (payload.rack_id,),
    ).fetchone()
    if rack["street_address_id"] is None or busy is not None:
        raise HTTPException(
            status_code=409,
            detail="指定された荷台は使用中です。別の荷台を選んでください。",
        )

    # 搬送元は「荷台が今どこにあるか」で決まる。人が選んだエリアと食い違うなら、
    # 目の前に無い荷台を指定している。DBのトリガーも弾くが、その文面は人に読めない
    if rack["rack_area_id"] is not None and rack["rack_area_id"] != payload.from_area_id:
        raise HTTPException(
            status_code=409,
            detail=(
                f"荷台{rack['marker_id']}は{rack['rack_area_label']}にあります。"
                "搬送元を選び直すか、別の荷台を指定してください。"
            ),
        )

    # 生成器は「HOME の階で荷台を拾う」形しか作れない(init は HOME の階からのみ)。
    # press_scenario_4/5 もその形だった: 2F で拾って 1F へ、戻りは回収。
    # 受け付けてから走行開始時に失敗させるより、ここで断ったほうが親切
    home_floor = _home_floor()
    if home_floor is not None and rack["rack_area_id"] is not None:
        floor = db.execute(
            "SELECT floor FROM area WHERE id = ?", (rack["rack_area_id"],)
        ).fetchone()
        if floor is not None and floor["floor"] != home_floor:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"荷台{rack['marker_id']}は{floor['floor']}Fにあります。"
                    f"搬送依頼はロボットの待機階({home_floor}F)にある荷台のみ対応しています。"
                ),
            )

    # 送り状番号は二重送信の検査キー。同じ番号が既にあれば受け付けない
    if payload.tracking_no:
        dup = db.execute(
            """SELECT id, created_at, is_deleted FROM request
               WHERE tracking_no = ?""",
            (payload.tracking_no,),
        ).fetchone()
        if dup is not None:
            # どの依頼が持っているかまで言う。番号だけ言われても人は確認できない
            when = str(dup["created_at"])[:16]
            note = "(取消済み)" if dup["is_deleted"] else ""
            raise HTTPException(
                status_code=409,
                detail=(
                    f"送り状番号 {payload.tracking_no} は依頼 #{dup['id']}{note} で"
                    f"{when} に受け付けています。伝票を確認してください。"
                ),
            )

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
        """SELECT id, status, rack_id, from_address_id
           FROM request WHERE id = ? AND is_deleted = 0""",
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

    # 走行中だった場合。
    # 荷台は出発した番地に戻す。実際にはロボットの下のどこかにあるが、
    # 番地なしのまま残すとその荷台は二度と選べなくなる(POST が「使用中」で断る)。
    # 出発地に戻す方が現実に近く、違っていれば荷台配置初期設定で人が直せる。
    #
    # ロボットは即座に解放しない。中断はエレベーター動作中に効かないことがあり
    # (§3.3)、まだ動いている相手に次の断片を投げてしまう。
    # 実機のときはエンジンが終了状態を待ってから解放する。
    if row["status"] == "running":
        _park_rack(db, row["rack_id"], row["from_address_id"])
        if not request_cancel(request_id):
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


def _park_rack(db: sqlite3.Connection, rack_id: int, prefer_address_id: int | None) -> None:
    """
    行き先を失った荷台を、どこかの空き番地に置く。
    まず出発した番地、それが埋まっていれば空いている番地を若い順に。
    どこも空いていなければ番地なしのまま残す(そのときは人が動かすしかない)。
    """
    candidates: list[int] = []
    if prefer_address_id is not None:
        candidates.append(prefer_address_id)
    rows = db.execute(
        """SELECT sa.id FROM street_address sa
           WHERE sa.is_deleted = 0
             AND NOT EXISTS (SELECT 1 FROM rack WHERE street_address_id = sa.id)
           ORDER BY sa.area_id, sa.address_no"""
    ).fetchall()
    candidates.extend(r["id"] for r in rows)

    for address_id in candidates:
        try:
            db.execute(
                "UPDATE rack SET street_address_id = ? WHERE id = ?", (address_id, rack_id)
            )
            log.info("荷台を番地に戻しました 荷台=%s 番地=%s", rack_id, address_id)
            return
        except sqlite3.IntegrityError:
            continue
    log.warning("空き番地が無く荷台を置けませんでした 荷台=%s", rack_id)


RACK_ONE_SQL = f"""
SELECT rk.id, rk.marker_id, rk.street_address_id, rk.is_empty,
       sa.area_id, sa.address_no
FROM rack rk
LEFT JOIN street_address sa ON sa.id = rk.street_address_id
WHERE rk.id = ?
"""


def _rack_out(db: sqlite3.Connection, rack_id: int) -> dict:
    row = db.execute(RACK_ONE_SQL, (rack_id,)).fetchone()
    return {**dict(row), "label": f"荷台{row['marker_id']}"}


def _in_transit(db: sqlite3.Connection, rack_id: int) -> bool:
    """走行中の依頼を持っている荷台。いまロボットの下にあるので動かせない"""
    row = db.execute(
        """SELECT 1 FROM request
           WHERE rack_id = ? AND is_deleted = 0 AND status = 'running' LIMIT 1""",
        (rack_id,),
    ).fetchone()
    return row is not None


@app.patch("/api/rack/{rack_id}", response_model=RackOut)
def patch_rack(rack_id: int, payload: RackPatch, db: sqlite3.Connection = Depends(get_db)):
    rack = db.execute("SELECT id FROM rack WHERE id = ? AND is_deleted = 0", (rack_id,)).fetchone()
    if rack is None:
        raise HTTPException(status_code=404, detail="荷台が見つかりません")

    used = db.execute(
        "SELECT id FROM rack WHERE marker_id = ? AND id <> ? AND is_deleted = 0",
        (payload.marker_id, rack_id),
    ).fetchone()
    if used is not None:
        raise HTTPException(
            status_code=409,
            detail=f"マーカーID {payload.marker_id} は別の荷台で使われています。",
        )

    db.execute("UPDATE rack SET marker_id = ? WHERE id = ?", (payload.marker_id, rack_id))
    db.commit()
    log.info("荷台のマーカーIDを変更しました 荷台=%s マーカー=%s", rack_id, payload.marker_id)
    return _rack_out(db, rack_id)


@app.put("/api/rack/placement", response_model=list[RackOut])
def put_placement(payload: PlacementIn, db: sqlite3.Connection = Depends(get_db)):
    """
    荷台配置初期設定画面からの一括反映。
    「どの番地にどの荷台があるか」を画面の内容そのままにする。
    """
    items = payload.items
    if len({i.rack_id for i in items}) != len(items):
        raise HTTPException(status_code=400, detail="同じ荷台が2回指定されています。")
    if len({i.street_address_id for i in items}) != len(items):
        raise HTTPException(status_code=400, detail="同じ番地に2台の荷台は置けません。")

    for item in items:
        rack = db.execute(
            "SELECT id, marker_id FROM rack WHERE id = ? AND is_deleted = 0", (item.rack_id,)
        ).fetchone()
        if rack is None:
            raise HTTPException(status_code=400, detail=f"荷台 id={item.rack_id} が見つかりません")
        if _in_transit(db, item.rack_id):
            raise HTTPException(
                status_code=409,
                detail=f"荷台{rack['marker_id']}は搬送中です。終わってから設定してください。",
            )
        exists = db.execute(
            "SELECT id FROM street_address WHERE id = ? AND is_deleted = 0",
            (item.street_address_id,),
        ).fetchone()
        if exists is None:
            raise HTTPException(
                status_code=400, detail=f"番地 id={item.street_address_id} が見つかりません"
            )

    try:
        # いったん全部どかしてから置き直す。入れ替えでも途中で衝突しない
        for item in items:
            db.execute("UPDATE rack SET street_address_id = NULL WHERE id = ?", (item.rack_id,))
        for item in items:
            db.execute(
                "UPDATE rack SET street_address_id = ? WHERE id = ?",
                (item.street_address_id, item.rack_id),
            )
        db.commit()
    except sqlite3.IntegrityError:
        db.rollback()
        # 画面に出ていない荷台がその番地にいる場合(画面が古い)
        raise HTTPException(
            status_code=409,
            detail="指定した番地に別の荷台があります。画面を更新してからやり直してください。",
        )

    log.info("荷台配置を更新しました 件数=%s", len(items))
    rows = db.execute(RACK_LIST_SQL).fetchall()
    return [{**dict(r), "label": f"荷台{r['marker_id']}"} for r in rows]


@app.get("/api/robot", response_model=RobotOut)
def get_robot(db: sqlite3.Connection = Depends(get_db)):
    """
    ロボットの現在の様子。設定画面が読むだけで、ここから操作はしない。
    ロボットを動かすのはエンジンの仕事。
    """
    row = db.execute(
        """SELECT rb.id, rb.name, rb.phase, rb.scenario_name,
                  rb.step_index, rb.step_total, rb.floor, rb.stuck_reason,
                  (SELECT r.id FROM request r
                   WHERE r.assigned_robot_id = rb.id AND r.status = 'running'
                     AND r.is_deleted = 0 LIMIT 1) AS request_id
           FROM robot rb WHERE rb.is_deleted = 0 ORDER BY rb.id LIMIT 1"""
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="ロボットが登録されていません")
    return {**dict(row), "mode": ROBOT_MODE}


@app.post("/api/robot/reset_home", response_model=RobotOut)
def reset_robot_home(db: sqlite3.Connection = Depends(get_db)):
    """
    人がロボットを HOME に置き直した後に押す。
    HOME へ戻れなかった(stuck_reason)、あるいは失敗の後で at_home が 0 のまま、
    という状態をここで正す。走行中の依頼があるときは断る — 先に取消する。
    """
    running = db.execute(
        "SELECT id FROM request WHERE status = 'running' AND is_deleted = 0 LIMIT 1"
    ).fetchone()
    if running is not None:
        raise HTTPException(status_code=409, detail=f"走行中の依頼 {running['id']} があります。先に取消してください")
    db.execute(
        """UPDATE robot SET at_home = 1, floor = ?, homing_floor = NULL, phase = 'idle',
                            scenario_name = NULL, step_index = NULL, step_total = NULL,
                            stuck_reason = NULL
           WHERE id = ?""",
        (home_floor(load_floors()), ROBOT_ID),
    )
    db.commit()
    log.warning("ロボットを HOME に置き直したと申告がありました")
    return get_robot(db)


def _home_floor() -> int | None:
    """ロボットの待機階。floors.json の home を持つ階"""
    try:
        from .scenario import load_floors

        for key, fl in load_floors()["floors"].items():
            if "home" in fl:
                return int(key)
    except Exception:  # noqa: BLE001
        log.exception("floors.json から待機階を読めませんでした")
    return None
