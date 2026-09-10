import { useStore } from '../domain/store'
import { IconCheck, IconAlert, IconClose } from './icons'

export function ToastHost() {
  const { toasts, dismissToast } = useStore()
  if (toasts.length === 0) return null

  return (
    <div className="toast-wrap">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="toast"
          style={t.kind === 'error' ? { borderLeftColor: 'var(--orange)' } : undefined}
        >
          <div
            className="t-icon"
            style={
              t.kind === 'error'
                ? { background: 'var(--orange-tint)', color: 'var(--orange-dark)' }
                : undefined
            }
          >
            {t.kind === 'error' ? <IconAlert size={18} /> : <IconCheck size={18} />}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="t-title">{t.title}</div>
            <div className="t-body">{t.body}</div>
          </div>
          <button
            onClick={() => dismissToast(t.id)}
            aria-label="閉じる"
            style={{ color: 'var(--navy-faint)', padding: 4 }}
          >
            <IconClose size={16} />
          </button>
        </div>
      ))}
    </div>
  )
}
