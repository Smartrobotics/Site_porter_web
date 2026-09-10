import type { BuildingProfile } from './types'

/**
 * サンプル建物プロファイル(JSON定義相当)。
 * 建物を切り替えると、階・場所の選択肢と経路マッピングが丸ごと入れ替わる。
 */
export const SAMPLE_BUILDINGS: BuildingProfile[] = [
  {
    id: 'site-a',
    name: 'デモ現場A(2階建・1F集積場→2F受渡)',
    source: 'json',
    floors: [
      { id: 'f1', label: '1F' },
      { id: 'f2', label: '2F' },
    ],
    spots: [
      { id: 'a-yard', label: '資材集積場', floorId: 'f1' },
      { id: 'a-gate', label: '搬入ゲート', floorId: 'f1' },
      { id: 'a-hall2', label: '受渡ホール', floorId: 'f2' },
      { id: 'a-office2', label: '現場事務所', floorId: 'f2' },
    ],
    routes: [
      { fromFloorId: 'f1', toFloorId: 'f2', mapNo: 1, pathNo: 12 },
      { fromFloorId: 'f2', toFloorId: 'f1', mapNo: 1, pathNo: 21 },
    ],
  },
  {
    id: 'site-b',
    name: 'デモ現場B(3階建・中層マンション工区)',
    source: 'json',
    floors: [
      { id: 'g1', label: '1F' },
      { id: 'g2', label: '2F' },
      { id: 'g3', label: '3F' },
    ],
    spots: [
      { id: 'b-stock', label: '資材ストックヤード', floorId: 'g1' },
      { id: 'b-elev', label: 'エレベーター前', floorId: 'g1' },
      { id: 'b-room2', label: '内装作業エリア', floorId: 'g2' },
      { id: 'b-room3', label: '設備作業エリア', floorId: 'g3' },
      { id: 'b-office3', label: '監督詰所', floorId: 'g3' },
    ],
    routes: [
      { fromFloorId: 'g1', toFloorId: 'g2', mapNo: 2, pathNo: 12 },
      { fromFloorId: 'g2', toFloorId: 'g1', mapNo: 2, pathNo: 21 },
      { fromFloorId: 'g1', toFloorId: 'g3', mapNo: 2, pathNo: 13 },
      { fromFloorId: 'g3', toFloorId: 'g1', mapNo: 2, pathNo: 31 },
      { fromFloorId: 'g2', toFloorId: 'g3', mapNo: 2, pathNo: 23 },
      { fromFloorId: 'g3', toFloorId: 'g2', mapNo: 2, pathNo: 32 },
    ],
  },
]

export const DEFAULT_BUILDING_ID = SAMPLE_BUILDINGS[0].id

export function getBuilding(id: string): BuildingProfile {
  return SAMPLE_BUILDINGS.find((b) => b.id === id) ?? SAMPLE_BUILDINGS[0]
}
