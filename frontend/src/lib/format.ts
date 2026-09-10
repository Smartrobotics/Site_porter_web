export function formatTime(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
}

export function formatDateTime(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleString('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'たった今'
  if (min < 60) return `${min}分前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}時間前`
  return formatDateTime(ts)
}
