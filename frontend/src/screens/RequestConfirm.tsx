import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '../domain/store'
import { PRIORITY_LABEL } from '../domain/types'
import { areaLabel, floorLabel } from '../domain/master'
import type { FormState } from './Request'
import { IconArrow } from '../components/icons'

/** 依頼画面から渡ってくる入力内容 */
export type ConfirmState = FormState

/**
 * 搬送依頼内容確認画面。
 * 送信前にもう一度内容を見せる。間違っていれば「戻る」で直す。
 */
export function RequestConfirm() {
  const navigate = useNavigate()
  const location = useLocation()
  const { master, startTransport } = useStore()
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
        // IDはサーバーが振る。E3 まではストア側でローカル採番する
        id: 0,
        kind: 'delivery',
        createdBy: 'user',
        rackId: req.rackId,
        markerId: req.markerId ? Number(req.markerId) : undefined,
        trackingNo: req.trackingNo || undefined,
        fromAreaId: req.fromAreaId,
        toAreaId: req.toAreaId,
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

  /** 「2Fエレベータ付近(2F)」 */
  const place = (areaId: number) => `${areaLabel(master, areaId)}(${floorLabel(master, areaId)})`

  const rows: { k: string; v: string }[] = [
    { k: '荷台', v: `マーカーID: ${req.markerId}` },
    { k: '送り状番号', v: req.trackingNo || '未入力' },
    { k: '搬送元', v: place(req.fromAreaId) },
    { k: '搬送先', v: place(req.toAreaId) },
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
          {place(req.fromAreaId)}
          <span className="arrow">
            <IconArrow size={17} />
          </span>
          {place(req.toAreaId)}
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
