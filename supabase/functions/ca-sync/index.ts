// Sincroniza os lançamentos do Conta Azul → Postgres. É o "coração" do tempo
// real: chamada por um agendamento (pg_cron) a cada poucos minutos. Cada upsert
// dispara um evento de Realtime que o front recebe na hora.
//
// Deploy:  supabase functions deploy ca-sync --no-verify-jwt
// Secrets: CONTA_AZUL_CLIENT_ID, CONTA_AZUL_CLIENT_SECRET
//
// Segurança: protegida por um segredo simples (SYNC_SECRET) OU pela
// service_role key no header Authorization (usada pelo cron e pelo callback).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { fetchEvents, refreshToken } from '../_shared/contaAzul.ts'
import { corsHeaders, json } from '../_shared/cors.ts'

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** Janela de sincronização: dos últimos 18 meses até 3 meses à frente. */
function syncWindow(): { from: string; to: string } {
  const now = new Date()
  const from = new Date(now.getFullYear(), now.getMonth() - 18, 1)
  const to = new Date(now.getFullYear(), now.getMonth() + 3, 1)
  return { from: isoDate(from), to: isoDate(to) }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // Autorização: header com service_role key OU ?secret=SYNC_SECRET.
  const auth = req.headers.get('Authorization') ?? ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const syncSecret = Deno.env.get('SYNC_SECRET')
  const urlSecret = new URL(req.url).searchParams.get('secret')
  const authorized =
    auth === `Bearer ${serviceKey}` || (!!syncSecret && urlSecret === syncSecret)
  if (!authorized) {
    return json({ error: 'não autorizado' }, 401)
  }

  const { data: logRow } = await supabase
    .from('ca_sync_log')
    .insert({ started_at: new Date().toISOString() })
    .select('id')
    .single()
  const logId = logRow?.id

  const finish = (patch: Record<string, unknown>) =>
    logId
      ? supabase.from('ca_sync_log').update(patch).eq('id', logId)
      : Promise.resolve()

  try {
    const clientId = Deno.env.get('CONTA_AZUL_CLIENT_ID')!
    const clientSecret = Deno.env.get('CONTA_AZUL_CLIENT_SECRET')!

    // 1) Carrega e (se preciso) renova o token.
    const { data: tokenRow, error: tokenErr } = await supabase
      .from('ca_tokens')
      .select('*')
      .eq('id', 'contaazul')
      .single()
    if (tokenErr || !tokenRow) {
      throw new Error('Sem token do Conta Azul. Faça a conexão OAuth primeiro.')
    }

    let accessToken = tokenRow.access_token as string
    const expiresAt = new Date(tokenRow.expires_at as string).getTime()
    // Renova se falta menos de 5 min para expirar.
    if (Date.now() > expiresAt - 5 * 60_000) {
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

    // 2) Busca receitas e despesas da janela.
    const { from, to } = syncWindow()
    const [receitas, despesas] = await Promise.all([
      fetchEvents({ accessToken, kind: 'receita', from, to }),
      fetchEvents({ accessToken, kind: 'despesa', from, to }),
    ])
    const all = [...receitas, ...despesas].map((e) => ({
      ...e,
      updated_at: new Date().toISOString(),
    }))

    // 3) Upsert em lote.
    if (all.length > 0) {
      const { error: upsertErr } = await supabase
        .from('ca_financial_events')
        .upsert(all, { onConflict: 'id' })
      if (upsertErr) throw upsertErr
    }

    await finish({
      finished_at: new Date().toISOString(),
      ok: true,
      receitas: receitas.length,
      despesas: despesas.length,
      message: `janela ${from} → ${to}`,
    })

    return json({
      ok: true,
      receitas: receitas.length,
      despesas: despesas.length,
      window: { from, to },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('Erro na sincronização:', message)
    await finish({ finished_at: new Date().toISOString(), ok: false, message })
    return json({ ok: false, error: message }, 500)
  }
})
