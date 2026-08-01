-- Status da integração POR CONTRATO.
--
-- v_contratos_painel continua uma linha por cliente (o d4sign-webhook e o
-- botão "faturar no CA" dependem disso). Mas a tela de gestão agora lista
-- contrato — e um cliente pode ter dois, cada um com seu contrato no CA.
-- Esta view expõe o vínculo cru pra ela, já com o cs_contrato_id que a
-- migration 20260801000001 do ZeiClient adicionou ao mapa.

create or replace view contaazul.v_contrato_map_painel as
select
  k.cs_contrato_id,
  k.cs_cliente_id,
  k.ca_contrato_id,
  k.numero                       as contrato_numero,
  k.valor                        as contrato_valor,
  k.status                       as contrato_status,
  k.origem                       as contrato_origem,
  k.criado_em                    as contrato_criado_em,
  (m.cs_cliente_id is not null)  as pessoa_sincronizada
from contaazul.ca_contrato_map k
left join contaazul.ca_pessoa_map m on m.cs_cliente_id = k.cs_cliente_id;

grant select on contaazul.v_contrato_map_painel to authenticated;

-- v_contratos_painel continua UMA linha por cliente. Com dois contratos, o
-- join por cs_cliente_id passaria a devolver duas linhas e quebraria quem lê
-- com maybeSingle (botão "faturar no CA", d4sign-webhook). Ela passa a olhar
-- só o contrato principal — que é o que esses fluxos querem dizer com "o
-- contrato do cliente". Contrato adicional se vê na gestão de contratos.
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
  k.criado_em                           as contrato_criado_em,
  length(regexp_replace(coalesce(c.cnpj_cpf, ''), '\D', '', 'g')) in (11, 14) as tem_documento
from public.cs_clientes c
left join contaazul.ca_pessoa_map  m on m.cs_cliente_id = c.id
left join contaazul.ca_contrato_map k
       on k.cs_cliente_id = c.id
      and (
        k.cs_contrato_id is null
        or k.cs_contrato_id = (
          select ct.id from public.cs_contratos ct
           where ct.cliente_id = c.id and ct.principal
        )
      )
where c.status = 'ativo';

grant select on contaazul.v_contratos_painel to authenticated;

-- ROLLBACK (comentado)
-- drop view if exists contaazul.v_contrato_map_painel;
