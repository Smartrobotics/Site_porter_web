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

ROBOT_MODE = os.getenv("ROBOT_MODE", "mock")
ROBOT_URL = os.getenv("ROBOT_URL", "http://127.0.0.1:8080")

POLL_FAIL_LIMIT = 3
BRIDGE_DOWN_FAIL_SECONDS = int(os.getenv("BRIDGE_DOWN_FAIL_SECONDS", "120"))

TRIP_TIMEOUT_SECONDS = int(os.getenv("TRIP_TIMEOUT_SECONDS", "1800"))

TERMINAL = ("SUCCESS", "FAILURE", "CANCELED")

CANCEL_WAIT_SECONDS = int(os.getenv("CANCEL_WAIT_SECONDS", "60"))

TICK_SECONDS = 1.0
SECONDS_PER_STEP = int(os.getenv("MOCK_SECONDS_PER_STEP", "20"))


ROBOT_ID = 1

HOMING_RUN_ID = 0

_ticks_in_step = 0

_poll_fails = 0
_bridge_down_since = 0.0

_last_uptime = 0

_cancelling: dict | None = None


def _set_robot(conn: sqlite3.Connection, phase: str, scenario_name: str,
               index: int, total: int) -> None:
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
    if not plan or not (0 < index <= len(plan)):
        return
    kind, params = plan[index - 1]
    if kind == "elv":
        _set_floor(conn, int(params["goal_floor"]))
        log.info("ロボットは %s 階にいます", params["goal_floor"])


def _stuck(conn: sqlite3.Connection, reason: str) -> None:
    log.error("%s。ロボットを HOME に置き直し、設定画面の「HOME に置き直した」を押してください", reason)
    conn.execute(
        """UPDATE robot SET phase = 'error', stuck_reason = ?, homing_floor = NULL,
                            scenario_name = NULL, step_index = NULL, step_total = NULL,
                            pause_reason = NULL
           WHERE id = ?""",
        (reason, ROBOT_ID),
    )


_stuck_logged_at = 0.0
_ros_down_logged_at = 0.0
_ros_down_count = 0
ROS_DOWN_FAIL_LIMIT = 3
EMERGENCY_STOP_MARK = "emergency stop"


def _go_idle(conn: sqlite3.Connection) -> None:
    conn.execute(
        """UPDATE robot SET phase = 'idle', scenario_name = NULL,
                            step_index = NULL, step_total = NULL, pause_reason = NULL
           WHERE id = ?""",
        (ROBOT_ID,),
    )


def _free_address(conn: sqlite3.Connection, area_id: int) -> int | None:
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
    rows = conn.execute(
        """SELECT * FROM request
           WHERE status = 'queued' AND is_deleted = 0
           ORDER BY priority, created_at, id"""
    ).fetchall()
    if ROBOT_MODE == "bridge" and _poll_bridge(conn) is None:
        return

    global _stuck_logged_at
    stuck = conn.execute("SELECT stuck_reason FROM robot WHERE id = ?", (ROBOT_ID,)).fetchone()
    if stuck and stuck["stuck_reason"]:
        if time.time() - _stuck_logged_at > 60:
            _stuck_logged_at = time.time()
            log.warning("人の手待ちのため走行を始めません: %s (順番待ち %s 件)",
                        stuck["stuck_reason"], len(rows))
        return

    if not rows:
        _go_idle(conn)
        return

    robot = conn.execute("SELECT at_home FROM robot WHERE id = ?", (ROBOT_ID,)).fetchone()
    if not robot["at_home"] and any(r["kind"] == "delivery" for r in rows):
        if not any(r["kind"] == "collect" for r in rows):
            _start_homing(conn)
            return
        rows = [r for r in rows if r["kind"] == "collect"]

    for row in rows:
        to_address_id = row["to_address_id"]
        if to_address_id is None or not _address_is_free(conn, to_address_id):
            to_address_id = _free_address(conn, row["to_area_id"])
        if to_address_id is None:
            if _unblock_full_area(conn, row):
                return
            continue
        try:
            _run(conn, row, to_address_id)
        except sqlite3.IntegrityError:
            log.exception("走行を開始できませんでした id=%s", row["id"])
        return

    _go_idle(conn)


