import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../domain/store'
import { areaLabel } from '../domain/master'
import { IconCheck } from './icons'

/** 画面上部に出しておく秒数。触らなければこの後に消える */
const SHOW_MS = 8_000

/**
 * 荷物が届いたことを知らせる帯。画面の上に出て、ボタンは無い。
 * 触れば通知画面へ、触らなければ SHOW_MS 後に消える。どちらでも「知らせた」扱い。
 * ポーリングで「届いた・未確認」の依頼を見つけたら、どの画面にいても1回出す。
 */
export function ArrivalModal() {
  const navigate = useNavigate()
  const { arrival, dismissArrival, master } = useStore()

  useEffect(() => {
    if (!arrival) return
    const id = window.setTimeout(dismissArrival, SHOW_MS)
    return () => window.clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrival?.id])

  if (!arrival) return null
  const to = areaLabel(master, arrival.toAreaId)
  return (
    <div className="toast-wrap" role="status">
      <div
        className="toast fade-in"
        onClick={() => {
          dismissArrival()
          navigate('/notifications')
        }}
      >
        <div className="t-icon">
          <IconCheck size={18} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="t-title">荷物が届きました</div>
          <div className="t-body">
            {arrival.itemName || '荷物'}
            {arrival.recipient ? `（${arrival.recipient}様宛）` : ''}・{to}
          </div>
        </div>
      </div>
    </div>
  )
}
