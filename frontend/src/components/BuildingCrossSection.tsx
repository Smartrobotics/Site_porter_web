import type { RobotTransportPhase } from '../domain/phase'
import { phaseIndex } from '../domain/phase'

interface Props {
  fromLabel: string
  toLabel: string
  progress: number
  phase: RobotTransportPhase
}

function levelOf(label: string): number {
  const m = label.match(/\d+/)
  return m ? parseInt(m[0], 10) : 1
}

/**
 * 建物断面の簡易イラスト。
 * 荷台ロボットが搬送元階→エレベーター→搬送先階を移動する様子を progress に応じて描画。
 */
export function BuildingCrossSection({ fromLabel, toLabel, progress, phase }: Props) {
  const goingUp = levelOf(toLabel) > levelOf(fromLabel)

  // 上段/下段スラブ座標
  const TOP_Y = 44
  const BOT_Y = 128
  const fromY = goingUp ? BOT_Y : TOP_Y
  const toY = goingUp ? TOP_Y : BOT_Y
  const shaftX = 250
  const startX = 60

  // ロボット位置(progress を3区間に分割)
  let cx: number
  let cy: number
  const p = Math.max(0, Math.min(100, progress))
  if (p <= 30) {
    const t = p / 30
    cx = startX + (shaftX - startX) * t
    cy = fromY
  } else if (p <= 62) {
    const t = (p - 30) / 32
    cx = shaftX
    cy = fromY + (toY - fromY) * t
  } else {
    const t = (p - 62) / 38
    cx = shaftX - (shaftX - startX) * t
    cy = toY
  }

  const done = phase === 'completed'
  const isError = phase === 'error'
  const robotColor = isError ? '#c62828' : done ? '#00A051' : '#F39800'

  const floorTop = { y: TOP_Y, label: goingUp ? toLabel : fromLabel }
  const floorBot = { y: BOT_Y, label: goingUp ? fromLabel : toLabel }

  return (
    <div className="cross-section">
      <svg viewBox="0 0 320 190" width="100%" role="img" aria-label="搬送経路の断面図">
        {/* 背景の階スラブ */}
        {[floorTop, floorBot].map((f) => (
          <g key={f.label}>
            <rect x="24" y={f.y} width="272" height="46" rx="6" fill="#ffffff" stroke="#dbe3ee" />
            <rect x="24" y={f.y} width="272" height="46" rx="6" fill="url(#floorGrad)" opacity="0.5" />
            <text x="36" y={f.y + 28} fontSize="15" fontWeight="800" fill="#1B2D4F">
              {f.label}
            </text>
          </g>
        ))}

        <defs>
          <linearGradient id="floorGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#f7fafe" />
            <stop offset="1" stopColor="#eaf1f8" />
          </linearGradient>
        </defs>

        {/* エレベーター/リフトシャフト */}
        <rect x="236" y={TOP_Y - 6} width="30" height={BOT_Y - TOP_Y + 58} rx="5" fill="#eef3f9" stroke="#d3ddea" strokeDasharray="4 3" />
        <text x="251" y={TOP_Y - 12} fontSize="8.5" fontWeight="700" fill="#6b7896" textAnchor="middle">
          LIFT
        </text>

        {/* 集積/受渡ポイント */}
        <circle cx={startX} cy={fromY + 30} r="4" fill="#0068B7" />
        <circle cx={startX} cy={toY + 30} r="4" fill="#00A051" />

        {/* 走行軌跡 */}
        <path
          d={`M ${startX} ${fromY} H ${shaftX} V ${toY} H ${startX}`}
          fill="none"
          stroke="#d7e0ec"
          strokeWidth="2.5"
          strokeLinecap="round"
        />

        {/* ロボット(荷台は描かない) */}
        {/* progress は useSmoothProgress が毎フレーム更新するので CSS トランジションは付けない */}
        <g transform={`translate(${cx.toFixed(2)}, ${cy.toFixed(2)})`}>
          {/* 本体 */}
          <rect x="-4" y="-11" width="20" height="16" rx="4" fill={robotColor} />
          <circle cx="6" cy="-14" r="2" fill={robotColor} />
          <rect x="0" y="-7" width="12" height="5" rx="2" fill="#fff" opacity="0.9" />
          <circle cx="1" cy="7" r="2.6" fill="#33405a" />
          <circle cx="11" cy="7" r="2.6" fill="#33405a" />
          {!done && !isError && (
            <circle cx="6" cy="-3" r="16" fill="none" stroke={robotColor} strokeWidth="1.5" opacity="0.3">
              <animate attributeName="r" values="12;20;12" dur="1.8s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.4;0;0.4" dur="1.8s" repeatCount="indefinite" />
            </circle>
          )}
        </g>
      </svg>
      <div
        style={{
          textAlign: 'center',
          fontSize: 11.5,
          fontWeight: 700,
          color: 'var(--navy-faint)',
          padding: '2px 0 10px',
        }}
      >
        {phaseIndex(phase) >= phaseIndex('arrived') && phase !== 'error'
          ? `${toLabel} 到達`
          : `${fromLabel} → ${toLabel} 搬送中`}
      </div>
    </div>
  )
}