def _unblock_full_area(conn: sqlite3.Connection, blocked: sqlite3.Row) -> bool:
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
    conn.execute("UPDATE rack SET street_address_id = NULL WHERE id = ?", (row["rack_id"],))
    robot = conn.execute("SELECT at_home FROM robot WHERE id = ?", (ROBOT_ID,)).fetchone()
    conn.execute("UPDATE request SET from_home = ? WHERE id = ?",
                 (1 if robot["at_home"] else 0, row["id"]))
    _set_at_home(conn, 0)

    log.info("搬送を開始しました id=%s kind=%s 番地=%s", row["id"], row["kind"], to_address_id)

    fresh = conn.execute("SELECT * FROM request WHERE id = ?", (row["id"],)).fetchone()
    plan = _plan_for(conn, fresh)
    if plan is None:
        _fail(conn, fresh, "走行の計画を作れませんでした（番地かマーカーが未設定）", moved=False)
        _set_at_home(conn, 1)
        return
    try:
        names = generate_chain(plan, run_id=fresh["id"], scenario_dir=SCENARIO_DIR)
        log.info("断片を %s 件書きました dir=%s", len(names), SCENARIO_DIR)
    except OSError as e:
        _fail(conn, fresh, f"断片を書けませんでした: {e}", moved=False)
        _set_at_home(conn, 1)
        return

    row = fresh
    if ROBOT_MODE == "bridge":
        _send_fragment(conn, row, 1)
    else:
        _set_robot(conn, _phase_of(row), names[0], 1, len(names))


def _has_open_request(conn: sqlite3.Connection, rack_id: int) -> bool:
    row = conn.execute(
        """SELECT 1 FROM request
           WHERE rack_id = ? AND is_deleted = 0 AND status IN ('queued', 'running')
           LIMIT 1""",
        (rack_id,),
    ).fetchone()
    return row is not None


def _empty_rack_in_area(conn: sqlite3.Connection, area_id: int, except_rack: int | None = None):
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
    rack = _empty_rack_in_area(conn, req["to_area_id"], except_rack=req["rack_id"])
    if rack is None:
        return False
    return _create_collect(conn, rack, req["from_area_id"], req["priority"],
                           f"依頼{req['id']}の荷降ろし後")


def _finish(conn: sqlite3.Connection, req: sqlite3.Row) -> None:
    names = _fragment_names(conn, req)
    if names and names[-1].endswith("return_home"):
        _set_at_home(conn, 1)
        _set_floor(conn, home_floor(load_floors()))
    status = "delivered" if req["kind"] == "delivery" else "done"
    conn.execute(
        "UPDATE request SET status = ?, delivered_at = datetime('now') WHERE id = ?",
        (status, req["id"]),
    )
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
            _start_homing(conn)


def _trip_params(conn: sqlite3.Connection, req: sqlite3.Row):
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
    row = conn.execute("SELECT floor FROM robot WHERE id = ?", (ROBOT_ID,)).fetchone()
    return int(row["floor"]) if row and row["floor"] is not None else None


def _plan_for(conn: sqlite3.Connection, req: sqlite3.Row):
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
        log.error("走行の計画を作れません id=%s: %s", req["id"], e)
        return None


def _fragment_names(conn: sqlite3.Connection, req: sqlite3.Row) -> list[str]:
    plan = _plan_for(conn, req)
    if plan is None:
        return []
    return [fragment_name(req["id"], seq, kind) for seq, (kind, _) in enumerate(plan, 1)]


def _phase_of(req: sqlite3.Row) -> str:
    return "delivery" if req["kind"] == "delivery" else "return"


def _homing_plan(conn: sqlite3.Connection):
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
        pass
    return True


def _post_fragment(name: str) -> bool:
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
    robot = conn.execute("SELECT * FROM robot WHERE id = ?", (ROBOT_ID,)).fetchone()
    names = _fragment_names(conn, req)
    if robot["step_index"]:
        _fragment_done(conn, _plan_for(conn, req), robot["step_index"])
    index = (robot["step_index"] or 0) + 1
    if index > len(names):
        _finish(conn, req)
        return
    _set_robot(conn, robot["phase"] or "delivery", names[index - 1], index, len(names))


