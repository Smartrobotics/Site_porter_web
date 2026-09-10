from typing import Literal

from pydantic import BaseModel, Field

class RequestCreate(BaseModel):
    """搬送依頼の受付。番地を決めるのはサーバーなので、送るのはエリアまで。"""
    rack_id: int
    from_area_id: int
    to_area_id: int
    item: str | None = Field(default=None, max_length=200)
    receiver_name: str | None = Field(default=None, max_length=100)
    tracking_no: str | None = Field(default=None, max_length=100)
    priority: int = Field(default=2, ge=1, le=3)


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
    # 画面が場所をたどるための生のID
    rack_id: int
    from_area_id: int
    to_area_id: int
    from_address_id: int | None
    to_address_id: int | None
    # 時刻。未到達なら None
    started_at: str | None
    delivered_at: str | None
    confirmed_at: str | None
    # 走行中の依頼だけ入る。ロボットの現在位置(モックでも実機でも同じ形)
    robot_phase: str | None
    step_index: int | None
    step_total: int | None


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


class CancelIn(BaseModel):
    """
    依頼の取消。
      abort  … 走行を中止する(失敗として残す)
      reset  … 搬送開始前の状態に戻す。依頼はそのまま残り、また順番待ちになる
      delete … 画面から消す。記録は is_deleted で残す
    """
    mode: Literal["abort", "reset", "delete"]


class RackPatch(BaseModel):
    """荷台のマーカーIDを付け替える。汎用マーカー要件でユーザーが自由に変えられる。"""
    marker_id: int = Field(ge=1)


class PlacementItem(BaseModel):
    rack_id: int
    street_address_id: int


class PlacementIn(BaseModel):
    """
    荷台配置をまとめて入れ替える。1台ずつ動かすと入れ替え(AをBの場所へ、BをAの場所へ)が
    途中で「その番地は使用中」に当たってしまうので、全体を1回の処理で反映する。
    """
    items: list[PlacementItem]
