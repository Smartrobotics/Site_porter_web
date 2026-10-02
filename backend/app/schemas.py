from typing import Literal

from pydantic import BaseModel, Field

class RequestCreate(BaseModel):
    rack_id: int
    from_area_id: int
    to_area_id: int
    item: str | None = Field(default=None, max_length=200)
    receiver_name: str | None = Field(default=None, max_length=100)
    tracking_no: str | None = Field(default=None, max_length=100)
    priority: int = Field(default=2, ge=1, le=3)


class RequestOut(BaseModel):
    id: int
    kind: str
    created_by: str
    tracking_no: str | None
    item: str | None
    receiver_name: str | None
    priority: int
    status: str
    created_at: str
    from_area: str
    to_area: str
    rack_marker_id: int
    rack_id: int
    from_area_id: int
    to_area_id: int
    from_address_id: int | None
    to_address_id: int | None
    started_at: str | None
    delivered_at: str | None
    confirmed_at: str | None
    robot_phase: str | None
    robot_scenario: str | None
    robot_floor: int | None = None
    robot_action: str | None = None
    robot_action_index: int | None = None
    robot_action_since: str | None = None
    robot_pause_reason: str | None = None
    step_index: int | None
    step_total: int | None


class AreaOut(BaseModel):
    id: int
    floor: int
    map_no: int
    label: str


class AddressOut(BaseModel):
    id: int
    area_id: int
    address_no: int
    path_no: int
    area_label: str
    label: str


class RackOut(BaseModel):
    id: int
    marker_id: int
    street_address_id: int | None
    is_empty: bool
    area_id: int | None
    address_no: int | None
    label: str


class UserOut(BaseModel):
    id: int
    name: str


class CancelIn(BaseModel):
    mode: Literal["abort", "reset", "delete"]


class RackPatch(BaseModel):
    marker_id: int = Field(ge=1)


class PlacementItem(BaseModel):
    rack_id: int
    street_address_id: int


class PlacementIn(BaseModel):
    items: list[PlacementItem]


class RobotOut(BaseModel):
    id: int
    name: str
    phase: str
    scenario_name: str | None
    step_index: int | None
    step_total: int | None
    request_id: int | None
    mode: str
    floor: int | None = None
    stuck_reason: str | None = None
    pause_reason: str | None = None
    server_now: str | None = None
