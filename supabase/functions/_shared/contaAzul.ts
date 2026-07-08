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

/** Nome legível de um valor que pode ser string, objeto ou array de objetos. */
function toName(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'string') return v
  if (Array.isArray(v)) return toName(v[0])
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    return toName(
      pick(o, ['nome', 'razao_social', 'nome_fantasia', 'descricao', 'name']) ?? '',
    )
  }
  return String(v)
}

function toIsoDate(v: unknown): string | null {
  if (typeof v !== 'string' || !v) return null
  // aceita "2026-07-08" ou "2026-07-08T00:00:00Z"
  return v.slice(0, 10)
}

/**
 * Mapeia um item cru da API v2 para o nosso modelo.
 *
 * Formato observado (contas-a-pagar/receber "buscar"): { id, descricao, total,
 * pago, nao_pago, status, status_traduzido, data_vencimento, data_competencia,
 * data_criacao, data_alteracao, fornecedor|cliente: {nome}, categorias: [{...}],
 * centros_de_custo: [...] }. `raw` guarda o payload para auditoria.
 */
export function normalizeEvent(kind: CaKind, item: Record<string, unknown>): NormalizedEvent {
  const id = String(
    pick(item, ['id', 'uuid', 'id_parcela', 'parcela_id', 'evento_id']) ??
      crypto.randomUUID(),
  )
  const amount = Number(
    pick(item, ['total', 'valor', 'valor_total', 'amount', 'valor_parcela']) ?? 0,
  )
  const due = toIsoDate(
    pick(item, ['data_vencimento', 'vencimento', 'dataVencimento', 'due_date']),
  )
  const dueDate = due ?? new Date().toISOString().slice(0, 10)

  const counterparty = toName(
    pick(item, ['cliente', 'fornecedor', 'nome_cliente', 'nome_fornecedor', 'pessoa']),
  )
  const category =
    toName(pick(item, ['categorias', 'categoria', 'nome_categoria'])) ||
    (kind === 'receita' ? 'Receitas' : 'Despesas')
  const description = String(
    pick(item, ['descricao', 'description', 'observacao', 'historico']) ?? category,
  )

  // Situação: a API traz status (ex.: PAGO/EM_ABERTO/ATRASADO) e os valores
  // pago/nao_pago — consideramos quitado quando nada resta em aberto.
  const statusRaw = String(pick(item, ['status', 'situacao']) ?? '').toUpperCase()
  const pagoValor = Number(pick(item, ['pago']) ?? 0)
  const naoPago = Number(pick(item, ['nao_pago']) ?? NaN)
  const isPaid =
    /PAGO|RECEBIDO|LIQUIDAD|QUITAD|CONCILIAD|SETTLED|PAID/.test(statusRaw) ||
    (Number.isFinite(naoPago) && naoPago <= 0 && pagoValor > 0)

  // A listagem não expõe a data de liquidação; usamos a melhor aproximação
  // disponível (data de pagamento se vier; senão o vencimento).
  const settled = isPaid
    ? (toIsoDate(
        pick(item, ['data_pagamento', 'data_liquidacao', 'data_recebimento']),
      ) ?? dueDate)
    : null

  const today = new Date().toISOString().slice(0, 10)
  const status: 'pago' | 'pendente' | 'vencido' = isPaid
    ? 'pago'
    : dueDate < today
      ? 'vencido'
      : 'pendente'

  return {
    id,
    kind,
    description,
    category,
    counterparty,
    amount: Number.isFinite(amount) ? Math.abs(amount) : 0,
    due_date: dueDate,
    settled_date: settled,
    status,
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
