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
// Regra da data da venda (fechada em 29/07/2026, teste real): o CA só emite a
// 1ª venda no ato da criação quando o contrato nasce com data_inicio no
// passado. Com data_inicio FUTURA ele não emite nada — as vendas nascem nas
// gerações do dia 1º, cada uma datada do dia 1º do mês do próprio vencimento.
// Então todo contrato é criado com data_inicio = 1º dia do mês da 1ª cobrança:
// pode ser criado em qualquer dia, de qualquer mês, que a cadeia nasce
// alinhada (venda 01/08 → venc 10/08, venda 01/09 → venc 10/09, …).
//
// Ações (query string ou corpo JSON):
//   acao=plano                      → lista candidatos (não cria nada)
//   acao=criar&contrato=<uuid>      → cria 1 contrato (cliente=<uuid> mira o principal)
//   acao=criar_lote                 → 10 por chamada; repita até restantes=0
//   acao=auto                       → cria para os elegíveis do modo automático
//   acao=encerrar&contrato=<uuid>   → encerra o contrato no Conta Azul
//
// A fila é de CONTRATOS (cs_contratos), não de clientes: um cliente pode ter
// dois serviços faturados em títulos separados.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { CA_API_BASE, refreshToken } from '../_shared/contaAzul.ts'
import { corsHeaders, json } from '../_shared/cors.ts'

interface Candidato {
  /** Id do CLIENTE. Contrato adicional carrega o mesmo id do dono. */
  id: string
  /** Preenchido só em contrato adicional (cs_contratos.id). */
  contrato_id?: string | null
  /** Nome do contrato, pra distinguir os do mesmo cliente na tela e no log. */
  contrato_descricao?: string | null
  /** Contrato principal do cliente (o que espelha em cs_clientes). */
  contrato_principal?: boolean
  nome: string
  codigo: string | null
  cnpj_cpf: string | null
  valor_honorarios: number | null
  dia_vencimento: number | null
  recorrencia_pagamento: string | null
  data_inicio_servicos: string | null
  data_primeiro_honorario: string | null
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
  const contratoAlvo = String(bodyParams.contrato ?? url.searchParams.get('contrato') ?? '')

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

    // ── Candidatos: contratos ativos ainda sem par no Conta Azul ────────────
    //
    // A fila é de CONTRATOS, não de clientes: um cliente pode ter dois
    // serviços faturados em títulos separados. cs_contratos é a fonte de
    // verdade (o principal nasceu do próprio cadastro do cliente no backfill),
    // e cada contrato carrega os dados do dono pra montar o payload do CA.
    const { data: contratosRaw, error: ctErr } = await supabasePublic
      .from('cs_contratos')
      .select('id, cliente_id, principal, descricao, plano_servicos, valor_honorarios, dia_vencimento, recorrencia_pagamento, data_inicio_servicos, data_primeiro_honorario, proximo_faturamento, nao_faturar, created_at')
      .eq('status', 'ativo')
    if (ctErr) throw ctErr

    // Onboarding entra junto: cliente em implantação já paga honorário desde o
    // primeiro mês. Quem decide se fatura é o contrato (nao_faturar + piso),
    // não a fase do relacionamento — prender a cobrança ao status fazia o
    // contrato nunca chegar ao CA e ninguém perceber até a cobrança não sair.
    const { data: clientesRaw, error: cliErr } = await supabasePublic
      .from('cs_clientes')
      .select('id, nome, codigo, cnpj_cpf, oportunidade_origem_id, status')
      .in('status', ['ativo', 'onboarding'])
    if (cliErr) throw cliErr
    const dono = new Map<string, Record<string, unknown>>(
      ((clientesRaw ?? []) as Record<string, unknown>[]).map((c) => [String(c.id), c]),
    )

    const { data: jaMapeados } = await supabase
      .from('ca_contrato_map')
      .select('cs_contrato_id')
    const comContrato = new Set(
      (jaMapeados ?? []).map((r) => r.cs_contrato_id).filter(Boolean),
    )

    const { data: pessoas } = await supabase
      .from('ca_pessoa_map')
      .select('cs_cliente_id, ca_pessoa_id')
    const pessoaDe = new Map(
      (pessoas ?? []).map((r) => [r.cs_cliente_id as string, r.ca_pessoa_id as string]),
    )

