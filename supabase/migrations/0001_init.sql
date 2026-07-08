-- ============================================================================
-- Painel Financeiro Finalizei — schema inicial
-- Espelha os lançamentos financeiros do Conta Azul (API v2) no Postgres, para
-- o front consumir com Supabase Realtime (o "tempo real").
--
-- Tudo fica ISOLADO no schema `contaazul` — não toca no `public` nem em nada
-- que já exista no projeto (Zei Client).
--
-- ⚠️ Depois de aplicar, adicione `contaazul` em:
--    Dashboard → Project Settings → Data API → "Exposed schemas"
--    (sem isso o front não consegue ler o schema via API).
-- ============================================================================

create schema if not exists contaazul;

-- Papéis da API precisam de USAGE no schema para enxergá-lo.
grant usage on schema contaazul to anon, authenticated, service_role;

-- ── Tokens OAuth do Conta Azul (uma linha; multi-conta é evolução futura) ────
create table if not exists contaazul.ca_tokens (
  id            text primary key default 'contaazul',
  access_token  text not null,
  refresh_token text not null,
  expires_at    timestamptz not null,
  updated_at    timestamptz not null default now()
);

comment on table contaazul.ca_tokens is
  'Tokens OAuth do Conta Azul. Acesso apenas via service_role (Edge Functions).';

-- ── Lançamentos financeiros normalizados ────────────────────────────────────
create table if not exists contaazul.ca_financial_events (
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

create index if not exists ca_events_due_idx    on contaazul.ca_financial_events (due_date);
create index if not exists ca_events_kind_idx   on contaazul.ca_financial_events (kind);
create index if not exists ca_events_status_idx on contaazul.ca_financial_events (status);

comment on table contaazul.ca_financial_events is
  'Contas a receber/pagar do Conta Azul, normalizadas para o painel.';

-- ── Log de sincronização (observabilidade do polling) ───────────────────────
create table if not exists contaazul.ca_sync_log (
  id          bigint generated always as identity primary key,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  ok          boolean,
  receitas    int default 0,
  despesas    int default 0,
  message     text
);

-- ============================================================================
-- Grants (schema custom não herda os defaults do `public`)
-- ============================================================================
-- Edge Functions (service_role) administram tudo:
grant all on all tables    in schema contaazul to service_role;
grant all on all sequences in schema contaazul to service_role;
alter default privileges in schema contaazul grant all on tables    to service_role;
alter default privileges in schema contaazul grant all on sequences to service_role;

-- Usuários logados só LEEM os eventos (tokens e log ficam inacessíveis):
grant select on contaazul.ca_financial_events to authenticated;

-- ============================================================================
-- Row Level Security
-- ============================================================================
alter table contaazul.ca_tokens           enable row level security;
alter table contaazul.ca_financial_events enable row level security;
alter table contaazul.ca_sync_log         enable row level security;

-- ca_tokens e ca_sync_log: SEM policies → só o service_role (Edge Functions)
-- consegue ler/escrever. Nunca exponha tokens ao cliente.

-- ── Lista de permissão ──────────────────────────────────────────────────────
-- O projeto Supabase é compartilhado com o app Zei Client (outros usuários no
-- Auth), então a leitura do financeiro é restrita a e-mails autorizados.
create table if not exists contaazul.ca_allowed_users (
  email text primary key,
  added_at timestamptz not null default now()
);
alter table contaazul.ca_allowed_users enable row level security;
-- sem policies: só o service_role administra a lista

insert into contaazul.ca_allowed_users (email) values
  ('werbethy17@gmail.com'),
  ('gestao@finalizeicontabilidade.com')
on conflict (email) do nothing;

-- Função SECURITY DEFINER: o usuário logado está na lista?
create or replace function contaazul.is_allowed()
returns boolean
language sql stable security definer
set search_path = ''
as $fn$
  select exists (
    select 1 from contaazul.ca_allowed_users a
    where a.email = (select auth.jwt() ->> 'email')
  );
$fn$;

revoke all on function contaazul.is_allowed() from public;
grant execute on function contaazul.is_allowed() to authenticated;

-- ca_financial_events: leitura só para usuários autenticados E autorizados.
drop policy if exists "events_select_authenticated" on contaazul.ca_financial_events;
drop policy if exists "events_select_allowed" on contaazul.ca_financial_events;
create policy "events_select_allowed"
  on contaazul.ca_financial_events
  for select
  to authenticated
  using (contaazul.is_allowed());

-- OPCIONAL (deploy interno rápido, sem tela de login): libere leitura anônima.
-- ⚠️  Isso torna os dados financeiros legíveis por qualquer um com a anon key.
--     Só habilite atrás de outra proteção (VPN, senha no host, rede interna).
-- grant select on contaazul.ca_financial_events to anon;
-- drop policy if exists "events_select_anon" on contaazul.ca_financial_events;
-- create policy "events_select_anon"
--   on contaazul.ca_financial_events for select to anon using (true);

-- ============================================================================
-- Realtime — publica a tabela de eventos para o front receber mudanças ao vivo
-- ============================================================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'contaazul'
      and tablename = 'ca_financial_events'
  ) then
    execute 'alter publication supabase_realtime add table contaazul.ca_financial_events';
  end if;
end $$;
