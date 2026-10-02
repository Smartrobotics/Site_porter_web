import { useStore } from '../domain/store'
import { addressLabel, areaLabel, findAddress, floorLabel } from '../domain/master'
import { IconPin, IconAlert } from './icons'

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
