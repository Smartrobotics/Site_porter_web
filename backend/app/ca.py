"""ローカルCA（mkcert）の配布。

スマホに証明書を入れる前は https:// 側が信頼されていないため、
このエンドポイントは **backend の http://<IP>:8000 で開くこと** を前提にしている。
"""

import logging
import os
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse

CA_DIR = Path(os.getenv("CA_DIR", "/ca"))

# 配布してよいファイルのホワイトリスト。
# パスを組み立てる前にここで照合するので、../ のような指定は通らない。
# 秘密鍵（rootCA-key.pem）は絶対に含めない。
CA_FILES = {
    "rootCA.pem": "application/x-x509-ca-cert",
    "rootCA.crt": "application/x-x509-ca-cert",
}

log = logging.getLogger(__name__)

router = APIRouter()


def available() -> bool:
    return any((CA_DIR / name).is_file() for name in CA_FILES)


@router.get("/api/ca/status")
def ca_status():
    return {
        "available": available(),
        "files": [n for n in CA_FILES if (CA_DIR / n).is_file()],
    }


@router.get("/api/ca/{filename}")
def ca_file(filename: str):
    media_type = CA_FILES.get(filename)
    if media_type is None:
        raise HTTPException(status_code=404, detail="Not found")

    path = CA_DIR / filename
    if not path.is_file():
        raise HTTPException(
            status_code=404,
            detail="証明書が置かれていません。README の「CAをスマホに渡す」を参照してください。",
        )

    # attachment だと iOS がプロファイルとして扱わずファイル保存になることがあるため inline
    log.info("証明書を配布しました file=%s", filename)
    return FileResponse(
        path,
        media_type=media_type,
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )


@router.get("/setup", response_class=HTMLResponse)
def setup_page(request: Request):
    """スマホで開く証明書インストール用のページ。"""
    host = request.url.hostname
    app_url = f"https://{host}:5173"

    if not available():
        body = """
        <p class="warn">証明書がサーバーに置かれていません。</p>
        <p>開発PCで次を実行してください。</p>
        <pre>mkdir -p ca
cp "$(mkcert -CAROOT)/rootCA.pem" ca/
cp ca/rootCA.pem ca/rootCA.crt
docker compose restart backend</pre>
        """
    else:
        body = f"""
        <ol>
          <li>
            <b>証明書をダウンロードする</b>
            <p class="dl">
              <a href="/api/ca/rootCA.pem" download>iPhone / iPad はこちら（rootCA.pem）</a>
              <a href="/api/ca/rootCA.crt" download>Android はこちら（rootCA.crt）</a>
            </p>
          </li>
          <li>
            <b>iPhone / iPad</b>
            <p>設定 → 一般 → VPNとデバイス管理 → ダウンロード済みプロファイル → インストール</p>
            <p class="warn">
              続けて 設定 → 一般 → 情報 → <b>証明書信頼設定</b> で mkcert のトグルをONにする。
              これを忘れると信頼されない。
            </p>
          </li>
          <li>
            <b>Android</b>
            <p>設定 → セキュリティ → 暗号化と認証情報 → 証明書をインストール → <b>CA証明書</b></p>
            <p>「VPNとアプリ」ではなくCA証明書を選ぶ。画面ロック未設定だと登録できない。</p>
          </li>
          <li>
            <b>アプリを開く</b>
            <p class="dl"><a href="{app_url}">{app_url}</a></p>
            <p>鍵アイコンが出て警告が無ければ成功。</p>
          </li>
        </ol>
        """

    return f"""<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>証明書のインストール</title>
<style>
  body {{ margin:0; padding:1.5rem 1.25rem 3rem; line-height:1.8;
         font-family:system-ui,-apple-system,"Hiragino Sans","Noto Sans JP",sans-serif;
         color:#1b1d22; background:#fbfbfc; max-width:34rem; margin-inline:auto; }}
  h1 {{ font-size:1.3rem; margin:0 0 .5rem; }}
  .lead {{ color:#6b7280; margin-top:0; }}
  ol {{ padding-left:1.2rem; }}
  li {{ margin-bottom:1.5rem; }}
  li p {{ margin:.4rem 0; }}
  .dl {{ display:flex; flex-direction:column; gap:.5rem; margin:.6rem 0; }}
  .dl a {{ display:block; padding:.7rem .9rem; text-align:center; text-decoration:none;
          color:#fff; background:#2f5bd7; border-radius:6px; }}
  .warn {{ padding:.6rem .8rem; background:#fdf1f1; color:#8c1f26; border-radius:6px; }}
  pre {{ padding:.8rem; overflow-x:auto; background:#f3f4f6; border-radius:6px; font-size:.85rem; }}
</style>
</head>
<body>
  <h1>証明書のインストール</h1>
  <p class="lead">カメラでQRを読むにはHTTPSが必要です。この端末にローカルCAを入れます。</p>
  {body}
</body>
</html>"""
