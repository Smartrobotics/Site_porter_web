import { useStore } from '../domain/store'
import { addressLabel, areaLabel, findAddress, floorLabel } from '../domain/master'
import { IconPin, IconAlert } from './icons'

/**
 * 現在地バッジ。
 * 既定では場所QRエントリーで確定した現在地(エリア)を表示する。
 * 搬送依頼入力画面のように、画面内で搬送元を選び直せる場合は
 * その選択を areaId / addressId で渡す。選び直した瞬間に表示が変わる。
 * どちらも分からないとき(E1-2 / E1-3)は隠さずに「場所不明」と出す。
 */
export function LocationBadge({
  style,
  areaId,
  addressId,
}: {
  style?: React.CSSProperties
  areaId?: number
  addressId?: number
}) {
  const { master, currentArea } = useStore()

  // 画面から渡された選択を優先する
  const address = findAddress(master, addressId)
  const shownAreaId = address ? address.areaId : (areaId ?? currentArea?.id)

  if (shownAreaId === undefined) {
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
        現在地:{' '}
        <strong>{address ? addressLabel(master, address.id) : areaLabel(master, shownAreaId)}</strong>
        <span className="loc-floor">({floorLabel(master, shownAreaId)})</span>
      </span>
    </div>
  )
}
