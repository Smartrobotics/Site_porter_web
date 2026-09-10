import { useNavigate } from 'react-router-dom'
import type { TransportTask } from '../domain/types'
import { PhaseBadge, ProgressBar } from './ui'
import { IconArrow } from './icons'
import { floorLabel } from '../building/types'
import { getBuilding } from '../building/sampleBuildings'
import { isActivePhase } from '../domain/phase'
import { relativeTime } from '../lib/format'

export function TaskCard({ task }: { task: TransportTask }) {
  const navigate = useNavigate()
  const building = getBuilding(task.buildingId)
  const active = isActivePhase(task.phase)

  return (
    <div className="card card-pad task-card fade-in" onClick={() => navigate(`/task/${task.id}`)}>
      <div className="tc-top">
        <div>
          <div className="tc-route">
            {floorLabel(building, task.fromFloorId)}
            <span className="arrow">
              <IconArrow size={17} />
            </span>
            {floorLabel(building, task.toFloorId)}
          </div>
          <div className="tc-meta">
            {relativeTime(task.createdAt)}・{task.recipient} 宛
          </div>
        </div>
        <PhaseBadge phase={task.phase} />
      </div>

      <div className="tc-item">{task.itemName}</div>

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
