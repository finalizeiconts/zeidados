-- Indicadores do escritório — a fotografia que o Zei Dados exibe como hub.
--
-- Fontes: carteira do ZeiClient (cs_clientes), contratos no Conta Azul
-- (ca_contrato_map) e contas a receber sincronizadas do CA
-- (ca_financial_events, kind='receita'). Inadimplência em faixas de atraso:
-- até 15 · 15–30 · 30–60 · 60+ dias, por valor e quantidade.

create or replace view contaazul.v_indicadores_escritorio as
with carteira as (
  select *
  from public.cs_clientes
  where status = 'ativo'
    and coalesce(tipo_pessoa, 'cliente') = 'cliente'
),
mensalizado as (
  -- Semestral ÷6, anual ÷12 etc.: o equivalente mensal de cada contrato.
  select
    valor_honorarios,
    case
      when lower(coalesce(recorrencia_pagamento, 'mensal')) like 'semestr%' then valor_honorarios / 6.0
      when lower(coalesce(recorrencia_pagamento, 'mensal')) like 'anual%'   then valor_honorarios / 12.0
      when lower(coalesce(recorrencia_pagamento, 'mensal')) like 'trimestr%' then valor_honorarios / 3.0
      when lower(coalesce(recorrencia_pagamento, 'mensal')) like 'bimestr%'  then valor_honorarios / 2.0
      else valor_honorarios
    end as mensal
  from carteira
  where coalesce(nao_faturar, false) = false
    and coalesce(valor_honorarios, 0) > 0
),
vencidas as (
  select amount, (current_date - due_date) as dias_atraso
  from contaazul.ca_financial_events
  where kind = 'receita'
    and status <> 'pago'
    and due_date < current_date
)
select
  (select count(*) from carteira)                                       as clientes_ativos,
  (select count(*) from contaazul.ca_contrato_map where status='ativo') as contratos_no_ca,
  (select round(coalesce(sum(mensal), 0), 2) from mensalizado)          as honorarios_recorrentes_mensal,
  (select round(coalesce(avg(mensal), 0), 2) from mensalizado)          as ticket_medio_mensal,
  (select count(*) from mensalizado)                                    as clientes_com_honorario,

  (select round(coalesce(sum(amount), 0), 2) from vencidas)                          as inadimplencia_total,
  (select count(*) from vencidas)                                                    as inadimplencia_titulos,
  (select round(coalesce(sum(amount), 0), 2) from vencidas where dias_atraso <= 15)  as vencido_ate_15d,
  (select count(*)                           from vencidas where dias_atraso <= 15)  as vencido_ate_15d_qtde,
  (select round(coalesce(sum(amount), 0), 2) from vencidas where dias_atraso > 15 and dias_atraso <= 30) as vencido_15_30d,
  (select count(*)                           from vencidas where dias_atraso > 15 and dias_atraso <= 30) as vencido_15_30d_qtde,
  (select round(coalesce(sum(amount), 0), 2) from vencidas where dias_atraso > 30 and dias_atraso <= 60) as vencido_30_60d,
  (select count(*)                           from vencidas where dias_atraso > 30 and dias_atraso <= 60) as vencido_30_60d_qtde,
  (select round(coalesce(sum(amount), 0), 2) from vencidas where dias_atraso > 60)   as vencido_60d_mais,
  (select count(*)                           from vencidas where dias_atraso > 60)   as vencido_60d_mais_qtde;

grant select on contaazul.v_indicadores_escritorio to authenticated;

-- ROLLBACK (comentado)
-- drop view if exists contaazul.v_indicadores_escritorio;
