import { useNavigate } from 'react-router-dom'
import { useScreenData } from '../lib/useScreenData'
import { IconPlus } from '../components/icons'
import { LocationBadge } from '../components/LocationBadge'

/**
 * ホーム。入場画面(Entry)と同じ構成: 現在地と「搬送依頼」だけ。
 * ロボットの状態や進行中・履歴の一覧はここに出さない — 依頼一覧で分かることで、
 * ここにも出すとテスト項目が増えるだけ(2026-09-14 の指摘)。
 */
export function Home() {
  useScreenData()
  const navigate = useNavigate()

  return (
    <div>
      <div className="page-head">
        <h1>ホーム</h1>
        <p>荷物を階から階へ届けます</p>
      </div>

      <LocationBadge style={{ marginBottom: 12 }} />

      <button className="btn btn-primary" style={{ marginBottom: 16 }} onClick={() => navigate('/request')}>
        <IconPlus size={20} /> 搬送依頼
      </button>
    </div>
  )
}
