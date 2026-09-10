import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import QRCode from 'qrcode'
import { useStore } from '../domain/store'
import { SAMPLE_BUILDINGS } from '../building/sampleBuildings'
import { floorLabel } from '../building/types'
import type { BuildingProfile, SpotDef } from '../building/types'
import type { Cart } from '../domain/types'
import type { RobotAdapterKind } from '../robot'
import { IconCart, IconCheck, IconAlert, IconPlus, IconQr, IconClose, IconPin } from '../components/icons'

/** 場所QRのエントリーURL(スマホ標準カメラで読む → ブラウザで現在地確定) */
function entryUrl(buildingId: string, spotId: string): string {
  const base = window.location.origin + window.location.pathname
  return `${base}#/entry?b=${encodeURIComponent(buildingId)}&spot=${encodeURIComponent(spotId)}`
}

export function Settings() {
  const navigate = useNavigate()
  const {
    building,
    setBuildingId,
    carts,
    updateCart,
    addCart,
    robotConfig,
    setRobotConfig,
    checkRobotConnection,
    demoError,
    setDemoError,
    demoOffline,
    setDemoOffline,
  } = useStore()

  const [urlDraft, setUrlDraft] = useState(robotConfig.atmobiUrl)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; detail: string } | null>(null)

  const chooseKind = (kind: RobotAdapterKind) => {
    setRobotConfig({ kind, atmobiUrl: urlDraft })
    setTestResult(null)
  }

  const runTest = async () => {
    setTesting(true)
    setTestResult(null)
    const res = await checkRobotConnection({ kind: 'atmobi', atmobiUrl: urlDraft })
    setTestResult(res)
    setTesting(false)
    if (robotConfig.kind === 'atmobi') {
      setRobotConfig({ kind: 'atmobi', atmobiUrl: urlDraft })
    }
  }

  return (
    <div className="fade-in">
      <div className="page-head">
        <h1>設定</h1>
        <p>建物・荷台・ロボット連携の構成</p>
      </div>

      {/* ---------- 建物プロファイル ---------- */}
      <div className="section-label">建物プロファイル</div>
      <div className="card card-pad">
        <div className="field" style={{ marginBottom: 12 }}>
          <label>現在の建物</label>
          <select
            className="select"
            value={building.id}
            onChange={(e) => setBuildingId(e.target.value)}
          >
            {SAMPLE_BUILDINGS.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>

        <div className="row-between" style={{ marginBottom: 6 }}>
          <span className="muted" style={{ fontSize: 12, fontWeight: 700 }}>階</span>
          <span className="muted" style={{ fontSize: 12 }}>{building.floors.length} 階</span>
        </div>
        <div className="chip-grid" style={{ marginBottom: 12 }}>
          {building.floors.map((f) => (
            <span key={f.id} className="chip" style={{ height: 32, fontSize: 12.5 }}>
              {f.label}
            </span>
          ))}
        </div>

        <div className="muted" style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>場所</div>
        <div className="chip-grid" style={{ marginBottom: 14 }}>
          {building.spots.map((s) => (
            <span key={s.id} className="chip" style={{ height: 32, fontSize: 12 }}>
              {s.label}
            </span>
          ))}
        </div>

        <div className="muted" style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
          経路マッピング(ロボット地図/経路番号)
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="map-table">
            <thead>
              <tr>
                <th>経路</th>
                <th>map_no</th>
                <th>path_no</th>
              </tr>
            </thead>
            <tbody>
              {building.routes.map((r) => (
                <tr key={`${r.fromFloorId}-${r.toFloorId}`}>
                  <td>
                    {floorLabel(building, r.fromFloorId)} → {floorLabel(building, r.toFloorId)}
                  </td>
                  <td className="mono">{r.mapNo}</td>
                  <td className="mono">{r.pathNo}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="divider" />
        <button className="btn btn-ghost" disabled title="将来対応予定">
          BIMデータ読込(将来対応)
        </button>
      </div>

      {/* ---------- 場所QRの発行 ---------- */}
      {/* ---------- デモ用: エラーの再現 ---------- */}
      <div className="section-label">デモ用: エラーの再現</div>
      <div className="card card-pad" style={{ marginBottom: 18 }}>
        <p className="muted" style={{ fontSize: 12.5, marginBottom: 12 }}>
          E6 / E8 は受け付けを断り、エラーモーダルを出します。[ 閉じる ] で内容確認画面に戻り、そのまま送信し直せます。
          E7 はモーダルを出さず、受け付けて順番待ちにします(空き場所ができたら走ります)。
          E9(ロボットが実行中)は設定なしで再現できます — 搬送中にもう1件依頼すれば順番待ちになります。
        </p>
        <div className="segmented">
          {(
            [
              { v: 'none', label: 'なし', hint: '通常' },
              { v: 'e6', label: 'E6', hint: 'サーバー接続不可' },
              { v: 'e8', label: 'E8', hint: '荷台が使用中' },
              { v: 'e7', label: 'E7', hint: '空き場所なし' },
            ] as const
          ).map((o) => (
            <button
              key={o.v}
              className={`seg${demoError === o.v ? (o.v === 'none' ? ' on-normal' : ' on-urgent') : ''}`}
              onClick={() => setDemoError(o.v)}
            >
              {o.label}
              <small>{o.hint}</small>
            </button>
          ))}
        </div>
        {demoError !== 'none' && (
          <p className="muted" style={{ fontSize: 12, marginTop: 10, color: 'var(--orange-dark)' }}>
            {demoError === 'e7'
              ? '現在、依頼は受け付けますが走らせません(順番待ちのまま)。デモが終わったら「なし」に戻してください。'
              : '現在、搬送依頼の送信は必ず失敗します。デモが終わったら「なし」に戻してください。'}
          </p>
        )}
      </div>

      {/* ---------- デモ用: 通信断 ---------- */}
      <div className="section-label">デモ用: 通信断(E10 と 画面遷移時のエラー)</div>
      <div className="card card-pad" style={{ marginBottom: 18 }}>
        <p className="muted" style={{ fontSize: 12.5, marginBottom: 12 }}>
          サーバーとの通信を失敗させ続けます。2つの扱いの違いが確認できます。
          ポーリング(E10)はエラーを出さず「搬送状況取得時刻」が止まるだけ。
          画面遷移時の取得は共通のモーダル「サーバと通信できませんでした…」を出します。
        </p>
        <div className="segmented">
          {(
            [
              { v: false, label: '通信あり', hint: '通常' },
              { v: true, label: '通信断', hint: '取得が失敗し続ける' },
            ] as const
          ).map((o) => (
            <button
              key={String(o.v)}
              className={`seg${demoOffline === o.v ? (o.v ? ' on-urgent' : ' on-normal') : ''}`}
              onClick={() => setDemoOffline(o.v)}
            >
              {o.label}
              <small>{o.hint}</small>
            </button>
          ))}
        </div>
        {demoOffline && (
          <p className="muted" style={{ fontSize: 12, marginTop: 10, color: 'var(--orange-dark)' }}>
            現在、サーバーとの通信は失敗し続けます。デモが終わったら「通信あり」に戻してください。
          </p>
        )}
      </div>

      <SpotQrSection building={building} />

      {/* ---------- 荷台 ⇔ マーカーID ---------- */}
      {/* ---------- 荷台配置初期設定 ---------- */}
      <div className="section-label">荷台の配置</div>
      <div className="card card-pad" style={{ marginBottom: 18 }}>
        <p className="muted" style={{ fontSize: 12.5, marginBottom: 12 }}>
          どの場所にどの荷台が置いてあるかを設定します。運用を始める前に一度だけ行います。
        </p>
        <button className="btn btn-ghost" onClick={() => navigate('/rack-setup')}>
          <IconCart size={19} /> 荷台配置初期設定
        </button>
      </div>

      {/* ---------- 管理者用 ---------- */}
      <div className="section-label">管理者用</div>
      <div className="card card-pad" style={{ marginBottom: 18 }}>
        <p className="muted" style={{ fontSize: 12.5, marginBottom: 12 }}>
          搬送の途中でロボットやエレベータに問題が起きたとき、依頼を取り消して立て直します。
        </p>
        <button className="btn btn-ghost" onClick={() => navigate('/admin/requests')}>
          <IconAlert size={19} /> 依頼管理(取消)
        </button>
      </div>

      <div className="section-label">荷台 ⇔ マーカーID 割当</div>
      <div className="stack-sm">
        {carts.map((c) => (
          <CartEditor key={c.id} cart={c} onSave={updateCart} />
        ))}
        <AddCartRow onAdd={addCart} nextIndex={carts.length + 1} />
      </div>

      {/* ---------- ロボットアダプタ ---------- */}
      <div className="section-label">ロボット連携</div>
      <div className="card card-pad">
        <div className="segmented" style={{ marginBottom: 14 }}>
          <button
            className={`seg${robotConfig.kind === 'mock' ? ' on-normal' : ''}`}
            onClick={() => chooseKind('mock')}
          >
            デモ (Mock)
            <small>ローカル疑似再生</small>
          </button>
          <button
            className={`seg${robotConfig.kind === 'atmobi' ? ' on-normal' : ''}`}
            onClick={() => chooseKind('atmobi')}
          >
            宅配ロボット 実機
            <small>ロボットAPI接続</small>
          </button>
        </div>

        {robotConfig.kind === 'atmobi' && (
          <div className="fade-in">
            <div className="field">
              <label>ロボット接続先URL</label>
              <input
                className="input"
                value={urlDraft}
                onChange={(e) => setUrlDraft(e.target.value)}
                placeholder="http://localhost:5000"
              />
            </div>
            <button className="btn btn-blue" disabled={testing} onClick={runTest}>
              {testing ? '接続テスト中…' : '接続テスト'}
            </button>

            {testResult && (
              <div
                className="card-pad"
                style={{
                  marginTop: 12,
                  borderRadius: 12,
                  display: 'flex',
                  gap: 10,
                  alignItems: 'flex-start',
                  background: testResult.ok ? 'var(--green-tint)' : '#fdeaea',
                  color: testResult.ok ? 'var(--green-dark)' : '#c62828',
                }}
              >
                {testResult.ok ? <IconCheck size={20} /> : <IconAlert size={20} />}
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13.5 }}>
                    {testResult.ok ? '接続成功' : '接続失敗'}
                  </div>
                  <div style={{ fontSize: 12.5, marginTop: 2 }}>{testResult.detail}</div>
                </div>
              </div>
            )}
          </div>
        )}

        {robotConfig.kind === 'mock' && (
          <div className="muted" style={{ fontSize: 12.5 }}>
            デモモードでは搬送フェーズをローカルで疑似再生します。実機接続は不要です。
          </div>
        )}
      </div>

      <div style={{ height: 8 }} />
    </div>
  )
}

function CartEditor({ cart, onSave }: { cart: Cart; onSave: (c: Cart) => void }) {
  const [label, setLabel] = useState(cart.label)
  const [markerId, setMarkerId] = useState(cart.markerId)
  const dirty = label !== cart.label || markerId !== cart.markerId

  return (
    <div className="card card-pad">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <div
          style={{
            width: 34,
            height: 34,
            borderRadius: 9,
            background: 'var(--blue-tint)',
            color: 'var(--blue-dark)',
            display: 'grid',
            placeItems: 'center',
          }}
        >
          <IconCart size={18} />
        </div>
        <input
          className="input"
          style={{ height: 40 }}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
      </div>
      <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--navy-soft)' }}>マーカーID</label>
      <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
        <input
          className="input mono"
          style={{ height: 44 }}
          value={markerId}
          onChange={(e) => setMarkerId(e.target.value)}
        />
        <button
          className="btn btn-blue btn-sm"
          style={{ minWidth: 64 }}
          disabled={!dirty || !markerId.trim()}
          onClick={() => onSave({ ...cart, label: label.trim() || cart.label, markerId: markerId.trim() })}
        >
          保存
        </button>
      </div>
    </div>
  )
}

