import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../domain/store'
import { useScreenData } from '../lib/useScreenData'
import { addressLabel, areaLabel, findRack } from '../domain/master'
import { PollingStamp } from '../components/PollingStamp'
import { PhaseBadge, ProgressBar, PriorityBadge } from '../components/ui'
import { BuildingCrossSection } from '../components/BuildingCrossSection'
import { timelineSteps, phaseIndex } from '../domain/phase'
import { IconCheck, IconAlert, IconArrow } from '../components/icons'
import { formatTime } from '../lib/format'
import { useSmoothProgress } from '../lib/useSmoothProgress'

export function TaskDetail() {
  useScreenData()
  const { id } = useParams()
  const navigate = useNavigate()
  const { tasks, master } = useStore()

  const task = tasks.find((t) => t.id === Number(id))

  // 画面を開いた時点ですでに搬送完了だったか。
  // その場合は通知を出さず、ポーリングもしない(見るものがないため)。
  // 開いている間に完了したときだけ通知を出す。
  const [completedOnOpen] = useState(() => task?.phase === 'completed')
  // 断片ごとに跳ぶ進みを、なめらかに見せる(フックなので早期 return より前に置く)
  const smooth = useSmoothProgress(
    task?.progress ?? 0,
    task?.stepTotal,
    !!task && task.phase !== 'completed' && task.phase !== 'error',
  )
  // 走行中は 99 で止める。100 は完了のときだけ
  const progress = Math.min(task && task.phase !== 'completed' ? 99 : 100, Math.round(smooth))
  if (!task) {
    return (
      <div className="empty" style={{ marginTop: 40 }}>
        <div className="e-emoji"><IconAlert size={44} strokeWidth={1.6} /></div>
        <p>依頼が見つかりませんでした</p>
        <button className="btn btn-ghost btn-sm" style={{ marginTop: 16 }} onClick={() => navigate('/')}>
          ホームへ戻る
        </button>
      </div>
    )
  }
  const fromLabel = areaLabel(master, task.fromAreaId)
  const toLabel = areaLabel(master, task.toAreaId)
  // 回収(system が作る依頼)には荷物が無い。「」ではなく、どの空荷台を戻すかを
  // マーカーIDで出す(荷台に貼ってある番号。依頼一覧の表記と同じ)
  const isCollect = task.kind === 'collect'
  const rack = findRack(master, task.rackId)
  const itemLabel = isCollect
    ? `空荷台（マーカーID: ${task.markerId ?? rack?.markerId ?? '-'}）`
    : task.itemName
  const currentIdx = phaseIndex(task.phase)
  const isCompleted = task.phase === 'completed'
  const isError = task.phase === 'error'
  const isActive = !isCompleted && !isError

  return (
    <div className="fade-in">
      <div className="page-head">
        <div className="row-between">
          <h1>搬送状況</h1>
          <PhaseBadge phase={task.phase} />
        </div>
        <p>
          {fromLabel} → {toLabel}
          {!isCollect && `・${task.itemName}`}
        </p>
        {/* 最初から完了していた場合はポーリングしないので、取得時刻も出さない */}
        {!completedOnOpen && <PollingStamp style={{ marginTop: 6 }} />}
      </div>

      {/* ポーリングで「搬送完了」を受け取った瞬間の通知。
          この画面のポーリングを使い回すので、通知用のポーリングはしない */}
      {isCompleted && !completedOnOpen && task.kind !== 'collect' && (
        <div className="card card-pad fade-in" style={{ marginBottom: 16, borderLeft: '4px solid var(--green)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span
              style={{
                width: 34,
                height: 34,
                borderRadius: 10,
                background: 'var(--green-tint)',
                color: 'var(--green-dark)',
                display: 'grid',
                placeItems: 'center',
                flexShrink: 0,
              }}
            >
              <IconCheck size={18} />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 800, fontSize: 14 }}>搬送が完了しました</div>
              <div className="muted" style={{ fontSize: 12.5 }}>
                「{task.itemName}」が届きました。受け取ったら受取確認を押してください。
              </div>
            </div>
          </div>
          <button
            className="btn btn-ghost btn-sm"
            style={{ marginTop: 10 }}
            onClick={() => navigate('/notifications')}
          >
            通知
          </button>
        </div>
      )}

      {/* 完了演出 */}
      {isCompleted && (
        <div className="celebrate" style={{ marginBottom: 16 }}>
          <div className="c-ring">
            <IconCheck size={34} />
          </div>
          <h3>{isCollect ? '回収完了' : '搬送完了'}</h3>
          <p>
            {isCollect
              ? `${itemLabel}を戻しました`
              : task.recipient && task.recipient !== '未指定'
                ? `「${task.itemName}」を ${task.recipient}様宛にお届けしました`
                : `「${task.itemName}」をお届けしました`}
            {task.completedAt ? `(${formatTime(task.completedAt)})` : ''}
          </p>
        </div>
      )}

      {isError && (
        <div
          className="card card-pad"
          style={{ marginBottom: 16, borderLeft: '4px solid #c62828', display: 'flex', gap: 12 }}
        >
          <div style={{ color: '#c62828', flexShrink: 0 }}>
            <IconAlert />
          </div>
          <div>
            <div style={{ fontWeight: 700, color: '#c62828' }}>搬送を継続できませんでした</div>
            <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
              {task.statusMessage}
            </div>
          </div>
        </div>
      )}

      {/* 建物断面イラスト */}
      <div className="card" style={{ padding: '12px 8px 0' }}>
        <BuildingCrossSection
          fromLabel={fromLabel}
          toLabel={toLabel}
          progress={smooth}
          phase={task.phase}
          fragmentKind={task.fragmentKind}
          fragmentSeq={task.fragmentSeq}
          stepTotal={task.stepTotal}
          robotFloor={task.robotFloor}
          action={task.action}
          actionIndex={task.actionIndex}
        />
      </div>

      {/* 進捗バー */}
      {isActive && (
        <div className="card card-pad" style={{ marginTop: 12 }}>
          <div className="row-between" style={{ marginBottom: 10 }}>
            <span style={{ fontWeight: 700, fontSize: 14 }}>{task.statusMessage}</span>
            <span style={{ fontWeight: 800, color: 'var(--orange-dark)' }}>{progress}%</span>
          </div>
          <ProgressBar value={progress} phase={task.phase} />
        </div>
      )}

      {/* タイムライン */}
      <div className="section-label">搬送タイムライン</div>
      <div className="card card-pad">
        <div className="timeline">
          {timelineSteps(task.kind).map((step) => {
            const idx = phaseIndex(step.phase)
            const done = isCompleted || idx < currentIdx
            const active = !isCompleted && idx === currentIdx && isActive
            const cls = done ? 'done' : active ? 'active' : 'pending'
            return (
              <div key={step.phase} className={`tl-step ${cls}`}>
                <span className="node">{done && <IconCheck size={14} />}</span>
                <span className="line" />
                <div className="tl-title">{step.title}</div>
                {active && <div className="tl-time">進行中…</div>}
                {done && step.phase === 'completed' && task.completedAt && (
                  <div className="tl-time">{formatTime(task.completedAt)}</div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* 依頼内容 */}
      <div className="section-label">依頼内容</div>
      <div className="card card-pad">
        <div className="kv" style={{ borderTop: 'none' }}>
          <span className="k">経路</span>
          <span className="v" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {fromLabel}
            <IconArrow size={14} />
            {toLabel}
          </span>
        </div>
        <div className="kv">
          <span className="k">集積 / 受渡</span>
          <span className="v">
            {addressLabel(master, task.fromAddressId)} / {addressLabel(master, task.toAddressId)}
          </span>
        </div>
        {/* 回収には荷物も受取人も無い。荷台は見出しに出ている */}
        {!isCollect && (
          <>
            <div className="kv">
              <span className="k">荷物</span>
              <span className="v">{task.itemName}</span>
            </div>
            <div className="kv">
              <span className="k">送り状番号</span>
              <span className="v mono">{task.trackingNo || '—'}</span>
            </div>
            <div className="kv">
              <span className="k">受取人</span>
              <span className="v">{task.recipient}</span>
            </div>
            <div className="kv">
              <span className="k">優先度</span>
              <span className="v">
                <PriorityBadge priority={task.priority} />
              </span>
            </div>
          </>
        )}
      </div>

      {/* 画面下にボタンは置かない。「搬送を中止する」は配送員が押すものと誤解されるため
          管理者用の依頼取消(設定 → 依頼一覧)だけに残し、ホームへは下のタブで戻る */}
    </div>
  )
}
