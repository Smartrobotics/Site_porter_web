import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../domain/store'
import { useScreenData } from '../lib/useScreenData'
import { floorLabel } from '../building/types'
import type { Cart } from '../domain/types'

/** 1行 = 1つの場所。そこに荷台があるか、あるならどのマーカーか */
interface Row {
  spotId: string
  spotLabel: string
  floor: string
  markerId: string // '' = なし
}

/**
 * 荷台配置初期設定画面。
 * 管理者が「どの場所に、どの荷台が置いてあるか」を最初に入れる画面。
 * データベースを直接いじってもできるが、設定ミスを防ぐためにこの画面を用意する。
 * (実装優先度は低い、と指定されている画面)
 */
export function RackSetup() {
  useScreenData()
  const navigate = useNavigate()
  const { building, carts, updateCart } = useStore()

  const initial = useMemo<Row[]>(
    () =>
      building.spots.map((s) => ({
        spotId: s.id,
        spotLabel: s.label,
        floor: floorLabel(building, s.floorId),
        markerId: carts.find((c) => c.spotId === s.id)?.markerId ?? '',
      })),
    [building, carts],
  )

  const [rows, setRows] = useState<Row[]>(initial)
  const [saved, setSaved] = useState(false)

  const setRow = (spotId: string, markerId: string) => {
    setRows((rs) => rs.map((r) => (r.spotId === spotId ? { ...r, markerId } : r)))
    setSaved(false)
  }

  // 同じ荷台を2か所に置くことはできない
  const duplicated = rows
    .map((r) => r.markerId)
    .filter((m, i, a) => m && a.indexOf(m) !== i)

  const apply = () => {
    // 画面の内容がそのまま配置になる。
    // 選ばれていない荷台は「どこにも置かれていない」扱いにする
    carts.forEach((c) => {
      const spotId = rows.find((r) => r.markerId === c.markerId)?.spotId
      if (spotId !== c.spotId) updateCart({ ...c, spotId } as Cart)
    })
    setSaved(true)
  }

  return (
    <div className="fade-in">
      <div className="page-head">
        <h1>荷台配置初期設定</h1>
        <p>{building.name}</p>
      </div>

      <p className="muted" style={{ fontSize: 12.5, marginBottom: 12 }}>
        どの場所にどの荷台が置いてあるかを設定します。データベースを直接操作しても同じことができますが、
        設定ミスを防ぐためにこの画面から行ってください。
      </p>

      <div className="stack-sm">
        {rows.map((r) => (
          <div key={r.spotId} className="card card-pad">
            <div className="row-between">
              <div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{r.spotLabel}</div>
                <div className="muted" style={{ fontSize: 12 }}>
                  {r.floor}
                </div>
              </div>
              <span className={`badge-pill ${r.markerId ? 'badge-blue' : 'badge-grey'}`}>
                {r.markerId ? 'あり' : 'なし'}
              </span>
            </div>

            <div className="field" style={{ marginTop: 10, marginBottom: 0 }}>
              <label>荷台マーカーID</label>
              <select
                className="select"
                value={r.markerId}
                onChange={(e) => setRow(r.spotId, e.target.value)}
              >
                <option value="">なし</option>
                {carts.map((c) => (
                  <option key={c.id} value={c.markerId}>
                    {c.markerId}({c.label})
                  </option>
                ))}
              </select>
            </div>
          </div>
        ))}
      </div>

      {duplicated.length > 0 && (
        <div className="muted" style={{ fontSize: 12.5, marginTop: 10, color: 'var(--orange-dark)' }}>
          同じ荷台を複数の場所に置くことはできません(マーカーID: {duplicated.join(', ')})
        </div>
      )}

      {saved && (
        <div className="muted" style={{ fontSize: 12.5, marginTop: 10, color: 'var(--green-dark)' }}>
          設定しました。
        </div>
      )}

      <button
        className="btn btn-primary"
        style={{ marginTop: 14 }}
        disabled={duplicated.length > 0}
        onClick={apply}
      >
        設定する
      </button>
      <button className="btn btn-ghost" style={{ marginTop: 10 }} onClick={() => navigate('/settings')}>
        キャンセル
      </button>
    </div>
  )
}