function AddCartRow({ onAdd, nextIndex }: { onAdd: (c: Cart) => void; nextIndex: number }) {
  const [open, setOpen] = useState(false)
  const [label, setLabel] = useState(`荷台 No.${nextIndex}`)
  const [markerId, setMarkerId] = useState('')

  if (!open) {
    return (
      <button className="btn btn-ghost" onClick={() => setOpen(true)}>
        <IconPlus size={18} /> 荷台を追加
      </button>
    )
  }

  return (
    <div className="card card-pad">
      <div className="field" style={{ marginBottom: 10 }}>
        <label>荷台名</label>
        <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} />
      </div>
      <div className="field" style={{ marginBottom: 12 }}>
        <label>マーカーID</label>
        <input
          className="input mono"
          placeholder="例: MK-1004"
          value={markerId}
          onChange={(e) => setMarkerId(e.target.value)}
        />
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-ghost btn-sm" style={{ flex: 1 }} onClick={() => setOpen(false)}>
          キャンセル
        </button>
        <button
          className="btn btn-primary btn-sm"
          style={{ flex: 1 }}
          disabled={!label.trim() || !markerId.trim()}
          onClick={() => {
            onAdd({
              id: `cart-${Date.now().toString(36)}`,
              label: label.trim(),
              markerId: markerId.trim(),
            })
            setOpen(false)
          }}
        >
          追加
        </button>
      </div>
    </div>
  )
}

