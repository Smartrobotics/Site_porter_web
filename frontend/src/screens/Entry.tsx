import { useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useStore } from '../domain/store'
import { findArea, floorLabel, SITE_NAME } from '../domain/master'
import { IconPin, IconArrow, IconHome, IconAlert } from '../components/icons'

/**
 * 場所QRエントリー画面。
 * `/#/entry?area=<area_id>` を開くと現在地をstoreに設定し、ウェルカムを表示する。
 * 壁のQRコードに入っているのは area.id の数字ひとつ(1エリアに1枚)。
 * 未登録のIDだった場合(E1-2 / E1-3)は隠さずに知らせ、依頼画面で選び直してもらう。
 */
export function Entry() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { master, masterLoaded, setCurrentArea } = useStore()

  const raw = params.get('area')
  const areaId = raw && /^\d+$/.test(raw) ? Number(raw) : undefined
  const area = findArea(master, areaId)

  // 開いた瞬間に現在地を確定・永続化(マスタが届いてから)
  useEffect(() => {
    if (area) setCurrentArea(area.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [area?.id])

  if (!masterLoaded) {
    return (
      <div className="fade-in">
        <p className="muted">読み込み中</p>
      </div>
    )
  }

  return (
    <div className="fade-in">
      <div className="entry-hero">
        <div className="entry-pin">
          <IconPin size={30} />
        </div>
        <h1>ようこそ</h1>
        {area ? (
          <>
            <p className="entry-sub">現在地を確認しました</p>
            <div className="entry-loc">
              <IconPin size={18} />
              <span>
                現在地: <strong>{area.label}</strong>({floorLabel(master, area.id)})
              </span>
            </div>
            <p className="entry-note">{SITE_NAME}</p>
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
