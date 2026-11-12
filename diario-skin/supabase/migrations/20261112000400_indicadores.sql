-- Diário da Linha Skin — view ops_indicadores (cálculos da seção 7).
--
-- Mesmas fórmulas do aplicativo (src/lib/calc.ts). Serve para consulta direta
-- no banco, planilhas e ferramentas de BI. Respeita as políticas de acesso
-- de quem consulta (security_invoker).

create or replace view public.ops_indicadores
with (security_invoker = true) as
with base as (
  select
    o.*,
    m.cavidades,
    m.filme_fundo_kg_bdj,
    m.filme_tampa_kg_bdj,
    (o.passo_fim - o.passo_inicio) as passos,
    r.retrabalho,                                   -- nulo = retrabalho não registrado (histórico)
    coalesce(pa.minutos_parados, 0) as minutos_parados,
    coalesce(f.fotos, 0) as fotos,
    case when o.hora_inicio is not null and o.hora_fim is not null then
      (extract(epoch from (o.hora_fim - o.hora_inicio)) / 3600.0
        + case when o.hora_fim < o.hora_inicio then 24 else 0 end)::numeric
    end as horas,
    rp.id as receita_id,
    rp.ciclo_teorico_s,
    array_remove(array[
      case when o.t_dome is not null and rp.t_dome is not null and o.t_dome <> rp.t_dome then 't_dome' end,
      case when o.t_pre  is not null and rp.t_pre  is not null and o.t_pre  <> rp.t_pre  then 't_pre'  end,
      case when o.t1     is not null and rp.t1     is not null and o.t1     <> rp.t1     then 't1'     end,
      case when o.t2     is not null and rp.t2     is not null and o.t2     <> rp.t2     then 't2'     end,
      case when o.t4     is not null and rp.t4     is not null and o.t4     <> rp.t4     then 't4'     end,
      case when o.t5     is not null and rp.t5     is not null and o.t5     <> rp.t5     then 't5'     end,
      case when o.t6     is not null and rp.t6     is not null and o.t6     <> rp.t6     then 't6'     end,
      case when o.t7     is not null and rp.t7     is not null and o.t7     <> rp.t7     then 't7'     end,
      case when o.p_vent is not null and rp.p_vent is not null and o.p_vent <> rp.p_vent then 'p_vent' end,
      case when o.sp     is not null and rp.sp     is not null and o.sp     <> rp.sp     then 'sp'     end,
      case when o.tx     is not null and rp.tx     is not null and o.tx     <> rp.tx     then 'tx'     end,
      case when o.tmax   is not null and rp.tmax   is not null and o.tmax   <> rp.tmax   then 'tmax'   end
    ], null) as parametros_alterados
  from public.ops o
  join public.moldes m on m.molde = o.molde
  left join lateral (
    select sum(x.quantidade)::integer as retrabalho from public.op_retrabalho x where x.op_id = o.id
  ) r on true
  left join lateral (
    select sum(x.minutos)::integer as minutos_parados from public.op_paradas x where x.op_id = o.id
  ) pa on true
  left join lateral (
    select count(*)::integer as fotos from public.op_fotos x where x.op_id = o.id
  ) f on true
  -- Receita padrão que valia na data da OP: a mais recente com vigência até
  -- aquele dia; sem data, a mais recente; antes da primeira, a mais antiga.
  left join lateral (
    select x.*
    from public.receitas_padrao x
    order by
      (o.data is null or (x.vigente_desde at time zone 'America/Sao_Paulo')::date <= o.data) desc,
      case when o.data is null or (x.vigente_desde at time zone 'America/Sao_Paulo')::date <= o.data
           then x.vigente_desde end desc nulls last,
      case when o.data is null or (x.vigente_desde at time zone 'America/Sao_Paulo')::date <= o.data
           then x.id end desc nulls last,
      x.vigente_desde asc,
      x.id asc
    limit 1
  ) rp on true
),
contagem as (
  select
    b.*,
    case when b.passos > 0 then b.passos * b.cavidades end as bandejas_formadas,
    case
      when b.caixas is not null and b.embalagens_por_caixa > 0
        then b.caixas * b.embalagens_por_caixa + coalesce(b.embalagens_avulsas, 0)
      when b.peso_final_kg > 0 and b.peso_nominal_kg > 0
        then round(b.peso_final_kg / b.peso_nominal_kg)::integer
    end as embalagens_boas,
    (b.caixas is not null and b.embalagens_por_caixa > 0) as boas_por_caixas
  from base b
),
destino as (
  select
    c.*,
    case when c.bandejas_formadas is not null and c.embalagens_boas is not null
         then greatest(0, c.bandejas_formadas - c.embalagens_boas) end as perdidas
  from contagem c
)
select
  d.id, d.origem, d.status, d.data, d.produto_codigo, d.produto_descricao, d.op, d.molde,
  d.peso_nominal_kg, d.embalagens_por_caixa, d.lote_mp, d.temp_produto_c,
  d.filme_fundo, d.filme_tampa, d.lote_filme, d.hora_inicio, d.hora_fim,
  d.passo_inicio, d.passo_fim, d.caixas, d.embalagens_avulsas, d.peso_final_kg,
  d.aparencia, d.observacoes,
  d.t_dome, d.t_pre, d.t1, d.t2, d.t4, d.t5, d.t6, d.t7, d.p_vent, d.sp, d.tx, d.tmax,
  d.parametros_origem, d.criado_por, d.criado_em, d.alterado_por, d.alterado_em, d.fechada_em,
  d.cavidades,
  d.passos,
  d.bandejas_formadas,
  d.embalagens_boas,
  d.retrabalho,
  case when d.retrabalho is not null and d.perdidas is not null
       then greatest(0, d.bandejas_formadas - d.embalagens_boas - d.retrabalho) end as vazias,
  case when d.retrabalho is null then d.perdidas end as perda_nao_classificada,
  d.embalagens_boas::numeric / nullif(d.bandejas_formadas, 0) as aproveitamento,
  d.retrabalho::numeric / nullif(d.bandejas_formadas, 0) as retrabalho_pct,
  case when d.retrabalho is not null and d.perdidas is not null
       then greatest(0, d.bandejas_formadas - d.embalagens_boas - d.retrabalho)::numeric
            / nullif(d.bandejas_formadas, 0) end as vazias_pct,
  d.horas,
  d.minutos_parados,
  d.peso_final_kg / nullif(d.horas, 0) as produtividade_kg_h,
  case when d.passos > 0 then d.passos / nullif(d.horas * 60, 0) end as ciclos_por_minuto,
  d.ciclo_teorico_s,
  d.perdidas * (d.filme_fundo_kg_bdj + d.filme_tampa_kg_bdj) as filme_perdido_kg,
  d.perdidas * d.filme_fundo_kg_bdj as filme_fundo_perdido_kg,
  d.perdidas * d.filme_tampa_kg_bdj as filme_tampa_perdido_kg,
  d.bandejas_formadas * (d.filme_fundo_kg_bdj + d.filme_tampa_kg_bdj) as filme_total_kg,
  d.bandejas_formadas * (d.filme_fundo_kg_bdj + d.filme_tampa_kg_bdj) * 1000
    / nullif(d.peso_final_kg, 0) as filme_g_por_kg,
  (d.filme_fundo_kg_bdj + d.filme_tampa_kg_bdj) * 1000 / nullif(d.peso_nominal_kg, 0) as filme_minimo_g_por_kg,
  d.peso_final_kg / nullif(d.embalagens_boas, 0) as peso_medio_kg,
  case when d.boas_por_caixas and d.peso_nominal_kg > 0
       then d.peso_final_kg / nullif(d.embalagens_boas, 0) / d.peso_nominal_kg - 1 end as sobrepeso,
  d.receita_id,
  d.parametros_alterados,
  d.fotos
from destino d;

revoke all on public.ops_indicadores from anon, authenticated;
grant select on public.ops_indicadores to authenticated;
