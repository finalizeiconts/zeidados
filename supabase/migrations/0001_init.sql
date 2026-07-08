-- ============================================================================
-- Painel Financeiro Finalizei — schema inicial
-- Espelha os lançamentos financeiros do Conta Azul (API v2) no Postgres, para
-- o front consumir com Supabase Realtime (o "tempo real").
-- ============================================================================

-- ── Tokens OAuth do Conta Azul (uma linha; multi-conta é evolução futura) ────
create table if not exists public.ca_tokens (
  id            text primary key default 'contaazul',
  access_token  text not null,
  refresh_token text not null,
  expires_at    timestamptz not null,
  updated_at    timestamptz not null default now()
);

comment on table public.ca_tokens is
  'Tokens OAuth do Conta Azul. Acesso apenas via service_role (Edge Functions).';

-- ── Lançamentos financeiros normalizados ────────────────────────────────────
create table if not exists public.ca_financial_events (
  id            text primary key,                         -- id da parcela/evento no Conta Azul
  kind          text not null check (kind in ('receita','despesa')),
  description   text not null default '',
  category      text not null default 'Outros',
  counterparty  text not null default '',
  amount        numeric(14,2) not null default 0,
  due_date      date not null,
  settled_date  date,
  status        text not null check (status in ('pago','pendente','vencido')),
  raw           jsonb,                                    -- payload original p/ auditoria
  updated_at    timestamptz not null default now()
);

create index if not exists ca_events_due_idx    on public.ca_financial_events (due_date);
create index if not exists ca_events_kind_idx   on public.ca_financial_events (kind);
create index if not exists ca_events_status_idx on public.ca_financial_events (status);

comment on table public.ca_financial_events is
  'Contas a receber/pagar do Conta Azul, normalizadas para o painel.';

-- ── Log de sincronização (observabilidade do polling) ───────────────────────
create table if not exists public.ca_sync_log (
  id          bigint generated always as identity primary key,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  ok          boolean,
  receitas    int default 0,
  despesas    int default 0,
  message     text
);

-- ============================================================================
-- Row Level Security
-- ============================================================================
alter table public.ca_tokens           enable row level security;
alter table public.ca_financial_events enable row level security;
alter table public.ca_sync_log          enable row level security;

-- ca_tokens e ca_sync_log: SEM policies → só o service_role (Edge Functions)
-- consegue ler/escrever. Nunca exponha tokens ao cliente.

-- ca_financial_events: leitura para usuários autenticados (Supabase Auth).
drop policy if exists "events_select_authenticated" on public.ca_financial_events;
create policy "events_select_authenticated"
  on public.ca_financial_events
  for select
  to authenticated
  using (true);

-- OPCIONAL (deploy interno rápido, sem tela de login): libere leitura anônima.
-- ⚠️  Isso torna os dados financeiros legíveis por qualquer um com a anon key.
--     Só habilite atrás de outra proteção (VPN, senha no host, rede interna).
-- drop policy if exists "events_select_anon" on public.ca_financial_events;
-- create policy "events_select_anon"
--   on public.ca_financial_events for select to anon using (true);

-- ============================================================================
-- Realtime — publica a tabela de eventos para o front receber mudanças ao vivo
-- ============================================================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'ca_financial_events'
  ) then
    execute 'alter publication supabase_realtime add table public.ca_financial_events';
  end if;
end $$;
