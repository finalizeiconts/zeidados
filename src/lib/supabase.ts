import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { FinancialEvent } from './types'

/**
 * Cliente Supabase. Se as variáveis de ambiente não estiverem definidas, o app
 * roda em modo demonstração (dados fictícios locais). Basta preencher o
 * `.env` com as credenciais do projeto para ligar os dados reais.
 */

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isSupabaseConfigured = Boolean(url && anonKey)

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url as string, anonKey as string, {
      auth: { persistSession: true, autoRefreshToken: true },
    })
  : null

/** Linha da tabela `ca_financial_events` (snake_case do Postgres). */
export interface FinancialEventRow {
  id: string
  kind: 'receita' | 'despesa'
  description: string
  category: string
  counterparty: string
  amount: number
  due_date: string
  settled_date: string | null
  status: 'pago' | 'pendente' | 'vencido'
}

export function rowToEvent(row: FinancialEventRow): FinancialEvent {
  return {
    id: row.id,
    kind: row.kind,
    description: row.description,
    category: row.category,
    counterparty: row.counterparty,
    amount: Number(row.amount),
    dueDate: row.due_date,
    settledDate: row.settled_date,
    status: row.status,
  }
}
