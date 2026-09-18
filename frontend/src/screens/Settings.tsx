import { useEffect, useState } from 'react'
import { useScreenData } from '../lib/useScreenData'
import { useNavigate } from 'react-router-dom'
import QRCode from 'qrcode'
import { robotPhaseLabel, useStore } from '../domain/store'
import { floorLabel, SITE_NAME, type Area, type Master, type Rack } from '../domain/master'
import { IconCart, IconAlert, IconQr, IconClose, IconPin } from '../components/icons'
import { PauseBanner } from '../components/PauseBanner'
import { RobotOfflineBanner } from '../components/RobotOfflineBanner'

/**
 * 壁QRのエントリーURL(スマホ標準カメラで読む → ブラウザで現在地確定)。
 * QRに入るのは area.id の数字ひとつ。エリアに1枚だけ貼る。
 */
function entryUrl(areaId: number): string {
  const base = window.location.origin + window.location.pathname
  return `${base}#/entry?area=${areaId}`
}

export function Settings() {
  useScreenData()
  const navigate = useNavigate()
  const {
    master,
    areas,
    addresses,
    racks,
    setRackMarker,
    robot,
    resetRobotHome,
    demoError,
    setDemoError,
    demoOffline,
    setDemoOffline,
  } = useStore()

  return (
    <div className="fade-in">
      <div className="page-head">
        <h1>設定</h1>
        <p>建物・荷台・ロボット連携の構成</p>
      </div>

      {/* ---------- 現場の構成 ---------- */}
      <div className="section-label">現場の構成</div>
      <div className="card card-pad">
        <p className="muted" style={{ fontSize: 12.5, marginBottom: 12 }}>
          サーバーのマスタ(area / street_address)をそのまま表示しています。
          変更はデータベース側で行います。
        </p>

        <div className="row-between" style={{ marginBottom: 6 }}>
          <span className="muted" style={{ fontSize: 12, fontWeight: 700 }}>エリア</span>
          <span className="muted" style={{ fontSize: 12 }}>{areas.length} 件</span>
        </div>
        <div className="chip-grid" style={{ marginBottom: 14 }}>
          {areas.map((a) => (
            <span key={a.id} className="chip" style={{ height: 32, fontSize: 12 }}>
              {a.label}
            </span>
          ))}
        </div>

        <div className="muted" style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
          番地(ロボットの地図番号 / 経路番号)
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="map-table">
            <thead>
              <tr>
                <th>番地</th>
                <th>map_no</th>
                <th>path_no</th>
              </tr>
            </thead>
            <tbody>
              {addresses.map((ad) => (
                <tr key={ad.id}>
                  <td>{ad.label}</td>
                  <td className="mono">{master.areas.find((a) => a.id === ad.areaId)?.mapNo ?? '-'}</td>
                  <td className="mono">{ad.pathNo}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ---------- 場所QRの発行 ---------- */}
      {/* ---------- デモ用: エラーの再現 ---------- */}
      <div className="section-label">デモ用: エラーの再現</div>
      <div className="card card-pad" style={{ marginBottom: 18 }}>
        <p className="muted" style={{ fontSize: 12.5, marginBottom: 12 }}>
          E6 / E8 は受け付けを断り、エラーモーダルを出します。[ 閉じる ] で内容確認画面に戻り、そのまま送信し直せます。
          E7(搬送先に空き場所がない)と E9(ロボットが実行中)は設定なしで再現できます。
          E7 は番地を全部埋めれば起き、E9 は搬送中にもう1件依頼すれば起きます。
          どちらもモーダルは出さず、受け付けて順番待ちになります。
        </p>
        <div className="segmented">
          {(
            [
              { v: 'none', label: 'なし', hint: '通常' },
              { v: 'e6', label: 'E6', hint: 'サーバー接続不可' },
              { v: 'e8', label: 'E8', hint: '荷台が使用中' },
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
            現在、搬送依頼の送信は必ず失敗します。デモが終わったら「なし」に戻してください。
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

      <AreaQrSection master={master} />

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
        {racks.map((rk) => (
          <RackEditor key={rk.id} rack={rk} onSave={setRackMarker} />
        ))}
      </div>

      {/* ---------- ロボットアダプタ ---------- */}
      <div className="section-label">ロボットの状態</div>
      <div className="card card-pad">
        <p className="muted" style={{ fontSize: 12.5, marginBottom: 12 }}>
          搬送を走らせるのはサーバーです。この画面は状態を読むだけで、ここから操作はしません。
          実機かモックかは docker-compose.yml の ROBOT_MODE で決まります。
        </p>
        {robot ? (
          <>
            {[
              { k: 'ロボット', v: robot.name },
              { k: '状態', v: robotPhaseLabel(robot.phase) },
              {
                k: '実行中の断片',
                v: robot.scenarioName
                  ? `${robot.scenarioName} (${robot.stepIndex}/${robot.stepTotal})`
                  : '—',
              },
              { k: '階', v: robot.floor !== null ? `${robot.floor}F` : '—' },
              {
                k: '動かし方',
                v: robot.mode === 'mock' ? 'モック(ロボット無し)' : `実機 (${robot.mode})`,
              },
            ].map((r) => (
              <div key={r.k} className="row-between" style={{ padding: '6px 0' }}>
                <span className="muted" style={{ fontSize: 13 }}>
                  {r.k}
                </span>
                <span style={{ fontWeight: 700, fontSize: 13 }} className="mono">
                  {r.v}
                </span>
              </div>
            ))}
            {/* phase=error で stuck_reason が無いのは通信断。stuck は下のカードが担当 */}
            {robot.phase === 'error' && !robot.stuckReason && (
              <RobotOfflineBanner style={{ marginTop: 10, background: 'var(--grey-tint)' }} />
            )}
            <PauseBanner reason={robot.pauseReason} style={{ marginTop: 10, background: 'var(--grey-tint)' }} />
            {robot.stuckReason && (
              <div
                className="card card-pad"
                style={{ marginTop: 10, borderLeft: '4px solid #c62828', background: 'var(--grey-tint)' }}
              >
                <div style={{ fontWeight: 700, color: '#c62828', fontSize: 13 }}>人の手が必要です</div>
                <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>{robot.stuckReason}</div>
                <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>
                  ロボットを HOME に置き直してから、下のボタンを押してください。押すまで次の搬送は始まりません。
                </div>
              </div>
            )}
            {/* 失敗の後は at_home が 0 のまま残る。人が HOME に置き直したら申告する */}
            {robot.requestId === null && (
              <button
                className="btn btn-ghost btn-sm"
                style={{ marginTop: 10 }}
                onClick={() => {
                  if (window.confirm('ロボットは HOME に置き直してありますか？')) void resetRobotHome()
                }}
              >
                ロボットを HOME に置き直した
              </button>
            )}
            {robot.requestId !== null && (
              <button
                className="btn btn-ghost btn-sm"
                style={{ marginTop: 10 }}
                onClick={() => navigate(`/task/${robot.requestId}`)}
              >
                実行中の搬送状況を見る
              </button>
            )}
          </>
        ) : (
          <p className="muted" style={{ fontSize: 12.5 }}>
            状態を取得できていません。
          </p>
        )}
      </div>

      <div style={{ height: 8 }} />
    </div>
  )
}

function RackEditor({
  rack,
  onSave,
}: {
  rack: Rack
  onSave: (rackId: number, markerId: number) => Promise<void>
}) {
  // 荷台にラベル列はない(表示名は marker_id から作る)。編集するのはマーカーIDだけ
  const [markerId, setMarkerId] = useState(String(rack.markerId))
  const [error, setError] = useState<string | null>(null)
  const dirty = markerId.trim() !== String(rack.markerId)
  const valid = /^\d+$/.test(markerId.trim())

  const save = async () => {
    setError(null)
    try {
      await onSave(rack.id, Number(markerId.trim()))
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存できませんでした')
    }
  }

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
        <div>
          <div style={{ fontWeight: 700 }}>{rack.label}</div>
          <div className="muted" style={{ fontSize: 12 }}>
            {rack.addressId ? `番地${rack.addressNo}` : '搬送中 / 未設置'}
          </div>
        </div>
      </div>
      <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--navy-soft)' }}>マーカーID</label>
      <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
        <input
          className="input mono"
          style={{ height: 44 }}
          inputMode="numeric"
          value={markerId}
          onChange={(e) => setMarkerId(e.target.value)}
        />
        <button
          className="btn btn-blue btn-sm"
          style={{ minWidth: 64 }}
          disabled={!dirty || !valid}
          onClick={() => void save()}
        >
          保存
        </button>
      </div>
      {error && (
        <div className="muted" style={{ fontSize: 12, marginTop: 6, color: 'var(--orange-dark)' }}>
          {error}
        </div>
      )}
    </div>
  )
}

function AreaQrSection({ master }: { master: Master }) {
  const [qrMap, setQrMap] = useState<Record<number, string>>({})
  const [selected, setSelected] = useState<Area | null>(null)

  useEffect(() => {
    let cancelled = false
    setQrMap({})
    Promise.all(
      master.areas.map(async (a) => {
        const dataUrl = await QRCode.toDataURL(entryUrl(a.id), { width: 320, margin: 1 })
        return [a.id, dataUrl] as const
      }),
    ).then((entries) => {
      if (!cancelled) setQrMap(Object.fromEntries(entries))
    })
    return () => {
      cancelled = true
    }
  }, [master])

  return (
    <>
      <div className="section-label">壁QRの発行</div>
      <div className="card card-pad">
        <p className="muted" style={{ fontSize: 12.5, marginBottom: 12 }}>
          エリアごとに1枚だけ掲示するQRです。スマホの標準カメラで読み取るとブラウザで起動し、
          現在地が自動確定します(インストール・事前設定は不要)。
        </p>
        <div className="qr-grid">
          {master.areas.map((a) => (
            <button key={a.id} className="qr-tile" onClick={() => setSelected(a)}>
              {qrMap[a.id] ? (
                <img src={qrMap[a.id]} alt={`${a.label} のQR`} />
              ) : (
                <div className="qr-ph">
                  <IconQr size={26} />
                </div>
              )}
              <div className="qr-tile-name">{a.label}</div>
              <div className="qr-tile-floor">{floorLabel(master, a.id)}</div>
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
                <IconPin size={16} /> {floorLabel(master, selected.id)}
              </div>
              <div className="poster-name">{selected.label}</div>
              {qrMap[selected.id] && (
                <img className="poster-qr" src={qrMap[selected.id]} alt={`${selected.label} のQR`} />
              )}
              <div className="poster-guide">スマホのカメラで読み取ってください</div>
              <div className="poster-sub">{SITE_NAME}</div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
