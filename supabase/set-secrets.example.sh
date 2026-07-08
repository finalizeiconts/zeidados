#!/usr/bin/env bash
# ============================================================================
# Define os secrets das Edge Functions (lado servidor). NUNCA comite os valores
# reais. Copie para `supabase/set-secrets.sh` (git-ignored), preencha e rode.
#
#   cp supabase/set-secrets.example.sh supabase/set-secrets.sh
#   # edite supabase/set-secrets.sh com os valores reais
#   bash supabase/set-secrets.sh
# ============================================================================
set -euo pipefail

# Credenciais do App de desenvolvedor do Conta Azul (portal developers.contaazul.com)
CONTA_AZUL_CLIENT_ID="SEU_CLIENT_ID"
CONTA_AZUL_CLIENT_SECRET="SEU_CLIENT_SECRET"

# URL pública da função de callback (projeto Zei Client).
# Cadastre exatamente esta URL como "Redirect URI" no App do Conta Azul.
CONTA_AZUL_REDIRECT_URI="https://ehrdmbbqvkxejgtkpbjb.supabase.co/functions/v1/ca-oauth-callback"

# Para onde voltar no app depois de conectar (o front na Hostinger):
APP_REDIRECT_URL="https://zeidados.finalizeicontabilidade.com.br"

# Segredo simples opcional para chamar o ca-sync manualmente via ?secret=...
SYNC_SECRET="$(openssl rand -hex 16)"

supabase secrets set \
  CONTA_AZUL_CLIENT_ID="$CONTA_AZUL_CLIENT_ID" \
  CONTA_AZUL_CLIENT_SECRET="$CONTA_AZUL_CLIENT_SECRET" \
  CONTA_AZUL_REDIRECT_URI="$CONTA_AZUL_REDIRECT_URI" \
  APP_REDIRECT_URL="$APP_REDIRECT_URL" \
  SYNC_SECRET="$SYNC_SECRET"

echo "Secrets definidos. SYNC_SECRET=$SYNC_SECRET (guarde se for usar chamada manual)."
