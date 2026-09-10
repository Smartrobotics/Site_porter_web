"""
搬送エンジン。1台のロボットに1件ずつ依頼を渡し、状態を進める。

いまロボットの中身はモックで、時間が経つと次の断片へ進むだけ。
scenario_bridge.py ができたら _advance() の中身を
「POST /scenario で断片を投げ、GET /state で終わりを待つ」に差し替える。
画面はこのモジュールの中を見ない。見るのは request.status と robot の現在位置だけなので、
差し替えても画面側は変わらない。

順番の決め方・番地の選び方・回収の作り方は docs/siteporter-db.ja.md の
「主要クエリ」と同じものを使っている。
"""

import asyncio
import logging
import sqlite3

from .db import connect

log = logging.getLogger(__name__)

TICK_SECONDS = 1.0
# 1断片にかける秒数。デモが見やすい速さ。実機では断片の終了を待つ
SECONDS_PER_STEP = 3

# 実機で1つずつ流す断片と同じ並び(tools/scenario_gen/gen_chain.py)
STEPS = ["init", "pick_up", "move_to_target", "elv", "put_down"]
STEP_TOTAL = len(STEPS)

# いまロボットは1台。2台目からはここを回す
ROBOT_ID = 1

# 同じ断片に留まっている秒数。実機に置き換えるとき一緒に消える
_ticks_in_step = 0


def _set_robot(conn: sqlite3.Connection, phase: str, scenario_name: str, index: int) -> None:
    conn.execute(
        """UPDATE robot SET phase = ?, scenario_name = ?, step_index = ?, step_total = ?
           WHERE id = ?""",
        (phase, scenario_name, index, STEP_TOTAL, ROBOT_ID),
    )


def _go_idle(conn: sqlite3.Connection) -> None:
    conn.execute(
        """UPDATE robot SET phase = 'idle', scenario_name = NULL,
                            step_index = NULL, step_total = NULL
           WHERE id = ?""",
        (ROBOT_ID,),
    )


def _free_address(conn: sqlite3.Connection, area_id: int) -> int | None:
    """エリア内の空き番地。荷台が載っていない番地を若い順に1つ"""
    row = conn.execute(
        """SELECT sa.id FROM street_address sa
           WHERE sa.area_id = ? AND sa.is_deleted = 0
             AND NOT EXISTS (SELECT 1 FROM rack WHERE street_address_id = sa.id)
           ORDER BY sa.address_no LIMIT 1""",
        (area_id,),
    ).fetchone()
    return row["id"] if row else None


def _address_is_free(conn: sqlite3.Connection, address_id: int) -> bool:
    row = conn.execute(
        "SELECT 1 FROM rack WHERE street_address_id = ? LIMIT 1", (address_id,)
    ).fetchone()
    return row is None


def _start_next(conn: sqlite3.Connection) -> None:
    """
    順番待ちを順に見て、走らせられる先頭の1件を走らせる。

    先頭が E7(搬送先が満杯)のときに後ろを全部止めない。止めると、
    場所を空けるはずの回収そのものが後ろで詰まって永久に動かなくなる。
    優先度の順番は保ったまま、走れる最初の1件を選ぶ。
    """
    rows = conn.execute(
        """SELECT * FROM request
           WHERE status = 'queued' AND is_deleted = 0
           ORDER BY priority, created_at, id"""
    ).fetchall()

    for row in rows:
        # 受付時に決めた番地でも、その後ふさがっていることがある。必ず確かめ直す
        to_address_id = row["to_address_id"]
        if to_address_id is None or not _address_is_free(conn, to_address_id):
            to_address_id = _free_address(conn, row["to_area_id"])
        if to_address_id is None:
            # E7: 搬送先に空き場所がない。この依頼は飛ばして次を見る
            continue
        _run(conn, row, to_address_id)
        return

    _go_idle(conn)


