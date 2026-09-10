/**
 * 搬送の進み方を表す語彙。画面はこの言葉でしか進行を語らない。
 *
 * サーバーが返すのは request.status とロボットの断片番号だけで、
 * ここへの読み替えは domain/mapping.ts が行う。
 * もとは robot/ に置いていたが、ロボットはサーバー側に移ったので、
 * これは「表示のための言葉」として domain に置く。
 */
export type RobotTransportPhase =
  | 'idle'
  /** 受付済みだがまだ走っていない(サーバー側の待ち) */
  | 'queued'
  | 'dispatching'
  | 'loading'
  | 'transporting'
  | 'arrived'
  | 'returning'
  | 'completed'
  | 'error'
  /** 管理者が取り消した */
  | 'cancelled'

export interface PhaseMeta {
  label: string
  badgeClass: string
  progressClass: string
}

export const PHASE_META: Record<RobotTransportPhase, PhaseMeta> = {
  idle: { label: '待機', badgeClass: 'badge-grey', progressClass: '' },
  queued: { label: '順番待ち', badgeClass: 'badge-grey', progressClass: '' },
  dispatching: { label: '配車中', badgeClass: 'badge-blue', progressClass: 'blue' },
  loading: { label: '積込中', badgeClass: 'badge-blue', progressClass: 'blue' },
  transporting: { label: '搬送中', badgeClass: 'badge-orange', progressClass: '' },
  arrived: { label: '到着', badgeClass: 'badge-green', progressClass: 'green' },
  returning: { label: '空荷台回収', badgeClass: 'badge-blue', progressClass: 'blue' },
  completed: { label: '完了', badgeClass: 'badge-green', progressClass: 'green' },
  error: { label: 'エラー', badgeClass: 'badge-red', progressClass: '' },
  cancelled: { label: '取消', badgeClass: 'badge-grey', progressClass: '' },
}

/** タイムライン用のフェーズ進行順 */
export const TIMELINE_STEPS: { phase: RobotTransportPhase; title: string }[] = [
  { phase: 'dispatching', title: '配車' },
  { phase: 'loading', title: '積込' },
  { phase: 'transporting', title: '搬送中' },
  { phase: 'arrived', title: '到着' },
  { phase: 'returning', title: '空荷台回収' },
  { phase: 'completed', title: '完了' },
]

const ORDER: RobotTransportPhase[] = [
  'idle',
  'queued',
  'dispatching',
  'loading',
  'transporting',
  'arrived',
  'returning',
  'completed',
]

export function phaseIndex(phase: RobotTransportPhase): number {
  const i = ORDER.indexOf(phase)
  return i < 0 ? 0 : i
}

export function isActivePhase(phase: RobotTransportPhase): boolean {
  return (
    phase !== 'completed' &&
    phase !== 'error' &&
    phase !== 'idle' &&
    phase !== 'queued' &&
    phase !== 'cancelled'
  )
}

/** 受付済みでまだ走っていない(順番待ち) */
export function isQueuedPhase(phase: RobotTransportPhase): boolean {
  return phase === 'queued'
}
