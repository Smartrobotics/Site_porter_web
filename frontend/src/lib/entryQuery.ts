/**
 * 壁QR・受取人カードのURLは `https://<host>/?area_id=1` / `?user_id=N` の形
 * (docs/siteporter-workflow.ja.md 6.1、qr/scripts/gen_qr.py)。
 * 画面は HashRouter なので、`#` の前に付いたクエリは画面に届かない。
 *
 * React を起動する前に(main.tsx)ハッシュへ書き換える。起動後に navigate() で
 * 飛ばす方法は、URL は変わるのに画面が切り替わらないことがあった。
 *
 *   ?area=1 / ?area_id=1  →  #/entry?area=1
 *   ?user=1 / ?user_id=1  →  #/requests?user_id=1
 */
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
