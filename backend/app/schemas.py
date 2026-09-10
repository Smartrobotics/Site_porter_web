from pydantic import BaseModel

class RequestOut(BaseModel):
    """搬送依頼一覧の1行。エリア名と荷台マーカーは JOIN 済みの値。"""
    id: int
    kind: str                 # delivery = 荷物搬送 / collect = 荷台回収
    created_by: str           # user = 配送員 / system = サーバー
    tracking_no: str | None   # collect は伝票を持たないので None
    item: str | None
    receiver_name: str | None
    priority: int             # 1=高 2=中 3=低
    status: str
    created_at: str
    from_area: str            # area.label
    to_area: str
    rack_marker_id: int

