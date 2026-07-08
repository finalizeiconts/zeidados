-- ============================================================================
-- Contratos recorrentes: cliente ativo no ZeiClient (contrato D4Sign assinado)
-- → contrato de faturamento recorrente no Conta Azul.
--
-- Segurança financeira: a criação AUTOMÁTICA só vale para clientes ativados a
-- partir da data em ca_config('contratos_auto_desde') — os 180 clientes já
-- existentes NÃO ganham contrato sozinhos (cobrança deles ainda vive fora do
-- Conta Azul); para esses há o botão manual no painel de integrações.
-- ============================================================================

-- Config simples chave/valor (só service_role)
create table if not exists contaazul.ca_config (
  chave      text primary key,
  valor      text not null,
  updated_at timestamptz not null default now()
);
alter table contaazul.ca_config enable row level security;
grant all on contaazul.ca_config to service_role;

insert into contaazul.ca_config (chave, valor)
values ('contratos_auto_desde', to_char(now(), 'YYYY-MM-DD'))
on conflict (chave) do nothing;

-- De-para contrato: cliente do CRM → contrato do Conta Azul
create table if not exists contaazul.ca_contrato_map (
  cs_cliente_id  uuid primary key,
  ca_contrato_id text not null,
  numero         integer,
  valor          numeric(14,2),
  dia_vencimento integer,
  origem         text not null default 'manual',   -- manual | auto
  status         text not null default 'ativo',    -- ativo | encerrado
  criado_em      timestamptz not null default now()
);
alter table contaazul.ca_contrato_map enable row level security;
grant all on contaazul.ca_contrato_map to service_role;

-- Último documento sincronizado por pessoa: detecta a virada CPF → CNPJ
alter table contaazul.ca_pessoa_map
  add column if not exists doc text;

-- ── Painel (ZeiClient · Integrações · Conta Azul) ───────────────────────────
create or replace view contaazul.v_contratos_painel as
select
  c.id                                  as cs_cliente_id,
  c.nome,
  c.codigo,
  c.cnpj_cpf,
  c.valor_honorarios,
  c.dia_vencimento,
  c.recorrencia_pagamento,
  c.data_inicio_servicos,
  length(regexp_replace(coalesce(c.cnpj_cpf, ''), '\D', '', 'g')) = 14 as tem_cnpj,
  (m.cs_cliente_id is not null)         as pessoa_sincronizada,
  k.ca_contrato_id,
  k.numero                              as contrato_numero,
  k.valor                               as contrato_valor,
  k.status                              as contrato_status,
  k.origem                              as contrato_origem,
  k.criado_em                           as contrato_criado_em
from public.cs_clientes c
left join contaazul.ca_pessoa_map  m on m.cs_cliente_id = c.id
left join contaazul.ca_contrato_map k on k.cs_cliente_id = c.id
where c.status = 'ativo';

grant select on contaazul.v_contratos_painel to authenticated;

-- Status geral ganha o total de contratos
create or replace view contaazul.v_integracao_status as
select
  exists (select 1 from contaazul.ca_tokens)                            as conectado,
  (select expires_at   from contaazul.ca_tokens limit 1)                as token_expira_em,
  (select updated_at   from contaazul.ca_tokens limit 1)                as token_atualizado_em,
  (select max(started_at) from contaazul.ca_sync_log where ok)          as ultima_sync_financeiro,
  (select count(*) from contaazul.ca_financial_events)                  as eventos_sincronizados,
  (select count(*) from contaazul.ca_pessoa_map)                        as clientes_mapeados,
  (select max(finished_at) from contaazul.ca_pessoas_sync_log where ok) as ultima_sync_clientes,
  (select count(*) from contaazul.ca_contrato_map where status='ativo') as contratos_ativos;

grant select on contaazul.v_integracao_status to authenticated;
