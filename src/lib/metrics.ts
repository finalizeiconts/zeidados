import type {
  CategorySlice,
  FinanceMetrics,
  FinancialEvent,
  MonthlyPoint,
  PeriodKey,
} from './types'

const MONTHS_PT = [
  'jan',
  'fev',
  'mar',
  'abr',
  'mai',
  'jun',
  'jul',
  'ago',
  'set',
  'out',
  'nov',
  'dez',
]

const PERIOD_DAYS: Record<PeriodKey, number> = {
  '30d': 30,
  '90d': 90,
  '12m': 365,
}

const PERIOD_LABEL: Record<PeriodKey, string> = {
  '30d': 'Últimos 30 dias',
  '90d': 'Últimos 90 dias',
  '12m': 'Últimos 12 meses',
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function inRange(iso: string | null, start: Date, end: Date): boolean {
  if (!iso) return false
  const t = new Date(iso).getTime()
  return t >= start.getTime() && t <= end.getTime()
}

function sum(events: FinancialEvent[]): number {
  return events.reduce((acc, e) => acc + e.amount, 0)
}

/**
 * Soma por regime de competência (por vencimento) de um tipo entre [start, end].
 * É a base de "receita/despesa do período" — simétrica e independente de quando
 * o dinheiro efetivamente entrou/saiu.
 */
function accrued(
  events: FinancialEvent[],
  kind: 'receita' | 'despesa',
  start: Date,
  end: Date,
): number {
  return sum(
    events.filter((e) => e.kind === kind && inRange(e.dueDate, start, end)),
  )
}

/** Série mensal (regime de competência) dos últimos `months` meses até `now`. */
function buildSerie(
  events: FinancialEvent[],
  now: Date,
  months: number,
): MonthlyPoint[] {
  const buckets = new Map<string, MonthlyPoint>()
  const points: MonthlyPoint[] = []

  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const key = monthKey(d)
    const point: MonthlyPoint = {
      month: key,
      label: MONTHS_PT[d.getMonth()],
      receita: 0,
      despesa: 0,
      resultado: 0,
    }
    buckets.set(key, point)
    points.push(point)
  }

  for (const e of events) {
    const key = monthKey(new Date(e.dueDate))
    const b = buckets.get(key)
    if (!b) continue
    if (e.kind === 'receita') b.receita += e.amount
    else b.despesa += e.amount
  }

  for (const p of points) p.resultado = p.receita - p.despesa
  return points
}

function categoryBreakdown(
  events: FinancialEvent[],
  start: Date,
  end: Date,
): CategorySlice[] {
  const byCat = new Map<string, number>()
  for (const e of events) {
    if (e.kind !== 'despesa') continue
    if (!inRange(e.dueDate, start, end)) continue
    byCat.set(e.category, (byCat.get(e.category) ?? 0) + e.amount)
  }
  const total = [...byCat.values()].reduce((a, b) => a + b, 0)
  return [...byCat.entries()]
    .map(([category, amount]) => ({
      category,
      amount,
      share: total > 0 ? amount / total : 0,
    }))
    .sort((a, b) => b.amount - a.amount)
}

function safeRatio(numer: number, denom: number): number {
  return denom > 0 ? numer / denom : 0
}

function delta(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 1 : 0
  return (current - previous) / previous
}

/**
 * Calcula todos os indicadores para o período selecionado.
 * `now` é injetável para testes e para o gerador de demo (determinístico).
 */
export function computeMetrics(
  events: FinancialEvent[],
  period: PeriodKey,
  now: Date = new Date(),
): FinanceMetrics {
  const days = PERIOD_DAYS[period]
  const end = now
  const start = new Date(now.getTime() - days * 86_400_000)
  const prevStart = new Date(start.getTime() - days * 86_400_000)

  const receitaRealizada = accrued(events, 'receita', start, end)
  const despesaRealizada = accrued(events, 'despesa', start, end)
  const lucro = receitaRealizada - despesaRealizada

  const receitaAnterior = accrued(events, 'receita', prevStart, start)
  const despesaAnterior = accrued(events, 'despesa', prevStart, start)
  const lucroAnterior = receitaAnterior - despesaAnterior

  // Saldo de caixa: tudo que já foi liquidado até hoje.
  const saldoCaixa =
    sum(events.filter((e) => e.kind === 'receita' && e.settledDate && new Date(e.settledDate) <= end)) -
    sum(events.filter((e) => e.kind === 'despesa' && e.settledDate && new Date(e.settledDate) <= end))

  const abertosReceita = events.filter(
    (e) => e.kind === 'receita' && e.status !== 'pago',
  )
  const abertosDespesa = events.filter(
    (e) => e.kind === 'despesa' && e.status !== 'pago',
  )
  const aReceber = sum(abertosReceita)
  const aPagar = sum(abertosDespesa)
  const inadimplenciaValor = sum(
    abertosReceita.filter((e) => e.status === 'vencido'),
  )

  const topReceber = [...abertosReceita]
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 6)

  return {
    periodLabel: PERIOD_LABEL[period],
    receitaRealizada,
    despesaRealizada,
    lucro,
    margem: safeRatio(lucro, receitaRealizada),
    saldoCaixa,
    aReceber,
    aPagar,
    inadimplenciaValor,
    inadimplenciaTaxa: safeRatio(inadimplenciaValor, aReceber),
    delta: {
      receita: delta(receitaRealizada, receitaAnterior),
      despesa: delta(despesaRealizada, despesaAnterior),
      lucro: delta(lucro, lucroAnterior),
    },
    serie: buildSerie(events, now, 12),
    despesasPorCategoria: categoryBreakdown(events, start, end),
    topReceber,
  }
}
