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
import os
import sqlite3
import time

from . import bridge
from .db import connect
from .scenario import (
    SCENARIO_DIR,
    fragment_name,
    generate_chain,
    home_floor,
    load_floors,
    plan_collect,
    plan_deliver,
    plan_go_home,
)

log = logging.getLogger(__name__)

# ロボットの動かし方。docker-compose.yml の ROBOT_MODE で切り替える。
#   mock   … 時間で断片を進めるだけ。ロボットもROSも要らない。開発とデモはこちら
#   bridge … 実機。scenario_bridge.py に POST /scenario を投げ、GET /state で終わりを待つ
# 画面はどちらでも同じものを見る(request.status と robot の現在位置)ので、
# 切り替えてもフロントエンドは変わらない。
ROBOT_MODE = os.getenv("ROBOT_MODE", "mock")
ROBOT_URL = os.getenv("ROBOT_URL", "http://127.0.0.1:8080")

# GET /state の連続失敗がこの回数に達したらロボットをオフライン扱いにする（§4.4 B）
POLL_FAIL_LIMIT = 3
# ブリッジが応答しないまま走行中の断片を待つ上限(秒)。短い断は待てば戻るが、
# これを超えたらロボットはどこかで断片を走り終えて止まっているはずなので、
# 走行を失敗にして人が確認するまで動かさない(2026-09-18 の判断)
BRIDGE_DOWN_FAIL_SECONDS = int(os.getenv("BRIDGE_DOWN_FAIL_SECONDS", "120"))

# 走行1件の上限時間。超えたら POST /cancel して失敗にする（§4.4 C）。
# 断片ごとに分けず走行全体で見る。そのほうが request.started_at だけで足り、
# スキーマに列を足さずに済む。実機での実測後に見直す。
TRIP_TIMEOUT_SECONDS = int(os.getenv("TRIP_TIMEOUT_SECONDS", "1800"))

# ブリッジが返す終了状態
TERMINAL = ("SUCCESS", "FAILURE", "CANCELED")

# POST /cancel を送ってから終了状態を待つ上限。
# エレベーター動作中(elv_call_floor / elv_get_on_off_flag)は中断判定が
# 無効なので、動作が終わるまで止まらない(§3.3)。待たずにロボットを
# 解放すると、まだ動いている相手に次の断片を投げることになる。
CANCEL_WAIT_SECONDS = int(os.getenv("CANCEL_WAIT_SECONDS", "60"))

TICK_SECONDS = 1.0
# mock で1断片にかける秒数。docker-compose.yml の MOCK_SECONDS_PER_STEP で変える。
# 実機(bridge)では使わない — 断片の終了はロボットが決める。
# 走行は6断片なので、20 なら1件およそ2分。
SECONDS_PER_STEP = int(os.getenv("MOCK_SECONDS_PER_STEP", "20"))

# 断片の並びは生成器が決める。走行ごとに長さも中身も変わる:
#   delivery … init, pick_up, move_to_target, elv, move_to_target, put_down（6件）
#   collect  … pick_up, move_to_target, elv, move_to_target, put_down, return_home（6件）
# 以前ここに5件の固定リストを持っていたが、それはモック用の作り話だった。
# move_to_target はエレベーターの前後で2回出るので、番号から種別は導けない。

# いまロボットは1台。2台目からはここを回す
ROBOT_ID = 1

# HOME へ戻る断片の run_id。依頼に id=0 は無いので名前が衝突しない
HOMING_RUN_ID = 0

# mock のときだけ使う。同じ断片に留まっている秒数。bridge では時間を数えない
_ticks_in_step = 0

# GET /state の連続失敗回数。3秒ぶんの履歴なのでメモリに置く。
# 失われても次のtickで数え直すだけなので、スキーマには入れない
_poll_fails = 0
# ブリッジが応答しなくなった最初の時刻。0 なら応答している
_bridge_down_since = 0.0

# 前回見た uptime_sec。巻き戻ったらブリッジが再起動している(§3.2 の uptime_sec)
_last_uptime = 0

# 中断を送って終了状態を待っている最中。ロボットはまだ動いているので次を始めない。
#   {"id": 依頼id, "sent_at": 送った時刻, "fail_reason": 待ち終わったら失敗にする理由}
# fail_reason が None なら状態はもう別のところで決まっている(取消エンドポイント)
_cancelling: dict | None = None


def _set_robot(conn: sqlite3.Connection, phase: str, scenario_name: str,
               index: int, total: int) -> None:
    # 断片が変わるので、前の断片のアクションは消す
    conn.execute(
        """UPDATE robot SET phase = ?, scenario_name = ?, step_index = ?, step_total = ?,
                            action = NULL, action_index = NULL, action_since = NULL
           WHERE id = ?""",
        (phase, scenario_name, index, total, ROBOT_ID),
    )


