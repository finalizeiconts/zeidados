import type { FinancialEvent } from '@/lib/types'
import { formatBRL, formatDateShort } from '@/lib/format'
import { ArrowDownLeft, ArrowUpRight } from 'lucide-react'

interface Props {
  events: FinancialEvent[]
  lastEventId: string | null
}

/** Últimos lançamentos, com destaque no que acabou de chegar (tempo real). */
export function ActivityFeed({ events, lastEventId }: Props) {
  const recent = [...events]
    .sort((a, b) => (b.settledDate ?? b.dueDate).localeCompare(a.settledDate ?? a.dueDate))
    .slice(0, 8)

  return (
    <ul className="flex flex-col">
      {recent.map((e) => {
        const isReceita = e.kind === 'receita'
        const isNew = e.id === lastEventId
        return (
          <li
            key={e.id}
            className={`flex items-center gap-3 border-b border-border py-2.5 last:border-b-0 ${
              isNew ? 'fz-fade-in' : ''
            }`}
          >
            <span
              className="flex h-8 w-8 flex-none items-center justify-center rounded-full"
              style={{
                background: isReceita
                  ? 'color-mix(in srgb, var(--grn) 14%, transparent)'
                  : 'color-mix(in srgb, var(--red) 14%, transparent)',
                color: isReceita ? 'var(--grn)' : 'var(--red)',
              }}
            >
              {isReceita ? (
                <ArrowDownLeft size={15} strokeWidth={2} />
              ) : (
                <ArrowUpRight size={15} strokeWidth={2} />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium">{e.counterparty}</div>
              <div className="truncate text-[11px] text-muted-fg">
                {e.description} · {formatDateShort(e.settledDate ?? e.dueDate)}
              </div>
            </div>
            <div
              className="tnum flex-none text-[13px] font-semibold"
              style={{ color: isReceita ? 'var(--grn)' : 'var(--red)' }}
            >
              {isReceita ? '+' : '−'}
              {formatBRL(e.amount)}
            </div>
            {isNew && (
              <span
                className="fz-live-dot h-1.5 w-1.5 flex-none rounded-full"
                style={{ background: 'var(--primary)' }}
              />
            )}
          </li>
        )
      })}
    </ul>
  )
}
