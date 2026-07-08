-- ============================================================================
-- Mapa ZeiClient (CRM) ↔ Conta Azul (Pessoas)
-- Liga cada cliente de public.cs_clientes à Pessoa criada no Conta Azul,
-- garantindo idempotência da sincronização (nunca duplica cadastro).
-- ============================================================================

create table if not exists contaazul.ca_pessoa_map (
  cs_cliente_id  uuid primary key,
  ca_pessoa_id   uuid not null,
  nome           text not null default '',
  origem         text not null default 'zeiclient',  -- zeiclient | planilha-bc
  synced_at      timestamptz not null default now()
);

comment on table contaazul.ca_pessoa_map is
  'De-para cliente do CRM ZeiClient → Pessoa do Conta Azul (sync ca-pessoas-sync).';

alter table contaazul.ca_pessoa_map enable row level security;
-- sem policies: só service_role (Edge Functions) lê/escreve

grant all on contaazul.ca_pessoa_map to service_role;

-- Log das execuções da sincronização de pessoas
create table if not exists contaazul.ca_pessoas_sync_log (
  id          bigint generated always as identity primary key,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  ok          boolean,
  criados     int default 0,
  mapeados    int default 0,
  pulados     int default 0,
  message     text
);

alter table contaazul.ca_pessoas_sync_log enable row level security;
grant all on contaazul.ca_pessoas_sync_log to service_role;