def _set_at_home(conn: sqlite3.Connection, value: int) -> None:
    conn.execute("UPDATE robot SET at_home = ? WHERE id = ?", (value, ROBOT_ID))


def _set_floor(conn: sqlite3.Connection, floor: int) -> None:
    conn.execute("UPDATE robot SET floor = ? WHERE id = ?", (floor, ROBOT_ID))


def _fragment_done(conn: sqlite3.Connection, plan, index: int) -> None:
    """断片 index(1始まり)が SUCCESS した。エレベーターなら階が変わっている"""
    if not plan or not (0 < index <= len(plan)):
        return
    kind, params = plan[index - 1]
    if kind == "elv":
        _set_floor(conn, int(params["goal_floor"]))
        log.info("ロボットは %s 階にいます", params["goal_floor"])


def _stuck(conn: sqlite3.Connection, reason: str) -> None:
    """
    人の手が要る。エンジンは新しい走行を始めず、理由を robot.stuck_reason に残す。
    HOME へ戻れなかったときに毎 tick 同じ断片を投げ直して永久に失敗し続けた
    (2026-09-15)のを止めるため。解除は POST /api/robot/reset_home
    """
    log.error("%s。ロボットを HOME に置き直し、設定画面の「HOME に置き直した」を押してください", reason)
    conn.execute(
        """UPDATE robot SET phase = 'error', stuck_reason = ?, homing_floor = NULL,
                            scenario_name = NULL, step_index = NULL, step_total = NULL,
                            pause_reason = NULL
           WHERE id = ?""",
        (reason, ROBOT_ID),
    )


# stuck の警告を毎秒出さないための時刻
_stuck_logged_at = 0.0
# ROS/エンジン停止の警告を毎秒出さないための時刻
_ros_down_logged_at = 0.0
# ros_ok=false が続いた回数。断片の実行中にこの回数に達したら、その走行は失敗にする
_ros_down_count = 0
# 実行中の断片が失われた(エンジン停止・再起動)と判断するまでの連続回数
ROS_DOWN_FAIL_LIMIT = 3
# エンジンが非常停止を報告するときの文字列(scenario_control の EmgStopWatch)。
# RUNNING の reason にはこのまま、失敗の reason には "... failed: emergency stop held for Ns" で入る
EMERGENCY_STOP_MARK = "emergency stop"


