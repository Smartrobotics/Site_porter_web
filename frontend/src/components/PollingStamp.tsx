import { useStore } from '../domain/store'

/** 10時23分45秒 */
function jpTime(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getHours()}時${p(d.getMinutes())}分${p(d.getSeconds())}秒`
}

/**
 * 搬送状況を最後に取得できた時刻(E10)。
 * ポーリングは何度も走るので失敗もそれなりに起きる。そのたびにエラーを
 * 出すとユーザーが困惑するため、メッセージは出さずにこの時刻だけを見せる。
 * 更新が止まっていれば、取得できていないことは時刻を見れば分かる。
 */
export function PollingStamp({ style }: { style?: React.CSSProperties }) {
  const { lastFetchedAt } = useStore()
  return (
    <div className="muted" style={{ fontSize: 12, ...style }}>
      搬送状況取得時刻：{jpTime(lastFetchedAt)}
    </div>
  )
}
