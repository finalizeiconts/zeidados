-- ============================================================================
-- Visão de status da integração Conta Azul, legível pelo app (ZeiClient).
-- NÃO expõe tokens — apenas metadados (conectado?, validade, últimas syncs).
-- A view roda com privilégios do dono (postgres), contornando o RLS das
-- tabelas internas de forma controlada.
-- ============================================================================

create or replace view contaazul.v_integracao_status as
select
  exists (select 1 from contaazul.ca_tokens)                          as conectado,
  (select expires_at   from contaazul.ca_tokens limit 1)              as token_expira_em,
  (select updated_at   from contaazul.ca_tokens limit 1)              as token_atualizado_em,
  (select max(started_at) from contaazul.ca_sync_log where ok)        as ultima_sync_financeiro,
  (select count(*) from contaazul.ca_financial_events)                as eventos_sincronizados,
  (select count(*) from contaazul.ca_pessoa_map)                      as clientes_mapeados,
  (select max(finished_at) from contaazul.ca_pessoas_sync_log where ok) as ultima_sync_clientes;

comment on view contaazul.v_integracao_status is
  'Status da integração Conta Azul para a página de integrações do ZeiClient.';

grant select on contaazul.v_integracao_status to authenticated;
