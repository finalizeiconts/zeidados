import { createClient } from '@supabase/supabase-js'
import type { FinancialEvent } from './types'

/**
 * Cliente Supabase. Se as variáveis de ambiente não estiverem definidas, o app
 * roda em modo demonstração (dados fictícios locais). Basta preencher o
 * `.env` com as credenciais do projeto para ligar os dados reais.
 */

// Configuração pública do projeto (Zei Client). A anon key é PÚBLICA por
// design (sempre embarca no bundle); a segurança vem do RLS + login. Embutir
// aqui elimina a dependência de variáveis de ambiente no build (Hostinger).
const FALLBACK_URL = 'https://ehrdmbbqvkxejgtkpbjb.supabase.co'
const FALLBACK_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVocmRtYmJxdmt4ZWpndGtwYmpiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4MzMyMjksImV4cCI6MjA5MTQwOTIyOX0.TbVqlKMJcz_odToYM_Wr_UrGLCrscHtuR0XfClPp39k'

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? FALLBACK_URL
const anonKey =
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? FALLBACK_ANON_KEY

/** Modo demonstração só quando pedido explicitamente (VITE_DEMO=1). */
export const isSupabaseConfigured =
  import.meta.env.VITE_DEMO !== '1' && Boolean(url && anonKey)

/**
 * Os dados do painel vivem no schema `contaazul` (isolado do resto do projeto
 * Zei Client). Lembre de expor esse schema em Project Settings → Data API.
 */
export const supabase = isSupabaseConfigured
  ? createClient(url as string, anonKey as string, {
      db: { schema: 'contaazul' },
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
