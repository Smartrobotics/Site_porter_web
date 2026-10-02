import { useStore } from '../domain/store'

function jpTime(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getHours()}時${p(d.getMinutes())}分${p(d.getSeconds())}秒`
}

export function PollingStamp({ style }: { style?: React.CSSProperties }) {
  const { lastFetchedAt } = useStore()
  return (
    <div className="muted" style={{ fontSize: 12, ...style }}>
      搬送状況取得時刻：{jpTime(lastFetchedAt)}
    </div>
  )
}
