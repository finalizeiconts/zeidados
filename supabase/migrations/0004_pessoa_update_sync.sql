-- ============================================================================
-- Sincronização contínua de cadastros (ZeiClient = fonte da verdade).
-- Guarda a "impressão digital" (hash) dos dados enviados ao Conta Azul para
-- detectar alterações no CRM e propagá-las via PATCH.
-- ============================================================================

alter table contaazul.ca_pessoa_map
  add column if not exists payload_hash text;

alter table contaazul.ca_pessoas_sync_log
  add column if not exists atualizados int default 0;

comment on column contaazul.ca_pessoa_map.payload_hash is
  'SHA-256 do payload enviado ao Conta Azul; muda no CRM → PATCH na próxima rodada.';
