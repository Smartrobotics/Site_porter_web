#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
scenario_bridge の代わり。ロボットも ROS も無い机の上で、サーバー側の
ChainRunner を通しで動かすためのもの。

docs/siteporter-bridge-api.ja.md の §3 の3つの口をそのまま実装している。
中身は ROS ではなくタイマー。サーバーから見ると本物と区別がつかないので、
engine.py の bridge モードはこれで完全に確認できる。

標準ライブラリだけ。flask も rospy も要らない。

    python3 tools/fake_bridge.py                    # 普通に動く
    python3 tools/fake_bridge.py --step-seconds 1   # 速く
    python3 tools/fake_bridge.py --fail-at 2        # 異常系A: step 2 で FAILURE
    python3 tools/fake_bridge.py --hang             # 異常系C: 終わらない
    python3 tools/fake_bridge.py --ros-down         # ros_ok:false（ブリッジは生きている）
    python3 tools/fake_bridge.py --die-after 20     # 異常系B: 20秒後に応答を止める
    python3 tools/fake_bridge.py --cancel-delay 10  # 取消を受けても10秒間止まらない
                                                   # （エレベーター動作中の再現。§3.3）

停止は Ctrl+C。
"""

import argparse
import json
import re
import sys
import threading
import time
from datetime import datetime, timezone, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

JST = timezone(timedelta(hours=9))
NAME_RE = re.compile(r'^[A-Za-z0-9_.\-]+$')

# 本物の断片が踏むステップに似せた名前。数だけ合っていれば十分
ACTIONS = ['init_pose', 'set_goal_elv', 'elv_call_floor', 'marker_dock', 'lift_down']


class Bridge:
    """/scenario_state の latched な値を持つだけの入れ物"""

    def __init__(self, opts):
        self.opts = opts
        self.lock = threading.Lock()
        self.started = time.time()
        self.cancel_flag = False
        self.cancel_at = None
        self.state = {
            'status': 'IDLE',
            'scenario_name': '',
            'step_index': 0,
            'step_total': 0,
            'action': '',
            'reason': '',
            'queue_size': 0,
        }

    # ---------------------------------------------------------------- 状態
    def snapshot(self):
        with self.lock:
            s = dict(self.state)
        s['stamp'] = datetime.now(JST).isoformat(timespec='milliseconds')
        s['ros_ok'] = not self.opts.ros_down
        s['uptime_sec'] = int(time.time() - self.started)
        return s

    def _set(self, **kw):
        with self.lock:
            self.state.update(kw)
        log = self.state
        print(f"  [state] {log['status']:8} {log['scenario_name']:24} "
              f"step {log['step_index']}/{log['step_total']} {log['action']}", flush=True)

    def is_busy(self, name):
        """同名がまだ終わっていない = 重複"""
        with self.lock:
            return (self.state['scenario_name'] == name
                    and self.state['status'] == 'RUNNING')

    # ---------------------------------------------------------------- 実行
    def start(self, name):
        self.cancel_flag = False
        self.cancel_at = None
        total = len(ACTIONS)
        self._set(status='RUNNING', scenario_name=name, step_index=0,
                  step_total=total, action=ACTIONS[0], reason='')
        threading.Thread(target=self._run, args=(name, total), daemon=True).start()

    def _run(self, name, total):
        # 本物のエンジンはステップが変わったときだけ publish する。同じ振る舞いにする
        for index in range(total):
            for _ in range(int(self.opts.step_seconds * 10)):
                if self.cancel_flag:
                    # エレベーター動作中は中断判定が無効で、動作が終わるまで
                    # 止まらない(§3.3)。--cancel-delay がその窓を再現する
                    if self.cancel_at is not None:
                        left = self.opts.cancel_delay - (time.time() - self.cancel_at)
                        if left > 0:
                            time.sleep(0.1)
                            continue
                    self._set(status='CANCELED', reason='canceled')
                    return
                time.sleep(0.1)
            if self.opts.fail_at is not None and index == self.opts.fail_at:
                self._set(status='FAILURE', step_index=index,
                          reason='navigation timeout')
                return
            if index + 1 < total:
                self._set(status='RUNNING', step_index=index + 1,
                          action=ACTIONS[index + 1])
        if self.opts.hang:
            print('  [hang] 終了状態を出さずに留まる（異常系C）', flush=True)
            return
        self._set(status='SUCCESS', step_index=total - 1, reason='')

    def cancel(self):
        self.cancel_flag = True
        if self.cancel_at is None:
            self.cancel_at = time.time()
        if self.opts.cancel_delay:
            print(f'  [cancel] 受け付けたが {self.opts.cancel_delay} 秒は止まらない',
                  flush=True)


class Handler(BaseHTTPRequestHandler):
    bridge: Bridge = None

    def log_message(self, *_):
        pass  # 自前で出す

    def _send(self, code, payload):
        body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _dead(self):
        """--die-after: 応答そのものを止める（異常系B）"""
        o = self.bridge.opts
        return o.die_after is not None and time.time() - self.bridge.started > o.die_after

    def do_GET(self):
        if self._dead():
            self.close_connection = True
            return
        if self.path.split('?')[0] != '/state':
            self._send(404, {'error': 'not_found'})
            return
        self._send(200, self.bridge.snapshot())

    def do_POST(self):
        if self._dead():
            self.close_connection = True
            return
        path = self.path.split('?')[0]
        length = int(self.headers.get('Content-Length') or 0)
        raw = self.rfile.read(length) if length else b''

        if self.bridge.opts.ros_down:
            self._send(503, {'error': 'ros_unavailable'})
            return

        if path == '/cancel':
            print('POST /cancel', flush=True)
            self.bridge.cancel()
            self._send(202, {'accepted': True})
            return

        if path != '/scenario':
            self._send(404, {'error': 'not_found'})
            return

        try:
            payload = json.loads(raw or b'{}')
        except ValueError:
            self._send(400, {'error': 'invalid_name'})
            return

        name = (payload.get('name') or '').strip()
        print(f"POST /scenario name={name!r} run_id={payload.get('run_id')}", flush=True)

        if not name or not NAME_RE.match(name):
            self._send(400, {'error': 'invalid_name'})
            return

        # 404 の確認はブリッジ側で行う（本物と同じ）。--scenario-dir 未指定なら省略
        d = self.bridge.opts.scenario_dir
        if d and not (Path(d) / f'{name}.json').is_file():
            self._send(404, {'error': 'scenario_not_found'})
            return

        if self.bridge.is_busy(name):
            self._send(202, {'accepted': True, 'name': name, 'duplicate': True})
            return

        self.bridge.start(name)
        self._send(202, {'accepted': True, 'name': name, 'duplicate': False})


def main():
    ap = argparse.ArgumentParser(description='scenario_bridge の偽物（ROS 不要）')
    ap.add_argument('--host', default='127.0.0.1')
    ap.add_argument('--port', type=int, default=8080)
    ap.add_argument('--step-seconds', type=float, default=3.0,
                    help='1ステップにかける秒数')
    ap.add_argument('--scenario-dir',
                    help='指定すると JSON の存在を確認し、無ければ 404 を返す')
    ap.add_argument('--fail-at', type=int, metavar='STEP',
                    help='異常系A: このステップで FAILURE')
    ap.add_argument('--hang', action='store_true',
                    help='異常系C: 終了状態を出さない')
    ap.add_argument('--ros-down', action='store_true',
                    help='ros_ok:false。GET /state は 200、POST は 503')
    ap.add_argument('--die-after', type=float, metavar='SEC',
                    help='異常系B: この秒数のあと応答を止める')
    ap.add_argument('--cancel-delay', type=float, default=0.0, metavar='SEC',
                    help='取消を受けてもこの秒数は止まらない'
                         '(エレベーター動作中の再現。§3.3)')
    opts = ap.parse_args()

    Handler.bridge = Bridge(opts)
    server = ThreadingHTTPServer((opts.host, opts.port), Handler)
    print(f'fake scenario_bridge на http://{opts.host}:{opts.port}', flush=True)
    print(f'  шаг {opts.step_seconds} с, всего {len(ACTIONS)} шагов на фрагмент', flush=True)
    if opts.ros_down:
        print('  ros_ok=false', flush=True)
    if opts.fail_at is not None:
        print(f'  FAILURE на шаге {opts.fail_at}', flush=True)
    if opts.hang:
        print('  зависание вместо завершения', flush=True)
    if opts.die_after is not None:
        print(f'  замолчит через {opts.die_after} с', flush=True)
    if opts.cancel_delay:
        print(f'  отмена подействует через {opts.cancel_delay} с', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nостановлен', flush=True)
        return 0


if __name__ == '__main__':
    sys.exit(main() or 0)
