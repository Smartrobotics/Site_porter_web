/**
 * サーバーへの fetch。必ず時間切れを付ける。
 *
 * バックエンドが落ちていると Vite の proxy(開発)や逆プロキシは、すぐ断らずに
 * 接続を待ち続けることがある。素の fetch はその間ずっと pending のままで、
 * 成功も失敗もしない — 「サーバと通信できませんでした」の判定が永遠に来ず、
 * モーダルが出ない(2026-09-16 に実測: 8 秒待っても応答なし)。
 * ポーリングも pending が積み上がる。ここで打ち切って失敗にする。
 */
export const FETCH_TIMEOUT_MS = 8_000

export class TimeoutError extends Error {
  constructor(path: string, ms: number) {
    super(`${path}: ${ms}ms 以内に応答がありません`)
    this.name = 'TimeoutError'
  }
}

export async function fetchWithTimeout(
  path: string,
  init?: RequestInit,
  timeoutMs = FETCH_TIMEOUT_MS,
): Promise<Response> {
  const ctrl = new AbortController()
  const timer = window.setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    return await fetch(path, { ...init, signal: ctrl.signal })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw new TimeoutError(path, timeoutMs)
    throw e
  } finally {
    window.clearTimeout(timer)
  }
}
