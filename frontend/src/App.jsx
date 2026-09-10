import { useEffect, useState } from 'react'

const API = '/api/requests'

const PRIORITY = { 1: '高', 2: '中', 3: '低' }
const PRIORITY_CLASS = { 1: 'pri-high', 2: 'pri-mid', 3: 'pri-low' }

const STATUS = {
  queued: '順番待ち',
  running: '搬送中',
  delivered: '搬送完了',
  confirmed: '受取確認済み',
  done: '完了',
  failed: '失敗',
  cancelled: '取消',
}

const KIND = { delivery: '荷物搬送', collect: '荷台回収' }
const CREATED_BY = { user: '配送員', system: 'システム' }

/** DBは UTC で保存する（datetime('now')）。表示は端末のタイムゾーンに直す */
function formatDate(s) {
  const d = new Date(s.replace(' ', 'T') + 'Z')
  if (Number.isNaN(d.getTime())) return s
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ` +
         `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

export default function App() {
  const [requests, setRequests] = useState([])
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [caFiles, setCaFiles] = useState([])

  // 証明書は http://<ホスト>:8000 から配る（CA未導入の端末は https を開けないため）
  const caBase = `http://${window.location.hostname}:8000`

  async function load() {
    try {
      const res = await fetch(API)
      if (!res.ok) throw new Error(`取得に失敗しました (${res.status})`)
      setRequests(await res.json())
      setError(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  useEffect(() => {
    fetch('/api/ca/status')
      .then((r) => r.json())
      .then((d) => setCaFiles(d.files || []))
      .catch(() => setCaFiles([]))
  }, [])

  return (
    <main className="page">
      <header className="head">
        <h1>依頼一覧</h1>
        <button className="reload" onClick={load}>更新</button>
      </header>

      {error && <p className="error">{error}</p>}

      {loading ? (
        <p className="muted">読み込み中</p>
      ) : requests.length === 0 ? (
        <p className="muted">依頼がありません。</p>
      ) : (
        <ul className="req-list">
          {requests.map((r) => (
            <li key={r.id} className="req">
              <div className="req-top">
                <span className="req-date">{formatDate(r.created_at)}</span>
                <span className={`badge ${PRIORITY_CLASS[r.priority]}`}>
                  {PRIORITY[r.priority] ?? r.priority}
                </span>
              </div>

              <div className="req-kind">
                {CREATED_BY[r.created_by] ?? r.created_by}・{KIND[r.kind] ?? r.kind}
              </div>

              {r.tracking_no && (
                <div className="req-tracking">送り状番号：{r.tracking_no}</div>
              )}

              <div className="req-item">{r.item ?? '（空荷台）'}</div>

              <div className="req-route">
                {r.from_area} <span className="arrow">→</span> {r.to_area}
                <span className="req-rack">荷台マーカー {r.rack_marker_id}</span>
              </div>

              {r.receiver_name && (
                <div className="req-receiver">受取人: {r.receiver_name}</div>
              )}

              <div className="req-status">{STATUS[r.status] ?? r.status}</div>
            </li>
          ))}
        </ul>
      )}

      {caFiles.length > 0 && (
        <footer className="setup">
          <h2>スマホで使う準備</h2>
          <p className="muted">
            カメラでQRを読むにはHTTPSが必要です。この端末にローカルCAを入れてください。
          </p>
          <p className="dl">
            {caFiles.includes('rootCA.pem') && (
              <a href={`${caBase}/api/ca/rootCA.pem`}>iPhone / iPad（rootCA.pem）</a>
            )}
            {caFiles.includes('rootCA.crt') && (
              <a href={`${caBase}/api/ca/rootCA.crt`}>Android（rootCA.crt）</a>
            )}
          </p>
          <p className="muted">
            <a href={`${caBase}/setup`}>インストール手順を見る</a>
          </p>
        </footer>
      )}
    </main>
  )
}