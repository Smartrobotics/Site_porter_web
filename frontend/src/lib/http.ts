
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
