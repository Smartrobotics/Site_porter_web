import { useStore } from '../domain/store'
import { floorLabel, spotLabel } from '../building/types'
import { IconPin, IconAlert } from './icons'

/**
 * 現在地バッジ。
 * 既定では場所QRエントリーで確定した現在地を表示する。
 * 搬送依頼入力画面のように、画面内で搬送元を選び直せる場合は
 * その選択を spotId / floorId で渡す。選び直した瞬間に表示が変わる。
 * どちらも分からないとき(E1-2 / E1-3)は隠さずに「場所不明」と出す。
 */
export function LocationBadge({
  style,
  spotId,
  floorId,
}: {
  style?: React.CSSProperties
  spotId?: string
  floorId?: string
}) {
  const { building, currentSpot } = useStore()

  // 画面から渡された選択を優先する
  const spot = spotId ? building.spots.find((s) => s.id === spotId) : currentSpot
  const floor = spot ? spot.floorId : floorId

  if (!spot && !floor) {
    return (
      <div className="loc-badge loc-unknown" style={style}>
        <span className="loc-pin">
          <IconAlert size={15} />
        </span>
        <span className="loc-text">
          現在地: <strong>場所不明</strong>
          <span className="loc-floor">搬送元を選んでください</span>
        </span>
      </div>
    )
  }

  return (
    <div className="loc-badge" style={style}>
      <span className="loc-pin">
        <IconPin size={15} />
      </span>
      <span className="loc-text">
        現在地: <strong>{spot ? spotLabel(building, spot.id) : floorLabel(building, floor!)}</strong>
        {spot && <span className="loc-floor">({floorLabel(building, spot.floorId)})</span>}
      </span>
    </div>
  )
}
