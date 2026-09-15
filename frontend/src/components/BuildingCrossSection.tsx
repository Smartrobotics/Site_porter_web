import type { RobotTransportPhase } from '../domain/phase'
import { phaseIndex } from '../domain/phase'

interface Props {
  fromLabel: string
  toLabel: string
  progress: number
  phase: RobotTransportPhase
  /** 走行中の断片。無ければ progress だけで位置を決める(完了・待ちなど) */
  fragmentKind?: string
  fragmentSeq?: number
  stepTotal?: number
  robotFloor?: number
}

function levelOf(label: string): number {
  const m = label.match(/\d+/)
  return m ? parseInt(m[0], 10) : 1
}

/**
 * 建物断面の簡易イラスト。
 * 荷台ロボットが搬送元階→エレベーター→搬送先階を移動する様子を描く。
 *
 * 位置は「いまどの断片を走っているか」と「ロボットがいる階」から決める。
 * 以前は進み(%)を 30/62/100 で3区間に切っていたが、断片の長さは走行ごとに
 * 違うので、まだ廊下を走っているのにリフトの中に描かれることがあった。
 *   init / pick_up      … いる階の荷台の位置
 *   move_to_target      … 搬送元の階ならリフトへ向かう、搬送先の階ならリフトから荷台へ
 *   elv                 … リフトの中を上下
 *   put_down / return_home … 搬送先の荷台の位置
 * 断片の中の進みは、なめらかにした progress をその断片の区間に割り付けて使う。
 */
export function BuildingCrossSection({
  fromLabel,
  toLabel,
  progress,
  phase,
  fragmentKind,
  fragmentSeq,
  stepTotal,
  robotFloor,
}: Props) {
  const fromLevel = levelOf(fromLabel)
  const toLevel = levelOf(toLabel)
  const goingUp = toLevel > fromLevel

  // 上段/下段スラブ座標
  const TOP_Y = 44
  const BOT_Y = 128
  const fromY = goingUp ? BOT_Y : TOP_Y
  const toY = goingUp ? TOP_Y : BOT_Y
  const shaftX = 250
  const startX = 60

  const p = Math.max(0, Math.min(100, progress))

  // 3つの区間。t は 0〜1
  const toShaft = (t: number) => ({ cx: startX + (shaftX - startX) * t, cy: fromY })
  const inShaft = (t: number) => ({ cx: shaftX, cy: fromY + (toY - fromY) * t })
  const toTarget = (t: number) => ({ cx: shaftX - (shaftX - startX) * t, cy: toY })

  // 断片の中での進み。progress は断片単位で段になっているので、
  // この断片の区間 [(seq-1)/N, seq/N] に割り付ける
  const localT = (() => {
    if (!stepTotal || !fragmentSeq) return 0
    const size = 100 / stepTotal
    return Math.max(0, Math.min(1, (p - (fragmentSeq - 1) * size) / size))
  })()

  let pos: { cx: number; cy: number }
  const onToFloor = robotFloor !== undefined && robotFloor === toLevel && toLevel !== fromLevel
  if (fragmentKind && stepTotal) {
    switch (fragmentKind) {
      case 'init':
      case 'pick_up':
        pos = onToFloor ? toTarget(1) : toShaft(0)
        break
      case 'move_to_target':
        pos = onToFloor ? toTarget(localT) : toShaft(localT)
        break
      case 'elv':
        pos = inShaft(localT)
        break
      case 'put_down':
      case 'return_home':
        pos = toTarget(1)
        break
      default:
        pos = toShaft(localT)
    }
  } else if (p <= 30) {
    // 断片が分からない(完了・順番待ち・モックの旧データ)ときは進みだけで描く
    pos = toShaft(p / 30)
  } else if (p <= 62) {
    pos = inShaft((p - 30) / 32)
  } else {
    pos = toTarget((p - 62) / 38)
  }
  const { cx, cy } = pos

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
          {/* 本体。中心を (0,0) に置く: 軌跡の線とリフトの中央に乗るように */}
          <rect x="-10" y="-11" width="20" height="16" rx="4" fill={robotColor} />
          <circle cx="0" cy="-14" r="2" fill={robotColor} />
          <rect x="-6" y="-7" width="12" height="5" rx="2" fill="#fff" opacity="0.9" />
          <circle cx="-5" cy="7" r="2.6" fill="#33405a" />
          <circle cx="5" cy="7" r="2.6" fill="#33405a" />
          {!done && !isError && (
            <circle cx="0" cy="-3" r="16" fill="none" stroke={robotColor} strokeWidth="1.5" opacity="0.3">
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
