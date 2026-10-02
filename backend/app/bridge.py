import json
import logging
import urllib.error
import urllib.request

log = logging.getLogger(__name__)

TIMEOUT_SECONDS = 3.0


class BridgeDown(Exception):
    pass


class BridgeRefused(Exception):
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
        raise BridgeDown(f"invalid json: {e}") from e


def post_scenario(base_url: str, name: str, run_id: int) -> dict:
    return _call(base_url, "POST", "/scenario", {"name": name, "run_id": run_id})


def get_state(base_url: str) -> dict:
    return _call(base_url, "GET", "/state")


def post_cancel(base_url: str) -> dict:
    return _call(base_url, "POST", "/cancel", {})
