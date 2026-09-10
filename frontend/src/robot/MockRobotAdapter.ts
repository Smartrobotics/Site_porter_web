import type { RobotAdapter, RobotStatusUpdate, RobotTransportPhase } from './types'
import type { TransportRequest } from '../domain/types'
import type { RouteMapping } from '../building/types'
import { AtmobiState } from './atmobiTypes'

interface Segment {
  phase: RobotTransportPhase
  durationMs: number
  message: string
  rawState: number
  /** このセグメント内で進捗をどこからどこまで進めるか */
  from: number
  to: number
}

/**
 * デモ用モックアダプタ。
 * タイマーで各フェーズを疑似再生し、progress を滑らかに更新する。
 *
 * 搬送(delivery): dispatching(3s) → loading(4s) → transporting(10s) → arrived(3s) → completed
 * 回収(collect) : dispatching(3s) → loading(3s) → returning(8s) → completed
 *
 * 回収は搬送の一部ではなく、独立した1回の走行として再生する。
 * 実機でも空荷台の回収は別の依頼・別のシナリオになるため。
 */
export class MockRobotAdapter implements RobotAdapter {
  readonly name = 'デモロボット (Mock)'

  /** 荷物を運ぶ走行。荷降ろしして荷台の下から出たら終わり */
  private deliveryTimeline: Segment[] = [
    { phase: 'dispatching', durationMs: 3000, from: 0, to: 14, rawState: AtmobiState.LOCALIZING, message: '配車中 — 荷台位置へ向かっています' },
    { phase: 'loading', durationMs: 4000, from: 14, to: 26, rawState: AtmobiState.DOCKING, message: '積込中 — 荷台を連結しています' },
    { phase: 'transporting', durationMs: 10000, from: 26, to: 88, rawState: AtmobiState.MOVING, message: '搬送中 — 目的階へ走行しています' },
    { phase: 'arrived', durationMs: 3000, from: 88, to: 99, rawState: AtmobiState.ARRIVED, message: '荷降ろし中 — 受渡場所に到着しました' },
    { phase: 'completed', durationMs: 0, from: 100, to: 100, rawState: AtmobiState.IDLE, message: '搬送完了' },
  ]

  /** 空荷台を戻す走行。運ぶ荷物がないので到着したら終わり */
  private collectTimeline: Segment[] = [
    { phase: 'dispatching', durationMs: 3000, from: 0, to: 16, rawState: AtmobiState.LOCALIZING, message: '配車中 — 空荷台の位置へ向かっています' },
    { phase: 'loading', durationMs: 3000, from: 16, to: 30, rawState: AtmobiState.DOCKING, message: '積込中 — 空荷台を連結しています' },
    { phase: 'returning', durationMs: 8000, from: 30, to: 99, rawState: AtmobiState.MOVING, message: '空荷台回収 — 集積場所へ戻しています' },
    { phase: 'completed', durationMs: 0, from: 100, to: 100, rawState: AtmobiState.IDLE, message: '回収完了' },
  ]

  private timers = new Map<string, number[]>()
  /** 走行IDごとに、どちらの筋書きを流すか */
  private kinds = new Map<string, 'delivery' | 'collect'>()

  async checkConnection(): Promise<{ ok: boolean; detail: string }> {
    return { ok: true, detail: 'デモモード稼働中(ローカルシミュレーション)' }
  }

  async startTransport(req: TransportRequest, _route: RouteMapping): Promise<string> {
    const id = `mock-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    this.kinds.set(id, req.kind === 'collect' ? 'collect' : 'delivery')
    return id
  }

  subscribe(taskId: string, cb: (u: RobotStatusUpdate) => void): () => void {
    const handles: number[] = []
    this.timers.set(taskId, handles)

    let elapsed = 0
    const tick = 200 // ms — 滑らかな進捗更新
    const timeline =
      this.kinds.get(taskId) === 'collect' ? this.collectTimeline : this.deliveryTimeline

    for (const seg of timeline) {
      const segStart = elapsed
      if (seg.durationMs === 0) {
        // 完了フェーズは一発通知
        handles.push(
          window.setTimeout(() => {
            cb({ phase: seg.phase, progress: 100, rawState: seg.rawState, message: seg.message })
          }, segStart),
        )
        continue
      }
      const steps = Math.max(1, Math.round(seg.durationMs / tick))
      for (let i = 0; i < steps; i++) {
        const t = i / steps
        const progress = Math.round(seg.from + (seg.to - seg.from) * t)
        const at = segStart + i * tick
        handles.push(
          window.setTimeout(() => {
            cb({ phase: seg.phase, progress, rawState: seg.rawState, message: seg.message })
          }, at),
        )
      }
      elapsed += seg.durationMs
    }

    return () => {
      const hs = this.timers.get(taskId)
      if (hs) hs.forEach((h) => window.clearTimeout(h))
      this.timers.delete(taskId)
      this.kinds.delete(taskId)
    }
  }

  async cancel(taskId: string): Promise<void> {
    const hs = this.timers.get(taskId)
    if (hs) hs.forEach((h) => window.clearTimeout(h))
    this.timers.delete(taskId)
    this.kinds.delete(taskId)
  }
}
