import { NavLink } from 'react-router-dom'
import { IconHome, IconList, IconBell, IconSettings } from './icons'
import { useStore } from '../domain/store'
import type { ReactNode } from 'react'

interface Tab {
  to: string
  label: string
  icon: ReactNode
}

export function TabNav() {
  const { pendingReceiptCount } = useStore()

  const tabs: Tab[] = [
    { to: '/', label: 'ホーム', icon: <IconHome /> },
    { to: '/requests', label: '依頼一覧', icon: <IconList /> },
    { to: '/notifications', label: '通知', icon: <IconBell /> },
    { to: '/settings', label: '設定', icon: <IconSettings /> },
  ]

  return (
    <nav className="tab-nav">
      {tabs.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end={t.to === '/'}
          className={({ isActive }) => `tab-item${isActive ? ' active' : ''}`}
        >
          <span className="tab-icon" style={{ position: 'relative' }}>
            {t.icon}
            {t.to === '/notifications' && pendingReceiptCount > 0 && (
              <span
                style={{
                  position: 'absolute',
                  top: -3,
                  right: -6,
                  minWidth: 15,
                  height: 15,
                  padding: '0 3px',
                  borderRadius: 8,
                  background: 'var(--orange)',
                  color: '#fff',
                  fontSize: 9,
                  fontWeight: 700,
                  display: 'grid',
                  placeItems: 'center',
                }}
              >
                {pendingReceiptCount}
              </span>
            )}
          </span>
          {t.label}
        </NavLink>
      ))}
    </nav>
  )
}
