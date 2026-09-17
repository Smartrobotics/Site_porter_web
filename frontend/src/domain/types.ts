import type { RobotTransportPhase } from './phase'

export type Priority = 'urgent' | 'normal' | 'low'

/**
 * 荷台(Rack)・受取人(User)・エリア・番地は domain/master.ts にある。
 * どれもサーバーのマスタから来るので、ここでは持たない。
 */

export interface AppNotification {
  id: string
  taskId: number
  title: string
  body: string
  createdAt: number
  read: boolean
  /** 完了/情報などの見た目種別 */
  kind: 'completed' | 'info' | 'error'
}

/**
 * 搬送依頼の入力内容。DBの request テーブル1行に対応する。
 *
 * 場所は2段で持つ。配送員が選ぶのは**エリア**、番地を選ぶのは**サーバー**。
 *   fromAreaId    … 壁QRで読んだエリア(必須)
 *   fromAddressId … 荷台が今ある番地。荷台が搬送中なら未定
 *   toAreaId      … 人が選んだエリア(必須)
 *   toAddressId   … サーバーが決める。受付時点では未定のことがある(E7)
 */
export interface TransportRequest {
  id: number
  /** delivery = 荷物搬送 / collect = 空荷台の回収(サーバーが作る) */
  kind?: 'delivery' | 'collect'
  /** user = 配送員 / system = サーバー */
  createdBy?: 'user' | 'system'
  /** この回収を生んだ搬送(表示用。DB では持たない) */
  parentTaskId?: number
  /** 運ぶ荷台。rack.id */
  rackId: number
  /** 送り状番号(伝票QR)。二重送信の検査キーになる */
  trackingNo?: string
  /** 依頼時に読んだ/入力したマーカーID。荷台マスタは書き換えない */
  markerId?: number
  fromAreaId: number
  toAreaId: number
  fromAddressId?: number
  toAddressId?: number
  itemName: string
  recipient: string
  priority: Priority
}

/** 搬送タスク(依頼 + 進行状態) */
export interface TransportTask extends TransportRequest {
  createdAt: number
  phase: RobotTransportPhase
  /** 断片単位の進み(0-100)。断片は6つ前後なので段になる。なめらかに見せるのは useSmoothProgress */
  progress: number
  /** 走行の断片数。走行中だけ入る。進みの補間で「次の段まで」を知るために使う */
  stepTotal?: number
  /** いま走っている断片の種別(init / pick_up / move_to_target / elv / put_down / return_home) */
  fragmentKind?: string
  /** その断片の番号(1始まり) */
  fragmentSeq?: number
  /** ロボットがいる階。断面図で「どの区間にいるか」を決める */
  robotFloor?: number
  /** 断片の中でいま動いているアクションと番号(0始まり)。エレベーター断片の細かい位置に使う */
  action?: string
  actionIndex?: number
  /** そのアクションが始まった時刻(ms)。区間の中の進みはここからの経過で出す */
  actionSince?: number
  /** 走行中の一時停止の理由(エンジンの reason)。"emergency stop" = 非常停止中。通常は undefined */
  pauseReason?: string
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

/** 画面の優先度と DB の priority(1=高 2=中 3=低)の対応 */
export const PRIORITY_TO_DB: Record<Priority, number> = { urgent: 1, normal: 2, low: 3 }
export const PRIORITY_FROM_DB: Record<number, Priority> = {
  1: 'urgent',
  2: 'normal',
  3: 'low',
}
