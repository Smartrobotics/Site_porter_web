import type { CSSProperties } from 'react'
import { IconAlert } from './icons'

/**
 * サーバーがロボット(ブリッジ)と話せていない。走行中の依頼は running のまま残り、
 * ロボットはいまの断片を走り終えて次を待つ。復旧すればサーバーが自動で続ける。
 * 人の手が要る状態(stuck_reason)とは別で、こちらは待てばよい。
 */
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
