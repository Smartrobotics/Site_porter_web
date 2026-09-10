import type { RobotTransportPhase } from '../domain/phase'
import { PHASE_META, isActivePhase } from '../domain/phase'
import type { Priority } from '../domain/types'
import { PRIORITY_LABEL } from '../domain/types'

export function PhaseBadge({ phase }: { phase: RobotTransportPhase }) {
  const meta = PHASE_META[phase]
  return (
    <span className={`badge-pill ${meta.badgeClass}`}>
      <span className={`dot${isActivePhase(phase) ? ' dot-pulse' : ''}`} />
      {meta.label}
    </span>
  )
}

export function ProgressBar({ value, phase }: { value: number; phase: RobotTransportPhase }) {
  const meta = PHASE_META[phase]
  const clamped = Math.max(0, Math.min(100, value))
  return (
    <div className={`progress ${meta.progressClass}`}>
      <span style={{ width: `${clamped}%` }} />
    </div>
  )
}

const PRIORITY_BADGE: Record<Priority, string> = {
  urgent: 'badge-orange',
  normal: 'badge-blue',
  low: 'badge-grey',
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  return (
    <span className={`badge-pill ${PRIORITY_BADGE[priority]}`}>{PRIORITY_LABEL[priority]}</span>
  )
}