    const candidatos: Candidato[] = ((contratosRaw ?? []) as Record<string, unknown>[])
      .filter((ct) => !comContrato.has(ct.id as string))
      .map((ct) => {
        const cli = dono.get(ct.cliente_id as string)
        if (!cli) return null // cliente inativo ou fora do escritório
        return {
          id: String(cli.id),
          contrato_id: String(ct.id),
          contrato_principal: Boolean(ct.principal),
          contrato_descricao: (ct.descricao as string | null) ?? null,
          nome: String(cli.nome),
          codigo: (cli.codigo as string | null) ?? null,
          cnpj_cpf: (cli.cnpj_cpf as string | null) ?? null,
          oportunidade_origem_id: (cli.oportunidade_origem_id as string | null) ?? null,
          plano_servicos: (ct.plano_servicos as string | null) ?? null,
          valor_honorarios: ct.valor_honorarios as number | null,
          dia_vencimento: ct.dia_vencimento as number | null,
          recorrencia_pagamento: (ct.recorrencia_pagamento as string | null) ?? null,
          data_inicio_servicos: (ct.data_inicio_servicos as string | null) ?? null,
          data_primeiro_honorario: (ct.data_primeiro_honorario as string | null) ?? null,
          proximo_faturamento: (ct.proximo_faturamento as string | null) ?? null,
          nao_faturar: (ct.nao_faturar as boolean | null) ?? false,
          created_at: String(ct.created_at),
        } as Candidato
      })
      .filter((c): c is Candidato => c !== null)
      .filter((c) =>
        // CPF (11) entra junto com CNPJ (14): parte da carteira é pessoa
        // física — produtor rural etc. — com contrato de honorários igual.
        [11, 14].includes(onlyDigits(c.cnpj_cpf).length) &&
        // Contrato marcado "não faturar" não vai pro CA: geraria vendas que
        // ninguém vai cobrar — sujeira contábil garantida.
        !c.nao_faturar &&
        Number(c.valor_honorarios) > 0 &&
        Number(c.dia_vencimento) >= 1 &&
        Number(c.dia_vencimento) <= 31)

    const autoElegiveis = candidatos.filter((c) => c.created_at >= autoDesde)

    // CNPJ/CPF repetido entre candidatos = cadastro duplicado no CRM. Criar
    // contrato pros dois cobraria a MESMA empresa duas vezes. Nenhum dos dois
    // é criado — resolve o cadastro primeiro.
    // Conta CLIENTES distintos por documento, não contratos: dois contratos do
    // mesmo cliente compartilham o CNPJ de propósito e não são duplicidade.
    const clientesPorDoc = new Map<string, Set<string>>()
    for (const c of candidatos) {
      const d = onlyDigits(c.cnpj_cpf)
      if (!clientesPorDoc.has(d)) clientesPorDoc.set(d, new Set())
      clientesPorDoc.get(d)!.add(c.id)
    }
    const docsDuplicados = new Set(
      [...clientesPorDoc.entries()].filter(([, ids]) => ids.size > 1).map(([d]) => d),
    )