def _run(conn: sqlite3.Connection, row: sqlite3.Row, to_address_id: int) -> None:
    conn.execute(
        """UPDATE request
           SET status = 'running', assigned_robot_id = ?, to_address_id = ?,
               started_at = datetime('now')
           WHERE id = ?""",
        (ROBOT_ID, to_address_id, row["id"]),
    )
    # 荷台はロボットの下に入る。どの番地にも載っていない状態
    conn.execute("UPDATE rack SET street_address_id = NULL WHERE id = ?", (row["rack_id"],))

    phase = "delivery" if row["kind"] == "delivery" else "return"
    _set_robot(conn, phase, f"run_{row['id']}_01_{STEPS[0]}", 1)
    log.info("搬送を開始しました id=%s kind=%s 番地=%s", row["id"], row["kind"], to_address_id)


def _maybe_create_collect(conn: sqlite3.Connection, req: sqlite3.Row) -> None:
    """
    荷降ろしを終えた時点で、その階にある空荷台の回収を作る。
    回収は搬送の続きではなく、別の依頼・別の走行。
    空荷台が無ければ何も作らない(異常ではない)。
    """
    row = conn.execute(
        """SELECT rk.id AS rack_id, rk.street_address_id AS address_id
           FROM rack rk
           JOIN street_address sa ON sa.id = rk.street_address_id
           WHERE rk.is_empty = 1 AND rk.is_deleted = 0
             AND sa.area_id = ? AND rk.id <> ?
           ORDER BY rk.marker_id LIMIT 1""",
        (req["to_area_id"], req["rack_id"]),
    ).fetchone()
    if row is None:
        return
    conn.execute(
        """INSERT INTO request
               (kind, created_by, rack_id, from_area_id, from_address_id,
                to_area_id, priority, status)
           VALUES ('collect', 'system', ?, ?, ?, ?, ?, 'queued')""",
        (row["rack_id"], req["to_area_id"], row["address_id"], req["from_area_id"], req["priority"]),
    )
    log.info("空荷台の回収を作りました 荷台=%s 元の依頼=%s", row["rack_id"], req["id"])


def _finish(conn: sqlite3.Connection, req: sqlite3.Row) -> None:
    status = "delivered" if req["kind"] == "delivery" else "done"
    conn.execute(
        "UPDATE request SET status = ?, delivered_at = datetime('now') WHERE id = ?",
        (status, req["id"]),
    )
    # 荷台は搬送先の番地に置かれる。
    # 走行中に人が荷台配置を変えて塞がっていることがあるので、失敗しても走行は終わらせる
    try:
        conn.execute(
            "UPDATE rack SET street_address_id = ? WHERE id = ?",
            (req["to_address_id"], req["rack_id"]),
        )
    except sqlite3.IntegrityError:
        log.warning(
            "番地が塞がっていたので荷台を置けませんでした id=%s 荷台=%s 番地=%s",
            req["id"], req["rack_id"], req["to_address_id"],
        )
    _go_idle(conn)
    log.info("搬送が終わりました id=%s status=%s", req["id"], status)

    if req["kind"] == "delivery":
        _maybe_create_collect(conn, req)


def _advance(conn: sqlite3.Connection, req: sqlite3.Row) -> None:
    robot = conn.execute("SELECT * FROM robot WHERE id = ?", (ROBOT_ID,)).fetchone()
    index = (robot["step_index"] or 0) + 1
    if index > STEP_TOTAL:
        _finish(conn, req)
        return
    _set_robot(conn, robot["phase"] or "delivery", f"run_{req['id']}_{index:02d}_{STEPS[index - 1]}", index)


def _tick_once() -> None:
    global _ticks_in_step
    conn = connect()
    try:
        running = conn.execute(
            "SELECT * FROM request WHERE status = 'running' AND is_deleted = 0 LIMIT 1"
        ).fetchone()
        if running is None:
            _ticks_in_step = 0
            _start_next(conn)
        else:
            _ticks_in_step += 1
            if _ticks_in_step >= SECONDS_PER_STEP:
                _ticks_in_step = 0
                _advance(conn, running)
        conn.commit()
    finally:
        conn.close()


async def run_engine() -> None:
    """アプリの起動中ずっと回る。1秒ごとに1回だけ様子を見る"""
    log.info("搬送エンジンを開始しました")
    while True:
        try:
            await asyncio.to_thread(_tick_once)
        except asyncio.CancelledError:
            raise
        except Exception:
            # 1回の失敗でエンジンを止めない。次のtickでやり直す
            log.exception("エンジンのtickに失敗しました")
        await asyncio.sleep(TICK_SECONDS)
