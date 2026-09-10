export interface FloorDef {
  id: string
  label: string
}

export interface SpotDef {
  id: string
  label: string
  floorId: string
}

/** 建物内の階間経路と、@mobi の地図番号/経路番号への写像 */
export interface RouteMapping {
  fromFloorId: string
  toFloorId: string
  mapNo: number
  pathNo: number
}

export interface BuildingProfile {
  id: string
  name: string
  floors: FloorDef[]
  spots: SpotDef[]
  routes: RouteMapping[]
  source: 'json' | 'bim'
}

export function findRoute(
  profile: BuildingProfile,
  fromFloorId: string,
  toFloorId: string,
): RouteMapping | undefined {
  return profile.routes.find((r) => r.fromFloorId === fromFloorId && r.toFloorId === toFloorId)
}

export function floorLabel(profile: BuildingProfile, floorId: string): string {
  return profile.floors.find((f) => f.id === floorId)?.label ?? floorId
}

export function spotLabel(profile: BuildingProfile, spotId: string | undefined): string {
  if (!spotId) return '—'
  return profile.spots.find((s) => s.id === spotId)?.label ?? spotId
}

export function spotsOnFloor(profile: BuildingProfile, floorId: string): SpotDef[] {
  return profile.spots.filter((s) => s.floorId === floorId)
}
