import { useEffect, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useStore } from '../domain/store'
import { getBuilding } from '../building/sampleBuildings'
import { floorLabel } from '../building/types'
import { IconPin, IconArrow, IconHome, IconAlert } from '../components/icons'

/**
 * 場所QRエントリー画面。
 * `/#/entry?b=<buildingId>&spot=<spotId>` を開くと、建物と現在地をstoreに設定し、
 * ウェルカム(現在地確定)を表示する。インストール・事前設定は不要。
 */
export function Entry() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { setBuildingId, setCurrentSpot } = useStore()

  const buildingId = params.get('b') ?? ''
  const spotId = params.get('spot') ?? ''

  // クエリからの建物/場所を解決(不正値はフォールバック)
  const resolved = useMemo(() => {
    const b = getBuilding(buildingId)
    const spot = b.spots.find((s) => s.id === spotId)
    return { building: b, spot, buildingMatched: b.id === buildingId }
  }, [buildingId, spotId])

  // 開いた瞬間に現在地を確定・永続化
  useEffect(() => {
    if (resolved.buildingMatched) setBuildingId(resolved.building.id)
    if (resolved.spot) setCurrentSpot(resolved.spot.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolved.building.id, resolved.spot?.id])

  const ok = !!resolved.spot
  const floor = resolved.spot ? floorLabel(resolved.building, resolved.spot.floorId) : ''

  return (
    <div className="fade-in">
      <div className="entry-hero">
        <div className="entry-pin">
          <IconPin size={30} />
        </div>
        <h1>ようこそ</h1>
        {ok ? (
          <>
            <p className="entry-sub">現在地を確認しました</p>
            <div className="entry-loc">
              <IconPin size={18} />
              <span>
                現在地: <strong>{resolved.spot!.label}</strong>({floor})
              </span>
            </div>
            <p className="entry-note">{resolved.building.name}</p>
          </>
        ) : (
          <div className="entry-warn">
            <IconAlert size={18} />
            <span>
              現在地を特定できませんでした。
              <br />
              搬送依頼画面で手動で選択してください。
            </span>
          </div>
        )}
      </div>

      <p className="entry-lead muted">
        アプリのインストールや事前設定は不要です。このまま搬送依頼にお進みいただけます。
      </p>

      <button
        className="btn btn-primary"
        style={{ marginTop: 8 }}
        onClick={() => navigate('/request')}
      >
        搬送依頼をはじめる
        <IconArrow size={18} />
      </button>
      <button className="btn btn-ghost" style={{ marginTop: 10 }} onClick={() => navigate('/')}>
        <IconHome size={18} /> ホームへ
      </button>
    </div>
  )
}
