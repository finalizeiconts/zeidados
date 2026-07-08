// Sincroniza clientes do ZeiClient (public.cs_clientes) → Pessoas do Conta
// Azul. Idempotente: usa contaazul.ca_pessoa_map para nunca duplicar; antes de
// criar, procura no Conta Azul por documento (CNPJ/CPF) e, se já existir,
// apenas mapeia.
//
// Parâmetros (query string):
//   dry=1     → NÃO cria nada; retorna o plano do que seria feito
//   limit=N   → processa no máximo N clientes nesta chamada (padrão 50)
//   status=X  → filtra status do CRM (padrão 'ativo')
//
// Protegida por SYNC_SECRET/service_role, como as demais.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { CA_API_BASE, refreshToken } from '../_shared/contaAzul.ts'
import { corsHeaders, json } from '../_shared/cors.ts'

interface CsCliente {
  id: string
  nome: string
  codigo: string | null
  cnpj_cpf: string | null
  email: string | null
  telefone: string | null
  nome_fantasia: string | null
  cidade: string | null
  estado: string | null
  endereco: string | null
  status: string
}

function onlyDigits(v: string | null): string {
  return (v ?? '').replace(/\D/g, '')
}

/** Monta o payload de criação de Pessoa a partir do cliente do CRM. */
function buildPessoa(c: CsCliente) {
  const doc = onlyDigits(c.cnpj_cpf)
  const isCpf = doc.length === 11
  const isCnpj = doc.length === 14
  const tipo = isCpf ? 'Física' : 'Jurídica' // sem doc válido, assume Jurídica

  const payload: Record<string, unknown> = {
    nome: c.nome,
    tipo_pessoa: tipo,
    perfis: [{ tipo_perfil: 'Cliente' }],
    ativo: true,
  }
  // "Código do cliente" no Conta Azul = código do ZeiClient (quem é quem).
  if (c.codigo) payload.codigo = c.codigo
  if (isCpf) payload.cpf = doc
  if (isCnpj) payload.cnpj = doc
  // Campo pode vir com múltiplos e-mails separados por vírgula/;: usa o 1º.
  const email = (c.email ?? '').split(/[,;]/)[0].trim().toLowerCase()
  if (email) payload.email = email
  // Telefone: só dígitos, sem +55, DDD/número não começando em zero;
  // aceita 8-9 (sem DDD) ou 10-11 (com DDD). Inválido → omite.
  let fone = onlyDigits(c.telefone)
  if (fone.startsWith('55') && fone.length > 11) fone = fone.slice(2)
  fone = fone.replace(/^0+/, '')
  if (/^[1-9]\d{7,10}$/.test(fone)) payload.telefone_comercial = fone
  if (c.nome_fantasia) payload.nome_fantasia = c.nome_fantasia
  if (c.cidade || c.estado) {
    payload.enderecos = [
      {
        logradouro: c.endereco ?? '',
        cidade: c.cidade ?? '',
        estado: c.estado ?? '',
        pais: 'Brasil',
      },
    ]
  }
  return payload
}

async function caFetch(
  accessToken: string,
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(CA_API_BASE + path, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  })
  const text = await res.text()
  let body: unknown = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  return { status: res.status, body }
}

function extractItems(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload as Record<string, unknown>[]
  const p = payload as Record<string, unknown>
  for (const key of ['itens', 'items', 'content', 'data']) {
    const v = p?.[key]
    if (Array.isArray(v)) return v as Record<string, unknown>[]
  }
  return []
}

