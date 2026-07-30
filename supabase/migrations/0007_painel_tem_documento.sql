-- O auto-start do contrato (d4sign-webhook) usava tem_cnpj como guarda — e
-- parte da carteira é pessoa física (produtor rural etc.) com contrato de
-- honorários igual. tem_documento aceita CPF (11) ou CNPJ (14); tem_cnpj
-- permanece por compatibilidade com o painel.

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
  length(regexp_replace(coalesce(c.cnpj_cpf, ''), '\D', '', 'g')) in (11, 14) as tem_documento,
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

-- ROLLBACK (comentado)
-- Recriar a view sem a coluna tem_documento (versão da migration 0005).
