"""
scenario_bridge への HTTP クライアント。

docs/siteporter-bridge-api.ja.md §3 の3つの口をそのまま呼ぶだけ。
判断は engine.py 側で行う。ここは「投げて、返ってきたものを渡す」に徹する。

標準ライブラリのみ。requirements.txt は変えない。
"""

import json
import logging
import urllib.error
import urllib.request

log = logging.getLogger(__name__)

# 仕様は「接続 1 秒 / 読取 2 秒」。urllib は両者を分けられないので合計で持つ。
# ループバック相手なので、分けられなくても実害はない。
TIMEOUT_SECONDS = 3.0


class BridgeDown(Exception):
    """繋がらない・応答が返らない。ブリッジごと落ちている可能性"""


class BridgeRefused(Exception):
    """繋がったが断られた（400 / 404 / 503）。ブリッジは生きている"""

    def __init__(self, status: int, error: str):
        super().__init__(f"{status} {error}")
        self.status = status
        self.error = error


def _call(base_url: str, method: str, path: str, body: dict | None = None) -> dict:
    url = base_url.rstrip("/") + path
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={"Content-Type": "application/json; charset=utf-8"},
    )
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as res:
            raw = res.read()
    except urllib.error.HTTPError as e:
        # 400 / 404 / 503。本文に {"error": "..."} が入っている
        try:
            payload = json.loads(e.read() or b"{}")
        except ValueError:
            payload = {}
        raise BridgeRefused(e.code, str(payload.get("error", "")))
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise BridgeDown(str(e)) from e

    try:
        return json.loads(raw or b"{}")
    except ValueError as e:
        # 200 なのに JSON でない。ブリッジが壊れているのと同じ扱いにする
        raise BridgeDown(f"invalid json: {e}") from e


def post_scenario(base_url: str, name: str, run_id: int) -> dict:
    """
    断片の実行を指示する。応答 `duplicate: true` はエラーではない
    （こちらの再送が二重に届いた、という意味）。
    """
    return _call(base_url, "POST", "/scenario", {"name": name, "run_id": run_id})


def get_state(base_url: str) -> dict:
    """
    進行状態。死活確認も兼ねる。
    200 が返れば「ブリッジは生きている」、`ros_ok` が ROS の生死。
    """
    return _call(base_url, "GET", "/state")


def post_cancel(base_url: str) -> dict:
    """実行中の断片を打ち切る"""
    return _call(base_url, "POST", "/cancel", {})
