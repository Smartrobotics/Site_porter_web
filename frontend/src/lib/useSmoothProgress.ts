import { useEffect, useRef, useState } from 'react'

/**
 * 段になった進み(断片ごとに 100/step_total ずつ跳ぶ)を、なめらかな値に直す。
 *
 * サーバーが返すのは「いま何番目の断片か」だけなので、そのまま描くと
 * ロボットは20秒に1回、6分の1ずつ飛ぶ。ここでは
 *   - 断片の中では、次の段の手前(CEILING)まで一定速度で進める
 *   - 1断片にかかる時間は、直前の段が変わるまでにかかった時間から学ぶ
 *     (最初は DEFAULT_STEP_MS。mock の MOCK_SECONDS_PER_STEP と合わせてある)
 *   - サーバーの値が先に進んだら CATCH_UP_MS で追いつく
 *   - サーバーの値より先には決して行かない(段の手前で待つ)
 * 走行中でなければ補間せず、サーバーの値をそのまま返す。
 */
const DEFAULT_STEP_MS = 20_000
const MIN_STEP_MS = 3_000
const MAX_STEP_MS = 600_000
const CATCH_UP_MS = 1_000
/** 次の段のどこまで先回りするか。1.0 だと段の変わり目が見えなくなる */
const CEILING = 0.92

export function useSmoothProgress(target: number, stepTotal: number | undefined, active: boolean): number {
  const [shown, setShown] = useState(target)
  const shownRef = useRef(target)
  const targetRef = useRef(target)
  const targetAtRef = useRef(performance.now())
  const stepMsRef = useRef(DEFAULT_STEP_MS)

  // サーバーの値が変わった: 段の所要時間を学び直す
  useEffect(() => {
    const now = performance.now()
    if (target > targetRef.current) {
      stepMsRef.current = Math.min(MAX_STEP_MS, Math.max(MIN_STEP_MS, now - targetAtRef.current))
      targetAtRef.current = now
    } else if (target < targetRef.current) {
      // 別の依頼を見に来た、または巻き戻った。学習値はそのまま、位置だけ合わせる
      shownRef.current = target
      targetAtRef.current = now
    }
    targetRef.current = target
  }, [target])

  useEffect(() => {
    if (!active) {
      shownRef.current = target
      setShown(target)
      return
    }
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = now - last
      last = now
      const t = targetRef.current
      const stepSize = stepTotal ? 100 / stepTotal : 0
      const ceiling = Math.min(100, t + stepSize * CEILING)
      let v = shownRef.current
      if (v < t) {
        // 追いつく
        v = Math.min(t, v + ((t - v) * dt) / CATCH_UP_MS + (stepSize * dt) / stepMsRef.current)
      } else if (stepSize > 0) {
        // 段の中を一定速度で進む
        v = Math.min(ceiling, v + (stepSize * dt) / stepMsRef.current)
      }
      if (v !== shownRef.current) {
        shownRef.current = v
        setShown(v)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, stepTotal])

  return active ? shown : target
}