def _go_idle(conn: sqlite3.Connection) -> None:
    conn.execute(
        """UPDATE robot SET phase = 'idle', scenario_name = NULL,
                            step_index = NULL, step_total = NULL, pause_reason = NULL
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
    # ロボットの生死は、順番待ちがあるかどうかに関係なく毎tick見る。
    # 待機中の画面に「待機中」と出ているのに実は死んでいる、を避けるため。
    # 仕様どおり GET /state が死活確認を兼ねる(§3.2)
    if ROBOT_MODE == "bridge" and _poll_bridge(conn) is None:
        return

    global _stuck_logged_at
    stuck = conn.execute("SELECT stuck_reason FROM robot WHERE id = ?", (ROBOT_ID,)).fetchone()
    if stuck and stuck["stuck_reason"]:
        # 人の手待ち。走らせない。理由は1分に1回だけ出す
        if time.time() - _stuck_logged_at > 60:
            _stuck_logged_at = time.time()
            log.warning("人の手待ちのため走行を始めません: %s (順番待ち %s 件)",
                        stuck["stuck_reason"], len(rows))
        return

    if not rows:
        _go_idle(conn)
        return

    # delivery は init から始まり、init は set_robot_position で「HOME にいる」と
    # 宣言する。実際に別の場所にいるなら、先に戻さないと誤った自己位置で走り出す。
    # collect は pick_up から始まるので HOME にいる必要はない。
    robot = conn.execute("SELECT at_home FROM robot WHERE id = ?", (ROBOT_ID,)).fetchone()
    if not robot["at_home"] and any(r["kind"] == "delivery" for r in rows):
        if not any(r["kind"] == "collect" for r in rows):
            _start_homing(conn)
            return
        # collect が先に走れるならそれを走らせる。戻るのはその後でよい
        rows = [r for r in rows if r["kind"] == "collect"]

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
    # 出発時にロボットが HOME にいたかを依頼に残す。計画はこれで決まり、
    # 毎 tick 作り直しても同じ形になる(再起動しても同じ)
    robot = conn.execute("SELECT at_home FROM robot WHERE id = ?", (ROBOT_ID,)).fetchone()
    conn.execute("UPDATE request SET from_home = ? WHERE id = ?",
                 (1 if robot["at_home"] else 0, row["id"]))
    # ロボットは HOME を離れる
    _set_at_home(conn, 0)

    log.info("搬送を開始しました id=%s kind=%s 番地=%s", row["id"], row["kind"], to_address_id)

    # 断片のJSONを共有ディレクトリへ書く。ファイルは転送しない — bind mount で
    # エンジンと同じ場所を見ている。mock でも書く: 実機と同じ道を通すため
    fresh = conn.execute("SELECT * FROM request WHERE id = ?", (row["id"],)).fetchone()
    plan = _plan_for(conn, fresh)
    if plan is None:
        _fail(conn, fresh, "走行の計画を作れませんでした（番地かマーカーが未設定）", moved=False)
        _set_at_home(conn, 1)   # 走り出していない
        return
    try:
        names = generate_chain(plan, run_id=fresh["id"], scenario_dir=SCENARIO_DIR)
        log.info("断片を %s 件書きました dir=%s", len(names), SCENARIO_DIR)
    except OSError as e:
        _fail(conn, fresh, f"断片を書けませんでした: {e}", moved=False)
        _set_at_home(conn, 1)   # 走り出していない
        return

    row = fresh
    if ROBOT_MODE == "bridge":
        _send_fragment(conn, row, 1)
    else:
        _set_robot(conn, _phase_of(row), names[0], 1, len(names))


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


def _maybe_create_collect(conn: sqlite3.Connection, req: sqlite3.Row) -> bool:
    """
    荷降ろしを終えた時点で、その階にある空荷台の回収を作る。
    回収は搬送の続きではなく、別の依頼・別の走行。
    空荷台が無ければ何も作らない(異常ではない)。
    """
    rack = _empty_rack_in_area(conn, req["to_area_id"], except_rack=req["rack_id"])
    if rack is None:
        return False
    return _create_collect(conn, rack, req["from_area_id"], req["priority"],
                           f"依頼{req['id']}の荷降ろし後")


def _finish(conn: sqlite3.Connection, req: sqlite3.Row) -> None:
    names = _fragment_names(conn, req)
    if names and names[-1].endswith("return_home"):
        # collect は return_home で終わる。ロボットは HOME に戻っている
        _set_at_home(conn, 1)
        _set_floor(conn, home_floor(load_floors()))
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
        if not _maybe_create_collect(conn, req):
            # 空荷台が無いので回収は作らない(異常ではない)。
            # ただし delivery は go_home=False で終わっているので、
            # ロボットは荷降ろし場所に残っている。次の delivery は init から
            # 始まり、init は「HOME にいる」と宣言してしまうので、先に戻す
            _start_homing(conn)


def _trip_params(conn: sqlite3.Connection, req: sqlite3.Row):
    """
    生成器に渡す pickup / dropoff。すべてDBから引く。
      pickup  … 荷台が今ある番地と、その荷台のマーカー
      dropoff … サーバーが選んだ番地
    """
    row = conn.execute(
        """SELECT fa.floor AS from_floor, fsa.path_no AS from_path,
                  ta.floor AS to_floor,   tsa.path_no AS to_path,
                  rk.marker_id AS marker
           FROM request r
           JOIN area fa            ON fa.id  = r.from_area_id
           JOIN street_address fsa ON fsa.id = r.from_address_id
           JOIN area ta            ON ta.id  = r.to_area_id
           JOIN street_address tsa ON tsa.id = r.to_address_id
           JOIN rack rk            ON rk.id  = r.rack_id
           WHERE r.id = ?""",
        (req["id"],),
    ).fetchone()
    if row is None:
        return None
    return (
        {"floor": row["from_floor"], "path_no": row["from_path"], "marker_id": row["marker"]},
        {"floor": row["to_floor"], "path_no": row["to_path"]},
    )


def _floors_from_db(conn: sqlite3.Connection) -> dict:
    """
    floors.json に、地図番号だけ DB の値をかぶせる。

    map_no は現場ごとに変わる設定で、2か所にあった: DB の area.map_no（画面が
    見せているもの）と floors.json。実際に食い違っていて、八潮の試験は 19/18、
    本番の現場は 14/13 だった。どちらも正しいが、正しい置き場所は1つ。
    DB を正とし、floors.json は DB に無いもの — エレベーターと HOME の姿勢 —
    だけを持つ。
    """
    floors = load_floors()
    for row in conn.execute(
        "SELECT floor, map_no FROM area WHERE is_deleted = 0 ORDER BY id"
    ).fetchall():
        key = str(row["floor"])
        fl = floors["floors"].get(key)
        if fl is None:
            log.warning("階 %s は DB にあるが floors.json に無い", key)
            continue
        if fl.get("map_no") != row["map_no"]:
            log.info("地図番号を DB の値にします 階=%s %s → %s",
                     key, fl.get("map_no"), row["map_no"])
        fl["map_no"] = row["map_no"]
    return floors


def _robot_floor(conn: sqlite3.Connection) -> int | None:
    """
    ロボットがいる階。robot.floor をそのまま返す。
    エレベーター断片の SUCCESS で更新し(_fragment_done)、HOME に戻れば HOME の階。
    以前は最後の依頼の行き先から推測していたが、途中で失敗した走行を
    「着いた」と見なして違う階の地図で走り出した。
    """
    row = conn.execute("SELECT floor FROM robot WHERE id = ?", (ROBOT_ID,)).fetchone()
    return int(row["floor"]) if row and row["floor"] is not None else None


def _plan_for(conn: sqlite3.Connection, req: sqlite3.Row):
    """
    走行の断片リスト。生成器の作りに合わせて2つに割る:
      delivery … go_home=False。put_down で終わり、その先はサーバーが決める
      collect  … 荷降ろし直後なら from_home=False(ロボットはその場にいる)。
                 E7 で満杯を解消する回収は HOME から出るので from_home=True:
                 init と移動が先に付く。どちらかは request.from_home が決める
    request の列だけから決まるので、サーバーが再起動しても同じ並びが出る。
    """
    params = _trip_params(conn, req)
    if params is None:
        return None
    pickup, dropoff = params
    floors = _floors_from_db(conn)
    try:
        if req["kind"] == "delivery":
            return plan_deliver(pickup, dropoff, floors, from_home=True, go_home=False)
        return plan_collect(pickup, dropoff, floors,
                            from_home=bool(req["from_home"]), go_home=True)
    except (ValueError, KeyError) as e:
        # 生成器が組めない形。tick を落とさず、依頼を閉じて理由を残す。
        # いちばん多いのは「init は HOME の階からしかできない」:
        # plan_deliver は HOME の階で荷台を拾う形しか作れない
        log.error("走行の計画を作れません id=%s: %s", req["id"], e)
        return None


def _fragment_names(conn: sqlite3.Connection, req: sqlite3.Row) -> list[str]:
    plan = _plan_for(conn, req)
    if plan is None:
        return []
    return [fragment_name(req["id"], seq, kind) for seq, (kind, _) in enumerate(plan, 1)]


def _phase_of(req: sqlite3.Row) -> str:
    return "delivery" if req["kind"] == "delivery" else "return"


# ---------------------------------------------------------------- HOME へ戻る
# 依頼ではない。荷物ではなくロボットが動くので request の行は作らない。
# 状態は robot.phase='homing' と scenario_name / step_index に置く。
# 断片の並びは「いまいる階」から決まり、その階は DB から引けるので、
# サーバーが再起動しても同じ並びが再現できる。


def _homing_plan(conn: sqlite3.Connection):
    """HOME へ戻る計画。始めた階(robot.homing_floor)で固定する"""
    row = conn.execute("SELECT homing_floor FROM robot WHERE id = ?", (ROBOT_ID,)).fetchone()
    floor = row["homing_floor"] if row and row["homing_floor"] is not None else _robot_floor(conn)
    if floor is None:
        return None
    return plan_go_home(int(floor), _floors_from_db(conn))


def _homing_names(conn: sqlite3.Connection) -> list[str]:
    plan = _homing_plan(conn)
    if not plan:
        return []
    return [fragment_name(HOMING_RUN_ID, seq, kind) for seq, (kind, _) in enumerate(plan, 1)]


def _start_homing(conn: sqlite3.Connection) -> bool:
    """HOME へ戻る走行を始める。始められなければ False"""
    floor = _robot_floor(conn)
    if floor is None:
        _stuck(conn, "ロボットがどの階にいるか分かりません。HOME へ戻せません")
        return False
    conn.execute("UPDATE robot SET homing_floor = ? WHERE id = ?", (floor, ROBOT_ID))
    plan = plan_go_home(floor, _floors_from_db(conn))
    try:
        names = generate_chain(plan, run_id=HOMING_RUN_ID, scenario_dir=SCENARIO_DIR)
    except OSError as e:
        log.error("HOME へ戻る断片を書けませんでした: %s", e)
        return False
    log.info("HOME へ戻します 現在の階=%s 断片=%s件", floor, len(names))
    _set_robot(conn, "homing", names[0], 1, len(names))
    if ROBOT_MODE == "bridge" and not _post_fragment(names[0]):
        # 投げられなかった。次のtickで同じ断片から再送する
        pass
    return True


def _post_fragment(name: str) -> bool:
    """断片を投げる。True = 受理された"""
    try:
        res = bridge.post_scenario(ROBOT_URL, name, HOMING_RUN_ID)
    except bridge.BridgeRefused as e:
        log.error("HOME へ戻る断片が断られました name=%s: %s", name, e)
        return False
    except bridge.BridgeDown as e:
        log.warning("HOME へ戻る断片を投げられませんでした name=%s: %s", name, e)
        return False
    if res.get("duplicate"):
        log.warning("同じ断片が二重に届いていました name=%s", name)
    return True


def _finish_homing(conn: sqlite3.Connection) -> None:
    _set_at_home(conn, 1)
    _set_floor(conn, home_floor(load_floors()))
    conn.execute("UPDATE robot SET homing_floor = NULL WHERE id = ?", (ROBOT_ID,))
    _go_idle(conn)
    log.info("HOME に戻りました")


def _advance_homing(conn: sqlite3.Connection) -> None:
    global _ticks_in_step
    robot = conn.execute("SELECT * FROM robot WHERE id = ?", (ROBOT_ID,)).fetchone()
    plan = _homing_plan(conn)
    names = _homing_names(conn)
    index = robot["step_index"] or 1
    if not names:
        _stuck(conn, "HOME へ戻る断片を組めませんでした")
        return

    if ROBOT_MODE != "bridge":
        _ticks_in_step += 1
        if _ticks_in_step < SECONDS_PER_STEP:
            return
        _ticks_in_step = 0
        _fragment_done(conn, plan, index)
        if index >= len(names):
            _finish_homing(conn)
        else:
            _set_robot(conn, "homing", names[index], index + 1, len(names))
        return

    state = _poll_bridge(conn)
    if state is None:
        if _ros_down_count >= ROS_DOWN_FAIL_LIMIT:
            _stuck(conn, "HOME へ戻る途中でエンジンが止まりました。ロボットの位置を確認してください")
        elif _bridge_down_too_long():
            _stuck(conn, "HOME へ戻る途中でブリッジが応答しなくなりました。ロボットの位置を確認してください")
        return
    status = state.get("status", "IDLE")
    name = state.get("scenario_name", "")
    expected = robot["scenario_name"]

    if status == "IDLE" and expected:
        # エンジンが再起動した。断片は最初から走り直すことになるので投げ直さない
        _stuck(conn, "HOME へ戻る途中でエンジンが再起動しました。ロボットの位置を確認してください")
        return
    if status in TERMINAL:
        if name != expected:
            return
        if status != "SUCCESS":
            _stuck(conn, f"HOME へ戻れませんでした status={status} reason={state.get('reason')}")
            return
        _fragment_done(conn, plan, index)
        if index >= len(names):
            _finish_homing(conn)
        elif _post_fragment(names[index]):
            _set_robot(conn, "homing", names[index], index + 1, len(names))


def _advance_mock(conn: sqlite3.Connection, req: sqlite3.Row) -> None:
    """ロボット無し。時間が経ったら次の断片へ進んだことにする"""
    robot = conn.execute("SELECT * FROM robot WHERE id = ?", (ROBOT_ID,)).fetchone()
    names = _fragment_names(conn, req)
    if robot["step_index"]:
        _fragment_done(conn, _plan_for(conn, req), robot["step_index"])
    index = (robot["step_index"] or 0) + 1
    if index > len(names):
        _finish(conn, req)
        return
    _set_robot(conn, robot["phase"] or "delivery", names[index - 1], index, len(names))


# ---------------------------------------------------------------- bridge
# ここから下が実機との会話。判断の根拠はすべて
# docs/siteporter-bridge-api.ja.md §3 と §4.4 にある。
#
# 段は2つあり、混ぜてはいけない:
#   robot.step_index  … 断片の番号（1〜5）。サーバーが数える。画面が見るのはこれ
#   state.step_index  … その断片の中のステップ。ロボットが数える。記録は残さない
#                       （断片が終わったかどうかだけが依頼の進行に関係する）


def _fail(conn: sqlite3.Connection, req: sqlite3.Row, reason: str,
          stuck_reason: str | None = None, moved: bool = True) -> None:
    """
    走行を失敗にする。

    moved(既定)なら、ロボットは HOME を離れた後のどこかで止まっている。
    どこに居て荷台がどうなっているかサーバーには分からないので、次の走行は
    始めず、人が HOME に置き直して申告するまで待つ(2026-09-18 の判断:
    走行中の失敗は種類を問わずすべて人の手待ちにする。それまでは軽い失敗なら
    次の依頼へ進んでいたが、位置も荷台も不明なまま走り続けるのは危ない)。
    moved=False は走り出す前の失敗(計画が組めない等)。ロボットは HOME のまま
    """
    conn.execute(
        """UPDATE request SET status = 'failed', cancelled_at = datetime('now')
           WHERE id = ?""",
        (req["id"],),
    )
    _go_idle(conn)
    # 荷台はロボットの下（番地なし）。次のtickで _rescue_stranded_racks が置き直す
    log.error("搬送が失敗しました id=%s reason=%s", req["id"], reason)
    if moved:
        _stuck(conn, stuck_reason or
               f"走行中にエラーが発生しました({reason})。ロボットの位置と荷台を確認してください")


def _send_fragment(conn: sqlite3.Connection, req: sqlite3.Row, index: int) -> None:
    """断片を1つ投げる。成功したら robot に「いまこの断片」を書く"""
    names = _fragment_names(conn, req)
    if not (0 < index <= len(names)):
        _fail(conn, req, f"断片 {index} が計画にありません")
        return
    name = names[index - 1]
    try:
        res = bridge.post_scenario(ROBOT_URL, name, req["id"])
    except bridge.BridgeRefused as e:
        # 400 / 404 / 503。ブリッジは生きていて、この指示を断った。
        # 404 はシナリオJSONが無い（gen_chain.py がまだ書いていない）
        _fail(conn, req, f"bridge refused: {e}")
        return
    except bridge.BridgeDown as e:
        # 届いたかどうか分からない。断片は始まっていないものとして次のtickで再送する。
        # 二重に届いても duplicate:true で弾かれるので、再送して安全（§3.1）
        log.warning("断片を投げられませんでした（再送します） name=%s: %s", name, e)
        return

    if res.get("duplicate"):
        log.warning("同じ断片が二重に届いていました name=%s", name)
    _set_robot(conn, _phase_of(req), name, index, len(names))
    log.info("断片を投げました name=%s", name)


def _begin_cancel(request_id: int, fail_reason: str | None) -> bool:
    """
    中断を送り、終了状態を待つ状態に入る。True なら待ちに入った。
    False は「待つ必要がない」— mock か、そもそも送れなかった場合。
    """
    global _cancelling
    if ROBOT_MODE != "bridge":
        return False
    try:
        bridge.post_cancel(ROBOT_URL)
    except (bridge.BridgeDown, bridge.BridgeRefused) as e:
        # 送れないならロボットの状態も分からない。待っても意味がない
        log.warning("中断を送れませんでした id=%s: %s", request_id, e)
        return False
    _cancelling = {"id": request_id, "sent_at": time.time(), "fail_reason": fail_reason}
    log.info("中断を送りました id=%s。終了状態を待ちます", request_id)
    return True


def request_cancel(request_id: int) -> bool:
    """
    取消エンドポイントから呼ぶ。依頼の状態はエンドポイント側で決まっているので、
    ここではロボットを止めて、止まるまでロボットを空きにしないことだけを行う。
    """
    return _begin_cancel(request_id, fail_reason=None)


def _wait_for_cancel(conn: sqlite3.Connection) -> None:
    """終了状態が来るか、待ち上限に達するまでロボットを解放しない"""
    global _cancelling
    pending = _cancelling
    if pending is None:
        return

    state = _poll_bridge(conn)
    waited = time.time() - pending["sent_at"]
    if state is not None and state.get("status") in TERMINAL:
        log.info("中断が確認できました id=%s status=%s", pending["id"], state.get("status"))
    elif waited > CANCEL_WAIT_SECONDS:
        # エレベーターが長い、あるいはブリッジが応答しない。これ以上待たない
        log.warning(
            "中断から %.0f 秒たっても終了状態になりません。ロボットを解放します id=%s",
            waited, pending["id"],
        )
    else:
        return

    if pending["fail_reason"]:
        req = conn.execute(
            "SELECT * FROM request WHERE id = ?", (pending["id"],)
        ).fetchone()
        if req is not None:
            _fail(conn, req, pending["fail_reason"])
    else:
        _go_idle(conn)
    _cancelling = None


def _trip_expired(conn: sqlite3.Connection, req: sqlite3.Row) -> bool:
    row = conn.execute(
        """SELECT (julianday('now') - julianday(started_at)) * 86400 AS sec
           FROM request WHERE id = ?""",
        (req["id"],),
    ).fetchone()
    return bool(row and row["sec"] is not None and row["sec"] > TRIP_TIMEOUT_SECONDS)


def _poll_bridge(conn: sqlite3.Connection) -> dict | None:
    """
    GET /state を1回。使える状態なら中身、駄目なら None。
    オフライン判定はここに集約する。走行の продвижение だけでなく、
    走行を始める前にも通す — ロボットが死んでいるのに依頼を消費しないため。
    """
    global _poll_fails, _bridge_down_since
    try:
        state = bridge.get_state(ROBOT_URL)
    except bridge.BridgeDown as e:
        _poll_fails += 1
        if not _bridge_down_since:
            _bridge_down_since = time.time()
        if _poll_fails == POLL_FAIL_LIMIT:
            log.error(
                "ブリッジが %s 回続けて応答しません。オフライン扱いにします: %s",
                _poll_fails, e,
            )
            conn.execute("UPDATE robot SET phase = 'error' WHERE id = ?", (ROBOT_ID,))
        return None
    except bridge.BridgeRefused as e:
        log.error("GET /state が断られました: %s", e)
        return None

    _poll_fails = 0
    _bridge_down_since = 0.0

    global _ros_down_count
    if not state.get("ros_ok", False):
        # ブリッジは生きていて ROS(かエンジン)だけ落ちている。状態の値は古いので信用しない。
        # 毎秒同じ行を出さない: 落ちている間は1分に1回
        global _ros_down_logged_at
        _ros_down_count += 1
        if time.time() - _ros_down_logged_at > 60:
            _ros_down_logged_at = time.time()
            log.error("ブリッジは応答していますが ROS かエンジンが落ちています(復旧するまで待ちます)")
        conn.execute("UPDATE robot SET phase = 'error' WHERE id = ?", (ROBOT_ID,))
        return None

    _ros_down_count = 0
    return state


def _bridge_down_for() -> float:
    """ブリッジが応答しなくなってからの秒数。応答していれば 0"""
    return time.time() - _bridge_down_since if _bridge_down_since else 0.0


def _bridge_down_too_long() -> bool:
    return _bridge_down_for() >= BRIDGE_DOWN_FAIL_SECONDS


def _fragment_lost(conn: sqlite3.Connection, req: sqlite3.Row, why: str) -> None:
    """
    実行中の断片が失われた(エンジンが落ちた・再起動した)。
    以前はここで断片を投げ直していたが、断片は最初のステップから走り直すため
    init なら誤った自己位置の宣言、elv ならエレベーターの再呼び出しになる。
    危険なので走行を失敗にし、人が確認するまで次を始めない(2026-09-17 の判断)。
    """
    robot = conn.execute("SELECT scenario_name FROM robot WHERE id = ?", (ROBOT_ID,)).fetchone()
    log.error("実行中の断片が失われました id=%s 断片=%s: %s", req["id"], robot["scenario_name"] if robot else "", why)
    _fail(conn, req, f"エンジン停止: {why}",
          stuck_reason=f"走行中にロボットとの通信が途切れました({why})。ロボットの位置と荷台を確認してください")


def _advance_bridge(conn: sqlite3.Connection, req: sqlite3.Row) -> None:
    global _last_uptime
    robot = conn.execute("SELECT * FROM robot WHERE id = ?", (ROBOT_ID,)).fetchone()
    expected = robot["scenario_name"]
    index = robot["step_index"] or 1

    if expected is None:
        # 走行中なのに断片を投げていない。再起動直後など。1本目から始める（§4.4 D）
        _send_fragment(conn, req, index)
        return

    state = _poll_bridge(conn)
    if state is None:
        # ブリッジ自体が落ちている(§4.4 B)なら依頼は running のまま保持し、復旧を待つ。
        # ただし BRIDGE_DOWN_FAIL_SECONDS を超えたら諦める: ロボットは断片を走り終えて
        # どこかで止まっているはずで、そこから盲目に続けるのは危ない
        # ブリッジは生きていて ROS/エンジンが落ちているのが続くなら、断片は失われている
        if _ros_down_count >= ROS_DOWN_FAIL_LIMIT:
            _fragment_lost(conn, req, "ROS かエンジンが応答しない")
        elif _bridge_down_too_long():
            _fragment_lost(conn, req, f"ブリッジが {_bridge_down_for():.0f} 秒応答しない")
        return

    if robot["phase"] == "error":
        # 復旧した
        log.info("ブリッジが復旧しました")
        conn.execute("UPDATE robot SET phase = ? WHERE id = ?", (_phase_of(req), ROBOT_ID))

    # ブリッジが再起動していたら、投げた断片は失われている。
    # 仕様が uptime_sec を持っているのはこの判定のため(§3.2)
    uptime = int(state.get("uptime_sec") or 0)
    restarted = uptime < _last_uptime
    _last_uptime = uptime

    if _trip_expired(conn, req):
        log.error("走行が上限時間を超えました id=%s 上限=%ss", req["id"], TRIP_TIMEOUT_SECONDS)
        if not _begin_cancel(req["id"], fail_reason="timeout"):
            _fail(conn, req, "timeout")
        return

    status = state.get("status", "IDLE")
    name = state.get("scenario_name", "")

    # 投げた断片をブリッジが覚えていない = 届いていないか、ブリッジが再起動した。
    # 終了状態は次のシナリオまで残る仕様なので、IDLE なのに待っている断片がある、
    # という形は「失われた」しか意味しない。
    # ただし state がすでにその断片の名前を出している(RUNNING でも終了でも)なら
    # 届いている。ブリッジだけが再起動した場合がこれで、再送してはいけない:
    # 2026-09-17 にブリッジを再起動するたびに再送し、エンジンのキューに
    # 同じ断片が積まれて pick_up が4回走った
    if status == "IDLE" and expected:
        # IDLE は起動直後にしか出ない = エンジンが再起動して断片を忘れた。投げ直さない
        _fragment_lost(conn, req, "エンジンが再起動した")
        return
    if name != expected and restarted and status in TERMINAL:
        # ブリッジだけが再起動し、エンジンは前の断片を終えて待っている。
        # 届いていなかった断片を送り直す(届いていれば duplicate で弾かれる)
        log.warning("ブリッジが再起動し、断片 %s が届いていません。再送します", expected)
        _send_fragment(conn, req, index)
        return

    if status in TERMINAL:
        # 終了状態は次のシナリオが始まるまで残る。名前を見ないと
        # 前の断片の SUCCESS を自分のものと誤認する（§3.2）
        if name != expected:
            return
        if status == "SUCCESS":
            _fragment_done(conn, _plan_for(conn, req), index)
            if index >= (robot["step_total"] or 0):
                _finish(conn, req)
            else:
                _send_fragment(conn, req, index + 1)
            return
        reason = state.get("reason") or status
        stuck_reason = None
        if EMERGENCY_STOP_MARK in reason:
            # 非常停止が解除されないまま上限を超えた
            stuck_reason = ("非常停止が続いたため走行を止めました(バンパーか非常停止ボタン)。"
                            "解除してロボットを HOME に置き直してください")
        _fail(conn, req, reason, stuck_reason=stuck_reason)
        return

    if status == "RUNNING" and name == expected:
        # 断片の中のステップ。依頼の進行は断片単位なので判断には使わないが、
        # 断面図がロボットの位置(リフトの前・中・後)を描くために残す
        # stamp はエンジンがこのステップを publish した時刻 = アクションの開始時刻
        # reason は RUNNING では一時停止の補足("emergency stop")。空なら通常走行。
        # 画面はこれで「非常停止中」を出す。走行自体は Atmobi が解除後に自分で再開する
        pause = state.get("reason") or None
        if pause != robot["pause_reason"]:
            if pause:
                log.warning("ロボットが一時停止しています 断片=%s 理由=%s", name, pause)
            else:
                log.info("ロボットの一時停止が解けました 断片=%s", name)
        conn.execute(
            """UPDATE robot SET action = ?, action_index = ?, action_since = ?, pause_reason = ?
               WHERE id = ?""",
            (state.get("action") or None, state.get("step_index"), state.get("stamp"), pause,
             ROBOT_ID),
        )
        log.debug(
            "断片 %s step %s/%s %s",
            name, state.get("step_index"), state.get("step_total"), state.get("action"),
        )


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

        if _cancelling is not None:
            # ロボットはまだ動いている。次の走行を始めてはいけない
            _wait_for_cancel(conn)
            conn.commit()
            return

        if conn.execute(
            "SELECT 1 FROM robot WHERE id = ? AND phase = 'homing'", (ROBOT_ID,)
        ).fetchone():
            # HOME へ戻っている最中。次の走行は始めない
            _advance_homing(conn)
            conn.commit()
            return

        running = conn.execute(
            "SELECT * FROM request WHERE status = 'running' AND is_deleted = 0 LIMIT 1"
        ).fetchone()
        if running is None:
            _ticks_in_step = 0
            _start_next(conn)
        elif ROBOT_MODE == "bridge":
            # 毎tick聞く。進んだかどうかを決めるのはロボット
            _advance_bridge(conn, running)
        else:
            _ticks_in_step += 1
            if _ticks_in_step >= SECONDS_PER_STEP:
                _ticks_in_step = 0
                _advance_mock(conn, running)
        conn.commit()
    finally:
        conn.close()


async def run_engine() -> None:
    """アプリの起動中ずっと回る。1秒ごとに1回だけ様子を見る"""
    if ROBOT_MODE == "bridge":
        log.info("搬送エンジンを開始しました mode=bridge url=%s", ROBOT_URL)
    elif ROBOT_MODE == "mock":
        log.info("搬送エンジンを開始しました mode=mock（ロボット無し）")
    else:
        log.error("ROBOT_MODE=%s は不明です。mock で動かします", ROBOT_MODE)
    while True:
        try:
            await asyncio.to_thread(_tick_once)
        except asyncio.CancelledError:
            raise
        except Exception:
            # 1回の失敗でエンジンを止めない。次のtickでやり直す
            log.exception("エンジンのtickに失敗しました")
        await asyncio.sleep(TICK_SECONDS)
