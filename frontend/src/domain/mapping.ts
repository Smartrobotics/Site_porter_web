/**
 * サーバーの request 1行を画面の TransportTask に直す。
 *
 * サーバーが持つのは「依頼がどこまで進んだか」(request.status)と
 * 「ロボットがいまどの断片にいるか」(robot.phase / step_index)だけ。
 * 画面の細かいフェーズはそこから組み立てる。
 * 実機に差し替わっても、サーバーが同じ形で返す限りここは変わらない。
 */

import type { TransportTask } from './types'
import { PRIORITY_FROM_DB } from './types'
import type { RobotTransportPhase } from './phase'

/** GET /api/request が返す1行 */
export interface RequestRaw {
  id: number
  kind: 'delivery' | 'collect'
  created_by: 'user' | 'system'
  tracking_no: string | null
  item: string | null
  receiver_name: string | null
  priority: number
  status: string
  created_at: string
  from_area: string
  to_area: string
  rack_marker_id: number
  rack_id: number
  from_area_id: number
  to_area_id: number
  from_address_id: number | null
  to_address_id: number | null
  started_at: string | null
  delivered_at: string | null
  confirmed_at: string | null
  robot_phase: string | null
  robot_scenario: string | null
  /** ロボットがいる階(エレベーター断片の完了で更新)。走行中の依頼だけ */
  robot_floor: number | null
  /** 断片の中でいま動いているアクションとその番号(0始まり)。断面図用 */
  robot_action: string | null
  robot_action_index: number | null
  /** そのアクションの開始時刻(ISO8601、+09:00 付き) */
  robot_action_since: string | null
  /** 走行中の一時停止の理由。"emergency stop" = 非常停止中。通常は null */
  robot_pause_reason: string | null
  step_index: number | null
  step_total: number | null
}

/** "2026-09-10 03:35:02"(UTC)→ ミリ秒。DBは datetime('now') = UTC で入れている */
function toMs(s: string | null): number | undefined {
  if (!s) return undefined
  const ms = Date.parse(`${s.replace(' ', 'T')}Z`)
  return Number.isNaN(ms) ? undefined : ms
}

/**
 * 断片の種別 → 画面のフェーズ。
 *
 * 番号では決められない。走行の断片数は依頼ごとに変わり、move_to_target は
 * エレベーターの前後で2回出る。種別で見れば計画が変わっても壊れない。
 * 種別は断片名の末尾にある: run_<id>_<NN>_<kind>
 */
const KIND_PHASE: Record<string, RobotTransportPhase> = {
  init: 'dispatching',
  pick_up: 'loading',
  move_to_target: 'transporting',
  elv: 'transporting',
  put_down: 'arrived',
  return_home: 'returning',
}

/** run_11_05_move_to_target → move_to_target */
function fragmentKind(name: string | null): string {
  if (!name) return ''
  const m = /^run_\d+_\d+_(.+)$/.exec(name)
  return m ? m[1] : ''
}

const PHASE_MESSAGE: Record<RobotTransportPhase, string> = {
  idle: '待機中',
  queued: '順番待ち',
  dispatching: '配車手配中…',
  loading: '積込準備中…',
  transporting: '搬送中…',
  arrived: '受渡場所に到着',
  returning: '空荷台を回収中…',
  completed: '搬送完了',
  error: 'エラーが発生しました',
  cancelled: '取り消しました',
}

function phaseOf(r: RequestRaw): RobotTransportPhase {
  switch (r.status) {
    case 'queued':
      return 'queued'
    case 'running':
      // 回収はひとまとめに「空荷台回収中」。段階を分けても人には意味がない
      if (r.kind === 'collect') return 'returning'
      return KIND_PHASE[fragmentKind(r.robot_scenario)] ?? 'transporting'
    case 'delivered':
    case 'confirmed':
    case 'done':
      return 'completed'
    case 'failed':
      return 'error'
    case 'cancelled':
      return 'cancelled'
    default:
      return 'idle'
  }
}

function progressOf(r: RequestRaw, phase: RobotTransportPhase): number {
  if (phase === 'completed') return 100
  if (r.status !== 'running' || !r.step_total) return 0
  // step_index は「いま走っている断片の番号」(1始まり)。終わった断片は
  // その1つ手前まで。最後の断片を走行中に 100% と出さないため
  const done = Math.max(0, (r.step_index ?? 0) - 1)
  return Math.round((done / r.step_total) * 100)
}

/**
 * @param noSpace 搬送先に空き番地がない(E7)。マスタから判断してストアが渡す。
 *                サーバーは「まだ番地を決めていない」しか返さないため、
 *                順番待ちの理由はこちらで見分ける
 */
export function toTask(r: RequestRaw, noSpace = false): TransportTask {
  const phase = phaseOf(r)
  const message =
    phase === 'queued' && noSpace
      ? '搬送先に空き場所がないため、空くまでお待ちください'
      : phase === 'queued'
        ? '順番待ち — ロボットが別の搬送を実行中です'
        : PHASE_MESSAGE[phase]

  return {
    id: r.id,
    kind: r.kind,
    createdBy: r.created_by,
    rackId: r.rack_id,
    trackingNo: r.tracking_no ?? undefined,
    markerId: r.rack_marker_id,
    fromAreaId: r.from_area_id,
    toAreaId: r.to_area_id,
    fromAddressId: r.from_address_id ?? undefined,
    toAddressId: r.to_address_id ?? undefined,
    itemName: r.item ?? '',
    recipient: r.receiver_name ?? '',
    priority: PRIORITY_FROM_DB[r.priority] ?? 'normal',
    createdAt: toMs(r.created_at) ?? Date.now(),
    phase,
    progress: progressOf(r, phase),
    stepTotal: r.status === 'running' && r.step_total ? r.step_total : undefined,
    fragmentKind: r.status === 'running' ? fragmentKind(r.robot_scenario) || undefined : undefined,
    fragmentSeq: r.status === 'running' ? (r.step_index ?? undefined) : undefined,
    robotFloor: r.status === 'running' ? (r.robot_floor ?? undefined) : undefined,
    action: r.status === 'running' ? (r.robot_action ?? undefined) : undefined,
    actionIndex: r.status === 'running' ? (r.robot_action_index ?? undefined) : undefined,
    actionSince:
      r.status === 'running' && r.robot_action_since
        ? (() => {
            const ms = Date.parse(r.robot_action_since)
            return Number.isNaN(ms) ? undefined : ms
          })()
        : undefined,
    pauseReason: r.status === 'running' ? (r.robot_pause_reason ?? undefined) : undefined,
    // robot.phase = 'error' はブリッジ/ROS との通信断。人の手待ち(stuck)は別途 failed になる
    robotOffline: r.status === 'running' && r.robot_phase === 'error',
    statusMessage: message,
    robotAdapterName: 'サーバー',
    completedAt: toMs(r.delivered_at),
    confirmedAt: toMs(r.confirmed_at),
  }
}
