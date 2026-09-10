import { useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../domain/store'
import { floorLabel, spotLabel } from '../building/types'
import { getBuilding } from '../building/sampleBuildings'

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
  const { tasks, carts, confirmReceipt } = useStore()

  const task = tasks.find((t) => t.id === id)
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

  const building = getBuilding(task.buildingId)
  const cart = carts.find((c) => c.id === task.cartId)
  const from = task.fromSpotId ? spotLabel(building, task.fromSpotId) : floorLabel(building, task.fromFloorId)
  const to = task.toSpotId ? spotLabel(building, task.toSpotId) : floorLabel(building, task.toFloorId)

  const rows = [
    { k: '搬送完了日時', v: stamp(task.completedAt ?? task.createdAt) },
    { k: '送り状番号', v: task.trackingNo || '未入力' },
    { k: 'エリア from', v: from },
    { k: 'エリア To', v: to },
    { k: '荷台マーカーID', v: task.markerId || cart?.markerId || '-' },
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
