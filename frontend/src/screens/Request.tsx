import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '../domain/store'
import type { Priority } from '../domain/types'
import { areaLabel, SITE_NAME, type Area } from '../domain/master'
import { IconArrow, IconCamera } from '../components/icons'
import { LocationBadge } from '../components/LocationBadge'

const PRIORITIES: { value: Priority; label: string; cls: string }[] = [
  { value: 'urgent', label: '高', cls: 'on-urgent' },
  { value: 'normal', label: '中', cls: 'on-normal' },
  { value: 'low', label: '低', cls: 'on-low' },
]

/**
 * 入力途中の内容。カメラ画面へ行って戻ってくる間もこれを持ち回る。
 * 番地(address)は入っていない。番地を決めるのはサーバーの仕事で、
 * 配送員が選ぶのはエリアまで。
 */
export interface FormState {
  rackId: number
  /** 入力欄の値なので文字列のまま持つ。数値に直すのは送信時 */
  markerId: string
  trackingNo: string
  /** 0 = 未選択 */
  fromAreaId: number
  toAreaId: number
  itemName: string
  recipient: string
  priority: Priority
}

interface LocationState {
  rackId?: number
  /** 内容確認画面から「戻る」で返ってきたときの入力内容 */
  form?: FormState
}

export function Request() {
  const navigate = useNavigate()
  const location = useLocation()
  const { racks, users, currentArea, setCurrentArea, areas, master, tasks } = useStore()

  const state = (location.state as LocationState | null) ?? {}

  // 「戻る」で返ってきたときは入力内容を復元する。
  // 初回は搬送元を現在地(壁QR由来)で初期化する
  const back = state.form
  // 現在地が分からないときは既定値を入れない。0 のままにして「場所不明」を出す
  const initialFrom = back ? back.fromAreaId : (currentArea?.id ?? 0)
  const initialTo = back
    ? back.toAreaId
    : (areas.find((a) => a.id !== initialFrom)?.id ?? 0)

  const [fromAreaId, setFromAreaId] = useState(initialFrom)
  const [toAreaId, setToAreaId] = useState(initialTo)
  // 最初はどれでもよいので先頭の荷台。カメラで読んだらそのマーカーが入る
  const initialRack = racks.find((r) => r.id === (back?.rackId ?? state.rackId)) ?? racks[0]
  const [markerId, setMarkerId] = useState(back?.markerId ?? String(initialRack?.markerId ?? ''))
  const [trackingNo, setTrackingNo] = useState(back?.trackingNo ?? '')
  const [itemName, setItemName] = useState(back?.itemName ?? '')
  const [recipient, setRecipient] = useState(back?.recipient ?? '')
  const [priority, setPriority] = useState<Priority>(back?.priority ?? 'normal')

  // 運ぶ荷台はマーカーIDで決まる。手入力でもカメラでも同じ
  const rack = racks.find((r) => String(r.markerId) === markerId.trim())
  const markerUnknown = markerId.trim() !== '' && !rack
  // 荷台が別のエリアにある場合、その荷台は目の前に無い
  const rackElsewhere = !!rack && rack.areaId !== undefined && rack.areaId !== fromAreaId

  // 送り状番号は二重送信の検査キー。送る前に気づけるようにする
  const trackingTaken = trackingNo.trim()
    ? tasks.find((t) => t.trackingNo === trackingNo.trim())
    : undefined

  const fromUnknown = fromAreaId === 0
  const sameArea = !fromUnknown && fromAreaId === toAreaId

  // 荷物名は任意。搬送元と搬送先が別のエリアなら送信できる
  const canSubmit =
    !fromUnknown &&
    toAreaId !== 0 &&
    !sameArea &&
    !!rack &&
    !markerUnknown &&
    !rackElsewhere &&
    !trackingTaken


  /** いま入力されている内容。カメラへ行くときも内容確認へ行くときも同じものを渡す */
  const formState = (): FormState => ({
    rackId: rack?.id ?? 0,
    markerId: markerId.trim(),
    trackingNo: trackingNo.trim(),
    fromAreaId,
    toAreaId,
    itemName: itemName.trim(),
    recipient: recipient.trim(),
    priority,
  })

  // 送信はまだしない。内容確認画面へ渡すだけ
  const submit = () => {
    if (!canSubmit) return
    navigate('/request/confirm', { state: formState() })
  }

  return (
    <div className="fade-in">
      <div className="page-head">
        <h1>搬送依頼</h1>
        <p>{SITE_NAME}</p>
      </div>

      <LocationBadge style={{ marginBottom: 14 }} areaId={fromAreaId || undefined} />

      {/* 荷台のマーカー読み取り */}
      <button
        className="btn btn-ghost btn-scan"
        onClick={() => navigate('/scan', { state: { form: formState() } })}
      >
        荷台のマーカーを読み取る
        <span className="cam">
          <IconCamera size={21} />
        </span>
      </button>

      <div className="field">
        <label>マーカーID</label>
        <input
          className="input"
          inputMode="numeric"
          value={markerId}
          onChange={(e) => setMarkerId(e.target.value)}
          aria-label="マーカーID"
        />
        {markerUnknown && (
          <div className="muted" style={{ fontSize: 12, color: 'var(--orange-dark)', marginTop: 6 }}>
            マーカーID {markerId.trim()} の荷台は登録されていません
          </div>
        )}
        {rackElsewhere && (
          <div className="muted" style={{ fontSize: 12, color: 'var(--orange-dark)', marginTop: 6 }}>
            この荷台は {areaLabel(master, rack!.areaId)} にあります。搬送元を選び直してください
          </div>
        )}
      </div>

      {/* 伝票QRコード読み取り */}
      <button
        className="btn btn-ghost btn-scan"
        style={{ marginBottom: 16 }}
        onClick={() => navigate('/slip-scan', { state: { form: formState() } })}
      >
        伝票QRコードを読み取る
        <span className="cam">
          <IconCamera size={21} />
        </span>
      </button>

      {/* 統合ロケーションセレクタ(場所主体) */}
      <div className="field">
        <label>搬送元 → 搬送先</label>
        <div className="floor-row">
          <div>
            <AreaSelect
              value={fromAreaId}
              onChange={(v) => {
                setFromAreaId(v)
                // 手で選び直したら、それが現在地。次に画面へ戻っても残る
                setCurrentArea(v || undefined)
              }}
              areas={areas}
            />
          </div>
          <div className="dir-arrow" aria-hidden="true">
            <IconArrow size={18} />
          </div>
          <div>
            <AreaSelect value={toAreaId} onChange={setToAreaId} areas={areas} />
          </div>
        </div>
        {fromUnknown && (
          <div className="muted" style={{ fontSize: 12, color: 'var(--orange-dark)', marginTop: 6 }}>
            現在地が分かりませんでした。搬送元を選んでください
          </div>
        )}
        {sameArea && (
          <div className="muted" style={{ fontSize: 12, color: 'var(--orange-dark)', marginTop: 6 }}>
            搬送元と搬送先を別々のエリアにしてください
          </div>
        )}
      </div>

      {/* 荷物名(任意) */}
      <div className="field">
        <label>荷物名</label>
        <input
          className="input"
          placeholder="伝票QRから自動入力されます"
          value={itemName}
          onChange={(e) => setItemName(e.target.value)}
        />
      </div>

      {/* 受取人: 登録済みの人から選ぶ */}
      <div className="field">
        <label>受取人</label>
        <select className="select" value={recipient} onChange={(e) => setRecipient(e.target.value)}>
          <option value="">未選択</option>
          {/* 伝票QRの受取人が名簿にない場合も、伝票の記載をそのまま残す */}
          {recipient && !users.some((u) => u.name === recipient) && (
            <option value={recipient}>{recipient}(名簿にありません)</option>
          )}
          {users.map((u) => (
            <option key={u.id} value={u.name}>
              {u.name}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label>送り状番号</label>
        <input
          className="input"
          placeholder="伝票QRから自動入力されます"
          value={trackingNo}
          onChange={(e) => setTrackingNo(e.target.value)}
        />
        {trackingTaken && (
          <div className="muted" style={{ fontSize: 12, color: 'var(--orange-dark)', marginTop: 6 }}>
            この送り状番号は依頼 #{trackingTaken.id} で受け付けています(二重送信の防止)
          </div>
        )}
      </div>

      {/* 優先度 */}
      <div className="field">
        <label>優先度</label>
        <div className="segmented">
          {PRIORITIES.map((p) => (
            <button
              key={p.value}
              className={`seg${priority === p.value ? ' ' + p.cls : ''}`}
              onClick={() => setPriority(p.value)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <button className="btn btn-primary" style={{ marginTop: 8 }} disabled={!canSubmit} onClick={submit}>
        搬送を依頼する
      </button>
    </div>
  )
}

/** エリアの選択。配送員が選ぶのはここまでで、番地はサーバーが決める */
function AreaSelect({
  value,
  onChange,
  areas,
}: {
  value: number
  onChange: (v: number) => void
  areas: Area[]
}) {
  return (
    <select
      className="select"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
    >
      {value === 0 && <option value={0}>場所不明 — 選んでください</option>}
      {areas.map((a) => (
        <option key={a.id} value={a.id}>
          {a.label}
        </option>
      ))}
    </select>
  )
}
