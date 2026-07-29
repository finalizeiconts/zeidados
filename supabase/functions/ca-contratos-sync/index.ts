// Contratos recorrentes no Conta Azul a partir do ZeiClient.
//
// Gatilho de negócio: contrato assinado no D4Sign → cliente vira "ativo" no
// CRM → este robô cria o contrato de faturamento recorrente no Conta Azul
// usando os dados contratuais que o CRM já guarda (honorários, dia de
// vencimento, recorrência, início dos serviços).
//
// Trava de segurança financeira: o modo automático SÓ cria contrato para
// clientes cujo cadastro no CRM nasceu a partir de ca_config
// ('contratos_auto_desde'). A carteira antiga (cobrança ainda fora do Conta
// Azul) não ganha contrato sozinho — para ela existe a ação manual "criar"
// disparada pelo painel de integrações do ZeiClient.
//
// Regra do dia 1º: o Conta Azul emite a 1ª venda no ato da criação, datada do
// dia da criação — então o contrato SÓ nasce no mês da própria 1ª cobrança
// (criar_lote/auto filtram por isso; cron mensal do dia 1º faz as ondas de
// dez/jan sozinho). Assim a data da venda cai sempre no mês do vencimento.
//
// Ações (query string ou corpo JSON):
//   acao=plano                      → lista candidatos (não cria nada)
//   acao=criar&cliente=<uuid>       → cria contrato para 1 cliente (manual)
//   acao=criar_lote[&ignorar_mes=1] → 10 por chamada, só quem vence NESTE mês
//   acao=auto                       → elegíveis do modo automático (mesmo gate)
//   acao=encerrar&cliente=<uuid>    → encerra o contrato no Conta Azul

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { CA_API_BASE, refreshToken } from '../_shared/contaAzul.ts'
import { corsHeaders, json } from '../_shared/cors.ts'

interface Candidato {
  id: string
  nome: string
  codigo: string | null
  cnpj_cpf: string | null
  valor_honorarios: number | null
  dia_vencimento: number | null
  recorrencia_pagamento: string | null
  data_inicio_servicos: string | null
  plano_servicos: string | null
  oportunidade_origem_id: string | null
  proximo_faturamento: string | null
  nao_faturar: boolean | null
  created_at: string
}

function onlyDigits(v: string | null): string {
  return (v ?? '').replace(/\D/g, '')
}

/**
 * Frequência do contrato no Conta Azul.
 *
 * O CA modela periodicidade como TIPO + INTERVALO: semestral não é um tipo
 * próprio, é "MENSAL a cada 6". Mandar MENSAL sem intervalo era o defeito que
 * cobraria um semestral de R$ 2.200 todo mês — descoberto na bancada de teste
 * do ZeiClient (28/07/2026) antes de chegar aqui.
 */
function frequenciaDe(recorrencia: string | null | undefined) {
  const r = (recorrencia ?? 'mensal').trim().toLowerCase()
  if (r.startsWith('semestr'))  return { tipo_frequencia: 'MENSAL', intervalo_frequencia: 6,  rotulo: 'semestral' }
  if (r.startsWith('trimestr')) return { tipo_frequencia: 'MENSAL', intervalo_frequencia: 3,  rotulo: 'trimestral' }
  if (r.startsWith('bimestr'))  return { tipo_frequencia: 'MENSAL', intervalo_frequencia: 2,  rotulo: 'bimestral' }
  if (r.startsWith('anual'))    return { tipo_frequencia: 'MENSAL', intervalo_frequencia: 12, rotulo: 'anual' }
  return { tipo_frequencia: 'MENSAL', intervalo_frequencia: 1, rotulo: 'mensal' }
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** Hoje no fuso de Brasília — o gate do "dia 1º" é no calendário BR, e entre
 *  21h e meia-noite a data UTC já virou. */
function hojeBRT(): string {
  return new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10)
}

/** Próxima ocorrência do dia de vencimento a partir de hoje/início. */
function primeiraDataVencimento(dia: number, inicio: string | null): string {
  const base = inicio && inicio > isoDate(new Date()) ? new Date(inicio) : new Date()
  const d = new Date(base.getFullYear(), base.getMonth(), dia)
  if (d <= base) d.setMonth(d.getMonth() + 1)
  return isoDate(d)
}

