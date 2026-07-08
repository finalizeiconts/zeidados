import type { ReactNode } from 'react'

interface CardProps {
  children: ReactNode
  className?: string
}

/** Cartão base do design Finalizei: borda sutil, cantos 16px, fundo card. */
export function Card({ children, className = '' }: CardProps) {
  return (
    <div
      className={`rounded-2xl border border-border bg-card ${className}`}
      style={{ boxShadow: 'var(--shadow)' }}
    >
      {children}
    </div>
  )
}

interface SectionLabelProps {
  children: ReactNode
}

/** Rótulo de seção com o tracinho amarelo antes (igual ao base). */
export function SectionLabel({ children }: SectionLabelProps) {
  return (
    <div className="mb-3.5 flex items-center gap-2.5 text-[10px] font-bold uppercase tracking-[1.4px] text-muted-fg">
      <span className="h-px w-6 bg-primary" />
      {children}
    </div>
  )
}
