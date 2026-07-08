import type { FinancialEvent } from '@/lib/types'
import { formatBRL, formatDate } from '@/lib/format'
import { Badge } from '@/components/ui/Badge'
import { Inbox } from 'lucide-react'

function statusBadge(e: FinancialEvent) {
  if (e.status === 'vencido')
    return <Badge tone="red">Vencido</Badge>
  return <Badge tone="ora">Pendente</Badge>
}

/** Maiores títulos a receber em aberto. */
export function ReceivablesTable({ items }: { items: FinancialEvent[] }) {
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center rounded-2xl border-2 border-dashed border-border px-6 py-10 text-center text-muted-fg">
        <Inbox size={28} strokeWidth={1} className="mb-2 opacity-50" />
        <span className="text-sm">Nada a receber em aberto. Tudo em dia! 🎉</span>
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13px] tnum">
          <thead>
            <tr>
              <Th>Cliente</Th>
              <Th>Vencimento</Th>
              <Th>Situação</Th>
              <Th right>Valor</Th>
            </tr>
          </thead>
          <tbody>
            {items.map((e) => (
              <tr key={e.id} className="transition-colors hover:bg-muted">
                <td className="border-b border-border px-4 py-3">
                  <span className="font-semibold">{e.counterparty}</span>
                  <span className="ml-2 text-[11px] text-muted-fg">{e.description}</span>
                </td>
                <td className="border-b border-border px-4 py-3 text-muted-fg">
                  {formatDate(e.dueDate)}
                </td>
                <td className="border-b border-border px-4 py-3">{statusBadge(e)}</td>
                <td className="border-b border-border px-4 py-3 text-right font-semibold">
                  {formatBRL(e.amount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th
      className={`border-b border-border px-4 py-3 text-[10px] font-bold uppercase tracking-[1px] text-muted-fg ${
        right ? 'text-right' : 'text-left'
      }`}
    >
      {children}
    </th>
  )
}
