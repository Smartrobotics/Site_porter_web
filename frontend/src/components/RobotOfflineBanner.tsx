import type { CSSProperties } from 'react'
import { IconAlert } from './icons'

export function RobotOfflineBanner({ style }: { style?: CSSProperties }) {
  return (
    <div
      className="card card-pad"
      role="alert"
      style={{ borderLeft: '4px solid #c62828', display: 'flex', gap: 12, ...style }}
    >
      <div style={{ color: '#c62828', flexShrink: 0 }}>
        <IconAlert />
      </div>
      <div style={{ fontWeight: 700, color: '#c62828', alignSelf: 'center' }}>ロボットと通信できません</div>
    </div>
  )
}
