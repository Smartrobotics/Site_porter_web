import type { CSSProperties } from 'react'
import { IconAlert } from './icons'

const EMERGENCY_STOP = 'emergency stop'

export function PauseBanner({ reason, style }: { reason?: string | null; style?: CSSProperties }) {
  if (!reason) return null
  const emergency = reason.startsWith(EMERGENCY_STOP)
  return (
    <div
      className="card card-pad"
      role="alert"
      style={{ borderLeft: '4px solid #e65100', display: 'flex', gap: 12, ...style }}
    >
      <div style={{ color: '#e65100', flexShrink: 0 }}>
        <IconAlert />
      </div>
      <div>
        <div style={{ fontWeight: 700, color: '#e65100' }}>{emergency ? '非常停止中' : '一時停止中'}</div>
        <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
          {emergency
            ? 'バンパーか非常停止ボタンでロボットが止まっています。安全を確かめて解除すると走行を再開します。長く続くと搬送は失敗になります。'
            : reason}
        </div>
      </div>
    </div>
  )
}
