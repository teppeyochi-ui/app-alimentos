-- Visão "plan1": os apontamentos com as mesmas colunas e cálculos da Plan1.
-- Rodar uma vez no Supabase: SQL Editor > New query > colar tudo > Run.
-- Depois, consulte com:  select * from plan1;
-- (também aparece no Table Editor e pode ser lida pelo Power BI / Excel).

create or replace view plan1 with (security_invoker = true) as
select
    a.id                                                        as "Nº",
    a.data                                                      as "Data",
    p.codigo                                                    as "PROD_DER",
    p.descricao                                                 as "DESPRO",
    p.desder                                                    as "DESDER",
    coalesce(a.peso_liquido::text, case when p.pdv then 'PDV' end) as "Peso Líquido",
    a.molde                                                     as "Molde",
    a.op                                                        as "OP",
    to_char(a.hora_inicio, 'HH24:MI')                           as "Hora inicio",
    a.passo_inicial                                             as "Passo inicio",
    to_char(a.hora_fim, 'HH24:MI')                              as "Hora termino",
    a.passo_final                                               as "Passo fim",
    a.producao_kg                                               as "Produção (kg)",
    a.passo_final - a.passo_inicial                             as "Passo total",
    round((a.producao_kg / nullif(a.peso_liquido, 0))::numeric, 0) as "Produção (un.)",
    (a.passo_final - a.passo_inicial) * a.cavidades             as "Produção (Bdj Total)",
    round(((a.producao_kg / nullif(a.peso_liquido, 0))
           / nullif((a.passo_final - a.passo_inicial) * a.cavidades, 0))::numeric, 4)
                                                                as "Rendimento (máquina)",
    to_char(a.hora_fim - a.hora_inicio, 'HH24:MI')              as "Tempo de produção total",
    round((a.producao_kg
           / nullif(extract(epoch from a.hora_fim - a.hora_inicio) / 3600, 0))::numeric, 1)
                                                                as "Produtividade (kg/h)",
    round(((extract(epoch from a.hora_fim - a.hora_inicio) / 60)
           / nullif(a.producao_kg, 0))::numeric, 2)             as "Tempo por kg (min)",
    round(((a.passo_final - a.passo_inicial) * a.cavidades * a.fundo_un)::numeric, 2)
                                                                as "Consumo filme fundo",
    round(((a.passo_final - a.passo_inicial) * a.cavidades * a.tampa_un)::numeric, 2)
                                                                as "Consumo Filme Tampa",
    round(((a.passo_final - a.passo_inicial) * a.cavidades * a.fundo_un
           / nullif(a.producao_kg, 0))::numeric, 4)             as "FT consumo Fundo",
    round(((a.passo_final - a.passo_inicial) * a.cavidades * a.tampa_un
           / nullif(a.producao_kg, 0))::numeric, 4)             as "FT consumo tampa",
    l.nome                                                      as "Linha",
    o.nome                                                      as "Operador",
    a.turno                                                     as "Turno",
    a.parada_min                                                as "Parada (min)",
    a.motivo_parada                                             as "Motivo da parada",
    a.observacoes                                               as "Observações",
    a.criado_em                                                 as "Lançado em"
from apontamentos a
join produtos   p on p.id = a.produto_id
join linhas     l on l.id = a.linha_id
join operadores o on o.id = a.operador_id;

-- Proteção: o Supabase publica as tabelas numa API pública. Com RLS ligado e
-- sem regras, essa API não devolve nada; o app (dono das tabelas) continua
-- lendo e gravando normalmente.
alter table apontamentos enable row level security;
alter table produtos     enable row level security;
alter table moldes       enable row level security;
alter table linhas       enable row level security;
alter table operadores   enable row level security;
