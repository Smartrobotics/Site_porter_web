import { useNavigate } from 'react-router-dom'
import { Logo } from './Logo'

export function Header() {
  const navigate = useNavigate()

  return (
    <header className="app-header">
      <button onClick={() => navigate('/')} aria-label="ホーム" style={{ background: 'none' }}>
        <Logo />
      </button>
    </header>
  )
}
