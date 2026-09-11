import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/global.css'
import App from './App.tsx'
import { redirectQueryToHash } from './lib/entryQuery'

// QR の ?area_id= / ?user_id= を、ルーターが読む前にハッシュへ直す
redirectQueryToHash()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