/**
 * Primeira cobrança respeitando o piso do cliente (proximo_faturamento).
 *
 * O piso é a memória da migração: o que vence antes dele JÁ FOI cobrado por
 * fora (Asaas manual). Ignorá-lo tem dois estragos: mensal criado antes do
 * dia de vencimento geraria a venda do mês já cobrado; e semestral/anual
 * nasceria no mês errado e DESALINHARIA O CICLO PRA SEMPRE — um jun/dez
 * criado em agosto viraria ago/fev, porque o CA repete a partir da primeira.
 * Avança mês a mês (mantendo o dia) até cruzar o piso.
 */
function primeiraDataComPiso(dia: number, inicio: string | null, piso: string | null): string {
  let data = primeiraDataVencimento(dia, inicio)
  if (!piso) return data
  let guarda = 0
  while (data < piso && guarda < 24) {
    const [y, m] = data.split('-').map(Number)
    data = isoDate(new Date(y, m, dia)) // mês seguinte, mesmo dia
    guarda++
  }
  return data
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { db: { schema: 'contaazul' } },
  )
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
  if (!authorized && auth.startsWith('Bearer ')) {
    const { data } = await supabase.auth.getUser(auth.slice(7))
    authorized = Boolean(data?.user)
  }
  if (!authorized) return json({ error: 'não autorizado' }, 401)

  let bodyParams: Record<string, unknown> = {}
  if (req.method === 'POST') {
    try {
      bodyParams = (await req.json()) as Record<string, unknown>
    } catch {
      /* sem corpo */
    }
  }
  const acao = String(bodyParams.acao ?? url.searchParams.get('acao') ?? 'plano')
  const clienteId = String(bodyParams.cliente ?? url.searchParams.get('cliente') ?? '')

  try {
    // ── Token válido ────────────────────────────────────────────────────────
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

    // ── Config ──────────────────────────────────────────────────────────────
    const { data: cfgRows } = await supabase.from('ca_config').select('chave, valor')
    const cfg = new Map((cfgRows ?? []).map((r) => [r.chave as string, r.valor as string]))
    const autoDesde = cfg.get('contratos_auto_desde') ?? isoDate(new Date())

    // ── Candidatos: ativos, com CPF/CNPJ, honorários e dia, sem contrato ────
    const { data: clientesRaw, error: cliErr } = await supabasePublic
      .from('cs_clientes')
      .select('id, nome, codigo, cnpj_cpf, valor_honorarios, dia_vencimento, recorrencia_pagamento, data_inicio_servicos, plano_servicos, oportunidade_origem_id, proximo_faturamento, nao_faturar, created_at')
      .eq('status', 'ativo')
    if (cliErr) throw cliErr

    const { data: contratos } = await supabase
      .from('ca_contrato_map')
      .select('cs_cliente_id')
    const comContrato = new Set((contratos ?? []).map((r) => r.cs_cliente_id))

    const { data: pessoas } = await supabase
      .from('ca_pessoa_map')
      .select('cs_cliente_id, ca_pessoa_id')
    const pessoaDe = new Map(
      (pessoas ?? []).map((r) => [r.cs_cliente_id as string, r.ca_pessoa_id as string]),
    )

    const candidatos = (clientesRaw as Candidato[]).filter(
      (c) =>
        !comContrato.has(c.id) &&
        // CPF (11) entra junto com CNPJ (14): parte da carteira é pessoa
        // física — produtor rural etc. — com contrato de honorários igual.
        // A ca-pessoas-sync já cria Pessoa Física no CA sem problema.
        [11, 14].includes(onlyDigits(c.cnpj_cpf).length) &&
        // Cliente marcado "não faturar" não ganha contrato: geraria vendas no
        // CA que ninguém vai cobrar — sujeira contábil garantida.
        !c.nao_faturar &&
        Number(c.valor_honorarios) > 0 &&
        Number(c.dia_vencimento) >= 1 &&
        Number(c.dia_vencimento) <= 31,
    )
    const autoElegiveis = candidatos.filter((c) => c.created_at >= autoDesde)

    // CNPJ/CPF repetido entre candidatos = cadastro duplicado no CRM. Criar
    // contrato pros dois cobraria a MESMA empresa duas vezes. Nenhum dos dois
    // é criado — resolve o cadastro primeiro.
    const porDoc = new Map<string, number>()
    for (const c of candidatos) {
      const d = onlyDigits(c.cnpj_cpf)
      porDoc.set(d, (porDoc.get(d) ?? 0) + 1)
    }
    const docsDuplicados = new Set([...porDoc.entries()].filter(([, n]) => n > 1).map(([d]) => d))

    // ── Gate do dia 1º ──────────────────────────────────────────────────────
    // O Conta Azul emite a 1ª venda NO ATO da criação, datada do dia da
    // criação — e cada geração do dia 1º emite o ciclo seguinte. Contrato
    // criado no meio do mês nasce com a cadeia toda deslocada (venda de
    // setembro datada 01/08, etc.). A única forma da data da venda cair no mês
    // do próprio vencimento é criar o contrato DENTRO do mês da 1ª cobrança —
    // por isso só entram no lote os candidatos cujo primeiro vencimento cai no
    // mês corrente. Semestrais/anuais esperam o mês deles (o cron mensal do
    // dia 1º cuida). ignorar_mes=1 fura o gate — teste consciente, nada mais.
    const ignorarMes = bodyParams.ignorar_mes === true || bodyParams.ignorar_mes === 1 ||
      url.searchParams.get('ignorar_mes') === '1'
    const mesAtual = hojeBRT().slice(0, 7)
    const primeiraDe = (c: Candidato) =>
      primeiraDataComPiso(Number(c.dia_vencimento), c.data_inicio_servicos, c.proximo_faturamento)
    const noMes = (c: Candidato) => primeiraDe(c).slice(0, 7) === mesAtual

    if (acao === 'plano') {
      // Lista COMPLETA — é a revisão pré-migração; amostrar esconderia erro.
      const lista = []
      for (const c of candidatos) {
        lista.push({
          nome: c.nome,
          documento: onlyDigits(c.cnpj_cpf),
          duplicado: docsDuplicados.has(onlyDigits(c.cnpj_cpf)),
          honorarios: c.valor_honorarios,
          recorrencia: c.recorrencia_pagamento ?? 'mensal',
          dia: c.dia_vencimento,
          piso: c.proximo_faturamento,
          primeira_cobranca_prevista: primeiraDe(c),
          cria_no_mes: primeiraDe(c).slice(0, 7),
          servico: await servicoDoCliente(c),
          pessoa_sincronizada: pessoaDe.has(c.id),
        })
      }
      return json({
        ok: true,
        auto_desde: autoDesde,
        mes_atual: mesAtual,
        candidatos_total: candidatos.length,
        elegiveis_neste_mes: candidatos.filter(noMes).length,
        aguardando_mes_futuro: candidatos.filter((c) => !noMes(c)).length,
        auto_elegiveis: autoElegiveis.length,
        documentos_duplicados: [...docsDuplicados],
        sem_pessoa_sincronizada: candidatos.filter((c) => !pessoaDe.has(c.id)).length,
        lista,
      })
    }

    // ── Serviço do contrato = serviço contratado no CRM ─────────────────────
    // Ordem de resolução: tipos de serviço da oportunidade de origem (prioriza
    // os que exigem onboarding = planos recorrentes) → plano_servicos do
    // cliente → fallback "Honorários Contábeis".
    async function servicoDoCliente(c: Candidato): Promise<string> {
      if (c.oportunidade_origem_id) {
        const { data: links } = await supabasePublic
          .from('cs_oportunidade_tipo_links')
          .select('tipo_id')
          .eq('oportunidade_id', c.oportunidade_origem_id)
        const tipoIds = (links ?? []).map((l) => l.tipo_id as string)
        if (tipoIds.length > 0) {
          const { data: tipos } = await supabasePublic
            .from('cs_crm_tipos_servico')
            .select('nome, requer_onboarding')
            .in('id', tipoIds)
          const recorrente = (tipos ?? []).find((t) => t.requer_onboarding)
          const escolhido = recorrente ?? (tipos ?? [])[0]
          if (escolhido?.nome) return String(escolhido.nome)
        }
      }
      if (c.plano_servicos) return c.plano_servicos
      return 'Honorários Contábeis'
    }

    // Garante o serviço homônimo no Conta Azul (cria uma única vez, mapeia).
    async function servicoCA(nome: string): Promise<string> {
      const { data: mapRow } = await supabase
        .from('ca_servico_map')
        .select('ca_servico_id')
        .eq('nome', nome)
        .maybeSingle()
      if (mapRow?.ca_servico_id) return mapRow.ca_servico_id as string

      const busca = await caFetch(
        accessToken,
        `/v1/servicos?pagina=1&tamanho_pagina=50&descricao=${encodeURIComponent(nome)}`,
      )
      let id = ''
      for (const s of extractItems(busca.body)) {
        if (String(s.descricao ?? s.nome ?? '').toLowerCase() === nome.toLowerCase()) {
          id = String(s.id)
          break
        }
      }
      if (!id) {
        const criado = await caFetch(accessToken, '/v1/servicos', {
          method: 'POST',
          // `status` é obrigatório (ATIVO | INATIVO) — sem ele o CA devolve 400 e o
          // contrato inteiro morre antes de nascer.
          body: JSON.stringify({ descricao: nome, tipo: 'PRESTADO', valor_venda: 0, status: 'ATIVO' }),
        })
        if (criado.status !== 200 && criado.status !== 201) {
          throw new Error(
            `Falha ao criar serviço "${nome}": ${criado.status} ${JSON.stringify(criado.body).slice(0, 300)}`,
          )
        }
        id = String((criado.body as Record<string, unknown>)?.id ?? '')
      }
      if (!id) throw new Error(`Não foi possível obter o serviço "${nome}".`)
      await supabase.from('ca_servico_map').upsert({ nome, ca_servico_id: id })
      return id
    }

    async function criarContrato(c: Candidato, origem: 'auto' | 'manual') {
      const caPessoa = pessoaDe.get(c.id)
      if (!caPessoa) {
        return { ok: false, nome: c.nome, erro: 'cliente ainda não sincronizado como Pessoa' }
      }
      const nomeServico = await servicoDoCliente(c)
      const idServico = await servicoCA(nomeServico)

      const prox = await caFetch(accessToken, '/v1/contratos/proximo-numero')
      const numero = Number(
        (prox.body as Record<string, unknown>)?.numero ?? prox.body ?? 0,
      )

      if (docsDuplicados.has(onlyDigits(c.cnpj_cpf))) {
        return { ok: false, nome: c.nome, erro: 'CPF/CNPJ duplicado no CRM — resolva o cadastro antes' }
      }
      const dia = Number(c.dia_vencimento)
      const inicio = c.data_inicio_servicos ?? isoDate(new Date())
      const freq = frequenciaDe(c.recorrencia_pagamento)
      const payload = {
        id_cliente: caPessoa,
        data_emissao: isoDate(new Date()),
        observacoes: `Contrato gerado pelo ZeiClient — cliente ${c.codigo ?? ''} ${c.nome}`,
        termos: {
          tipo_frequencia: freq.tipo_frequencia,
          intervalo_frequencia: freq.intervalo_frequencia,
          tipo_expiracao: 'NUNCA',
          data_inicio: inicio,
          data_fim: '2099-12-31',
          // Emite a venda no dia 1º e vence no dia do contrato — o boleto
          // nasce com prazo pro cliente, em vez de nascer no próprio dia do
          // vencimento (regra combinada em 28/07/2026). Obrigatório: sem este
          // campo o CA devolve 400.
          dia_emissao_venda: 1,
          numero,
        },
        condicao_pagamento: {
          tipo_pagamento: 'BOLETO_BANCARIO',
          dia_vencimento: dia,
          primeira_data_vencimento: primeiraDataComPiso(dia, inicio, c.proximo_faturamento),
        },
        itens: [
          {
            id: idServico,
            quantidade: 1,
            descricao: `${nomeServico} — ${freq.rotulo}`,
            valor: Number(c.valor_honorarios),
          },
        ],
      }

      const res = await caFetch(accessToken, '/v1/contratos', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      if (res.status !== 200 && res.status !== 201 && res.status !== 202) {
        return {
          ok: false,
          nome: c.nome,
          erro: `${res.status}: ${JSON.stringify(res.body).slice(0, 250)}`,
        }
      }
      const contratoId = String(
        (res.body as Record<string, unknown>)?.id ??
          (res.body as Record<string, unknown>)?.protocolo ??
          '',
      )
      await supabase.from('ca_contrato_map').upsert({
        cs_cliente_id: c.id,
        ca_contrato_id: contratoId,
        numero,
        valor: Number(c.valor_honorarios),
        dia_vencimento: dia,
        origem,
        status: 'ativo',
        // Marca d'água NÃO-nula: null significa "contrato pré-existente" e faz
        // o cron da ponte ADOTAR a primeira venda em vez de faturá-la. Em
        // contrato novo, a primeira venda emitida JÁ deve virar boleto — o
        // uuid zero diz "nada processado, fatura tudo que vier".
        ultima_venda_processada: '00000000-0000-0000-0000-000000000000',
      })
      return { ok: true, nome: c.nome, contrato: contratoId, numero }
    }

    if (acao === 'criar') {
      if (!clienteId) return json({ error: 'informe cliente=<uuid>' }, 400)
      const c = (clientesRaw as Candidato[]).find((x) => x.id === clienteId)
      if (!c) return json({ error: 'cliente ativo não encontrado' }, 404)
      if (comContrato.has(c.id)) return json({ error: 'cliente já tem contrato' }, 409)
      const r = await criarContrato(c, 'manual')
      return json({ ok: r.ok, resultado: r }, r.ok ? 200 : 422)
    }

    // Migração da carteira: processa TODOS os candidatos, em lotes de 10 por
    // chamada (rate limit do CA). Rode acao=plano antes e revise a lista —
    // este aqui cria de verdade. Repita a chamada até restantes = 0.
    if (acao === 'criar_lote') {
      const elegiveis = ignorarMes ? candidatos : candidatos.filter(noMes)
      const lote = elegiveis.slice(0, 10)
      const resultados = []
      for (const c of lote) {
        resultados.push(await criarContrato(c, 'manual'))
        await new Promise((r) => setTimeout(r, 300))
      }
      return json({
        ok: true,
        mes_atual: mesAtual,
        processados: resultados.length,
        criados: resultados.filter((r) => r.ok).length,
        falhas: resultados.filter((r) => !r.ok),
        restantes: Math.max(0, elegiveis.length - lote.length),
        aguardando_mes_futuro: candidatos.length - elegiveis.length,
      })
    }

    if (acao === 'auto') {
      const resultados = []
      for (const c of autoElegiveis.filter(noMes).slice(0, 20)) {
        resultados.push(await criarContrato(c, 'auto'))
        await new Promise((r) => setTimeout(r, 200))
      }
      return json({ ok: true, mes_atual: mesAtual, processados: resultados.length, resultados })
    }

    if (acao === 'encerrar') {
      if (!clienteId) return json({ error: 'informe cliente=<uuid>' }, 400)
      const { data: row } = await supabase
        .from('ca_contrato_map')
        .select('*')
        .eq('cs_cliente_id', clienteId)
        .single()
      if (!row) return json({ error: 'contrato não encontrado' }, 404)
      const res = await caFetch(
        accessToken,
        `/v1/contratos/${row.ca_contrato_id}/encerrar`,
        { method: 'POST', body: JSON.stringify({}) },
      )
      if (res.status >= 200 && res.status < 300) {
        await supabase
          .from('ca_contrato_map')
          .update({ status: 'encerrado' })
          .eq('cs_cliente_id', clienteId)
        return json({ ok: true })
      }
      return json({ ok: false, erro: res.status, detalhe: res.body }, 422)
    }

    return json({ error: `ação desconhecida: "${acao}"` }, 400)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('ca-contratos-sync erro:', message)
    return json({ ok: false, error: message }, 500)
  }
})
