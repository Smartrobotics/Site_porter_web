import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../domain/store'
import { useScreenData } from '../lib/useScreenData'
import { floorLabel, SITE_NAME } from '../domain/master'

/** 1行 = 1つの番地。そこに荷台があるか、あるならどのマーカーか */
interface Row {
  addressId: number
  addressLabel: string
  floor: string
  /** 0 = なし。select は文字列を返すので数値に直して持つ */
  markerId: number
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
  const { master, addresses, racks, savePlacement } = useStore()

  const initial = useMemo<Row[]>(
    () =>
      addresses.map((a) => ({
        addressId: a.id,
        addressLabel: a.label,
        floor: floorLabel(master, a.areaId),
        markerId: racks.find((r) => r.addressId === a.id)?.markerId ?? 0,
      })),
    [master, addresses, racks],
  )

  const [rows, setRows] = useState<Row[]>(initial)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const setRow = (addressId: number, markerId: number) => {
    setRows((rs) => rs.map((r) => (r.addressId === addressId ? { ...r, markerId } : r)))
    setSaved(false)
    setError(null)
  }

  /** 搬送中の荷台は番地に載っていない。この画面では動かせない */
  const inTransit = racks.filter((r) => r.addressId === undefined)
  /** 置き場所が選ばれていない荷台。サーバーは「置き場所のない荷台」を許さない */
  const unplaced = racks.filter(
    (r) => r.addressId !== undefined && !rows.some((row) => row.markerId === r.markerId),
  )

  // 同じ荷台を2か所に置くことはできない
  const duplicated = rows
    .map((r) => r.markerId)
    .filter((m, i, a) => m !== 0 && a.indexOf(m) !== i)

  const apply = async () => {
    setSaving(true)
    setError(null)
    // 画面の内容をそのまま配置として送る。1台ずつではなく一度に。
    // 入れ替え(AをBの場所へ、BをAの場所へ)を途中で衝突させないため
    const items = rows
      .filter((r) => r.markerId !== 0)
      .map((r) => ({
        rackId: racks.find((rk) => rk.markerId === r.markerId)?.id ?? 0,
        addressId: r.addressId,
      }))
      .filter((i) => i.rackId !== 0)
    try {
      await savePlacement(items)
      setSaved(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : '設定できませんでした')
    }
    setSaving(false)
  }

  return (
    <div className="fade-in">
      <div className="page-head">
        <h1>荷台配置初期設定</h1>
        <p>{SITE_NAME}</p>
      </div>

      <p className="muted" style={{ fontSize: 12.5, marginBottom: 12 }}>
        どの場所にどの荷台が置いてあるかを設定します。データベースを直接操作しても同じことができますが、
        設定ミスを防ぐためにこの画面から行ってください。
      </p>

      <div className="stack-sm">
        {rows.map((r) => (
          <div key={r.addressId} className="card card-pad">
            <div className="row-between">
              <div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{r.addressLabel}</div>
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
                onChange={(e) => setRow(r.addressId, Number(e.target.value))}
              >
                <option value={0}>なし</option>
                {racks.map((rk) => (
                  <option key={rk.id} value={rk.markerId}>
                    {rk.markerId}({rk.label})
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

      {unplaced.length > 0 && (
        <div className="muted" style={{ fontSize: 12.5, marginTop: 10, color: 'var(--orange-dark)' }}>
          置き場所が選ばれていない荷台があります(マーカーID:{' '}
          {unplaced.map((r) => r.markerId).join(', ')})。すべての荷台に番地を割り当ててください。
        </div>
      )}

      {inTransit.length > 0 && (
        <div className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>
          搬送中の荷台はこの画面では動かせません(マーカーID:{' '}
          {inTransit.map((r) => r.markerId).join(', ')})
        </div>
      )}

      {error && (
        <div className="muted" style={{ fontSize: 12.5, marginTop: 10, color: 'var(--orange-dark)' }}>
          {error}
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
        disabled={duplicated.length > 0 || unplaced.length > 0 || saving}
        onClick={() => void apply()}
      >
        {saving ? '設定しています…' : '設定する'}
      </button>
      <button className="btn btn-ghost" style={{ marginTop: 10 }} onClick={() => navigate('/settings')}>
        キャンセル
      </button>
    </div>
  )
}