    // 1ª cobrança do contrato. "Data 1º honorário" do cadastro é a fonte da
    // verdade quando aponta pro FUTURO — é ela que o time define antes de
    // mandar o contrato pro D4Sign, e é ela que o auto-start usa quando todo
    // mundo assina. No passado (carteira migrada, campo histórico) não serve:
    // cai no cálculo padrão dia de vencimento + piso.
    const primeiraDe = (c: Candidato) => {
      const manual = (c.data_primeiro_honorario ?? '').slice(0, 10)
      if (manual && manual > isoDate(new Date())) return manual
      return primeiraDataComPiso(Number(c.dia_vencimento), c.data_inicio_servicos, c.proximo_faturamento)
    }
    const primeiraManual = (c: Candidato) => {
      const manual = (c.data_primeiro_honorario ?? '').slice(0, 10)
      return Boolean(manual && manual > isoDate(new Date()))
    }
    // data_inicio do contrato no CA: 1º dia do mês da 1ª cobrança. É o que
    // impede a emissão imediata e alinha a data de cada venda ao mês do
    // vencimento dela (ver cabeçalho).
    const inicioDe = (c: Candidato) => `${primeiraDe(c).slice(0, 7)}-01`

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
          origem_primeira: primeiraManual(c) ? 'manual (Data 1º honorário)' : 'calculada (dia + piso)',
          inicio_no_ca: inicioDe(c),
          contrato_id: c.contrato_id,
          contrato: c.contrato_descricao ?? (c.contrato_principal ? 'principal' : 'adicional'),
          servico: await servicoDoCliente(c),
          // Categoria visível ANTES de criar: foi por não conseguir enxergar
          // isso que a carteira inteira nasceu em "Honorarios MEI".
          categoria: await categoriaDoTipo(await servicoDoCliente(c)),
          pessoa_sincronizada: pessoaDe.has(c.id),
        })
      }
      return json({
        ok: true,
        auto_desde: autoDesde,
        candidatos_total: candidatos.length,
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

    /**
     * Categoria financeira do contrato.
     *
     * Casar por nome exato falhava calado (01/08/2026): `plano_servicos` é
     * texto livre no cadastro do cliente e não precisa bater com o nome do
     * tipo de serviço — um acento ou um "(Prestadores)" a mais já quebra. E o
     * fallback 'Honorários Contábeis' nem existe como tipo. Sem categoria o
     * payload omitia o campo e o CA carimbava o default dele ("Honorarios
     * MEI") em toda a carteira.
     *
     * Cascata: nome exato → nome sem diferenciar caixa/espaços → De→Para de
     * categorias (ca_categoria_map) → padrão do escritório. `limit(1)` no
     * lugar de maybeSingle porque dois tipos homônimos faziam a consulta
     * devolver erro, não linha.
     */
    async function categoriaDoTipo(nomeTipo: string): Promise<
      { id: string | null; origem: string }
    > {
      const limpo = nomeTipo.trim()

      const { data: exato } = await supabasePublic
        .from('cs_crm_tipos_servico').select('ca_categoria_id')
        .eq('nome', limpo).not('ca_categoria_id', 'is', null).limit(1)
      if (exato?.[0]?.ca_categoria_id) {
        return { id: String(exato[0].ca_categoria_id), origem: 'tipo de serviço (nome exato)' }
      }

      const { data: aprox } = await supabasePublic
        .from('cs_crm_tipos_servico').select('ca_categoria_id')
        .ilike('nome', limpo).not('ca_categoria_id', 'is', null).limit(1)
      if (aprox?.[0]?.ca_categoria_id) {
        return { id: String(aprox[0].ca_categoria_id), origem: 'tipo de serviço (nome aproximado)' }
      }

      const { data: mapa } = await supabase
        .from('ca_categoria_map').select('ca_categoria_id')
        .ilike('nome', limpo).limit(1)
      if (mapa?.[0]?.ca_categoria_id) {
        return { id: String(mapa[0].ca_categoria_id), origem: 'De→Para de categorias' }
      }

      const padrao = Deno.env.get('CA_CATEGORIA_PADRAO_ID')
        ?? 'bd66dc95-4551-4be6-be46-300e960d4e45' // Honorarios Contabeis
      return { id: padrao, origem: 'padrão do escritório' }
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
          // `status` é obrigatório (ATIVO | INATIVO) e o campo do tipo é
          // `tipo_servico` (não `tipo`) — validado contra a API real em 31/07.
          body: JSON.stringify({ descricao: nome, tipo_servico: 'PRESTADO', preco: 0, status: 'ATIVO' }),
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
      const cat = await categoriaDoTipo(nomeServico)
      const idCategoria = cat.id

      const prox = await caFetch(accessToken, '/v1/contratos/proximo-numero')
      const numero = Number(
        (prox.body as Record<string, unknown>)?.numero ?? prox.body ?? 0,
      )

      if (docsDuplicados.has(onlyDigits(c.cnpj_cpf))) {
        return { ok: false, nome: c.nome, erro: 'CPF/CNPJ duplicado no CRM — resolva o cadastro antes' }
      }
      // A 1ª cobrança (manual do cadastro ou calculada) manda em tudo: o CA
      // exige dia_vencimento igual ao dia dela, e o início SEMPRE fica no 1º
      // dia do mês dela — nunca a data do cadastro. Início no passado faz o CA
      // emitir a 1ª venda na hora, datada de hoje, e desalinhar a cadeia
      // inteira (aprendido em 29/07/2026 com 10 contratos revertidos).
      const primeira = primeiraDe(c)
      const dia = Number(primeira.slice(8, 10))
      const inicio = inicioDe(c)
      const freq = frequenciaDe(c.recorrencia_pagamento)
      const payload = {
        id_cliente: caPessoa,
        data_emissao: isoDate(new Date()),
        // Sem id_categoria o CA carimba a categoria default da conta em todas
        // as vendas do contrato (caso "Honorários MEI", 31/07). A categoria
        // vem do Editar Tipo do plano na Config CRM.
        ...(idCategoria ? { id_categoria: idCategoria } : {}),
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
          primeira_data_vencimento: primeira,
          // Conta de recebimento — formato confirmado na doc oficial do
          // criarcontrato. Os "testes" de 01/08 que sugeriam campo ignorado
          // rodaram por engano na bancada (ca-teste-contrato), que não tinha o
          // campo; esta função nunca tinha sido exercitada. Sem a conta o
          // título fica fora das projeções por conta do CA.
          id_conta_financeira: Deno.env.get('CA_CONTA_ASAAS_ID')
            ?? '144f4ec8-e379-48a1-a4cb-733af36da866',
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
        cs_contrato_id: c.contrato_id ?? null,
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
      // `contrato=` mira um contrato específico; `cliente=` continua valendo e
      // resolve pro principal — é como o painel chama desde antes de existir
      // mais de um contrato por cliente.
      const c = contratoAlvo
        ? candidatos.find((x) => x.contrato_id === contratoAlvo)
        : candidatos.find((x) => x.id === clienteId && x.contrato_principal)
      if (!contratoAlvo && !clienteId) return json({ error: 'informe contrato=<uuid> ou cliente=<uuid>' }, 400)
      if (!c) {
        return json({
          error: contratoAlvo
            ? 'contrato não encontrado entre os candidatos (já existe no CA, inativo, ou sem valor/dia)'
            : 'cliente sem contrato principal elegível (já existe no CA, inativo, ou sem valor/dia)',
        }, 404)
      }
      const r = await criarContrato(c, 'manual')
      return json({ ok: r.ok, resultado: r }, r.ok ? 200 : 422)
    }

    // Migração da carteira: processa TODOS os candidatos, em lotes de 10 por
    // chamada (rate limit do CA). Rode acao=plano antes e revise a lista —
    // este aqui cria de verdade. Repita a chamada até restantes = 0.
    if (acao === 'criar_lote') {
      const lote = candidatos.slice(0, 10)
      const resultados = []
      for (const c of lote) {
        resultados.push(await criarContrato(c, 'manual'))
        await new Promise((r) => setTimeout(r, 300))
      }
      return json({
        ok: true,
        processados: resultados.length,
        criados: resultados.filter((r) => r.ok).length,
        falhas: resultados.filter((r) => !r.ok),
        restantes: Math.max(0, candidatos.length - lote.length),
      })
    }

    if (acao === 'auto') {
      const resultados = []
      for (const c of autoElegiveis.slice(0, 20)) {
        resultados.push(await criarContrato(c, 'auto'))
        await new Promise((r) => setTimeout(r, 200))
      }
      return json({ ok: true, processados: resultados.length, resultados })
    }

    if (acao === 'encerrar') {
      if (!contratoAlvo && !clienteId) {
        return json({ error: 'informe contrato=<uuid> ou cliente=<uuid>' }, 400)
      }
      // Por cliente só encerra quando ele tem UM contrato: com dois, encerrar
      // "o do cliente" seria adivinhar qual — melhor exigir o id.
      const q = supabase.from('ca_contrato_map').select('*').eq('status', 'ativo')
      const { data: rows } = contratoAlvo
        ? await q.eq('cs_contrato_id', contratoAlvo)
        : await q.eq('cs_cliente_id', clienteId)
      if (!rows || rows.length === 0) return json({ error: 'contrato não encontrado' }, 404)
      if (rows.length > 1) {
        return json({
          error: 'este cliente tem mais de um contrato — informe contrato=<uuid>',
          contratos: rows.map((r) => ({ cs_contrato_id: r.cs_contrato_id, numero: r.numero, valor: r.valor })),
        }, 409)
      }
      const row = rows[0]
      const res = await caFetch(
        accessToken,
        `/v1/contratos/${row.ca_contrato_id}/encerrar`,
        { method: 'POST', body: JSON.stringify({}) },
      )
      if (res.status >= 200 && res.status < 300) {
        await supabase
          .from('ca_contrato_map')
          .update({ status: 'encerrado' })
          .eq('ca_contrato_id', row.ca_contrato_id)
        return json({ ok: true, contrato: row.ca_contrato_id, numero: row.numero })
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
