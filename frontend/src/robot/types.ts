import type { TransportRequest } from '../domain/types'
import type { RouteMapping } from '../building/types'

/** ロボット搬送フェーズ(UI共通の抽象フェーズ) */
export type RobotTransportPhase =
  | 'idle'
  /** 受付済みだがまだ走っていない(サーバー側の待ち。ロボットは返さない) */
  | 'queued'
  | 'dispatching'
  | 'loading'
  | 'transporting'
  | 'arrived'
  | 'returning'
  | 'completed'
  | 'error'
  /** 管理者が取り消した(サーバー側の状態。ロボットは返さない) */
  | 'cancelled'

export interface RobotStatusUpdate {
  phase: RobotTransportPhase
  /** 0-100 の進捗率 */
  progress: number
  /** ロボット固有の生ステータス値(@mobiの state 値など) */
  rawState?: number
  message: string
}

/**
 * ロボット連携アダプタIF。
 * 実機(@mobi)・モックなど、下位のロボットを差し替え可能にする。
 */
export interface RobotAdapter {
  readonly name: string
  /** 搬送を開始し、ロボット側タスクIDを返す */
  startTransport(req: TransportRequest, route: RouteMapping): Promise<string>
  /** タスクの状態更新を購読する。戻り値で購読解除 */
  subscribe(taskId: string, cb: (u: RobotStatusUpdate) => void): () => void
  /** タスクをキャンセルする */
  cancel(taskId: string): Promise<void>
  /** 接続確認 */
  checkConnection(): Promise<{ ok: boolean; detail: string }>
}
