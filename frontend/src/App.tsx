import { HashRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom'
import { useEffect } from 'react'
import { StoreProvider } from './domain/store'
import { Header } from './components/Header'
import { TabNav } from './components/TabNav'
import { ToastHost } from './components/ToastHost'
import { ScreenErrorModal } from './components/ScreenErrorModal'
import { Home } from './screens/Home'
import { Entry } from './screens/Entry'
import { Scan } from './screens/Scan'
import { SlipScan } from './screens/SlipScan'
import { Request } from './screens/Request'
import { Requests } from './screens/Requests'
import { RequestConfirm } from './screens/RequestConfirm'
import { RequestSent } from './screens/RequestSent'
import { TaskDetail } from './screens/TaskDetail'
import { Notifications } from './screens/Notifications'
import { ReceiptConfirm } from './screens/ReceiptConfirm'
import { Settings } from './screens/Settings'
import { RackSetup } from './screens/RackSetup'
import { AdminRequests } from './screens/AdminRequests'

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    document.querySelector('.app-main')?.scrollTo(0, 0)
    window.scrollTo(0, 0)
  }, [pathname])
  return null
}

/**
 * 壁QR・受取人カードのURLは `?area_id=1` / `?user_id=1` の形
 * (docs/siteporter-workflow.ja.md 6.1、qr/scripts/gen_qr.py)。
 * ルーティングは HashRouter なので、`#` の前に付いたクエリは画面に届かない。
 * ここで一度だけ読み取り、対応する画面へ送る:
 *   ?area=1 / ?area_id=1  →  #/entry?area=1
 *   ?user=1 / ?user_id=1  →  #/requests?user_id=1
 * 読んだクエリはアドレスバーから消す。残すと再読み込みのたびに飛ばされる。
 */
function QueryEntry() {
  const navigate = useNavigate()
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const area = q.get('area') ?? q.get('area_id')
    const user = q.get('user') ?? q.get('user_id')
    if (!area && !user) return
    window.history.replaceState(null, '', window.location.pathname + window.location.hash)
    if (area) navigate(`/entry?area=${encodeURIComponent(area)}`, { replace: true })
    else if (user) navigate(`/requests?user_id=${encodeURIComponent(user)}`, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return null
}

function Layout() {
  return (
    <div className="app-shell">
      <Header />
      <ToastHost />
      <ScreenErrorModal />
      <ScrollToTop />
      <QueryEntry />
      <main className="app-main">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/entry" element={<Entry />} />
          <Route path="/scan" element={<Scan />} />
          <Route path="/slip-scan" element={<SlipScan />} />
          <Route path="/request" element={<Request />} />
          <Route path="/requests" element={<Requests />} />
          <Route path="/request/confirm" element={<RequestConfirm />} />
          <Route path="/request/sent" element={<RequestSent />} />
          <Route path="/task/:id" element={<TaskDetail />} />
          <Route path="/notifications" element={<Notifications />} />
          <Route path="/receipt/:id" element={<ReceiptConfirm />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/rack-setup" element={<RackSetup />} />
          <Route path="/admin/requests" element={<AdminRequests />} />
        </Routes>
      </main>
      <TabNav />
    </div>
  )
}

export function App() {
  return (
    <StoreProvider>
      <HashRouter>
        <Layout />
      </HashRouter>
    </StoreProvider>
  )
}

export default App