def _fail(conn: sqlite3.Connection, req: sqlite3.Row, reason: str,
          stuck_reason: str | None = None, moved: bool = True) -> None:
    conn.execute(
        """UPDATE request SET status = 'failed', cancelled_at = datetime('now')
           WHERE id = ?""",
        (req["id"],),
    )
    _go_idle(conn)
    log.error("搬送が失敗しました id=%s reason=%s", req["id"], reason)
    if moved:
        _stuck(conn, stuck_reason or
               f"走行中にエラーが発生しました({reason})。ロボットの位置と荷台を確認してください")


def _send_fragment(conn: sqlite3.Connection, req: sqlite3.Row, index: int) -> None:
    names = _fragment_names(conn, req)
    if not (0 < index <= len(names)):
        _fail(conn, req, f"断片 {index} が計画にありません")
        return
    name = names[index - 1]
    try:
        res = bridge.post_scenario(ROBOT_URL, name, req["id"])
    except bridge.BridgeRefused as e:
        _fail(conn, req, f"bridge refused: {e}")
        return
    except bridge.BridgeDown as e:
        log.warning("断片を投げられませんでした（再送します） name=%s: %s", name, e)
        return

    if res.get("duplicate"):
        log.warning("同じ断片が二重に届いていました name=%s", name)
    _set_robot(conn, _phase_of(req), name, index, len(names))
    log.info("断片を投げました name=%s", name)


def _begin_cancel(request_id: int, fail_reason: str | None) -> bool:
    global _cancelling
    if ROBOT_MODE != "bridge":
        return False
    try:
        bridge.post_cancel(ROBOT_URL)
    except (bridge.BridgeDown, bridge.BridgeRefused) as e:
        log.warning("中断を送れませんでした id=%s: %s", request_id, e)
        return False
    _cancelling = {"id": request_id, "sent_at": time.time(), "fail_reason": fail_reason}
    log.info("中断を送りました id=%s。終了状態を待ちます", request_id)
    return True


def request_cancel(request_id: int) -> bool:
    return _begin_cancel(request_id, fail_reason=None)


def _wait_for_cancel(conn: sqlite3.Connection) -> None:
    global _cancelling
    pending = _cancelling
    if pending is None:
        return

    state = _poll_bridge(conn)
    waited = time.time() - pending["sent_at"]
    if state is not None and state.get("status") in TERMINAL:
        log.info("中断が確認できました id=%s status=%s", pending["id"], state.get("status"))
    elif waited > CANCEL_WAIT_SECONDS:
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
    return time.time() - _bridge_down_since if _bridge_down_since else 0.0


def _bridge_down_too_long() -> bool:
    return _bridge_down_for() >= BRIDGE_DOWN_FAIL_SECONDS


def _fragment_lost(conn: sqlite3.Connection, req: sqlite3.Row, why: str) -> None:
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
        _send_fragment(conn, req, index)
        return

    state = _poll_bridge(conn)
    if state is None:
        if _ros_down_count >= ROS_DOWN_FAIL_LIMIT:
            _fragment_lost(conn, req, "ROS かエンジンが応答しない")
        elif _bridge_down_too_long():
            _fragment_lost(conn, req, f"ブリッジが {_bridge_down_for():.0f} 秒応答しない")
        return

    if robot["phase"] == "error":
        log.info("ブリッジが復旧しました")
        conn.execute("UPDATE robot SET phase = ? WHERE id = ?", (_phase_of(req), ROBOT_ID))

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

    if status == "IDLE" and expected:
        _fragment_lost(conn, req, "エンジンが再起動した")
        return
    if name != expected and restarted and status in TERMINAL:
        log.warning("ブリッジが再起動し、断片 %s が届いていません。再送します", expected)
        _send_fragment(conn, req, index)
        return

    if status in TERMINAL:
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
            stuck_reason = ("非常停止が続いたため走行を止めました(バンパーか非常停止ボタン)。"
                            "解除してロボットを HOME に置き直してください")
        _fail(conn, req, reason, stuck_reason=stuck_reason)
        return

    if status == "RUNNING" and name == expected:
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
            _wait_for_cancel(conn)
            conn.commit()
            return

        if conn.execute(
            "SELECT 1 FROM robot WHERE id = ? AND phase = 'homing'", (ROBOT_ID,)
        ).fetchone():
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
            log.exception("エンジンのtickに失敗しました")
        await asyncio.sleep(TICK_SECONDS)
