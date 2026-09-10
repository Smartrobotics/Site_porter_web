interface IconProps {
  size?: number
  className?: string
  strokeWidth?: number
}

function base(size: number) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }
}

export function IconHome({ size = 22, strokeWidth = 2 }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={strokeWidth}>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V20h14V9.5" />
      <path d="M9.5 20v-6h5v6" />
    </svg>
  )
}

export function IconScan({ size = 22, strokeWidth = 2 }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={strokeWidth}>
      <path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8" />
      <path d="M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8" />
      <path d="M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16" />
      <path d="M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16" />
      <path d="M3.5 12h17" />
    </svg>
  )
}

export function IconBell({ size = 22, strokeWidth = 2 }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={strokeWidth}>
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </svg>
  )
}

export function IconSettings({ size = 22, strokeWidth = 2 }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={strokeWidth}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" />
    </svg>
  )
}

export function IconList({ size = 22, strokeWidth = 2 }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={strokeWidth}>
      <path d="M8 6h13M8 12h13M8 18h13" />
      <path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
    </svg>
  )
}

export function IconPlus({ size = 22, strokeWidth = 2.4 }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={strokeWidth}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

export function IconCheck({ size = 22, strokeWidth = 2.4 }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={strokeWidth}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}

export function IconArrow({ size = 20, strokeWidth = 2.4 }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={strokeWidth}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  )
}

export function IconSwap({ size = 20, strokeWidth = 2.2 }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={strokeWidth}>
      <path d="M7 4v16M7 20l-3-3M7 20l3-3" />
      <path d="M17 20V4M17 4l-3 3M17 4l3 3" />
    </svg>
  )
}

export function IconChevron({ size = 20, strokeWidth = 2.2, className }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={strokeWidth} className={className}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  )
}

export function IconBack({ size = 24, strokeWidth = 2.2 }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={strokeWidth}>
      <path d="M15 18l-6-6 6-6" />
    </svg>
  )
}

export function IconCart({ size = 22, strokeWidth = 2 }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={strokeWidth}>
      <rect x="3" y="7" width="13" height="9" rx="1.5" />
      <path d="M16 10h3l2 3v3h-5" />
      <circle cx="7" cy="18.5" r="1.6" />
      <circle cx="17" cy="18.5" r="1.6" />
    </svg>
  )
}

export function IconRobot({ size = 22, strokeWidth = 2 }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={strokeWidth}>
      <rect x="5" y="8" width="14" height="10" rx="2.5" />
      <path d="M12 8V5" />
      <circle cx="12" cy="4" r="1" />
      <path d="M9 12.5h.01M15 12.5h.01" />
      <path d="M9.5 15.5h5" />
      <path d="M3 12v3M21 12v3" />
    </svg>
  )
}

export function IconAlert({ size = 22, strokeWidth = 2 }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={strokeWidth}>
      <path d="M12 3 2 20h20L12 3z" />
      <path d="M12 10v4M12 17.5h.01" />
    </svg>
  )
}

export function IconClose({ size = 20, strokeWidth = 2.2 }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={strokeWidth}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}

export function IconPin({ size = 18, strokeWidth = 2 }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={strokeWidth}>
      <path d="M12 21s7-6.3 7-11a7 7 0 0 0-14 0c0 4.7 7 11 7 11z" />
      <circle cx="12" cy="10" r="2.6" />
    </svg>
  )
}

export function IconDoc({ size = 20, strokeWidth = 2 }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={strokeWidth}>
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v4h4" />
      <path d="M9 12h6M9 16h6" />
    </svg>
  )
}

export function IconQr({ size = 20, strokeWidth = 2 }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={strokeWidth}>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <path d="M14 14h3v3M21 14v.01M17 21h4v-4M14 21v-3" />
    </svg>
  )
}

export function IconCamera({ size = 20, strokeWidth = 2 }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={strokeWidth}>
      <path d="M3 8.5A1.5 1.5 0 0 1 4.5 7h2.2l1.1-1.8A1.5 1.5 0 0 1 9.1 4.5h5.8a1.5 1.5 0 0 1 1.3.7L17.3 7h2.2A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z" />
      <circle cx="12" cy="13" r="3.4" />
    </svg>
  )
}
