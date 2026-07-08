// Inicia o fluxo OAuth: redireciona o usuário para a tela de autorização do
// Conta Azul. Após autorizar, o Conta Azul chama a função `ca-oauth-callback`.
//
// Deploy:  supabase functions deploy ca-auth-start --no-verify-jwt
// Secrets: CONTA_AZUL_CLIENT_ID, CONTA_AZUL_REDIRECT_URI

import { buildAuthorizeUrl } from '../_shared/contaAzul.ts'
import { corsHeaders } from '../_shared/cors.ts'

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

  // `state` protege contra CSRF; o callback compara com o cookie.
  const state = crypto.randomUUID()
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
