import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '../domain/store'
import type { Priority } from '../domain/types'
import { PRIORITY_LABEL } from '../domain/types'
import { floorLabel, spotLabel } from '../building/types'
import { IconArrow } from '../components/icons'

/** 依頼画面から渡ってくる入力内容 */
export interface ConfirmState {
  cartId: string
  markerId: string
  trackingNo: string
  fromFloorId: string
  toFloorId: string
  fromSpotId?: string
  toSpotId?: string
  itemName: string
  recipient: string
  priority: Priority
}

/** 「搬送元 資材集積場(1F)」のような1行にする */
function placeLabel(
  building: import('../building/types').BuildingProfile,
  floorId: string,
  spotId?: string,
): string {
  const floor = floorLabel(building, floorId)
  return spotId ? `${spotLabel(building, spotId)}(${floor})` : floor
}

/**
 * 搬送依頼内容確認画面。
 * 送信前にもう一度内容を見せる。間違っていれば「戻る」で直す。
 */
export function RequestConfirm() {
  const navigate = useNavigate()
  const location = useLocation()
  const { building, startTransport } = useStore()
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const req = location.state as ConfirmState | null

  // 直接URLで開かれた場合は入力内容がないので、入力画面へ戻す
  if (!req) {
    return (
      <div className="fade-in">
        <div className="page-head">
          <h1>搬送依頼内容確認</h1>
          <p>依頼内容が見つかりません</p>
        </div>
        <button className="btn btn-primary" onClick={() => navigate('/request', { replace: true })}>
          搬送依頼入力へ戻る
        </button>
      </div>
    )
  }

  const send = async () => {
    setSending(true)
    setError(null)
    try {
      const id = await startTransport({
        id: `req-${Date.now().toString(36)}`,
        cartId: req.cartId,
        markerId: req.markerId,
        trackingNo: req.trackingNo,
        fromFloorId: req.fromFloorId,
        toFloorId: req.toFloorId,
        fromSpotId: req.fromSpotId,
        toSpotId: req.toSpotId,
        itemName: req.itemName,
        recipient: req.recipient,
        priority: req.priority,
      })
      navigate('/request/sent', { replace: true, state: { taskId: id } })
    } catch (e) {
      // E6 サーバーに接続できない / E8 荷台が使用中 / その他サーバー側の障害
      setError(e instanceof Error ? e.message : 'サーバーに接続できませんでした')
      setSending(false)
    }
  }

  const rows: { k: string; v: string }[] = [
    { k: '荷台', v: `マーカーID: ${req.markerId}` },
    { k: '送り状番号', v: req.trackingNo || '未入力' },
    { k: '搬送元', v: placeLabel(building, req.fromFloorId, req.fromSpotId) },
    { k: '搬送先', v: placeLabel(building, req.toFloorId, req.toSpotId) },
    { k: '荷物名', v: req.itemName || '宅配荷物' },
    { k: '受取人', v: req.recipient || '未選択' },
    { k: '優先度', v: PRIORITY_LABEL[req.priority] },
  ]

  return (
    <div className="fade-in">
      <div className="page-head">
        <h1>搬送依頼内容確認</h1>
        <p>内容をご確認ください</p>
      </div>

      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div className="tc-route" style={{ marginBottom: 12 }}>
          {placeLabel(building, req.fromFloorId, req.fromSpotId)}
          <span className="arrow">
            <IconArrow size={17} />
          </span>
          {placeLabel(building, req.toFloorId, req.toSpotId)}
        </div>
        {rows.map((r) => (
          <div key={r.k} className="row-between" style={{ padding: '7px 0' }}>
            <span className="muted" style={{ fontSize: 13 }}>
              {r.k}
            </span>
            <span style={{ fontWeight: 700, fontSize: 14 }}>{r.v}</span>
          </div>
        ))}
      </div>

      <button className="btn btn-primary" disabled={sending} onClick={send}>
        {sending ? '送信しています…' : '搬送依頼送信'}
      </button>
      <button
        className="btn btn-ghost"
        style={{ marginTop: 10 }}
        disabled={sending}
        onClick={() => navigate('/request', { replace: true, state: { form: req } })}
      >
        戻る
      </button>

      {error && (
        <div className="modal-overlay" onClick={() => setError(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <strong>送信できませんでした</strong>
            </div>
            <div className="modal-body">
              <p className="muted" style={{ fontSize: 13, marginBottom: 14 }}>
                {error}
              </p>
              <button className="btn btn-primary" onClick={() => setError(null)}>
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