/** Procura Pessoa existente no Conta Azul pelo documento; retorna o id ou null. */
async function findByDoc(accessToken: string, doc: string): Promise<string | null> {
  if (!doc) return null
  const { status, body } = await caFetch(
    accessToken,
    `/v1/pessoas?pagina=1&tamanho_pagina=10&termo_busca=${encodeURIComponent(doc)}`,
  )
  if (status !== 200) return null
  for (const p of extractItems(body)) {
    const pDoc = onlyDigits(String(p.cnpj ?? p.cpf ?? p.documento ?? ''))
    if (pDoc === doc) return String(p.id)
  }
  return null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { db: { schema: 'contaazul' } },
  )
  // O CRM vive no schema public — cliente separado para leitura.
  const supabasePublic = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const url = new URL(req.url)
  const auth = req.headers.get('Authorization') ?? ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const syncSecret = Deno.env.get('SYNC_SECRET')
  let authorized =
    auth === `Bearer ${serviceKey}` ||
    (!!syncSecret && url.searchParams.get('secret') === syncSecret)

  // Também aceita usuário LOGADO do app (botão "Sincronizar" no ZeiClient).
  // Operação idempotente e não destrutiva; o app é interno (staff).
  if (!authorized && auth.startsWith('Bearer ')) {
    const { data } = await supabase.auth.getUser(auth.slice(7))
    authorized = Boolean(data?.user)
  }
  if (!authorized) return json({ error: 'não autorizado' }, 401)

  // Parâmetros via query string (cron/curl) ou corpo JSON (functions.invoke).
  let bodyParams: Record<string, unknown> = {}
  if (req.method === 'POST') {
    try {
      bodyParams = (await req.json()) as Record<string, unknown>
    } catch {
      /* sem corpo */
    }
  }
  const dry =
    url.searchParams.get('dry') === '1' || bodyParams.dry === true || bodyParams.dry === 1
  const limit = Math.min(
    200,
    Number(bodyParams.limit ?? url.searchParams.get('limit') ?? 50),
  )
  const statusFiltro = String(
    bodyParams.status ?? url.searchParams.get('status') ?? 'ativo',
  )

  const { data: logRow } = dry
    ? { data: null }
    : await supabase
        .from('ca_pessoas_sync_log')
        .insert({ started_at: new Date().toISOString() })
        .select('id')
        .single()

  const finish = (patch: Record<string, unknown>) =>
    logRow?.id
      ? supabase.from('ca_pessoas_sync_log').update(patch).eq('id', logRow.id)
      : Promise.resolve()

  try {
    // Token válido (renova se preciso).
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
      const r = await refreshToken({
        clientId,
        clientSecret,
        refreshToken: tokenRow.refresh_token as string,
      })
      accessToken = r.access_token
      await supabase.from('ca_tokens').update({
        access_token: r.access_token,
        refresh_token: r.refresh_token,
        expires_at: new Date(Date.now() + r.expires_in * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', 'contaazul')
    }

    // Clientes do CRM ainda não mapeados.
    const { data: clientes, error: cliErr } = await supabasePublic
      .from('cs_clientes')
      .select('id, nome, codigo, cnpj_cpf, email, telefone, nome_fantasia, cidade, estado, endereco, status')
      .eq('status', statusFiltro)
      .order('nome')
    if (cliErr) throw cliErr

    const { data: mapeados } = await supabase
      .from('ca_pessoa_map')
      .select('cs_cliente_id')
    const jaMapeados = new Set((mapeados ?? []).map((m) => m.cs_cliente_id))

    const pendentes = (clientes as CsCliente[]).filter((c) => !jaMapeados.has(c.id))
    const lote = pendentes.slice(0, limit)

    if (dry) {
      return json({
        ok: true,
        dry_run: true,
        crm_total: clientes?.length ?? 0,
        ja_mapeados: jaMapeados.size,
        pendentes: pendentes.length,
        neste_lote: lote.length,
        plano: lote.map((c) => ({
          nome: c.nome,
          documento: onlyDigits(c.cnpj_cpf) || '(sem documento)',
          tipo: onlyDigits(c.cnpj_cpf).length === 11 ? 'Física' : 'Jurídica',
          email: c.email ?? '(sem email)',
        })),
      })
    }

    let criados = 0
    let mapeadosAgora = 0
    let pulados = 0
    const detalhes: Array<Record<string, unknown>> = []

    for (const c of lote) {
      const doc = onlyDigits(c.cnpj_cpf)

      // 1) Já existe no Conta Azul? Só mapeia.
      const existente = doc ? await findByDoc(accessToken, doc) : null
      if (existente) {
        await supabase.from('ca_pessoa_map').upsert({
          cs_cliente_id: c.id,
          ca_pessoa_id: existente,
          nome: c.nome,
        })
        mapeadosAgora++
        detalhes.push({ nome: c.nome, acao: 'mapeado (já existia)', ca_id: existente })
        continue
      }

      // 2) Cria a Pessoa.
      const { status, body } = await caFetch(accessToken, '/v1/pessoas', {
        method: 'POST',
        body: JSON.stringify(buildPessoa(c)),
      })
      if (status === 200 || status === 201) {
        const caId = String((body as Record<string, unknown>)?.id ?? '')
        if (caId) {
          await supabase.from('ca_pessoa_map').upsert({
            cs_cliente_id: c.id,
            ca_pessoa_id: caId,
            nome: c.nome,
          })
        }
        criados++
        detalhes.push({ nome: c.nome, acao: 'criado', ca_id: caId })
      } else {
        pulados++
        detalhes.push({
          nome: c.nome,
          acao: 'ERRO',
          status,
          erro: JSON.stringify(body).slice(0, 200),
        })
      }
      // Ritmo: bem abaixo de 10 req/s.
      await new Promise((r) => setTimeout(r, 150))
    }

    await finish({
      finished_at: new Date().toISOString(),
      ok: true,
      criados,
      mapeados: mapeadosAgora,
      pulados,
      message: `lote de ${lote.length}; restam ${pendentes.length - lote.length}`,
    })

    return json({
      ok: true,
      criados,
      mapeados: mapeadosAgora,
      erros: pulados,
      restantes: pendentes.length - lote.length,
      detalhes,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('ca-pessoas-sync erro:', message)
    await finish({ finished_at: new Date().toISOString(), ok: false, message })
    return json({ ok: false, error: message }, 500)
  }
})