/**
 * 場所QRの発行セクション。
 * 各荷受け場/送り場に掲示するエントリーURLのQRを表示。
 * タップで現地掲示イメージ(場所名大書き+QR)の拡大モーダルを開く。
 * 建物を切り替えるとQR一覧も丸ごと入れ替わる。
 */
function SpotQrSection({ building }: { building: BuildingProfile }) {
  const [qrMap, setQrMap] = useState<Record<string, string>>({})
  const [selected, setSelected] = useState<SpotDef | null>(null)

  useEffect(() => {
    let cancelled = false
    setQrMap({})
    Promise.all(
      building.spots.map(async (s) => {
        const url = entryUrl(building.id, s.id)
        const dataUrl = await QRCode.toDataURL(url, { width: 320, margin: 1 })
        return [s.id, dataUrl] as const
      }),
    ).then((entries) => {
      if (!cancelled) setQrMap(Object.fromEntries(entries))
    })
    return () => {
      cancelled = true
    }
  }, [building])

  return (
    <>
      <div className="section-label">場所QRの発行</div>
      <div className="card card-pad">
        <p className="muted" style={{ fontSize: 12.5, marginBottom: 12 }}>
          各荷受け場/送り場に掲示するQRです。スマホの標準カメラで読み取るとブラウザで起動し、現在地が自動確定します(インストール・事前設定は不要)。
        </p>
        <div className="qr-grid">
          {building.spots.map((s) => (
            <button key={s.id} className="qr-tile" onClick={() => setSelected(s)}>
              {qrMap[s.id] ? (
                <img src={qrMap[s.id]} alt={`${s.label} のQR`} />
              ) : (
                <div className="qr-ph">
                  <IconQr size={26} />
                </div>
              )}
              <div className="qr-tile-name">{s.label}</div>
              <div className="qr-tile-floor">{floorLabel(building, s.floorId)}</div>
            </button>
          ))}
        </div>
      </div>

      {selected && (
        <div className="modal-overlay" onClick={() => setSelected(null)}>
          <div className="modal-card poster" onClick={(e) => e.stopPropagation()}>
            <button className="modal-x poster-x" onClick={() => setSelected(null)} aria-label="閉じる">
              <IconClose size={18} />
            </button>
            <div className="poster-body">
              <div className="poster-floor">
                <IconPin size={16} /> {floorLabel(building, selected.floorId)}
              </div>
              <div className="poster-name">{selected.label}</div>
              {qrMap[selected.id] && (
                <img className="poster-qr" src={qrMap[selected.id]} alt={`${selected.label} のQR`} />
              )}
              <div className="poster-guide">スマホのカメラで読み取ってください</div>
              <div className="poster-sub">{building.name}</div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
