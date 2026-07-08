// Recebe o `code` do Conta Azul, troca por tokens, guarda em `ca_tokens` e
// dispara uma primeira sincronização. Ao final, volta para o app.
//
// Deploy:  supabase functions deploy ca-oauth-callback --no-verify-jwt
// Secrets: CONTA_AZUL_CLIENT_ID, CONTA_AZUL_CLIENT_SECRET,
//          CONTA_AZUL_REDIRECT_URI, APP_REDIRECT_URL

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { exchangeCode } from '../_shared/contaAzul.ts'
import { corsHeaders } from '../_shared/cors.ts'

function redirect(to: string): Response {
  // Response.redirect exige URL absoluta e lança com caminho relativo; este
  // formato aceita ambos.
  return new Response(null, { status: 302, headers: { ...corsHeaders, Location: to } })
}

function parseCookie(header: string | null, name: string): string | null {
  if (!header) return null
  for (const part of header.split(';')) {
    const [k, v] = part.trim().split('=')
    if (k === name) return v ?? null
  }
  return null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const cookieState = parseCookie(req.headers.get('cookie'), 'ca_oauth_state')

  // Destino pós-conexão: vem dentro do state (ver ca-auth-start), com
  // allowlist de domínios; senão, APP_REDIRECT_URL.
  const REDIRECT_ALLOWLIST = [
    'zeidados.finalizeicontabilidade.com.br',
    'zeiclient.finalizeicontabilidade.com.br',
    'localhost',
  ]
  let appRedirect = Deno.env.get('APP_REDIRECT_URL') ?? '/'
  try {
    const decoded = JSON.parse(
      atob((state ?? '').replaceAll('-', '+').replaceAll('_', '/')),
    ) as { r?: string }
    if (decoded.r) {
      const u = new URL(decoded.r)
      if (
        (u.protocol === 'https:' || u.hostname === 'localhost') &&
        REDIRECT_ALLOWLIST.includes(u.hostname)
      ) {
        appRedirect = decoded.r
      }
    }
  } catch {
    /* state antigo/ilegível: mantém o padrão */
  }

  if (!code) {
    return redirect(`${appRedirect}?ca=erro&motivo=sem_code`)
  }
  // Verificação de CSRF: só falha se havia cookie e não bate.
  if (cookieState && state && cookieState !== state) {
    return redirect(`${appRedirect}?ca=erro&motivo=state`)
  }

  try {
    const clientId = Deno.env.get('CONTA_AZUL_CLIENT_ID')!
    const clientSecret = Deno.env.get('CONTA_AZUL_CLIENT_SECRET')!
    const redirectUri = Deno.env.get('CONTA_AZUL_REDIRECT_URI')!

    const tokens = await exchangeCode({ clientId, clientSecret, code, redirectUri })

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { db: { schema: 'contaazul' } },
    )

    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()
    const { error } = await supabase.from('ca_tokens').upsert({
      id: 'contaazul',
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    })
    if (error) throw error

    // Dispara a 1ª sincronização (sem bloquear o redirect).
    const syncUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/ca-sync`
    fetch(syncUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
      },
    }).catch(() => {})

    return redirect(`${appRedirect}?ca=conectado`)
  } catch (err) {
    console.error('Erro no callback OAuth:', err)
    return redirect(`${appRedirect}?ca=erro`)
  }
})
