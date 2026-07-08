-- ============================================================================
-- Agendamento do polling do Conta Azul (o "tempo real").
-- Como o Conta Azul NÃO tem webhooks, sincronizamos por polling: um job do
-- pg_cron chama a Edge Function `ca-sync` a cada 2 minutos. Cada lançamento
-- novo/alterado dispara um evento de Realtime que o painel recebe na hora.
--
-- Rode este script UMA vez no SQL Editor do seu projeto, DEPOIS de:
--   1) aplicar a migration 0001_init.sql
--   2) fazer deploy das Edge Functions
--   3) definir os secrets (ver supabase/set-secrets.example.sh)
--
-- Substitua <PROJECT_REF> e <SERVICE_ROLE_KEY> pelos valores do seu projeto.
-- ============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Remove agendamento anterior (se existir) para poder reexecutar.
select cron.unschedule('ca-sync-2min')
where exists (select 1 from cron.job where jobname = 'ca-sync-2min');

-- Agenda a cada 2 minutos.
select cron.schedule(
  'ca-sync-2min',
  '*/2 * * * *',
  $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/ca-sync',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- Conferir agendamentos:   select * from cron.job;
-- Ver execuções recentes:   select * from cron.job_run_details order by start_time desc limit 20;
-- Ver logs do nosso sync:   select * from public.ca_sync_log order by started_at desc limit 20;
