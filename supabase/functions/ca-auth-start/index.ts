// Inicia o fluxo OAuth: redireciona o usuário para a tela de autorização do
// Conta Azul. Após autorizar, o Conta Azul chama a função `ca-oauth-callback`.
//
// Aceita `?redirect=<url>` para voltar a uma página específica após conectar
// (ex.: a página de integrações do ZeiClient). Apenas domínios da lista são
// aceitos; o destino viaja dentro do `state` (junto com o nonce anti-CSRF).
//
// Secrets: CONTA_AZUL_CLIENT_ID, CONTA_AZUL_REDIRECT_URI

import { buildAuthorizeUrl } from '../_shared/contaAzul.ts'
import { corsHeaders } from '../_shared/cors.ts'

const REDIRECT_ALLOWLIST = [
  'zeidados.finalizeicontabilidade.com.br',
  'zeiclient.finalizeicontabilidade.com.br',
  'localhost',
]

function isAllowedRedirect(value: string): boolean {
  try {
    const u = new URL(value)
    return (
      (u.protocol === 'https:' || u.hostname === 'localhost') &&
      REDIRECT_ALLOWLIST.includes(u.hostname)
    )
  } catch {
    return false
  }
}

function b64url(s: string): string {
  return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

Deno.serve((req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const clientId = Deno.env.get('CONTA_AZUL_CLIENT_ID')
  const redirectUri = Deno.env.get('CONTA_AZUL_REDIRECT_URI')

  if (!clientId || !redirectUri) {
    return new Response(
      'Configure os secrets CONTA_AZUL_CLIENT_ID e CONTA_AZUL_REDIRECT_URI.',
      { status: 500, headers: corsHeaders },
    )
  }

  const wanted = new URL(req.url).searchParams.get('redirect') ?? ''
  const back = isAllowedRedirect(wanted) ? wanted : ''

  // `state` = nonce anti-CSRF + destino pós-conexão, codificados.
  const state = b64url(JSON.stringify({ n: crypto.randomUUID(), r: back }))
  const authorizeUrl = buildAuthorizeUrl({ clientId, redirectUri, state })

  return new Response(null, {
    status: 302,
    headers: {
      ...corsHeaders,
      Location: authorizeUrl,
      'Set-Cookie': `ca_oauth_state=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`,
    },
  })
})
