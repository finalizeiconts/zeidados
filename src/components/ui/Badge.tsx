import type { ReactNode } from 'react'

type Tone = 'primary' | 'grn' | 'red' | 'ora' | 'out'

const toneClass: Record<Tone, string> = {
  primary: 'bg-primary text-primary-fg',
  grn: 'text-grn',
  red: 'text-red',
  ora: 'text-ora',
  out: 'border border-border text-fg',
}

// Fundos suaves (color-mix) para os tons de status — combinam com o base HTML.
const toneStyle: Partial<Record<Tone, React.CSSProperties>> = {
  grn: { background: 'color-mix(in srgb, var(--grn) 14%, transparent)' },
  red: { background: 'color-mix(in srgb, var(--red) 14%, transparent)' },
  ora: { background: 'color-mix(in srgb, var(--ora) 16%, transparent)' },
}

interface BadgeProps {
  children: ReactNode
  tone?: Tone
  className?: string
}

export function Badge({ children, tone = 'out', className = '' }: BadgeProps) {
  return (
    <span
      className={`inline-flex h-[22px] items-center gap-1.5 rounded-full px-2.5 text-[11px] font-semibold ${toneClass[tone]} ${className}`}
      style={toneStyle[tone]}
    >
      {children}
    </span>
  )
}
