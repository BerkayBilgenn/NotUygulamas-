import type { CSSProperties } from 'react'

interface StarProps {
  size?: number
  color?: string
  className?: string
  style?: CSSProperties
}

export function Star({ size = 16, color = 'var(--pink-2)', className, style }: StarProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} style={style} aria-hidden="true">
      <path
        d="M12 2.8l2.75 5.6 6.15.9-4.45 4.35 1.05 6.12L12 16.87l-5.5 2.9 1.05-6.12L3.1 9.3l6.15-.9z"
        fill={color}
        stroke={color}
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function Sparkle({ size = 16, color = 'var(--pink-2)', className, style }: StarProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} style={style} aria-hidden="true">
      <path d="M12 1.5c.8 5.6 3 8.5 9.5 10.5-6.5 2-8.7 4.9-9.5 10.5-.8-5.6-3-8.5-9.5-10.5C9 10 11.2 7.1 12 1.5z" fill={color} />
    </svg>
  )
}

interface Scatter {
  kind: 'star' | 'sparkle'
  size: number
  color: string
  style: CSSProperties
}

const SETS: Record<string, Scatter[]> = {
  sidebar: [
    { kind: 'star', size: 12, color: 'var(--pink-2)', style: { top: 'calc(14px + env(safe-area-inset-top))', left: 172 } },
    { kind: 'sparkle', size: 18, color: 'var(--pink-1)', style: { bottom: 70, right: 14 } },
    { kind: 'star', size: 9, color: 'var(--pink-1)', style: { bottom: 124, right: 36 } },
    { kind: 'sparkle', size: 11, color: 'var(--pink-2)', style: { bottom: 22, left: 18 } },
  ],
  empty: [
    { kind: 'star', size: 22, color: 'var(--pink-1)', style: { top: '14%', left: '12%' } },
    { kind: 'sparkle', size: 30, color: 'var(--pink-2)', style: { top: '22%', right: '14%' } },
    { kind: 'star', size: 14, color: 'var(--pink-2)', style: { bottom: '20%', left: '20%' } },
    { kind: 'sparkle', size: 16, color: 'var(--pink-1)', style: { bottom: '14%', right: '22%' } },
    { kind: 'star', size: 10, color: 'var(--pink-3)', style: { top: '40%', left: '6%' } },
  ],
}

export function StarField({ set }: { set: keyof typeof SETS }) {
  return (
    <div className="starfield" aria-hidden="true">
      {SETS[set].map((s, i) =>
        s.kind === 'star' ? (
          <Star key={i} size={s.size} color={s.color} className="twinkle" style={{ ...s.style, animationDelay: `${i * 0.7}s` }} />
        ) : (
          <Sparkle key={i} size={s.size} color={s.color} className="twinkle" style={{ ...s.style, animationDelay: `${i * 0.7}s` }} />
        ),
      )}
    </div>
  )
}
