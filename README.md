# Painel Financeiro Finalizei

Painel de BI financeiro **em tempo real** que consome as receitas e despesas do
**Conta Azul**. Indicadores (receita, despesa, lucro, margem, fluxo de caixa,
a receber/pagar, inadimplência), gráficos e uma trilha de atividade ao vivo — no
design system **Finalizei** (Manrope + Instrument Serif, monocromático + amarelo
de marca, temas claro/escuro).

<p align="center"><em>Roda na hora em modo demonstração; conecte o Conta Azul para dados reais.</em></p>

---

## Como funciona o "tempo real"

O Conta Azul **não tem webhooks** ([FAQ oficial](https://developers.contaazul.com/faq)),
então a atualização em tempo real é feita por **polling + Realtime**:

```
Conta Azul API v2 ──poll (2 min)──▶ Edge Function ca-sync ──upsert──▶ Postgres
                                                                         │
                                                    Supabase Realtime ◀──┘
                                                             │  (postgres_changes)
                                                    React (Vite) atualiza ao vivo
```

1. Um job do **pg_cron** chama a Edge Function `ca-sync` a cada 2 minutos.
2. `ca-sync` busca contas a receber/pagar na API v2 e faz **upsert** na tabela
   `ca_financial_events`.
3. Cada mudança dispara um evento de **Supabase Realtime**.
4. O front assina a tabela e recalcula os indicadores instantaneamente — sem
   recarregar a página.

> A frequência (2 min) respeita o limite da API (600 req/min por conta) com folga.

## Stack

| Camada | Tecnologia |
|---|---|
| Front | React 19 · TypeScript strict · Vite 6 · Tailwind v4 |
| Back  | Supabase — Postgres + RLS + Edge Functions (Deno/TS) + Realtime |
| Dados | Conta Azul API v2 (OAuth 2.0 Authorization Code) |

Gráficos são SVG próprios (sem dependência pesada), seguindo boas práticas de
dataviz (marcas finas, escala única, cores semânticas, tooltip no hover).

---

## Rodando agora (modo demonstração)

Sem nenhuma configuração, o app roda com **dados fictícios realistas** de um
escritório de contabilidade e simula a chegada de lançamentos ao vivo.

```bash
npm install
npm run dev
# abre http://localhost:5173
```

Outros comandos:

```bash
npm run build      # typecheck + build de produção
npm run preview    # serve o build
npm run typecheck  # só o TypeScript
```

---

## Ligando o Conta Azul (dados reais)

### 1. Crie o App de desenvolvedor

No portal [developers.contaazul.com](https://developers.contaazul.com) crie um
**App** (recomendado começar por um **App de desenvolvimento**, que vem com uma
conta de testes e dados fictícios por 30 dias). Anote o `client_id` e o
`client_secret`.

### 2. Provisione o Supabase

```bash
supabase link --project-ref <PROJECT_REF>
supabase db push                       # aplica supabase/migrations/0001_init.sql
supabase functions deploy ca-auth-start     --no-verify-jwt
supabase functions deploy ca-oauth-callback --no-verify-jwt
supabase functions deploy ca-sync           --no-verify-jwt
```

### 3. Defina os secrets (lado servidor)

```bash
cp supabase/set-secrets.example.sh supabase/set-secrets.sh   # git-ignored
# edite com client_id/secret reais e as URLs; depois:
bash supabase/set-secrets.sh
```

A `CONTA_AZUL_REDIRECT_URI` deve ser exatamente
`https://<PROJECT_REF>.supabase.co/functions/v1/ca-oauth-callback` — **cadastre
essa mesma URL como Redirect URI no App do Conta Azul.**

### 4. Agende o polling

Abra o **SQL Editor** do projeto, cole `supabase/schedule.sql`, troque
`<PROJECT_REF>` e `<SERVICE_ROLE_KEY>` e execute. (A migration já habilitou o
Realtime na tabela de eventos.)

### 5. Configure o front

```bash
cp .env.example .env
# preencha VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY e VITE_CA_CONNECT_URL
```

Rode o app, clique em **Conectar** (banner que aparece quando ainda não há
dados), autorize no Conta Azul e pronto — o painel passa a sincronizar sozinho.

> **Autenticação de usuários:** a leitura da tabela exige Supabase Auth
> (`authenticated`). Para um deploy interno rápido sem tela de login, há uma
> policy anônima **comentada** em `0001_init.sql` — leia o aviso de segurança
> antes de habilitar.

---

## Deploy do front (Vercel)

Projeto Vite padrão: build `npm run build`, saída `dist/`. Configure as
variáveis `VITE_*` no painel da Vercel e ajuste `APP_REDIRECT_URL` (secret do
Supabase) para a URL final do front.

---

## Estrutura

```
src/
  lib/            tipos, formatação (pt-BR), motor de métricas, dados demo, cliente Supabase
  hooks/          useFinanceData (demo ↔ Realtime), useTheme
  components/
    layout/       Dock, Topbar
    ui/           Card, Badge, KpiCard, LiveDot
    charts/       RevenueExpenseChart, ResultLineChart, ExpenseBreakdown (+utils)
    dashboard/    KPIs, ReceivablesTable, ActivityFeed, ConnectBanner
  pages/          Dashboard
supabase/
  migrations/     0001_init.sql (tabelas, RLS, Realtime)
  functions/      ca-auth-start, ca-oauth-callback, ca-sync, _shared/
  schedule.sql    agendamento pg_cron do polling
```

### Regime contábil

- **Receita / Despesa / Lucro / Margem** do período: regime de **competência**
  (por data de vencimento) — simétrico e padrão em contabilidade.
- **Saldo em caixa**: regime de **caixa** (apenas o efetivamente liquidado).
- **A receber / A pagar / Inadimplência**: títulos em aberto por situação.

O mapeamento dos campos da API v2 em `supabase/functions/_shared/contaAzul.ts` é
**tolerante a variações de nome** e guarda o payload original em `raw` — confira
a resposta real da sua conta e ajuste os nomes se necessário.

---

## Segurança

- `client_secret` e `service_role` key **nunca** vão para o front nem para o
  Git — só como **secrets do Supabase** (servidor). O bundle do front só recebe
  a `anon key` (pública) e URLs.
- `ca_tokens` fica sem policy de RLS: apenas o `service_role` (Edge Functions)
  acessa os tokens.
- `supabase/set-secrets.sh` está no `.gitignore`.
