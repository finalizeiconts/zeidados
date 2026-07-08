-- ============================================================================
-- Espelho de serviços: serviço contratado no CRM (cs_crm_tipos_servico) →
-- serviço cadastrado no Conta Azul (item do contrato recorrente).
-- Criado sob demanda com o MESMO nome, mapeado uma única vez.
-- ============================================================================

create table if not exists contaazul.ca_servico_map (
  nome          text primary key,       -- nome do serviço (igual nos dois lados)
  ca_servico_id text not null,
  criado_em     timestamptz not null default now()
);
alter table contaazul.ca_servico_map enable row level security;
grant all on contaazul.ca_servico_map to service_role;
