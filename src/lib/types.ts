/**
 * Modelo de domínio do painel financeiro.
 *
 * Cada lançamento (receita ou despesa) do Conta Azul é normalizado para o tipo
 * `FinancialEvent`. As funções em `metrics.ts` derivam todos os indicadores a
 * partir de uma lista desses eventos — não importa se vieram do modo demo ou do
 * Supabase (que por sua vez espelha a API v2 do Conta Azul).
 */

export type EventKind = 'receita' | 'despesa'

/** Situação de um lançamento financeiro. */
export type EventStatus = 'pago' | 'pendente' | 'vencido'

export interface FinancialEvent {
  id: string
  kind: EventKind
  description: string
  /** Categoria contábil/financeira (ex.: "Honorários", "Folha", "Impostos"). */
  category: string
  /** Cliente (receita) ou fornecedor (despesa). */
  counterparty: string
  /** Valor sempre positivo, em reais. */
  amount: number
  /** Vencimento (ISO date, ex.: "2026-07-08"). */
  dueDate: string
  /** Data de liquidação, ou null se ainda não foi pago/recebido. */
  settledDate: string | null
  status: EventStatus
}

/** Ponto de uma série temporal mensal para os gráficos. */
export interface MonthlyPoint {
  /** Chave do mês, ex.: "2026-07". */
  month: string
  /** Rótulo curto, ex.: "jul". */
  label: string
  receita: number
  despesa: number
  /** receita - despesa no mês. */
  resultado: number
}

/** Fatia da quebra de despesas por categoria. */
export interface CategorySlice {
  category: string
  amount: number
  /** Fração de 0 a 1 sobre o total. */
  share: number
}

/** Todos os indicadores prontos para exibir, para um período. */
export interface FinanceMetrics {
  periodLabel: string
  receitaRealizada: number
  despesaRealizada: number
  lucro: number
  /** lucro / receitaRealizada (0..1); 0 se receita for 0. */
  margem: number
  /** Saldo acumulado de caixa (entradas pagas - saídas pagas até hoje). */
  saldoCaixa: number
  /** Receitas ainda não recebidas (pendentes + vencidas). */
  aReceber: number
  /** Despesas ainda não pagas (pendentes + vencidas). */
  aPagar: number
  /** Total de receitas vencidas e não pagas. */
  inadimplenciaValor: number
  /** inadimplenciaValor / aReceber (0..1); 0 se aReceber for 0. */
  inadimplenciaTaxa: number
  /** Comparativos vs. período anterior (variação relativa, ex.: 0.12 = +12%). */
  delta: {
    receita: number
    despesa: number
    lucro: number
  }
  serie: MonthlyPoint[]
  despesasPorCategoria: CategorySlice[]
  /** Maiores títulos a receber em aberto (para tabela). */
  topReceber: FinancialEvent[]
}

/** Estado de sincronização exibido no cabeçalho ("ao vivo"). */
export interface SyncState {
  /** 'demo' = dados fictícios locais; 'live' = Supabase/Conta Azul. */
  source: 'demo' | 'live'
  status: 'conectando' | 'ativo' | 'erro' | 'offline'
  lastSync: Date | null
  message?: string
}

export type PeriodKey = '30d' | '90d' | '12m'
