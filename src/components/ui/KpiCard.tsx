import type { LucideIcon } from 'lucide-react'
import { TrendingDown, TrendingUp } from 'lucide-react'
import { formatPct } from '@/lib/format'

type ValueTone = 'default' | 'grn' | 'red' | 'ora'

const valueColor: Record<ValueTone, string | undefined> = {
  default: undefined,
  grn: 'var(--grn)',
  red: 'var(--red)',
  ora: 'var(--ora)',
}

interface KpiCardProps {
  label: string
  value: string
  icon: LucideIcon
  sub?: string
  tone?: ValueTone
  /** Variação relativa vs. período anterior (ex.: 0.12). */
  delta?: number
  /** Se true, uma queda no delta é "boa" (verde) — útil para despesas. */
  invertDelta?: boolean
  highlight?: boolean
}

export function KpiCard({
  label,
  value,
  icon: Icon,
  sub,
  tone = 'default',
  delta,
  invertDelta = false,
  highlight = false,
}: KpiCardProps) {
  const hasDelta = typeof delta === 'number' && Number.isFinite(delta)
  const up = (delta ?? 0) >= 0
  const good = invertDelta ? !up : up
  const deltaColor = good ? 'var(--grn)' : 'var(--red)'
  const DeltaIcon = up ? TrendingUp : TrendingDown

  return (
    <div
      className="rounded-2xl border bg-card p-[18px] transition-colors"
      style={{
        borderColor: highlight ? 'var(--border-strong)' : 'var(--border)',
        boxShadow: 'var(--shadow)',
      }}
    >
      <div className="mb-3.5 flex items-start justify-between">
        <span className="eyebrow">{label}</span>
        <span
          className="flex h-10 w-10 items-center justify-center rounded-xl"
          style={{ background: 'var(--fg)', color: 'var(--bg)' }}
        >
          <Icon size={18} strokeWidth={1.75} />
        </span>
      </div>
      <div
        className="text-[32px] font-light leading-none tracking-[-0.6px] tnum"
        style={{ color: valueColor[tone] }}
      >
        {value}
      </div>
      <div className="mt-2.5 flex items-center gap-2">
        {hasDelta && (
          <span
            className="inline-flex items-center gap-1 text-[11px] font-semibold tnum"
            style={{ color: deltaColor }}
          >
            <DeltaIcon size={13} strokeWidth={2} />
            {formatPct(delta as number, { signed: true })}
          </span>
        )}
        {sub && <span className="text-[11px] text-muted-fg">{sub}</span>}
      </div>
    </div>
  )
}
