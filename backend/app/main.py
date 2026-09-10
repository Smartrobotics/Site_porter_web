import logging
import os
import sqlite3
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .ca import router as ca_router
from .db import DB_PATH, get_db, init_db
from .logging_config import setup_logging
from .schemas import RequestOut

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
    yield
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
REQUEST_LIST_SQL = """
SELECT r.id, r.kind, r.created_by, r.tracking_no, r.item,
       r.receiver_name, r.priority, r.status, r.created_at,
       fa.label AS from_area, ta.label AS to_area, rk.marker_id AS rack_marker_id
FROM request r
JOIN area fa ON fa.id = r.from_area_id
JOIN area ta ON ta.id = r.to_area_id
JOIN rack rk ON rk.id = r.rack_id
WHERE r.is_deleted = 0
ORDER BY r.created_at DESC, r.id DESC
"""


@app.get("/api/requests", response_model=list[RequestOut])
def list_requests(db: sqlite3.Connection = Depends(get_db)):
    rows = db.execute(REQUEST_LIST_SQL).fetchall()
    log.debug("依頼一覧を返しました count=%s", len(rows))
    return [dict(row) for row in rows]
