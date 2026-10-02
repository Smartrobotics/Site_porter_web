import { useStore } from '../domain/store'

export function ScreenErrorModal() {
  const { screenError, dismissScreenError } = useStore()
  if (!screenError) return null

  return (
    <div className="modal-overlay" onClick={dismissScreenError}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <strong>通信エラー</strong>
        </div>
        <div className="modal-body">
          <p className="muted" style={{ fontSize: 13, marginBottom: 14 }}>
            {screenError}
          </p>
          <button className="btn btn-primary" onClick={dismissScreenError}>
            閉じる
          </button>
        </div>
      </div>
    </div>
  )
}
