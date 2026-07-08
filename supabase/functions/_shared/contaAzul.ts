// Cliente da API do Conta Azul (v2) para as Edge Functions (Deno).
// Docs: https://developers.contaazul.com

export const CA_AUTH_BASE = 'https://auth.contaazul.com'
export const CA_API_BASE = 'https://api-v2.contaazul.com'
export const CA_SCOPE = 'openid profile aws.cognito.signin.user.admin'

export interface CaTokenResponse {
  access_token: string
  refresh_token: string
  expires_in: number
  token_type: string
}

function basicAuthHeader(clientId: string, clientSecret: string): string {
  return 'Basic ' + btoa(`${clientId}:${clientSecret}`)
}

/** Monta a URL de autorização (Authorization Code). */
export function buildAuthorizeUrl(params: {
  clientId: string
  redirectUri: string
  state: string
}): string {
  const u = new URL(`${CA_AUTH_BASE}/oauth2/authorize`)
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('client_id', params.clientId)
  u.searchParams.set('redirect_uri', params.redirectUri)
  u.searchParams.set('scope', CA_SCOPE)
  u.searchParams.set('state', params.state)
  return u.toString()
}

/** Troca o authorization code por tokens. */
export async function exchangeCode(opts: {
  clientId: string
  clientSecret: string
  code: string
  redirectUri: string
}): Promise<CaTokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: opts.code,
    redirect_uri: opts.redirectUri,
  })
  const res = await fetch(`${CA_AUTH_BASE}/oauth2/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: basicAuthHeader(opts.clientId, opts.clientSecret),
    },
    body,
  })
  if (!res.ok) {
    throw new Error(`Falha ao trocar code (${res.status}): ${await res.text()}`)
  }
  return (await res.json()) as CaTokenResponse
}

/** Renova o access token usando o refresh token. */
export async function refreshToken(opts: {
  clientId: string
  clientSecret: string
  refreshToken: string
}): Promise<CaTokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: opts.refreshToken,
  })
  const res = await fetch(`${CA_AUTH_BASE}/oauth2/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: basicAuthHeader(opts.clientId, opts.clientSecret),
    },
    body,
  })
  if (!res.ok) {
    throw new Error(`Falha ao renovar token (${res.status}): ${await res.text()}`)
  }
  const data = (await res.json()) as CaTokenResponse
  // Alguns provedores OAuth não devolvem novo refresh_token na renovação.
  if (!data.refresh_token) data.refresh_token = opts.refreshToken
  return data
}

// ── Consulta de eventos financeiros ────────────────────────────────────────

export type CaKind = 'receita' | 'despesa'

const ENDPOINT: Record<CaKind, string> = {
  receita: '/v1/financeiro/eventos-financeiros/contas-a-receber/buscar',
  despesa: '/v1/financeiro/eventos-financeiros/contas-a-pagar/buscar',
}

export interface NormalizedEvent {
  id: string
  kind: CaKind
  description: string
  category: string
  counterparty: string
  amount: number
  due_date: string
  settled_date: string | null
  status: 'pago' | 'pendente' | 'vencido'
  raw: unknown
}

/** Extrai o 1º campo presente dentre vários nomes possíveis. */
function pick(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null) return obj[k]
  }
  return undefined
}

function toIsoDate(v: unknown): string | null {
  if (typeof v !== 'string' || !v) return null
  // aceita "2026-07-08" ou "2026-07-08T00:00:00Z"
  return v.slice(0, 10)
}

function normalizeStatus(
  rawStatus: unknown,
  dueDate: string,
  settled: string | null,
): 'pago' | 'pendente' | 'vencido' {
  const s = String(rawStatus ?? '').toUpperCase()
  if (settled || /PAGO|RECEBIDO|LIQUIDAD|QUITAD|SETTLED|PAID/.test(s)) return 'pago'
  // sem liquidação: vencido se passou do vencimento
  const today = new Date().toISOString().slice(0, 10)
  if (dueDate && dueDate < today) return 'vencido'
  return 'pendente'
}

/**
 * Mapeia um item cru da API para o nosso modelo. Tolerante a variações de nome
 * de campo — a API v2 pode usar rótulos diferentes; registramos o `raw` para
 * conferência. Ajuste os nomes aqui após inspecionar a resposta real.
 */
export function normalizeEvent(kind: CaKind, item: Record<string, unknown>): NormalizedEvent {
  const id = String(
    pick(item, ['id', 'uuid', 'id_parcela', 'parcela_id', 'evento_id']) ??
      crypto.randomUUID(),
  )
  const amount = Number(
    pick(item, ['valor', 'valor_total', 'total', 'amount', 'valor_parcela']) ?? 0,
  )
  const due = toIsoDate(
    pick(item, ['data_vencimento', 'vencimento', 'dataVencimento', 'due_date']),
  )
  const settled = toIsoDate(
    pick(item, ['data_pagamento', 'data_liquidacao', 'data_recebimento', 'settled_date']),
  )
  const dueDate = due ?? new Date().toISOString().slice(0, 10)
  const counterparty = String(
    pick(item, [
      'nome_cliente',
      'cliente',
      'nome_fornecedor',
      'fornecedor',
      'nome',
      'pessoa',
    ]) ?? '',
  )
  const category = String(
    pick(item, ['categoria', 'nome_categoria', 'category']) ??
      (kind === 'receita' ? 'Receitas' : 'Despesas'),
  )
  const description = String(
    pick(item, ['descricao', 'description', 'observacao', 'historico']) ?? category,
  )

  return {
    id,
    kind,
    description,
    category,
    counterparty,
    amount: Number.isFinite(amount) ? Math.abs(amount) : 0,
    due_date: dueDate,
    settled_date: settled,
    status: normalizeStatus(pick(item, ['status', 'situacao']), dueDate, settled),
    raw: item,
  }
}

/** Retorna o array de itens de uma resposta paginada (nome de campo tolerante). */
function extractItems(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload as Record<string, unknown>[]
  const p = payload as Record<string, unknown>
  for (const key of ['itens', 'items', 'content', 'data', 'resultado', 'results']) {
    const v = p?.[key]
    if (Array.isArray(v)) return v as Record<string, unknown>[]
  }
  return []
}

/**
 * Busca todos os eventos de um tipo dentro de uma janela de vencimento,
 * paginando até esgotar.
 */
export async function fetchEvents(opts: {
  accessToken: string
  kind: CaKind
  from: string // YYYY-MM-DD
  to: string // YYYY-MM-DD
  pageSize?: number
  maxPages?: number
}): Promise<NormalizedEvent[]> {
  const pageSize = opts.pageSize ?? 100
  const maxPages = opts.maxPages ?? 50
  const out: NormalizedEvent[] = []

  for (let page = 1; page <= maxPages; page++) {
    const url = new URL(CA_API_BASE + ENDPOINT[opts.kind])
    url.searchParams.set('pagina', String(page))
    url.searchParams.set('tamanho_pagina', String(pageSize))
    url.searchParams.set('data_vencimento_de', opts.from)
    url.searchParams.set('data_vencimento_ate', opts.to)

    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${opts.accessToken}`,
        Accept: 'application/json',
      },
    })
    if (!res.ok) {
      throw new Error(
        `Erro ao buscar ${opts.kind} (${res.status}): ${await res.text()}`,
      )
    }
    const payload = await res.json()
    const items = extractItems(payload)
    for (const item of items) out.push(normalizeEvent(opts.kind, item))
    if (items.length < pageSize) break // última página
  }

  return out
}
