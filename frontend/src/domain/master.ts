/**
 * マスタデータ。サーバー(/api/area, /api/address, /api/rack)から取得する。
 * 旧 building/ の BuildingProfile を置き換える。
 *
 * 階層は2段。DBの構造をそのまま持つ。
 *   エリア(area)   … 壁のQRコード1枚ぶんの範囲。配送員が選ぶのはここ
 *   番地(address)  … 荷台を1台だけ置ける場所。選ぶのはサーバー
 */

/** エリア。壁のQRコードは1エリアに1枚 */
export interface Area {
  id: number
  floor: number
  /** ロボットの地図番号。2F=14, 1F=13 */
  mapNo: number
  label: string
}

/** 番地。荷台を1台だけ置く場所 */
export interface Address {
  id: number
  areaId: number
  addressNo: number
  /** 経路番号。シナリオ生成に渡る値 */
  pathNo: number
  areaLabel: string
  /** 「2Fエレベータ付近 番地1」 */
  label: string
}

/** 荷台。搬送中は番地を持たない */
export interface Rack {
  id: number
  markerId: number
  addressId?: number
  isEmpty: boolean
  areaId?: number
  addressNo?: number
  /** 「荷台3」 */
  label: string
}

/** 受取人。name は伝票QRの receiver と一致していること */
export interface User {
  id: number
  name: string
}

export interface Master {
  areas: Area[]
  addresses: Address[]
  racks: Rack[]
  users: User[]
}

export const EMPTY_MASTER: Master = { areas: [], addresses: [], racks: [], users: [] }

/** 現場の名前。DBには持たないので定数。複数現場になったらテーブルに移す */
export const SITE_NAME = '現場'

// ---------------------------------------------------------------- 変換
// サーバーは snake_case、画面側は camelCase。境界はここだけ。

interface AreaRaw {
  id: number
  floor: number
  map_no: number
  label: string
}

interface AddressRaw {
  id: number
  area_id: number
  address_no: number
  path_no: number
  area_label: string
  label: string
}

interface RackRaw {
  id: number
  marker_id: number
  street_address_id: number | null
  is_empty: boolean
  area_id: number | null
  address_no: number | null
  label: string
}

export function toArea(r: AreaRaw): Area {
  return { id: r.id, floor: r.floor, mapNo: r.map_no, label: r.label }
}

export function toAddress(r: AddressRaw): Address {
  return {
    id: r.id,
    areaId: r.area_id,
    addressNo: r.address_no,
    pathNo: r.path_no,
    areaLabel: r.area_label,
    label: r.label,
  }
}

export function toUser(r: User): User {
  return { id: r.id, name: r.name }
}

export function toRack(r: RackRaw): Rack {
  return {
    id: r.id,
    markerId: r.marker_id,
    addressId: r.street_address_id ?? undefined,
    isEmpty: r.is_empty,
    areaId: r.area_id ?? undefined,
    addressNo: r.address_no ?? undefined,
    label: r.label,
  }
}

// ---------------------------------------------------------------- 参照
// 旧 building/types.ts の floorLabel / spotLabel / spotsOnFloor に対応する。

export function findArea(m: Master, areaId: number | undefined): Area | undefined {
  return areaId === undefined ? undefined : m.areas.find((a) => a.id === areaId)
}

export function findAddress(m: Master, addressId: number | undefined): Address | undefined {
  return addressId === undefined ? undefined : m.addresses.find((a) => a.id === addressId)
}

export function findRack(m: Master, rackId: number | undefined): Rack | undefined {
  return rackId === undefined ? undefined : m.racks.find((r) => r.id === rackId)
}

/** 「2Fエレベータ付近」。見つからなければ番号をそのまま返す(データ不整合を隠さない) */
export function areaLabel(m: Master, areaId: number | undefined): string {
  if (areaId === undefined) return '—'
  return findArea(m, areaId)?.label ?? `エリア${areaId}`
}

/** 「2Fエレベータ付近 番地1」 */
export function addressLabel(m: Master, addressId: number | undefined): string {
  if (addressId === undefined) return '—'
  return findAddress(m, addressId)?.label ?? `番地${addressId}`
}

/** 「2F」。エリアが属する階だけを短く出したいとき */
export function floorLabel(m: Master, areaId: number | undefined): string {
  const area = findArea(m, areaId)
  return area ? `${area.floor}F` : ''
}

/** そのエリアにある番地。荷台配置初期設定などで使う */
export function addressesInArea(m: Master, areaId: number): Address[] {
  return m.addresses.filter((a) => a.areaId === areaId)
}

/** その番地に置かれている荷台(空きの判定に使う) */
export function rackAtAddress(m: Master, addressId: number): Rack | undefined {
  return m.racks.find((r) => r.addressId === addressId)
}

/** エリア内の空いている番地。0件でも依頼は受け付ける(E7) */
export function freeAddressesInArea(m: Master, areaId: number): Address[] {
  return addressesInArea(m, areaId).filter((a) => !rackAtAddress(m, a.id))
}
