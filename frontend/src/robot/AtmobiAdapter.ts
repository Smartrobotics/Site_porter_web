import type { RobotAdapter, RobotStatusUpdate, RobotTransportPhase } from './types'
import type { TransportRequest } from '../domain/types'
import type { RouteMapping } from '../building/types'
import { NaviStatus, naviStatusLabel, stateLabel } from './atmobiTypes'

const DEFAULT_BASE_URL = 'http://localhost:5000'
const FETCH_TIMEOUT_MS = 3000
const POLL_INTERVAL_MS = 2000

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const ctrl = new AbortController()
  const t = window.setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: ctrl.signal })
  } finally {
    window.clearTimeout(t)
  }
}

/**
 * @mobi (atmobi) 実機アダプタ。
 * localhost:5000 想定。ベースURLは設定画面から変更可能。
 *
 * 走行シーケンス:
 *   POST navi/localize/map/{mapNo}
 *   PUT  navi/waypoint/map/{mapNo}/waypoint/{pathNo}
 *   PUT  navi/start  { "loop": false }
 *   GET  navi/status を2秒間隔ポーリング
 *   GET  state で詳細状態(移動中/到着/非常停止 等)を取得しmessageへ反映
 */
export class AtmobiAdapter implements RobotAdapter {
  readonly name = '宅配ロボット 実機'
  private baseUrl: string
  private polls = new Map<string, number>()

  constructor(baseUrl: string = DEFAULT_BASE_URL) {
    this.baseUrl = baseUrl.replace(/\/+$/, '')
  }

  async checkConnection(): Promise<{ ok: boolean; detail: string }> {
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/state`)
      if (!res.ok) {
        return { ok: false, detail: `HTTP ${res.status} — 宅配ロボットが応答しません` }
      }
      const data = (await res.json()) as { state?: number }
      return {
        ok: true,
        detail: `接続成功 — 現在状態: ${stateLabel(data.state)}`,
      }
    } catch (e) {
      const reason = e instanceof DOMException && e.name === 'AbortError' ? 'タイムアウト(3秒)' : '接続失敗'
      return { ok: false, detail: `${reason} — ${this.baseUrl} に到達できません` }
    }
  }

  async startTransport(_req: TransportRequest, route: RouteMapping): Promise<string> {
    const { mapNo, pathNo } = route
    // 1) 環境地図の選択
    const r1 = await fetchWithTimeout(`${this.baseUrl}/navi/localize/map/${mapNo}`, { method: 'POST' })
    if (!r1.ok) throw new Error(`地図選択に失敗しました (HTTP ${r1.status})`)

    // 2) 経由地点(経路)設定
    const r2 = await fetchWithTimeout(
      `${this.baseUrl}/navi/waypoint/map/${mapNo}/waypoint/${pathNo}`,
      { method: 'PUT' },
    )
    if (!r2.ok) throw new Error(`経路設定に失敗しました (HTTP ${r2.status})`)

    // 3) 走行開始
    const r3 = await fetchWithTimeout(`${this.baseUrl}/navi/start`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ loop: false }),
    })
    if (!r3.ok) throw new Error(`走行開始に失敗しました (HTTP ${r3.status})`)

    // 画面に露出するタスクIDは中立プレフィックスにする(内部語の秘匿)
    return `rbt-${mapNo}-${pathNo}-${Date.now().toString(36)}`
  }

  subscribe(taskId: string, cb: (u: RobotStatusUpdate) => void): () => void {
    let progress = 15
    let done = false

    const poll = async () => {
      if (done) return
      try {
        const [statusRes, stateRes] = await Promise.all([
          fetchWithTimeout(`${this.baseUrl}/navi/status`),
          fetchWithTimeout(`${this.baseUrl}/state`),
        ])
        const status = (await statusRes.json()) as { navi_status?: number }
        const state = (await stateRes.json()) as { state?: number }
        const nav = status.navi_status ?? NaviStatus.UNKNOWN
        const rawState = state.state

        let phase: RobotTransportPhase = 'transporting'
        if (nav === NaviStatus.ACTIVE) {
          phase = 'transporting'
          progress = Math.min(90, progress + 6)
        } else if (nav === NaviStatus.SUCCEEDED) {
          phase = 'arrived'
          progress = 100
          done = true
        } else if (nav === NaviStatus.ABORTED || nav === NaviStatus.REJECTED) {
          phase = 'error'
          done = true
        } else if (nav === NaviStatus.PENDING) {
          phase = 'dispatching'
        }

        const msg = `${naviStatusLabel(nav)} / 機体: ${stateLabel(rawState)}`
        cb({ phase, progress, rawState, message: msg })
      } catch (e) {
        const reason = e instanceof DOMException && e.name === 'AbortError' ? 'タイムアウト' : '通信エラー'
        cb({ phase: 'error', progress, message: `宅配ロボットとの通信に失敗しました (${reason})` })
        done = true
      }
      if (!done) {
        const h = window.setTimeout(poll, POLL_INTERVAL_MS)
        this.polls.set(taskId, h)
      } else {
        this.polls.delete(taskId)
      }
    }

    void poll()

    return () => {
      const h = this.polls.get(taskId)
      if (h) window.clearTimeout(h)
      this.polls.delete(taskId)
      done = true
    }
  }

  async cancel(taskId: string): Promise<void> {
    const h = this.polls.get(taskId)
    if (h) window.clearTimeout(h)
    this.polls.delete(taskId)
    try {
      // @mobi API: 走行終了は PUT navi/end
      await fetchWithTimeout(`${this.baseUrl}/navi/end`, { method: 'PUT' })
    } catch {
      // キャンセル送信失敗は無視(UIはローカルで停止済)
    }
  }
}
