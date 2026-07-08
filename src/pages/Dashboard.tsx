import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  Landmark,
  Percent,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react'
import type { UseFinanceData } from '@/hooks/useFinanceData'
import { computeMetrics } from '@/lib/metrics'
import { formatBRL, formatPct } from '@/lib/format'
import type { PeriodKey } from '@/lib/types'
import { Card, SectionLabel } from '@/components/ui/Card'
import { KpiCard } from '@/components/ui/KpiCard'
import { LiveDot } from '@/components/ui/LiveDot'
import { RevenueExpenseChart } from '@/components/charts/RevenueExpenseChart'
import { ResultLineChart } from '@/components/charts/ResultLineChart'
import { ExpenseBreakdown } from '@/components/charts/ExpenseBreakdown'
import { ReceivablesTable } from '@/components/dashboard/ReceivablesTable'
import { ActivityFeed } from '@/components/dashboard/ActivityFeed'
import { ConnectBanner } from '@/components/dashboard/ConnectBanner'

const PERIODS: Array<{ key: PeriodKey; label: string }> = [
  { key: '30d', label: '30 dias' },
  { key: '90d', label: '90 dias' },
  { key: '12m', label: '12 meses' },
]

export function Dashboard({ data }: { data: UseFinanceData }) {
  const { events, sync, now, lastEventId } = data
  const [period, setPeriod] = useState<PeriodKey>('30d')

  const m = useMemo(
    () => computeMetrics(events, period, now),
    [events, period, now],
  )

  const lucroTone = m.lucro >= 0 ? 'grn' : 'red'
  const showConnect =
    sync.source === 'live' && events.length === 0 && sync.status !== 'conectando'

  return (
    <div className="mx-auto max-w-[1120px] px-6 pb-16 pt-7">
      {/* cabeçalho da página + seletor de período */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="eyebrow">Visão geral · {m.periodLabel}</div>
          <h2 className="mt-1 text-[26px] font-light tracking-[-0.5px]">
            Saúde financeira{' '}
            <span className="font-serif-italic">em tempo real</span>
          </h2>
        </div>
        <div className="flex items-center gap-3">
          <div className="md:hidden">
            <LiveDot sync={sync} />
          </div>
          <div
            className="flex gap-0.5 rounded-full border border-border bg-card p-[3px]"
            role="tablist"
            aria-label="Período"
          >
            {PERIODS.map((p) => {
              const on = p.key === period
              return (
                <button
                  key={p.key}
                  role="tab"
                  aria-selected={on}
                  onClick={() => setPeriod(p.key)}
                  className="rounded-full px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-[0.08em] transition-colors"
                  style={{
                    background: on ? 'var(--fg)' : 'transparent',
                    color: on ? 'var(--bg)' : 'var(--muted-fg)',
                  }}
                >
                  {p.label}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {showConnect && <ConnectBanner />}

      {/* KPIs */}
      <section className="mb-9">
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            label="Receita"
            value={formatBRL(m.receitaRealizada)}
            icon={TrendingUp}
            delta={m.delta.receita}
            sub="faturada no período"
          />
          <KpiCard
            label="Despesa"
            value={formatBRL(m.despesaRealizada)}
            icon={TrendingDown}
            delta={m.delta.despesa}
            invertDelta
            sub="do período"
          />
          <KpiCard
            label="Lucro"
            value={formatBRL(m.lucro)}
            icon={Wallet}
            tone={lucroTone}
            delta={m.delta.lucro}
            sub={`margem ${formatPct(m.margem)}`}
            highlight
          />
          <KpiCard
            label="Saldo em caixa"
            value={formatBRL(m.saldoCaixa)}
            icon={Landmark}
            sub="liquidado até hoje"
          />
        </div>
      </section>

      {/* segunda linha de KPIs: a receber / inadimplência */}
      <section className="mb-9">
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
          <KpiCard
            label="A receber"
            value={formatBRL(m.aReceber)}
            icon={Landmark}
            sub="títulos em aberto"
          />
          <KpiCard
            label="A pagar"
            value={formatBRL(m.aPagar)}
            icon={Wallet}
            sub="compromissos em aberto"
          />
          <KpiCard
            label="Inadimplência"
            value={formatPct(m.inadimplenciaTaxa)}
            icon={AlertTriangle}
            tone={m.inadimplenciaTaxa > 0.05 ? 'red' : 'default'}
            sub={`${formatBRL(m.inadimplenciaValor)} vencidos`}
          />
        </div>
      </section>

      {/* gráficos principais */}
      <section className="mb-9 grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <SectionLabel>Receita × Despesa — evolução mensal</SectionLabel>
          <Card className="p-5">
            <RevenueExpenseChart data={m.serie} />
          </Card>
        </div>
        <div>
          <SectionLabel>Despesas por categoria</SectionLabel>
          <Card className="p-5">
            <ExpenseBreakdown data={m.despesasPorCategoria} />
          </Card>
        </div>
      </section>

      {/* resultado + atividade ao vivo */}
      <section className="mb-9 grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <SectionLabel>
            Resultado líquido mensal <Percent size={11} className="opacity-60" />
          </SectionLabel>
          <Card className="p-5">
            <ResultLineChart data={m.serie} />
          </Card>
        </div>
        <div>
          <SectionLabel>Atividade ao vivo</SectionLabel>
          <Card className="p-5">
            <ActivityFeed events={events} lastEventId={lastEventId} />
          </Card>
        </div>
      </section>

      {/* a receber */}
      <section>
        <SectionLabel>Maiores títulos a receber</SectionLabel>
        <ReceivablesTable items={m.topReceber} />
      </section>
    </div>
  )
}
