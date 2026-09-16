import { useNavigate } from 'react-router-dom'
import { useStore } from '../domain/store'
import { areaLabel } from '../domain/master'
import { IconCheck } from './icons'

/**
 * 荷物が届いたことを知らせるモーダル。
 * ポーリングで「届いた・未確認」の依頼を見つけたら、どの画面にいても1回出す。
 * 通知タブのバッジだけでは気付かれないため。閉じるまで次の知らせは出さない。
 */
export function ArrivalModal() {
  const navigate = useNavigate()
  const { arrival, dismissArrival, master } = useStore()
  if (!arrival) return null

  const to = areaLabel(master, arrival.toAreaId)
  return (
    <div className="modal-overlay" onClick={dismissArrival}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: 'var(--green-dark)', display: 'grid', placeItems: 'center' }}>
            <IconCheck size={18} />
          </span>
          <strong>荷物が届きました</strong>
        </div>
        <div className="modal-body">
          <p style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>
            {arrival.itemName || '荷物'}
            {arrival.recipient ? `（${arrival.recipient}様宛）` : ''}
          </p>
          <p className="muted" style={{ fontSize: 13, marginBottom: 14 }}>
            {to} に到着しました。受け取ったら通知画面で受取確認を押してください。
          </p>
          <button
            className="btn btn-primary"
            onClick={() => {
              dismissArrival()
              navigate('/notifications')
            }}
          >
            通知を見る
          </button>
          <button className="btn btn-ghost" style={{ marginTop: 8 }} onClick={dismissArrival}>
            閉じる
          </button>
        </div>
      </div>
    </div>
  )
}
