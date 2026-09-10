import type { RobotTransportPhase } from '../robot/types'

export type Priority = 'urgent' | 'normal' | 'low'

/** 荷台 — マーカーIDはユーザーが自由に割当・変更できる(汎用マーカー要件) */
export interface Cart {
  id: string
  label: string
  markerId: string
  /** いまどの場所に置かれているか。未設置なら undefined(DB の rack.street_address_id) */
  spotId?: string
}

/** 受取人(サンプル人員リストから選択) */
export interface Person {
  id: string
  name: string
  role: string
}

export interface AppNotification {
  id: string
  taskId: string
  title: string
  body: string
  createdAt: number
  read: boolean
  /** 完了/情報などの見た目種別 */
  kind: 'completed' | 'info' | 'error'
}

/** 搬送依頼の入力内容 */
export interface TransportRequest {
  id: string
  /** delivery = 荷物搬送 / collect = 空荷台の回収(サーバーが作る) */
  kind?: 'delivery' | 'collect'
  /** user = 配送員 / system = サーバー */
  createdBy?: 'user' | 'system'
  /** この回収を生んだ搬送(表示用。DB では持たない) */
  parentTaskId?: string
  cartId: string
  /** 送り状番号(伝票QR)。二重送信の検査キーになる */
  trackingNo?: string
  /** 荷台のマーカーID。依頼ごとの値で、荷台マスタは書き換えない */
  markerId?: string
  fromFloorId: string
  toFloorId: string
  fromSpotId?: string
  toSpotId?: string
  itemName: string
  recipient: string
  priority: Priority
}

/** 搬送タスク(依頼 + 進行状態) */
export interface TransportTask extends TransportRequest {
  buildingId: string
  createdAt: number
  phase: RobotTransportPhase
  progress: number
  rawState?: number
  statusMessage: string
  robotTaskId?: string
  robotAdapterName: string
  completedAt?: number
  /** 受取人が「確認」を押した時刻。未確認なら undefined */
  confirmedAt?: number
  /** 管理者が完全に削除した。画面からは消えるが記録は残す(DB の is_deleted) */
  isDeleted?: boolean
}

export const PRIORITY_LABEL: Record<Priority, string> = {
  urgent: '高',
  normal: '中',
  low: '低',
}
