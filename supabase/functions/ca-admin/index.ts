// Função administrativa da integração Conta Azul — usada pelo processo de
// importação de dados históricos (Bom Controle → Conta Azul).
//
// O token OAuth NUNCA sai do servidor: esta função o lê/renova aqui dentro,
// exatamente como a ca-sync. Protegida pelos mesmos segredos (SYNC_SECRET ou
// service_role key).
//
// Ações (query string `action`):
//   contas          → lista contas financeiras existentes no Conta Azul
//   categorias      → lista categorias existentes (paginado completo)
//   buscar-pagar    → busca contas a pagar por descrição (?q=...)
//   protocolo       → consulta protocolo assíncrono (?id=...)
//   teste-criar     → cria 1 ÚNICO lançamento de teste de R$ 0,01 marcado
//                     "[TESTE IMPORTACAO ZEI DADOS - PODE EXCLUIR]"
//                     (?contato=UUID&conta=UUID&categoria=UUID)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { CA_API_BASE, refreshToken } from '../_shared/contaAzul.ts'
import { corsHeaders, json } from '../_shared/cors.ts'

async function caGet(accessToken: string, path: string): Promise<unknown> {
  const res = await fetch(CA_API_BASE + path, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}: ${text.slice(0, 300)}`)
  return text ? JSON.parse(text) : null
}

async function caPost(accessToken: string, path: string, body: unknown): Promise<unknown> {
  const res = await fetch(CA_API_BASE + path, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`POST ${path} -> ${res.status}: ${text.slice(0, 500)}`)
  return text ? JSON.parse(text) : null
}

function extractItems(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload as Record<string, unknown>[]
  const p = payload as Record<string, unknown>
  for (const key of ['itens', 'items', 'content', 'data', 'resultado', 'results']) {
    const v = p?.[key]
    if (Array.isArray(v)) return v as Record<string, unknown>[]
  }
  return []
}

/** Pagina um GET até esgotar. */
async function caGetAll(accessToken: string, path: string, maxPages = 20) {
  const all: Record<string, unknown>[] = []
  for (let page = 1; page <= maxPages; page++) {
    const sep = path.includes('?') ? '&' : '?'
    const payload = await caGet(
      accessToken,
      `${path}${sep}pagina=${page}&tamanho_pagina=100`,
    )
    const items = extractItems(payload)
    all.push(...items)
    if (items.length < 100) break
  }
  return all
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { db: { schema: 'contaazul' } },
  )

  const auth = req.headers.get('Authorization') ?? ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const syncSecret = Deno.env.get('SYNC_SECRET')
  const url = new URL(req.url)
  const urlSecret = url.searchParams.get('secret')
  const authorized =
    auth === `Bearer ${serviceKey}` || (!!syncSecret && urlSecret === syncSecret)
  if (!authorized) return json({ error: 'não autorizado' }, 401)

  try {
    // Token válido (renova se preciso) — mesmo fluxo da ca-sync.
    const clientId = Deno.env.get('CONTA_AZUL_CLIENT_ID')!
    const clientSecret = Deno.env.get('CONTA_AZUL_CLIENT_SECRET')!
    const { data: tokenRow } = await supabase
      .from('ca_tokens')
      .select('*')
      .eq('id', 'contaazul')
      .single()
    if (!tokenRow) throw new Error('Sem token do Conta Azul.')

    let accessToken = tokenRow.access_token as string
    if (Date.now() > new Date(tokenRow.expires_at as string).getTime() - 5 * 60_000) {
      const refreshed = await refreshToken({
        clientId,
        clientSecret,
        refreshToken: tokenRow.refresh_token as string,
      })
      accessToken = refreshed.access_token
      await supabase.from('ca_tokens').update({
        access_token: refreshed.access_token,
        refresh_token: refreshed.refresh_token,
        expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', 'contaazul')
    }

    const action = url.searchParams.get('action') ?? ''

    switch (action) {
      case 'contas': {
        // Pede explicitamente para incluir inativas, digitais e caixinhas.
        const contas = await caGetAll(
          accessToken,
          '/v1/conta-financeira?apenas_ativo=false&esconde_conta_digital=false&mostrar_caixinha=true',
        )
        return json({ ok: true, total: contas.length, contas })
      }

      case 'categorias': {
        const categorias = await caGetAll(accessToken, '/v1/categorias')
        return json({ ok: true, total: categorias.length, categorias })
      }

      case 'buscar-pagar': {
        const q = url.searchParams.get('q') ?? ''
        const payload = await caGet(
          accessToken,
          `/v1/financeiro/eventos-financeiros/contas-a-pagar/buscar?pagina=1&tamanho_pagina=20&descricao=${encodeURIComponent(q)}`,
        )
        return json({ ok: true, itens: extractItems(payload) })
      }

      case 'pessoa-codigo': {
        // Define o "Código do cliente" de uma Pessoa existente.
        const id = url.searchParams.get('id') ?? ''
        const codigo = url.searchParams.get('codigo') ?? ''
        if (!id || !codigo) return json({ error: 'informe ?id=UUID&codigo=XXXX' }, 400)
        const res = await fetch(`${CA_API_BASE}/v1/pessoas/${id}`, {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({ codigo }),
        })
        const text = await res.text()
        if (!res.ok) throw new Error(`PATCH pessoa -> ${res.status}: ${text.slice(0, 300)}`)
        return json({ ok: true, status: res.status })
      }

      case 'pessoas': {
        const termo = url.searchParams.get('q') ?? ''
        const payload = await caGet(
          accessToken,
          `/v1/pessoas?pagina=1&tamanho_pagina=20&termo_busca=${encodeURIComponent(termo)}`,
        )
        return json({ ok: true, itens: extractItems(payload) })
      }

      case 'debug-contas': {
        // Resposta crua da 1ª página, para diagnóstico de shape/filtros.
        const payload = await caGet(
          accessToken,
          '/v1/conta-financeira?pagina=1&tamanho_pagina=100',
        )
        return json({ ok: true, payload })
      }

      case 'parcela': {
        const id = url.searchParams.get('id') ?? ''
        const payload = await caGet(
          accessToken,
          `/v1/financeiro/eventos-financeiros/parcelas/${id}`,
        )
        return json({ ok: true, parcela: payload })
      }

      case 'protocolo': {
        const id = url.searchParams.get('id') ?? ''
        const payload = await caGet(accessToken, `/v1/protocolo/${id}`)
        return json({ ok: true, protocolo: payload })
      }

      case 'teste-criar': {
        // 1 único lançamento de R$ 0,01, claramente marcado para exclusão.
        const contato = url.searchParams.get('contato')
        const conta = url.searchParams.get('conta')
        const categoria = url.searchParams.get('categoria')
        if (!contato || !conta || !categoria) {
          return json(
            { error: 'informe ?contato=UUID&conta=UUID&categoria=UUID' },
            400,
          )
        }
        const hoje = new Date().toISOString().slice(0, 10)
        const DESC = '[TESTE IMPORTACAO ZEI DADOS - PODE EXCLUIR]'
        const body = {
          data_competencia: hoje,
          valor: 0.01,
          observacao: 'Lançamento de validação da importação — excluir.',
          descricao: DESC,
          contato,
          conta_financeira: conta,
          rateio: [{ id_categoria: categoria, valor: 0.01 }],
          condicao_pagamento: {
            parcelas: [
              {
                descricao: DESC,
                data_vencimento: hoje,
                nota: 'teste de integração',
                conta_financeira: conta,
                detalhe_valor: { valor_bruto: 0.01, valor_liquido: 0.01 },
                metodo_pagamento: 'OUTRO',
              },
            ],
          },
        }
        const resp = await caPost(
          accessToken,
          '/v1/financeiro/eventos-financeiros/contas-a-pagar',
          body,
        )
        return json({ ok: true, resultado: resp })
      }

      default:
        return json({ error: `ação desconhecida: "${action}"` }, 400)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('ca-admin erro:', message)
    return json({ ok: false, error: message }, 500)
  }
})
