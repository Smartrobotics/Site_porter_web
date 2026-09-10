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
            # E7: 搬送先に空き場所がない。この依頼は飛ばして次を見る。
            # ただし、そのままでは永久に空かない。搬送先に空荷台があれば
            # 「回収するだけ」の走行を作って場所を空ける(docs の方針)
            if _unblock_full_area(conn, row):
                # 1回のtickで作る回収は1件まで。空き場所より多く作ると
                # 作った回収自身が行き先を失って詰まる
                return
            continue
        try:
            _run(conn, row, to_address_id)
        except sqlite3.IntegrityError:
            # 想定外の食い違い。次のtickで修復ステップが直す
            log.exception("走行を開始できませんでした id=%s", row["id"])
        return

    _go_idle(conn)


def _unblock_full_area(conn: sqlite3.Connection, blocked: sqlite3.Row) -> bool:
    """
    搬送先が満杯で止まっている依頼のために、そのエリアの空荷台を外へ出す。
    出し先は、まず止まっている依頼の出発エリア。そこも満杯なら他のエリア。
    空荷台が無い場合は本当に人が動かすしかない(荷台配置初期設定で直す)。

    すでにそのエリアから出る回収が積まれているなら何もしない。
    1件出れば1つ空くので、それ以上作っても行き先の取り合いになるだけ。
    """
    pending = conn.execute(
        """SELECT 1 FROM request
           WHERE kind = 'collect' AND is_deleted = 0
             AND status IN ('queued', 'running') AND from_area_id = ?
           LIMIT 1""",
        (blocked["to_area_id"],),
    ).fetchone()
    if pending is not None:
        return False

    rack = _empty_rack_in_area(conn, blocked["to_area_id"])
    if rack is None:
        return False
    if _create_collect(conn, rack, blocked["from_area_id"], blocked["priority"],
                       f"依頼{blocked['id']}の搬送先が満杯"):
        return True
    others = conn.execute(
        "SELECT id FROM area WHERE id <> ? AND is_deleted = 0 ORDER BY id",
        (blocked["to_area_id"],),
    ).fetchall()
    for area in others:
        if _create_collect(conn, rack, area["id"], blocked["priority"],
                           f"依頼{blocked['id']}の搬送先が満杯"):
            return True
    return False


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


def _has_open_request(conn: sqlite3.Connection, rack_id: int) -> bool:
    """その荷台に、まだ終わっていない依頼があるか。1台の荷台は同時に1走行だけ"""
    row = conn.execute(
        """SELECT 1 FROM request
           WHERE rack_id = ? AND is_deleted = 0 AND status IN ('queued', 'running')
           LIMIT 1""",
        (rack_id,),
    ).fetchone()
    return row is not None


def _empty_rack_in_area(conn: sqlite3.Connection, area_id: int, except_rack: int | None = None):
    """回収できる空荷台。すでに依頼が入っている荷台は対象にしない"""
    rows = conn.execute(
        """SELECT rk.id AS rack_id, rk.street_address_id AS address_id
           FROM rack rk
           JOIN street_address sa ON sa.id = rk.street_address_id
           WHERE rk.is_empty = 1 AND rk.is_deleted = 0 AND sa.area_id = ?
           ORDER BY rk.marker_id""",
        (area_id,),
    ).fetchall()
    for row in rows:
        if except_rack is not None and row["rack_id"] == except_rack:
            continue
        if _has_open_request(conn, row["rack_id"]):
            continue
        return row
    return None


def _create_collect(conn: sqlite3.Connection, rack, to_area_id: int, priority: int, why: str) -> bool:
    """空荷台を別のエリアへ戻す走行を1件作る。戻す先に空きが無ければ作らない"""
    if _free_address(conn, to_area_id) is None:
        return False
    conn.execute(
        """INSERT INTO request
               (kind, created_by, rack_id, from_area_id, from_address_id,
                to_area_id, priority, status)
           SELECT 'collect', 'system', ?, sa.area_id, sa.id, ?, ?, 'queued'
           FROM street_address sa WHERE sa.id = ?""",
        (rack["rack_id"], to_area_id, priority, rack["address_id"]),
    )
    log.info("空荷台の回収を作りました 荷台=%s 行き先エリア=%s 理由=%s",
             rack["rack_id"], to_area_id, why)
    return True


