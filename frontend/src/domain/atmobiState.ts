/**
 * @mobi が返す生のステータス値と、その日本語表記。
 * scenario_bridge.py が state を返し始めたら 搬送状況画面 の rawState 行に出る。
 */
/**
 * @mobi (atmobi) API の状態値定義。
 * enum は tsconfig の erasableSyntaxOnly と相性が悪いため、
 * const オブジェクト + ラベルマップで表現する(値の意味は同一)。
 */

/** GET /state の state 値 (0〜23) */
export const AtmobiState = {
  IDLE: 0,
  INITIALIZING: 1,
  STANDBY: 2,
  LOCALIZING: 3,
  MAP_LOADING: 4,
  WAYPOINT_SETTING: 5,
  READY: 6,
  START_PENDING: 7,
  MOVING: 8,
  PAUSED: 9,
  OBSTACLE_DETECTED: 10,
  ARRIVED: 11,
  DOCKING: 12,
  UNDOCKING: 13,
  CHARGING: 14,
  ROTATING: 15,
  DECELERATING: 16,
  EMERGENCY_STOP: 17,
  MANUAL: 18,
  RECOVERING: 19,
  LOW_BATTERY: 20,
  COMM_ERROR: 21,
  MAINTENANCE: 22,
  SHUTDOWN: 23,
} as const

export type AtmobiStateValue = (typeof AtmobiState)[keyof typeof AtmobiState]

export const ATMOBI_STATE_LABEL: Record<number, string> = {
  0: '待機(アイドル)',
  1: '初期化中',
  2: 'スタンバイ',
  3: '自己位置推定中',
  4: '地図読込中',
  5: '経由地点設定中',
  6: '準備完了',
  7: '発進待機',
  8: '移動中',
  9: '一時停止',
  10: '障害物検知',
  11: '到着',
  12: 'ドッキング中',
  13: 'ドッキング解除中',
  14: '充電中',
  15: '旋回中',
  16: '減速中',
  17: '非常停止',
  18: '手動操作',
  19: '復帰処理中',
  20: 'バッテリー低下',
  21: '通信エラー',
  22: 'メンテナンス',
  23: 'シャットダウン',
}

/** GET /navi/status の navi_status 値 (0〜11) */
export const NaviStatus = {
  UNKNOWN: 0,
  ACTIVE: 1,
  PENDING: 2,
  SUCCEEDED: 3,
  ABORTED: 4,
  REJECTED: 5,
  PREEMPTING: 6,
  RECALLING: 7,
  RECALLED: 8,
  LOST: 9,
  PAUSED: 10,
  CANCELLED: 11,
} as const

export type NaviStatusValue = (typeof NaviStatus)[keyof typeof NaviStatus]

export const NAVI_STATUS_LABEL: Record<number, string> = {
  0: '不明',
  1: '走行中 (ACTIVE)',
  2: '受付済 (PENDING)',
  3: '成功 (SUCCEEDED)',
  4: '中断 (ABORTED)',
  5: '拒否 (REJECTED)',
  6: '横取り中 (PREEMPTING)',
  7: '取消処理中 (RECALLING)',
  8: '取消済 (RECALLED)',
  9: '経路喪失 (LOST)',
  10: '一時停止 (PAUSED)',
  11: 'キャンセル済 (CANCELLED)',
}

export function stateLabel(v: number | undefined): string {
  if (v === undefined) return '—'
  return ATMOBI_STATE_LABEL[v] ?? `不明(${v})`
}

export function naviStatusLabel(v: number | undefined): string {
  if (v === undefined) return '—'
  return NAVI_STATUS_LABEL[v] ?? `不明(${v})`
}
