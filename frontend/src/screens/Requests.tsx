import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useStore } from '../domain/store'
import { useScreenData } from '../lib/useScreenData'
import { PhaseBadge } from '../components/ui'
import { IconList } from '../components/icons'
import { PollingStamp } from '../components/PollingStamp'
import { floorLabel, spotLabel } from '../building/types'
import { getBuilding } from '../building/sampleBuildings'
import { isActivePhase } from '../domain/phase'
import type { TransportTask } from '../domain/types'

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

/** 2026/09/01 12:34:56 */
function stamp(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** 依頼者。サーバーが自分で作った回収は「システム」になる */
function requesterLabel(t: TransportTask): string {
  return t.createdBy === 'system' ? 'システム' : '配送員'
}

/** 種別 */
function kindLabel(t: TransportTask): string {
  return t.kind === 'collect' ? '荷台回収' : '荷物搬送'
}

/** 依頼内容 */
function contentLabel(t: TransportTask, markerId?: string): string {
  if (t.kind === 'collect') return `空荷台(マーカーID: ${markerId ?? '-'}) を回収`
  return `荷物：${t.itemName || '宅配荷物'}`
}

function place(building: ReturnType<typeof getBuilding>, floorId: string, spotId?: string): string {
  return spotId ? spotLabel(building, spotId) : floorLabel(building, floorId)
}

/**
 * 依頼一覧画面。
 * 過去1週間の依頼を表示する。ただし受取確認が済んでいない依頼は
 * 1週間以上前でも表示する(荷物の行方が分からなくなるため)。
 * ?user= が付いていれば、その受取人でフィルタした状態で開く。
 */
export function Requests() {
  useScreenData()
  const navigate = useNavigate()
  const { tasks, carts } = useStore()
  const [params] = useSearchParams()
  const [recipient, setRecipient] = useState(params.get('user') ?? '')

  const recipients = useMemo(
    () => Array.from(new Set(tasks.map((t) => t.recipient).filter(Boolean))),
    [tasks],
  )

  const rows = useMemo(() => {
    const since = Date.now() - WEEK_MS
    return tasks
      .filter((t) => !t.isDeleted)
      .filter((t) => t.createdAt >= since || isActivePhase(t.phase))
      // フィルタなしなら荷台回収(システムからの依頼)も出す。
      // 受取人でしぼると回収には受取人がいないので自然に外れる
      .filter((t) => !recipient || t.recipient === recipient)
      .sort((a, b) => b.createdAt - a.createdAt)
  }, [tasks, recipient])

  return (
    <div className="fade-in">
      <div className="page-head">
        <h1>依頼一覧</h1>
        <p>過去1週間の依頼(受取確認が済んでいないものはすべて表示)</p>
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

      <PollingStamp style={{ marginBottom: 10 }} />

      {rows.length === 0 ? (
        <div className="card">
          <div className="empty">
            <div className="e-emoji">
              <IconList size={44} strokeWidth={1.6} />
            </div>
            <p>該当する依頼はありません。</p>
          </div>
        </div>
      ) : (
        <div className="stack-sm">
          {rows.map((t) => {
            const building = getBuilding(t.buildingId)
            return (
              <div key={t.id} className="card card-pad">
                <div className="muted" style={{ fontSize: 12 }}>
                  {stamp(t.createdAt)}
                </div>

                <div className="row-between" style={{ marginTop: 6 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>
                    {requesterLabel(t)}・{kindLabel(t)}
                  </div>
                  {t.confirmedAt ? (
                    <span className="badge-pill badge-green">
                      <span className="dot" />
                      受取確認完了
                    </span>
                  ) : (
                    <PhaseBadge phase={t.phase} />
                  )}
                </div>

                <div style={{ fontSize: 14, marginTop: 6 }}>{contentLabel(t, t.markerId || carts.find((c) => c.id === t.cartId)?.markerId)}</div>
                {t.trackingNo && (
                  <div className="muted mono" style={{ fontSize: 12, marginTop: 2 }}>
                    送り状番号: {t.trackingNo}
                  </div>
                )}
                <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                  {place(building, t.fromFloorId, t.fromSpotId)} →{' '}
                  {place(building, t.toFloorId, t.toSpotId)}
                </div>
                {t.recipient && (
                  <div style={{ marginTop: 8, fontSize: 15, fontWeight: 800 }}>
                    受取人:{' '}
                    <span style={{ color: 'var(--orange-dark)' }}>{t.recipient}</span>
                  </div>
                )}

                <button
                  className="btn btn-ghost btn-sm"
                  style={{ marginTop: 10 }}
                  onClick={() => navigate(`/task/${t.id}`)}
                >
                  搬送状況
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
