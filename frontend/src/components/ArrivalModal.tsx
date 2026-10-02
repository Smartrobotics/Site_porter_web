import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../domain/store'
import { areaLabel } from '../domain/master'
import { IconCheck, IconClose } from './icons'

const SHOW_MS = 8_000

export function ArrivalModal() {
  const navigate = useNavigate()
  const { arrival, dismissArrival, master } = useStore()

  useEffect(() => {
    if (!arrival) return
    const id = window.setTimeout(dismissArrival, SHOW_MS)
    return () => window.clearTimeout(id)
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
        <button
          onClick={(e) => {
            e.stopPropagation()
            dismissArrival()
          }}
          aria-label="閉じる"
          style={{ color: 'var(--navy-faint)', padding: 4 }}
        >
          <IconClose size={16} />
        </button>
      </div>
    </div>
  )
}
