import { useEffect, useRef, useState } from 'react'
import type { RobotTransportPhase } from '../domain/phase'
import { phaseIndex } from '../domain/phase'

interface Props {
  /** 依頼の id。変わったら「戻らない」ための記憶を捨てる */
  taskId: number | string
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
/** 荷台の下から出る/入る move_forward_time。0.02 m/s で 41.65 s(move_forward_time.py) */
const MOVE_FORWARD_SECONDS = 42
/** そのときの見た目のずれ(px)。荷台の位置から廊下側へ少し出る */
const MOVE_FORWARD_SHIFT = 14

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
 * 位置は「経路上の距離 s」ひとつで持つ。経路は
 *   荷台(出発階) → 点1 → 点2 → 点3 → 点4 → 点5 → 荷台(到着階)
 * の折れ線で、s はその上の px。断片とアクションから s を決め、
 * 同じ依頼の中では s を決して戻さない(前回より小さくなったら前回の値を使う)。
 * 区間の終わりまで来てからアクションがまだ続いていても、
 * 次のアクションで「区間の始点」に飛び戻ることが無いようにするため。
 *
 *   init / pick_up      … 出発階の荷台。move_forward_time で荷台から少し出る
 *   move_to_target      … start_navigation の間に荷台→点1、到着階なら点5→荷台の手前
 *   elv                 … 6点をアクションに従って進む(動くアクションの間だけ)
 *   put_down            … move_forward_time で荷台の手前→荷台
 *   return_home         … 到着階の荷台
 * 動いている区間の中の進みはアクションが変わってからの経過時間で出す。
 */
export function BuildingCrossSection({
  taskId,
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

  // 経路の折れ線と、その上の目印の距離
  const route = [
    { x: startX, y: fromY }, // 荷台(出発階)
    { x: WAIT_X, y: fromY }, // 点1
    { x: DOOR_X, y: fromY }, // 点2
    { x: shaftX, y: fromY }, // 点3
    { x: shaftX, y: toY }, // 点4
    { x: DOOR_X, y: toY }, // 点5
    { x: startX, y: toY }, // 荷台(到着階)
  ]
  const cum: number[] = [0]
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1]
    const b = route[i]
    cum.push(cum[i - 1] + Math.hypot(b.x - a.x, b.y - a.y))
  }
  const TOTAL = cum[cum.length - 1]
  // 目印: 点n の s は cum[n]。荷台のすぐ外(OUT)と到着階の荷台の手前(IN)
  const S_RACK_FROM = 0
  const S_OUT = MOVE_FORWARD_SHIFT
  const S_WP = (n: WP) => cum[n]
  const S_IN = TOTAL - MOVE_FORWARD_SHIFT
  const S_RACK_TO = TOTAL

  const posAt = (s: number) => {
    const v = Math.max(0, Math.min(TOTAL, s))
    for (let i = 1; i < route.length; i++) {
      if (v <= cum[i]) {
        const t = cum[i] === cum[i - 1] ? 1 : (v - cum[i - 1]) / (cum[i] - cum[i - 1])
        const a = route[i - 1]
        const b = route[i]
        return { cx: a.x + (b.x - a.x) * t, cy: a.y + (b.y - a.y) * t }
      }
    }
    const last = route[route.length - 1]
    return { cx: last.x, cy: last.y }
  }

  const isElv = fragmentKind === 'elv'
  const isCorridor = fragmentKind === 'move_to_target'
  const atRack = fragmentKind === 'init' || fragmentKind === 'pick_up' || fragmentKind === 'put_down'
  const leg: Leg = isElv
    ? elvLeg(action, actionIndex)
    : {
        from: 1,
        to: 1,
        // 廊下: start_navigation のときだけ動く。set_route_no は出発点で止まっている。
        // 荷台の前: move_forward_time(荷台の下から出る/入る)のときだけ少し動く
        seconds:
          isCorridor && action === 'start_navigation'
            ? CORRIDOR_SECONDS
            : atRack && action === 'move_forward_time'
              ? MOVE_FORWARD_SECONDS
              : 0,
      }
  // 区間の鍵: 断片番号 + アクション番号。どちらかが変われば計り直す
  const legKey = `${fragmentKind ?? ''}:${fragmentSeq ?? 0}:${actionIndex ?? action ?? ''}`
  const legT = useLegClock(legKey, leg.seconds)

  const lerp = (a: number, b: number, t: number) => a + (b - a) * t

  // いまの断片とアクションから、経路上の距離 s を出す
  const robotOnToFloor = robotFloor !== undefined && robotFloor === toLevel && toLevel !== fromLevel
  let s: number
  if (fragmentKind && stepTotal) {
    switch (fragmentKind) {
      case 'init':
      case 'pick_up':
        // 出発階の荷台。move_forward_time で荷台のすぐ外へ
        s = robotOnToFloor ? S_RACK_TO : lerp(S_RACK_FROM, S_OUT, legT)
        break
      case 'move_to_target':
        s = robotOnToFloor
          ? lerp(S_WP(5), S_IN, legT) // 点5 → 荷台の手前
          : lerp(S_OUT, S_WP(1), legT) // 荷台のすぐ外 → 点1
        break
      case 'elv':
        s = leg.seconds > 0 ? lerp(S_WP(leg.from), S_WP(leg.to), legT) : S_WP(leg.from)
        break
      case 'put_down':
        s = lerp(S_IN, S_RACK_TO, legT) // 荷台の手前 → 荷台
        break
      case 'return_home':
        s = S_RACK_TO
        break
      default:
        s = S_RACK_FROM
    }
  } else {
    // 断片が分からない(完了・順番待ち・モックの旧データ)ときは進みだけで描く
    s = (p / 100) * TOTAL
  }
  if (phase === 'completed') s = S_RACK_TO

  // 同じ依頼の中では戻らない。依頼が変わったら計り直す
  const maxRef = useRef<{ key: number | string; s: number }>({ key: taskId, s: 0 })
  if (maxRef.current.key !== taskId) maxRef.current = { key: taskId, s: 0 }
  if (s < maxRef.current.s) s = maxRef.current.s
  else maxRef.current.s = s

  const { cx, cy } = posAt(s)

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
