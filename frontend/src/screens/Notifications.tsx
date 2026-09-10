import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../domain/store'
import { useScreenData } from '../lib/useScreenData'
import { IconBell } from '../components/icons'
import { addressLabel, areaLabel, findRack } from '../domain/master'

/** 2026/09/01 12:34 */
function stamp(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/**
 * 通知一覧画面。
 * 受取確認が済んでいない荷物の通知だけを表示する。
 * 確認が済んだものは依頼一覧画面で見られるので、ここには残さない
 * (残すと際限なく増えるため)。荷台回収の完了などは通知しない。
 */
export function Notifications() {
  useScreenData()
  const navigate = useNavigate()
  const { tasks, master } = useStore()
  const [recipient, setRecipient] = useState('')

  const pending = useMemo(
    () =>
      tasks
        .filter((t) => !t.isDeleted && t.kind !== 'collect' && t.phase === 'completed' && !t.confirmedAt)
        .filter((t) => !recipient || t.recipient === recipient)
        .sort((a, b) => (b.completedAt ?? b.createdAt) - (a.completedAt ?? a.createdAt)),
    [tasks, recipient],
  )

  const recipients = useMemo(
    () =>
      Array.from(
        new Set(
          tasks
            .filter((t) => t.kind !== 'collect' && t.phase === 'completed' && !t.confirmedAt)
            .map((t) => t.recipient)
            .filter(Boolean),
        ),
      ),
    [tasks],
  )

  return (
    <div className="fade-in">
      <div className="page-head">
        <h1>通知</h1>
        <p>受取確認が済んでいない荷物 {pending.length} 件</p>
      </div>

      <div className="field">
        <label>受取人</label>
        <select className="select" value={recipient} onChange={(e) => setRecipient(e.target.value)}>
          <option value="">フィルタなし</option>
          {recipients.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </div>

      {pending.length === 0 ? (
        <div className="card">
          <div className="empty">
            <div className="e-emoji">
              <IconBell size={44} strokeWidth={1.6} />
            </div>
            <p>
              受取確認が必要な荷物はありません。
              <br />
              搬送が完了するとここに表示されます。
            </p>
          </div>
        </div>
      ) : (
        <div className="stack-sm">
          {pending.map((t) => {
            const rack = findRack(master, t.rackId)
            const from = t.fromAddressId ? addressLabel(master, t.fromAddressId) : areaLabel(master, t.fromAreaId)
            const to = t.toAddressId ? addressLabel(master, t.toAddressId) : areaLabel(master, t.toAreaId)
            return (
              <div key={t.id} className="card card-pad">
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>
                  荷物を受け取ってから [ 受取確認 ] ボタンを押してください。
                </div>

                <Row k="搬送完了日時" v={stamp(t.completedAt ?? t.createdAt)} />
                <Row k="送り状番号" v={t.trackingNo || '未入力'} />
                <Row k="エリア from" v={from} />
                <Row k="エリア To" v={to} />
                <Row k="荷台マーカーID" v={String(t.markerId ?? rack?.markerId ?? '-')} />
                <Row k="荷物名" v={t.itemName} />
                <Row k="受取人" v={t.recipient || '未選択'} />

                <button
                  className="btn btn-primary"
                  style={{ marginTop: 12 }}
                  onClick={() => navigate(`/receipt/${t.id}`)}
                >
                  受取確認
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="row-between" style={{ padding: '5px 0' }}>
      <span className="muted" style={{ fontSize: 13 }}>
        {k}
      </span>
      <span style={{ fontWeight: 700, fontSize: 14 }}>{v}</span>
    </div>
  )
}
