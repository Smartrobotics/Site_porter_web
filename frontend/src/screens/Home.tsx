import { useNavigate } from 'react-router-dom'
import { robotPhaseLabel, useStore } from '../domain/store'
import { useScreenData } from '../lib/useScreenData'
import { TaskCard } from '../components/TaskCard'
import { IconCart, IconPlus, IconRobot } from '../components/icons'
import { LocationBadge } from '../components/LocationBadge'
import { isActivePhase } from '../domain/phase'

export function Home() {
  useScreenData()
  const navigate = useNavigate()
  const { tasks, robot } = useStore()

  const visible = tasks.filter((t) => !t.isDeleted)
  const active = visible.filter((t) => isActivePhase(t.phase))
  const finished = visible.filter((t) => !isActivePhase(t.phase))

  // サーバーがロボット無し(モック)で動いているかどうか
  const isMock = robot?.mode === 'mock'

  return (
    <div>
      <div className="page-head">
        <h1>ホーム</h1>
        <p>荷物を階から階へ届けます</p>
      </div>

      <LocationBadge style={{ marginBottom: 12 }} />

      <button className="btn btn-primary" style={{ marginBottom: 16 }} onClick={() => navigate('/request')}>
        <IconPlus size={20} /> 搬送依頼
      </button>

      {/* ロボット接続状態バッジ */}
      <div
        className="card card-pad row-between fade-in"
        style={{ marginBottom: 4 }}
        onClick={() => navigate('/settings')}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              display: 'grid',
              placeItems: 'center',
              background: isMock ? 'var(--green-tint)' : 'var(--blue-tint)',
              color: isMock ? 'var(--green-dark)' : 'var(--blue-dark)',
            }}
          >
            <IconRobot />
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>
              {robot ? robotPhaseLabel(robot.phase) : '—'}
            </div>
            <div className="muted" style={{ fontSize: 12 }}>
              {robot?.name ?? 'ロボット'}
            </div>
          </div>
        </div>
        <span className={`conn-badge ${isMock ? 'badge-green' : 'badge-blue'}`}>
          <span className="dot dot-pulse" style={{ width: 7, height: 7, borderRadius: '50%', background: 'currentColor' }} />
          {isMock ? 'デモモード' : '実機接続'}
        </span>
      </div>

      {active.length > 0 && (
        <>
          <div className="section-label">進行中の依頼</div>
          {active.map((t) => (
            <TaskCard key={t.id} task={t} />
          ))}
        </>
      )}

      <div className="section-label">完了・履歴</div>
      {finished.length === 0 ? (
        <div className="card">
          <div className="empty">
            <div className="e-emoji"><IconCart size={44} strokeWidth={1.6} /></div>
            <p>まだ搬送履歴はありません。<br />上の「搬送依頼」から作成してください。</p>
          </div>
        </div>
      ) : (
        finished.map((t) => <TaskCard key={t.id} task={t} />)
      )}

      {active.length === 0 && finished.length === 0 && (
        <div style={{ height: 8 }} />
      )}
    </div>
  )
}
