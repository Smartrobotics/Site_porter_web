import { useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../domain/store'
import { addressLabel, areaLabel, findRack } from '../domain/master'

/** 2026/09/01 12:34 */
function stamp(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/**
 * 荷物受取確認画面。
 * 通知一覧で [ 受取確認 ] を押すとここへ来る。押し間違いがあるので、
 * ここでもう一度確認してから確定する。
 */
export function ReceiptConfirm() {
  const navigate = useNavigate()
  const { id } = useParams()
  const { tasks, master, confirmReceipt } = useStore()

  const task = tasks.find((t) => t.id === Number(id))
  if (!task) {
    return (
      <div className="fade-in">
        <div className="page-head">
          <h1>荷物受取確認</h1>
          <p>該当する荷物が見つかりません</p>
        </div>
        <button className="btn btn-primary" onClick={() => navigate('/notifications', { replace: true })}>
          通知一覧へ戻る
        </button>
      </div>
    )
  }
  const rack = findRack(master, task.rackId)
  const from = task.fromAddressId ? addressLabel(master, task.fromAddressId) : areaLabel(master, task.fromAreaId)
  const to = task.toAddressId ? addressLabel(master, task.toAddressId) : areaLabel(master, task.toAreaId)

  const rows = [
    { k: '搬送完了日時', v: stamp(task.completedAt ?? task.createdAt) },
    { k: '送り状番号', v: task.trackingNo || '未入力' },
    { k: '搬送元', v: from },
    { k: '搬送先', v: to },
    { k: '荷台マーカーID', v: task.markerId || rack?.markerId || '-' },
    { k: '荷物名', v: task.itemName },
    { k: '受取人', v: task.recipient || '未選択' },
  ]

  return (
    <div className="fade-in">
      <div className="page-head">
        <h1>荷物受取確認</h1>
        <p>確認ボタンを押してください。</p>
      </div>

      <div className="card card-pad" style={{ marginBottom: 16 }}>
        {rows.map((r) => (
          <div key={r.k} className="row-between" style={{ padding: '7px 0' }}>
            <span className="muted" style={{ fontSize: 13 }}>
              {r.k}
            </span>
            <span style={{ fontWeight: 700, fontSize: 14 }}>{r.v}</span>
          </div>
        ))}
      </div>

      <button
        className="btn btn-primary"
        onClick={() => {
          confirmReceipt(task.id)
          navigate('/notifications', { replace: true })
        }}
      >
        確認
      </button>
      <button
        className="btn btn-ghost"
        style={{ marginTop: 10 }}
        onClick={() => navigate('/notifications', { replace: true })}
      >
        キャンセル
      </button>
    </div>
  )
}
