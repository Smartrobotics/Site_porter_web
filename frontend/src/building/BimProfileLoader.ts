import type { BuildingProfile } from './types'

/**
 * BIMデータから建物プロファイルを生成するローダー(将来対応)。
 * 現時点ではIFのみ定義し、呼び出すと例外を投げる。
 */
export interface BimProfileLoader {
  loadFromBim(file: File): Promise<BuildingProfile>
}

export const bimProfileLoader: BimProfileLoader = {
  async loadFromBim(_file: File): Promise<BuildingProfile> {
    throw new Error('BIM読込は将来対応予定')
  },
}