def _maybe_create_collect(conn: sqlite3.Connection, req: sqlite3.Row) -> None:
    """
    荷降ろしを終えた時点で、その階にある空荷台の回収を作る。
    回収は搬送の続きではなく、別の依頼・別の走行。
    空荷台が無ければ何も作らない(異常ではない)。
    """
    rack = _empty_rack_in_area(conn, req["to_area_id"], except_rack=req["rack_id"])
    if rack is None:
        return
    _create_collect(conn, rack, req["from_area_id"], req["priority"], f"依頼{req['id']}の荷降ろし後")


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


def _rescue_stranded_racks(conn: sqlite3.Connection) -> None:
    """
    番地に載っておらず、走行中の依頼も持っていない荷台を拾い直す。
    走行中の取消などでこの状態になると、その荷台は POST で「使用中」と
    断られ続けて二度と使えなくなる。ここで必ず戻れるようにしておく。
    """
    rows = conn.execute(
        """SELECT rk.id FROM rack rk
           WHERE rk.street_address_id IS NULL AND rk.is_deleted = 0
             AND NOT EXISTS (
               SELECT 1 FROM request r
               WHERE r.rack_id = rk.id AND r.is_deleted = 0
                 AND r.status IN ('queued', 'running'))"""
    ).fetchall()
    for row in rows:
        address_id = _any_free_address(conn)
        if address_id is None:
            return
        conn.execute(
            "UPDATE rack SET street_address_id = ? WHERE id = ?", (address_id, row["id"])
        )
        log.warning("行き先を失っていた荷台を番地に戻しました 荷台=%s 番地=%s", row["id"], address_id)


def _any_free_address(conn: sqlite3.Connection) -> int | None:
    row = conn.execute(
        """SELECT sa.id FROM street_address sa
           WHERE sa.is_deleted = 0
             AND NOT EXISTS (SELECT 1 FROM rack WHERE street_address_id = sa.id)
           ORDER BY sa.area_id, sa.address_no LIMIT 1"""
    ).fetchone()
    return row["id"] if row else None


def _close_deleted_running(conn: sqlite3.Connection) -> None:
    """
    「走行中なのに削除済み」を閉じる。
    この形が残るとロボットが解放されず、次の依頼が
    ux_request_running_robot に弾かれてエンジンが回らなくなる。
    取消のエンドポイントを通ればこうはならないが、DBを直接いじると起こりうる。
    """
    rows = conn.execute(
        """SELECT id, rack_id, from_address_id FROM request
           WHERE status = 'running' AND is_deleted = 1"""
    ).fetchall()
    for row in rows:
        conn.execute(
            """UPDATE request SET status = 'cancelled', assigned_robot_id = NULL,
                                  cancelled_at = datetime('now')
               WHERE id = ?""",
            (row["id"],),
        )
        _go_idle(conn)
        log.warning("削除済みなのに走行中だった依頼を閉じました id=%s", row["id"])


def _fix_rack_emptiness(conn: sqlite3.Connection) -> None:
    """
    荷台の荷あり/空を、依頼の状態から導き直す。

    決まりはひとつ:「荷あり」なのは、その荷台に生きている搬送依頼
    (queued / running / delivered)がある間だけ。受取確認が済めば空になる。

    受取確認の前に依頼が取消・削除されると、荷台は荷ありのまま取り残される。
    そうなると回収の対象からも外れ、二度と使われない。
    毎tickここで導き直せば、どの経路で壊れても必ず戻る。
    """
    open_delivery = """
        SELECT 1 FROM request r
        WHERE r.rack_id = rack.id AND r.is_deleted = 0 AND r.kind = 'delivery'
          AND r.status IN ('queued', 'running', 'delivered')
    """
    fixed = conn.execute(
        f"UPDATE rack SET is_empty = 1 WHERE is_empty = 0 AND NOT EXISTS ({open_delivery})"
    ).rowcount
    if fixed:
        log.warning("荷あり扱いのまま取り残された荷台を空にしました 件数=%s", fixed)
    conn.execute(f"UPDATE rack SET is_empty = 0 WHERE is_empty = 1 AND EXISTS ({open_delivery})")


def _tick_once() -> None:
    global _ticks_in_step
    conn = connect()
    try:
        _close_deleted_running(conn)
        _fix_rack_emptiness(conn)
        _rescue_stranded_racks(conn)
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
