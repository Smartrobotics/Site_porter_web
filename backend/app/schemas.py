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


class AreaOut(BaseModel):
    """エリア。壁のQRコードは1エリアに1枚。配送員が選ぶのはこの単位。"""
    id: int
    floor: int
    map_no: int          # ロボットの地図番号。2F=14, 1F=13
    label: str


class AddressOut(BaseModel):
    """番地。荷台を1台だけ置く場所。番地を選ぶのはサーバー。"""
    id: int
    area_id: int
    address_no: int
    path_no: int         # 経路番号。シナリオ生成に渡る
    area_label: str
    label: str           # 表示用「2Fエレベータ付近 番地1」


class RackOut(BaseModel):
    """荷台。搬送中は番地を持たない(street_address_id = None)。"""
    id: int
    marker_id: int
    street_address_id: int | None
    is_empty: bool
    area_id: int | None
    address_no: int | None
    label: str           # 表示用「荷台3」



class UserOut(BaseModel):
    """受取人。name は伝票QRの receiver と一致していること。"""
    id: int
    name: str
