interface LogoProps {
  size?: number
  showWord?: boolean
}

/** サイトポーター ワードマーク + 三色幾何学シンボル(自作SVG) */
export function Logo({ size = 30, showWord = true }: LogoProps) {
  return (
    <div className="logo">
      <svg
        width={size}
        height={size}
        viewBox="0 0 120 120"
        fill="none"
        role="img"
        aria-label="サイトポーター"
      >
        <path d="M20 92 A44 44 0 0 1 92 20" stroke="#F39800" strokeWidth="11" strokeLinecap="round" />
        <path d="M34 96 A34 34 0 0 1 96 34" stroke="#0068B7" strokeWidth="11" strokeLinecap="round" />
        <path d="M48 100 A24 24 0 0 1 100 48" stroke="#00A051" strokeWidth="11" strokeLinecap="round" />
        <circle cx="60" cy="60" r="8.5" fill="#1B2D4F" />
      </svg>
      {showWord && (
        <span className="logo-word">
          サイトポーター
          <small>SITE PORTER</small>
        </span>
      )}
    </div>
  )
}
