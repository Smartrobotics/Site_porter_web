
export function hashForQuery(search: string): string | null {
  const q = new URLSearchParams(search)
  const area = q.get('area') ?? q.get('area_id')
  if (area) return `#/entry?area=${encodeURIComponent(area)}`
  const user = q.get('user') ?? q.get('user_id')
  if (user) return `#/requests?user_id=${encodeURIComponent(user)}`
  return null
}

/** クエリをハッシュに直し、アドレスバーからクエリを消す。何も無ければ何もしない */
export function redirectQueryToHash(): void {
  const target = hashForQuery(window.location.search)
  if (!target) return
  window.history.replaceState(null, '', window.location.pathname + target)
}
