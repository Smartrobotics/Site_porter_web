import { useLocation, useNavigate } from 'react-router-dom'
import { IconCheck } from '../components/icons'

export interface SentState {
  taskId: string
}

/**
 * 搬送依頼送信完了画面。
 * 送信できたことだけを伝える。搬送状況へは自動で移らず、
 * ボタンを押してもらう(受付だけの場合は見せても意味がないため)。
 */
export function RequestSent() {
  const navigate = useNavigate()
  const location = useLocation()
  const state = location.state as SentState | null

  if (!state) {
    return (
      <div className="fade-in">
        <div className="page-head">
          <h1>搬送依頼送信完了</h1>
          <p>送信内容が見つかりません</p>
        </div>
        <button className="btn btn-primary" onClick={() => navigate('/', { replace: true })}>
          ホームへ
        </button>
      </div>
    )
  }


  return (
    <div className="fade-in">
      <div className="card card-pad" style={{ textAlign: 'center', padding: '32px 20px', marginBottom: 16 }}>
        <div
          style={{
            width: 68,
            height: 68,
            borderRadius: '50%',
            background: 'var(--green-tint)',
            color: 'var(--green-dark)',
            display: 'grid',
            placeItems: 'center',
            margin: '0 auto 16px',
          }}
        >
          <IconCheck size={34} />
        </div>
        <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 8 }}>搬送依頼を送信しました</div>
        <div className="muted" style={{ fontSize: 13, lineHeight: 1.7 }}>
          受付が完了しました。搬送の進み具合は搬送状況画面で確認できます。
        </div>
      </div>

      <button
        className="btn btn-primary"
        onClick={() => navigate(`/task/${state.taskId}`, { replace: true })}
      >
        搬送状況確認
      </button>
    </div>
  )
}
