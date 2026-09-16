import { useEffect, useRef, useState } from 'react'
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
  /** 断片の中でいま動いているアクションと番号(0始まり)。elv 断片の細かい位置に使う */
  action?: string
  actionIndex?: number
}

function levelOf(label: string): number {
  const m = label.match(/\d+/)
  return m ? parseInt(m[0], 10) : 1
}

/**
 * エレベーター断片(backend/app/scenario/fragments/elv.json)の中の位置。
 * 番号はその JSON の steps の並び。名前だけでは足りない:
 * set_goal_elv / start_elv_goal_controller / elv_get_on_off_flag は乗るときと降りるときの2回出る。
 *
 *   点1 = elv_wait(呼び出し待ち)   点2 = 扉の前   点3 = リフトの中(出発階)
 *   点4 = リフトの中(到着階)        点5 = 扉の前(到着階)   点6 = elv_wait(到着階、通らない)
 *
 * ロボットが実際に動くアクションのときだけ動かす。設定や確認のアクションでは止まっている:
 *   0 elv_call_floor              点1 で待つ
 *   1 set_route_no                点1
 *   2 start_navigation            点1 → 点2
 *   3 set_goal_elv                点2
 *   4 start_elv_goal_controller   点2 → 点3
 *   5 elv_boarding_check_enter    点3
 *   6 elv_get_on_off_flag         点3 → 点4(リフトが動く。時間で進める)
 *   7 set_goal_elv                点4
 *   8 start_elv_goal_controller   点4 → 点5
 *   9 elv_boarding_check_exit     点5
 *   10 elv_get_on_off_flag / 11 set_map / 12 set_robot_position   点5
 *
 * 動く区間の中の進みはサーバーからは来ない(アクションが変わった時だけ分かる)ので、
 * アクションが変わってからの経過時間を目安の所要時間で割って進める。
 * 次のアクションが来る前に着いてしまわないよう 92% で止める。
 */
type WP = 1 | 2 | 3 | 4 | 5
interface Leg {
  from: WP
  to: WP
  /** 目安の所要時間(秒)。0 なら止まっている(from の位置) */
  seconds: number
}

const ELV_LEG_BY_INDEX: Leg[] = [
  { from: 1, to: 1, seconds: 0 }, // 0 elv_call_floor
  { from: 1, to: 1, seconds: 0 }, // 1 set_route_no
  { from: 1, to: 2, seconds: 15 }, // 2 start_navigation
  { from: 2, to: 2, seconds: 0 }, // 3 set_goal_elv
  { from: 2, to: 3, seconds: 20 }, // 4 start_elv_goal_controller
  { from: 3, to: 3, seconds: 0 }, // 5 elv_boarding_check_enter
  { from: 3, to: 4, seconds: 40 }, // 6 elv_get_on_off_flag(乗っている)
  { from: 4, to: 4, seconds: 0 }, // 7 set_goal_elv
  { from: 4, to: 5, seconds: 20 }, // 8 start_elv_goal_controller
  { from: 5, to: 5, seconds: 0 }, // 9 elv_boarding_check_exit
  { from: 5, to: 5, seconds: 0 }, // 10 elv_get_on_off_flag
  { from: 5, to: 5, seconds: 0 }, // 11 set_map
  { from: 5, to: 5, seconds: 0 }, // 12 set_robot_position
]

/** 廊下の走行(move_to_target の start_navigation)の目安の所要時間(秒) */
const CORRIDOR_SECONDS = 30

const LEG_CEILING = 0.92

function elvLeg(action: string | undefined, actionIndex: number | undefined): Leg {
  if (actionIndex !== undefined && actionIndex >= 0 && actionIndex < ELV_LEG_BY_INDEX.length) {
    return ELV_LEG_BY_INDEX[actionIndex]
  }
  // 番号が無い(古いデータ)ときは名前で最善を尽くす。2回出るものは前半扱い
  switch (action) {
    case 'start_navigation':
      return ELV_LEG_BY_INDEX[2]
    case 'set_goal_elv':
      return ELV_LEG_BY_INDEX[3]
    case 'start_elv_goal_controller':
      return ELV_LEG_BY_INDEX[4]
    case 'elv_boarding_check_enter':
      return ELV_LEG_BY_INDEX[5]
    case 'elv_get_on_off_flag':
      return ELV_LEG_BY_INDEX[6]
    case 'elv_boarding_check_exit':
    case 'set_map':
    case 'set_robot_position':
      return ELV_LEG_BY_INDEX[9]
    default:
      return ELV_LEG_BY_INDEX[0]
  }
}

/**
 * アクションが変わってからの経過で 0〜LEG_CEILING を返す。
 * 区間が変わったら 0 からやり直す。
 */
function useLegClock(key: string, seconds: number): number {
  const startRef = useRef<{ key: string; at: number }>({ key, at: performance.now() })
  const [t, setT] = useState(0)
  useEffect(() => {
    if (startRef.current.key !== key) {
      startRef.current = { key, at: performance.now() }
      setT(0)
    }
    if (seconds <= 0) return
    const id = window.setInterval(() => {
      const elapsed = (performance.now() - startRef.current.at) / 1000
      setT(Math.min(LEG_CEILING, elapsed / seconds))
    }, 100)
    return () => window.clearInterval(id)
  }, [key, seconds])
  return seconds <= 0 ? 0 : t
}

