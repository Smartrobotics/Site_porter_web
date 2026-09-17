import type { CSSProperties } from 'react'
import { IconAlert } from './icons'

/** エンジンが RUNNING の reason に載せる文字列(scenario_control の EmgStopWatch) */
const EMERGENCY_STOP = 'emergency stop'

/**
 * 走行中の一時停止。ロボットは止まっているが依頼は running のまま。
 * 非常停止(バンパー・非常停止ボタン)は解除すると Atmobi が自分で走り出すので、
 * ここには「解除してください」だけ書き、ボタンは置かない。
 */
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
