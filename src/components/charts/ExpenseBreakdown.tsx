import type { CategorySlice } from '@/lib/types'
import { formatBRL, formatPct } from '@/lib/format'

/**
 * Ranking de despesas por categoria (uma medida, várias categorias) → barras
 * horizontais em tom único com rótulo de valor e participação diretos.
 */
export function ExpenseBreakdown({ data }: { data: CategorySlice[] }) {
  const top = data.slice(0, 7)
  const max = Math.max(1, ...top.map((d) => d.amount))

  if (top.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-muted-fg">
        Sem despesas no período.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {top.map((d, i) => (
        <div key={d.category} className="fz-fade-in">
          <div className="mb-1 flex items-baseline justify-between text-xs">
            <span className="font-medium text-fg">{d.category}</span>
            <span className="tnum text-muted-fg">
              {formatBRL(d.amount)}
              <span className="ml-2 text-[11px]">{formatPct(d.share)}</span>
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full" style={{ background: 'var(--muted)' }}>
            <div
              className="h-full rounded-full"
              style={{
                width: `${(d.amount / max) * 100}%`,
                background: i === 0 ? 'var(--fg)' : 'var(--border-strong)',
                transition: 'width .5s ease',
              }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}
