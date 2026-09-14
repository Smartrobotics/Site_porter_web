import { useNavigate } from 'react-router-dom'
import type { TransportTask } from '../domain/types'
import { PhaseBadge, ProgressBar } from './ui'
import { IconArrow } from './icons'
import { areaLabel } from '../domain/master'
import { useStore } from '../domain/store'
import { isActivePhase } from '../domain/phase'
import { relativeTime } from '../lib/format'

export function TaskCard({ task }: { task: TransportTask }) {
  const navigate = useNavigate()
  const { master } = useStore()
  const active = isActivePhase(task.phase)

  return (
    <div className="card card-pad task-card fade-in" onClick={() => navigate(`/task/${task.id}`)}>
      <div className="tc-top">
        <div>
          <div className="tc-route">
            {/* 場所名は途中で折らない。入らなければ「→」の後ろで次の行へ */}
            <span className="place">{areaLabel(master, task.fromAreaId)}</span>
            <span className="arrow">
              <IconArrow size={17} />
            </span>
            <span className="place">{areaLabel(master, task.toAreaId)}</span>
          </div>
          <div className="tc-meta">
            {relativeTime(task.createdAt)}
            {task.recipient ? `・${task.recipient}様宛` : ''}
          </div>
        </div>
        <PhaseBadge phase={task.phase} />
      </div>

      <div className="tc-item">
        {task.kind === 'collect' ? `空荷台（マーカーID: ${task.markerId ?? '-'}）` : task.itemName}
      </div>

      {active && (
        <>
          <div className="tc-progress-row">
            <ProgressBar value={task.progress} phase={task.phase} />
            <span className="pct">{task.progress}%</span>
          </div>
          <div className="tc-meta" style={{ marginTop: 6 }}>
            {task.statusMessage}
          </div>
        </>
      )}
    </div>
  )
}
