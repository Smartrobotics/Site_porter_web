import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../domain/store'
import { useScreenData } from '../lib/useScreenData'
import { PhaseBadge } from '../components/ui'
import { IconList, IconAlert } from '../components/icons'
import { addressLabel, areaLabel, findRack } from '../domain/master'
import type { TransportTask } from '../domain/types'

/** 2026/09/07 12:34:56 */
function stamp(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** エレベータを呼んだあとかどうか。呼んだ後はエレベータ側のキャンセルが別途要る */
function liftCalled(t: TransportTask): boolean {
  return t.phase === 'transporting' || t.phase === 'arrived' || t.phase === 'returning'
}

/**
 * 管理者用の依頼一覧(依頼取消画面)。
 * 搬送途中で問題が起きたときに、依頼を取り消して立て直すための画面。
 * 項目は依頼一覧とほぼ同じで、取消のボタンが増える。
 *
 * 取消の扱いは搬送開始前と後で違う:
 *   ロボットアサイン前(順番待ち) — いつでも取消できる
 *   アサイン後                   — 問題が発生した場合に限る
 */
export function AdminRequests() {
  useScreenData()
  const navigate = useNavigate()
  const { tasks, master, cancelRequest } = useStore()
  const [target, setTarget] = useState<TransportTask | null>(null)

  const rows = useMemo(() => [...tasks].sort((a, b) => b.createdAt - a.createdAt), [tasks])

  return (
    <div className="fade-in">
      <div className="page-head">
        <h1>依頼管理(管理者用)</h1>
        <p>問題が起きた依頼を取り消します</p>
      </div>

      <div className="card card-pad" style={{ marginBottom: 14, borderLeft: '4px solid var(--orange)' }}>
        <div style={{ fontWeight: 700, fontSize: 13.5, display: 'flex', gap: 8, alignItems: 'center' }}>
          <IconAlert size={17} /> 取り消す前に確認してください
        </div>
        <ul className="muted" style={{ fontSize: 12.5, marginTop: 6, paddingLeft: 18, lineHeight: 1.8 }}>
          <li>ロボットが途中で止まっている場合は、手動で初期位置に戻してください。</li>
          <li>
            エレベータを呼び出した後は、エレベータ管理用WEBサイトでもキャンセルが必要です(別システムのため
            この画面からは取り消せません)。
          </li>
        </ul>
      </div>

      {rows.length === 0 ? (
        <div className="card">
          <div className="empty">
            <div className="e-emoji">
              <IconList size={44} strokeWidth={1.6} />
            </div>
            <p>依頼はありません。</p>
          </div>
        </div>
      ) : (
        <div className="stack-sm">
          {rows.map((t) => {
            const from = t.fromAddressId ? addressLabel(master, t.fromAddressId) : areaLabel(master, t.fromAreaId)
            const to = t.toAddressId ? addressLabel(master, t.toAddressId) : areaLabel(master, t.toAreaId)
            const assigned = t.phase !== 'queued' && t.phase !== 'cancelled' && !t.isDeleted
            const canCancel = !t.isDeleted && t.phase !== 'cancelled'
            return (
              <div key={t.id} className="card card-pad" style={{ opacity: t.isDeleted ? 0.55 : 1 }}>
                <div className="muted" style={{ fontSize: 12 }}>
                  {stamp(t.createdAt)}
                </div>
                <div className="row-between" style={{ marginTop: 6 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>
                    {t.createdBy === 'system' ? 'システム' : '配送員'}・
                    {t.kind === 'collect' ? '荷台回収' : '荷物搬送'}
                  </div>
                  {t.isDeleted ? (
                    <span className="badge-pill badge-grey">削除済み</span>
                  ) : (
                    <PhaseBadge phase={t.phase} />
                  )}
                </div>
                <div style={{ fontSize: 14, marginTop: 6 }}>
                  {t.kind === 'collect'
                    ? `空荷台(マーカーID: ${t.markerId || findRack(master, t.rackId)?.markerId || '-'}) を回収`
                    : `荷物：${t.itemName || '宅配荷物'}`}
                </div>
                <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                  {from} → {to}
                  {t.recipient ? `・${t.recipient} 宛` : ''}
                </div>
                <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                  ロボット: {assigned ? `アサイン済み(${t.robotAdapterName})` : '未アサイン'}
                </div>

                {canCancel && (
                  <button className="btn btn-ghost btn-sm" style={{ marginTop: 10 }} onClick={() => setTarget(t)}>
                    取消
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      <button className="btn btn-ghost" style={{ marginTop: 14 }} onClick={() => navigate('/settings')}>
        設定へ戻る
      </button>

      {target && (
        <div className="modal-overlay" onClick={() => setTarget(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <strong>依頼を取り消す</strong>
            </div>
            <div className="modal-body">
              <p className="muted" style={{ fontSize: 13, marginBottom: 10 }}>
                {target.kind === 'collect' ? '空荷台の回収' : `「${target.itemName || '宅配荷物'}」`}の依頼を
                取り消します。
              </p>

              {target.phase === 'queued' ? (
                <p className="muted" style={{ fontSize: 12.5, marginBottom: 12 }}>
                  まだロボットにアサインされていないので、そのまま取り消せます。
                </p>
              ) : (
                <p
                  className="muted"
                  style={{ fontSize: 12.5, marginBottom: 12, color: 'var(--orange-dark)' }}
                >
                  すでにロボットにアサイン済みです。問題が発生した場合のみ取り消してください。
                  ロボットは手動で初期位置に戻してください。
                  {liftCalled(target) &&
                    ' エレベータを呼び出し済みのため、エレベータ管理用WEBサイトでもキャンセルしてください。'}
                </p>
              )}

              <button
                className="btn btn-ghost"
                style={{ marginBottom: 10 }}
                onClick={async () => {
                  await cancelRequest(target.id, 'reset')
                  setTarget(null)
                }}
              >
                搬送開始前の状態に戻す
                <br />
                <small className="muted">あらためて搬送依頼をする必要はありません</small>
              </button>

              <button
                className="btn btn-primary"
                onClick={async () => {
                  await cancelRequest(target.id, 'delete')
                  setTarget(null)
                }}
              >
                完全に削除する
                <br />
                <small style={{ opacity: 0.85 }}>あらためて搬送依頼が必要です</small>
              </button>

              <button className="btn btn-ghost" style={{ marginTop: 10 }} onClick={() => setTarget(null)}>
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