/**
 * 建物断面の簡易イラスト。
 * 荷台ロボットが搬送元階→エレベーター→搬送先階を移動する様子を描く。
 *
 * 位置は「いまどの断片を走っているか」と「ロボットがいる階」から決める。
 *   init / pick_up      … いる階の荷台の位置
 *   move_to_target      … 搬送元の階なら荷台から点1(elv_wait)へ、搬送先の階なら点5から荷台へ
 *   elv                 … 上の6点をアクションに従って進む
 *   put_down / return_home … 搬送先の荷台の位置
 * 動くのはロボットが実際に走るアクションの間だけ(start_navigation /
 * start_elv_goal_controller / リフトの中)。その間の進みはアクションが変わってからの
 * 経過時間で出す。設定・確認のアクションでは止まって見える。
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
  action,
  actionIndex,
}: Props) {
  const fromLevel = levelOf(fromLabel)
  const toLevel = levelOf(toLabel)
  const goingUp = toLevel > fromLevel

  // 上段/下段スラブ座標
  const TOP_Y = 44
  const BOT_Y = 128
  const fromY = goingUp ? BOT_Y : TOP_Y
  const toY = goingUp ? TOP_Y : BOT_Y
  const shaftX = 251 // リフトの中央(シャフトは x=236〜266)
  const startX = 60 // 荷台の位置
  const WAIT_X = 190 // 点1 / 点6: elv_wait
  const DOOR_X = 222 // 点2 / 点5: 扉の前

  const p = Math.max(0, Math.min(100, progress))

  const isElv = fragmentKind === 'elv'
  const isCorridor = fragmentKind === 'move_to_target'
  const leg: Leg = isElv
    ? elvLeg(action, actionIndex)
    : // 廊下: start_navigation のときだけ動く。set_route_no は出発点で止まっている
      { from: 1, to: 1, seconds: isCorridor && action === 'start_navigation' ? CORRIDOR_SECONDS : 0 }
  // 区間の鍵: 断片番号 + アクション番号。どちらかが変われば計り直す
  const legKey = `${fragmentKind ?? ''}:${fragmentSeq ?? 0}:${actionIndex ?? action ?? ''}`
  const legT = useLegClock(legKey, leg.seconds)

  // 直線区間。t は 0〜1
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t
  const onFromFloor = (x: number) => ({ cx: x, cy: fromY })
  const onToFloor = (x: number) => ({ cx: x, cy: toY })

  // 6点の座標(点6 は描くだけで通らない)
  const wp = (n: WP) => {
    switch (n) {
      case 1:
        return onFromFloor(WAIT_X)
      case 2:
        return onFromFloor(DOOR_X)
      case 3:
        return onFromFloor(shaftX)
      case 4:
        return onToFloor(shaftX)
      default:
        return onToFloor(DOOR_X)
    }
  }
  const between = (a: { cx: number; cy: number }, b: { cx: number; cy: number }, t: number) => ({
    cx: lerp(a.cx, b.cx, t),
    cy: lerp(a.cy, b.cy, t),
  })

  let pos: { cx: number; cy: number }
  const robotOnToFloor = robotFloor !== undefined && robotFloor === toLevel && toLevel !== fromLevel
  if (fragmentKind && stepTotal) {
    switch (fragmentKind) {
      case 'init':
      case 'pick_up':
        pos = robotOnToFloor ? onToFloor(startX) : onFromFloor(startX)
        break
      case 'move_to_target':
        // 廊下。start_navigation の間だけ動き、それ以外は出発点に止まっている
        pos = robotOnToFloor
          ? onToFloor(lerp(DOOR_X, startX, legT)) // 点5 → 荷台
          : onFromFloor(lerp(startX, WAIT_X, legT)) // 荷台 → 点1
        break
      case 'elv':
        pos = leg.seconds > 0 ? between(wp(leg.from), wp(leg.to), legT) : wp(leg.from)
        break
      case 'put_down':
      case 'return_home':
        pos = onToFloor(startX)
        break
      default:
        pos = onFromFloor(startX)
    }
  } else if (p <= 30) {
    // 断片が分からない(完了・順番待ち・モックの旧データ)ときは進みだけで描く
    pos = onFromFloor(lerp(startX, shaftX, p / 30))
  } else if (p <= 62) {
    pos = { cx: shaftX, cy: lerp(fromY, toY, (p - 30) / 32) }
  } else {
    pos = onToFloor(lerp(shaftX, startX, (p - 62) / 38))
  }
  const { cx, cy } = pos

  const done = phase === 'completed'
  const isError = phase === 'error'
  const robotColor = isError ? '#c62828' : done ? '#00A051' : '#F39800'

  const floorTop = { y: TOP_Y, label: goingUp ? toLabel : fromLabel }
  const floorBot = { y: BOT_Y, label: goingUp ? fromLabel : toLabel }

  // 6点。名前は付けない
  const waypoints = [
    { x: WAIT_X, y: fromY },
    { x: DOOR_X, y: fromY },
    { x: shaftX, y: fromY },
    { x: shaftX, y: toY },
    { x: DOOR_X, y: toY },
    { x: WAIT_X, y: toY },
  ]

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

        {/* エレベーター前後の通過点 */}
        {waypoints.map((w, i) => (
          <circle key={i} cx={w.x} cy={w.y} r="4" fill="#ffffff" stroke="#1B2D4F" strokeWidth="1.6" />
        ))}

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
