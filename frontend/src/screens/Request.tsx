import { useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '../domain/store'
import { SAMPLE_PEOPLE } from '../domain/people'
import type { Priority } from '../domain/types'
import { findRoute, spotsOnFloor } from '../building/types'
import { IconArrow, IconCamera } from '../components/icons'
import { LocationBadge } from '../components/LocationBadge'

const PRIORITIES: { value: Priority; label: string; cls: string }[] = [
  { value: 'urgent', label: '高', cls: 'on-urgent' },
  { value: 'normal', label: '中', cls: 'on-normal' },
  { value: 'low', label: '低', cls: 'on-low' },
]

interface FormState {
  cartId: string
  markerId: string
  trackingNo: string
  fromFloorId: string
  toFloorId: string
  fromSpotId?: string
  toSpotId?: string
  itemName: string
  recipient: string
  priority: Priority
}

interface LocationState {
  cartId?: string
  /** 内容確認画面から「戻る」で返ってきたときの入力内容 */
  form?: FormState
}

/** 統合ロケーション値のエンコード/デコード: `floorId` または `floorId:spotId` */
function encodeLoc(floorId: string, spotId?: string): string {
  return spotId ? `${floorId}:${spotId}` : floorId
}
function decodeLoc(value: string): { floorId: string; spotId?: string } {
  const [floorId, spotId] = value.split(':')
  return { floorId, spotId: spotId || undefined }
}

export function Request() {
  const navigate = useNavigate()
  const location = useLocation()
  const { building, carts, currentSpot, setCurrentSpot } = useStore()

  const state = (location.state as LocationState | null) ?? {}
  const cart = carts.find((c) => c.id === (state.form?.cartId ?? state.cartId)) ?? carts[0]

  const floors = building.floors

  // 「戻る」で返ってきたときは入力内容を復元する。
  // 初回は搬送元を現在地(場所QR由来)で初期化する
  const back = state.form
  // 現在地が分からないときは既定の階を入れない。空のままにして「場所不明」を出す
  const initialFrom = back
    ? encodeLoc(back.fromFloorId, back.fromSpotId)
    : currentSpot
      ? encodeLoc(currentSpot.floorId, currentSpot.id)
      : ''
  const initialTo = back
    ? encodeLoc(back.toFloorId, back.toSpotId)
    : encodeLoc(floors[1]?.id ?? floors[0]?.id ?? '')

  const [fromLoc, setFromLoc] = useState(initialFrom)
  const [toLoc, setToLoc] = useState(initialTo)
  const [markerId, setMarkerId] = useState(back?.markerId ?? cart?.markerId ?? '')
  const [trackingNo, setTrackingNo] = useState(back?.trackingNo ?? '')
  const [itemName, setItemName] = useState(back?.itemName ?? '')
  const [recipient, setRecipient] = useState(back?.recipient ?? '')
  const [priority, setPriority] = useState<Priority>(back?.priority ?? 'normal')

  const from = decodeLoc(fromLoc)
  const to = decodeLoc(toLoc)

  const fromUnknown = !fromLoc
  const sameFloor = !fromUnknown && from.floorId === to.floorId
  const route = findRoute(building, from.floorId, to.floorId)
  const routeMissing = !fromUnknown && !sameFloor && !route

  // 荷物名は任意(必須解除)。妥当な経路であれば送信可能
  const canSubmit = !fromUnknown && !sameFloor && !routeMissing


  /** いま入力されている内容。カメラへ行くときも内容確認へ行くときも同じものを渡す */
  const formState = () => ({
    cartId: cart.id,
    markerId: markerId.trim(),
    trackingNo: trackingNo.trim(),
    fromFloorId: from.floorId,
    toFloorId: to.floorId,
    fromSpotId: from.spotId,
    toSpotId: to.spotId,
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
        <p>{building.name}</p>
      </div>

      <LocationBadge style={{ marginBottom: 14 }} spotId={from.spotId} floorId={from.floorId || undefined} />

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
          value={markerId}
          onChange={(e) => setMarkerId(e.target.value)}
          aria-label="マーカーID"
        />
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
            <LocationSelect
              value={fromLoc}
              onChange={(v) => {
                setFromLoc(v)
                // 手で選び直したら、それが現在地。次に画面へ戻っても残る
                setCurrentSpot(decodeLoc(v).spotId)
              }}
              building={building}
            />
          </div>
          <div className="dir-arrow" aria-hidden="true">
            <IconArrow size={18} />
          </div>
          <div>
            <LocationSelect value={toLoc} onChange={setToLoc} building={building} />
          </div>
        </div>
        {fromUnknown && (
          <div className="muted" style={{ fontSize: 12, color: 'var(--orange-dark)', marginTop: 6 }}>
            現在地が分かりませんでした。搬送元を選んでください
          </div>
        )}
        {sameFloor && (
          <div className="muted" style={{ fontSize: 12, color: 'var(--orange-dark)', marginTop: 6 }}>
            搬送元と搬送先の階を別々に指定してください
          </div>
        )}
        {routeMissing && (
          <div className="muted" style={{ fontSize: 12, color: 'var(--orange-dark)', marginTop: 6 }}>
            この階間の経路マッピングが未定義です
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
          {recipient && !SAMPLE_PEOPLE.some((p) => p.name === recipient) && (
            <option value={recipient}>{recipient}(名簿にありません)</option>
          )}
          {SAMPLE_PEOPLE.map((p) => (
            <option key={p.id} value={p.name}>
              {p.name}({p.role})
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

/** 場所主体の統合セレクタ: 階(optgroup)ごとに「階のみ」+その階の場所を列挙 */
function LocationSelect({
  value,
  onChange,
  building,
}: {
  value: string
  onChange: (v: string) => void
  building: import('../building/types').BuildingProfile
}) {
  const groups = useMemo(
    () => building.floors.map((f) => ({ floor: f, spots: spotsOnFloor(building, f.id) })),
    [building],
  )
  return (
    <select className="select" value={value} onChange={(e) => onChange(e.target.value)}>
      {value === '' && <option value="">場所不明 — 選んでください</option>}
      {groups.map(({ floor, spots }) => (
        <optgroup key={floor.id} label={floor.label}>
          <option value={encodeLoc(floor.id)}>{floor.label}(階のみ)</option>
          {spots.map((s) => (
            <option key={s.id} value={encodeLoc(floor.id, s.id)}>
              {s.label}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}
