import { HashRouter, Routes, Route, useLocation } from 'react-router-dom'
import { useEffect } from 'react'
import { StoreProvider } from './domain/store'
import { Header } from './components/Header'
import { TabNav } from './components/TabNav'
import { ToastHost } from './components/ToastHost'
import { ScreenErrorModal } from './components/ScreenErrorModal'
import { ArrivalModal } from './components/ArrivalModal'
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

function Layout() {
  return (
    <div className="app-shell">
      <Header />
      <ToastHost />
      <ScreenErrorModal />
      <ArrivalModal />
      <ScrollToTop />
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
