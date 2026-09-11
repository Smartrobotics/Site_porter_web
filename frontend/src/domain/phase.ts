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

export interface TimelineStep {
  phase: RobotTransportPhase
  title: string
}

/**
 * タイムラインの段階。依頼の種別で変わる。
 *
 * 搬送(delivery)は荷降ろしで終わる。空荷台の回収は搬送の続きではなく、
 * 荷降ろしを終えた時点でサーバーがその階の空荷台を見て別に作る依頼
 * (kind = collect, created_by = system)。だから搬送のタイムラインには出さない。
 */
const DELIVERY_STEPS: TimelineStep[] = [
  { phase: 'dispatching', title: '配車' },
  { phase: 'loading', title: '積込' },
  { phase: 'transporting', title: '搬送中' },
  { phase: 'arrived', title: '到着' },
  { phase: 'completed', title: '完了' },
]

/** 回収は走行中ずっと「空荷台回収」のひとまとめ(mapping.ts の phaseOf を参照) */
const COLLECT_STEPS: TimelineStep[] = [
  { phase: 'returning', title: '空荷台回収' },
  { phase: 'completed', title: '完了' },
]

export function timelineSteps(kind: 'delivery' | 'collect' | undefined): TimelineStep[] {
  return kind === 'collect' ? COLLECT_STEPS : DELIVERY_STEPS
}

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
