-- Diário da Linha Skin — atualização do banco criado com a primeira versão.
-- Gerado por ferramentas/gerar-sql.mjs.
-- Uso: Supabase → SQL Editor → colar tudo → Run.
-- Não apaga nada: acrescenta colunas, troca a função de gravação e a view,
-- cria o histórico de alterações e o perfil gestor, e completa o catálogo.
-- Pode ser rodado mais de uma vez, em qualquer versão anterior do banco.

-- 1) Catálogo: derivação, peso da caixa, espécie e molde a confirmar
alter table public.produtos alter column molde drop not null;
alter table public.produtos add column if not exists molde_a_confirmar boolean not null default false;
alter table public.produtos add column if not exists derivacao text;
alter table public.produtos add column if not exists peso_caixa_kg numeric check (peso_caixa_kg > 0);
alter table public.produtos add column if not exists especie text;

-- 2) OP: avaliação da foto do produto pela IA
alter table public.ops add column if not exists analise_ia jsonb;

-- 3) Função de gravação e view de indicadores (versões atuais)
-- Diário da Linha Skin — gravação de uma OP inteira numa chamada só.
--
-- O aparelho guarda a OP localmente e chama salvar_op(p) quando tem conexão.
-- A função grava OP, retrabalho, paradas e fotos na mesma transação e pode ser
-- repetida à vontade: os identificadores vêm do aparelho, então reenviar não duplica.
--
-- Conflito entre aparelhos: vence a edição mais recente (campo alterado_em).
-- Paradas e fotos se somam; só saem as que vierem em *_removidas.
--
-- Roda com as permissões de quem chama (security invoker): valem as políticas
-- de acesso. Operador mexendo em OP já encerrada recebe erro 42501.
--
-- Devolve {"resultado": "gravada" | "igual" | "ignorada"}:
--   gravada  — entrou;
--   igual    — esta mesma edição já estava no servidor (reenvio);
--   ignorada — o servidor tem edição mais nova; o aparelho deve baixar a do servidor.

create or replace function public.salvar_op(p jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid := (p ->> 'id')::uuid;
  v_alterado timestamptz := least(coalesce((p ->> 'alterado_em')::timestamptz, now()), now());
  v_status text := coalesce(p ->> 'status', 'aberta');
  v_no_servidor timestamptz;
  n public.ops%rowtype;
begin
  if v_id is null then
    raise exception 'OP sem identificador.' using errcode = '22023';
  end if;
  if v_status not in ('aberta','fechada','cancelada') then
    raise exception 'Status inválido: %', v_status using errcode = '22023';
  end if;

  select o.alterado_em into v_no_servidor from public.ops o where o.id = v_id;
  if found and v_no_servidor is not null then
    if v_no_servidor = v_alterado then
      return jsonb_build_object('resultado', 'igual');
    elsif v_no_servidor > v_alterado then
      return jsonb_build_object('resultado', 'ignorada');
    end if;
  end if;

  -- Campos da OP com o tipo de cada coluna; chaves desconhecidas são ignoradas.
  n := jsonb_populate_record(null::public.ops, p);

  -- 1) A OP entra como 'aberta' enquanto retrabalho, paradas e fotos são
  --    gravados (as políticas deles dependem do status). O status pedido
  --    é aplicado no passo 5.
  insert into public.ops as o (
    id, origem, status, data, produto_codigo, produto_descricao, op, molde,
    peso_nominal_kg, embalagens_por_caixa, lote_mp, temp_produto_c,
    filme_fundo, filme_tampa, lote_filme, hora_inicio, hora_fim,
    passo_inicio, passo_fim, caixas, embalagens_avulsas, peso_final_kg,
    aparencia, observacoes,
    t_dome, t_pre, t1, t2, t4, t5, t6, t7, p_vent, sp, tx, tmax, parametros_origem,
    criado_em, alterado_em, fechada_em, analise_ia
  ) values (
    v_id, coalesce(n.origem, 'diario'), 'aberta', n.data, n.produto_codigo,
    coalesce(trim(n.produto_descricao), ''), n.op, n.molde,
    n.peso_nominal_kg, n.embalagens_por_caixa, n.lote_mp, n.temp_produto_c,
    n.filme_fundo, n.filme_tampa, n.lote_filme, n.hora_inicio, n.hora_fim,
    n.passo_inicio, n.passo_fim, n.caixas, coalesce(n.embalagens_avulsas, 0), n.peso_final_kg,
    n.aparencia, n.observacoes,
    n.t_dome, n.t_pre, n.t1, n.t2, n.t4, n.t5, n.t6, n.t7, n.p_vent, n.sp, n.tx, n.tmax, n.parametros_origem,
    n.criado_em, v_alterado, n.fechada_em,
    case when jsonb_typeof(n.analise_ia) = 'object' then n.analise_ia end
  )
  on conflict (id) do update set
    status = 'aberta',
    data = excluded.data,
    produto_codigo = excluded.produto_codigo,
    produto_descricao = excluded.produto_descricao,
    op = excluded.op,
    molde = excluded.molde,
    peso_nominal_kg = excluded.peso_nominal_kg,
    embalagens_por_caixa = excluded.embalagens_por_caixa,
    lote_mp = excluded.lote_mp,
    temp_produto_c = excluded.temp_produto_c,
    filme_fundo = excluded.filme_fundo,
    filme_tampa = excluded.filme_tampa,
    lote_filme = excluded.lote_filme,
    hora_inicio = excluded.hora_inicio,
    hora_fim = excluded.hora_fim,
    passo_inicio = excluded.passo_inicio,
    passo_fim = excluded.passo_fim,
    caixas = excluded.caixas,
    embalagens_avulsas = excluded.embalagens_avulsas,
    peso_final_kg = excluded.peso_final_kg,
    aparencia = excluded.aparencia,
    observacoes = excluded.observacoes,
    t_dome = excluded.t_dome, t_pre = excluded.t_pre,
    t1 = excluded.t1, t2 = excluded.t2, t4 = excluded.t4, t5 = excluded.t5,
    t6 = excluded.t6, t7 = excluded.t7, p_vent = excluded.p_vent,
    sp = excluded.sp, tx = excluded.tx, tmax = excluded.tmax,
    parametros_origem = excluded.parametros_origem,
    alterado_em = excluded.alterado_em,
    fechada_em = excluded.fechada_em,
    analise_ia = excluded.analise_ia;

  -- 2) Retrabalho: uma linha por motivo, com a contagem do aparelho.
  if jsonb_typeof(p -> 'retrabalho') = 'object' then
    insert into public.op_retrabalho (op_id, motivo, quantidade)
    select v_id, e.key, greatest(0, round(e.value::numeric)::integer)
    from jsonb_each_text(p -> 'retrabalho') e
    where e.key in ('sem_vacuo','furo','ruga','selagem','peso','posicao','outro')
      and e.value ~ '^-?[0-9]+(\.[0-9]+)?$'
    on conflict (op_id, motivo) do update set quantidade = excluded.quantidade;
  end if;

  -- 3) Paradas.
  if jsonb_typeof(p -> 'paradas') = 'array' then
    insert into public.op_paradas (id, op_id, motivo, minutos)
    select x.id, v_id, x.motivo, x.minutos
    from jsonb_to_recordset(p -> 'paradas') as x(id uuid, motivo text, minutos integer)
    where x.id is not null and x.minutos > 0 and nullif(trim(x.motivo), '') is not null
    on conflict (id) do update set motivo = excluded.motivo, minutos = excluded.minutos;
  end if;
  if jsonb_typeof(p -> 'paradas_removidas') = 'array' then
    delete from public.op_paradas d
    where d.op_id = v_id
      and d.id in (select t::uuid from jsonb_array_elements_text(p -> 'paradas_removidas') t);
  end if;

  -- 4) Fotos: só o registro; o arquivo vai para o bucket fotos-op à parte.
  if jsonb_typeof(p -> 'fotos') = 'array' then
    insert into public.op_fotos (id, op_id, tipo, caminho, tela_numero, criado_em)
    select x.id, v_id, x.tipo, x.caminho, x.tela_numero, coalesce(x.criado_em, now())
    from jsonb_to_recordset(p -> 'fotos')
      as x(id uuid, tipo text, caminho text, tela_numero integer, criado_em timestamptz)
    where x.id is not null and x.tipo in ('tela','produto') and nullif(x.caminho, '') is not null
    on conflict (id) do update set tela_numero = excluded.tela_numero;
  end if;
  if jsonb_typeof(p -> 'fotos_removidas') = 'array' then
    delete from public.op_fotos d
    where d.op_id = v_id
      and d.id in (select t::uuid from jsonb_array_elements_text(p -> 'fotos_removidas') t);
  end if;

  -- 5) Status pedido. Se a política não deixar, nenhuma linha muda e a transação inteira é desfeita.
  if v_status <> 'aberta' then
    update public.ops o
       set status = v_status,
           fechada_em = case when v_status = 'fechada' then coalesce(o.fechada_em, now()) else o.fechada_em end
     where o.id = v_id;
    if not found then
      raise exception 'Sem permissão para alterar esta OP.' using errcode = '42501';
    end if;
  end if;

  return jsonb_build_object('resultado', 'gravada');
end
$$;

revoke execute on function public.salvar_op(jsonb) from public, anon;
grant execute on function public.salvar_op(jsonb) to authenticated, service_role;

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
  d.fotos,
  -- Nota de aparência (0 a 10) da última avaliação da foto do produto pela IA.
  case when jsonb_typeof(d.analise_ia -> 'nota_aparencia') = 'number'
       then (d.analise_ia ->> 'nota_aparencia')::numeric end as nota_aparencia_ia
from destino d;

revoke all on public.ops_indicadores from anon, authenticated;
grant select on public.ops_indicadores to authenticated;

-- 4) Histórico de alterações das OPs e perfil gestor
-- Diário da Linha Skin — histórico de alterações das OPs e perfil "gestor".
--
-- Este arquivo pode ser rodado mais de uma vez (serve à instalação nova e à
-- atualização de um banco que já existe).

-- ---------------------------------------------------------------- perfil gestor
-- Gestor: usuário que só consulta. As políticas de gravação listam quem pode
-- gravar (operador, pd, admin); o gestor não está em nenhuma, então só lê.

alter table public.perfis drop constraint if exists perfis_papel_check;
alter table public.perfis add constraint perfis_papel_check
  check (papel in ('operador','pd','admin','gestor'));

-- Envio de fotos: só quem lança. (Antes bastava ser usuário ativo.)
-- Se o projeto não deixar trocar a política por aqui, fica a anterior: o
-- gestor continua sem conseguir ligar a foto a uma OP.
do $$
begin
  drop policy if exists fotos_op_enviar on storage.objects;
  create policy fotos_op_enviar on storage.objects for insert to authenticated
    with check (bucket_id = 'fotos-op' and (select public.papel_atual()) in ('operador','pd','admin'));
exception when insufficient_privilege then
  raise notice 'Política de envio de fotos mantida como estava (sem permissão para trocar).';
end
$$;

-- ---------------------------------------------------------------- histórico de alterações
-- Cada registro diz quem mudou o quê numa OP, de quanto para quanto.
--   mudancas = { "caixas": {"de": 110, "para": 111}, "retrabalho.furo": {"de": 2, "para": 3}, ... }
-- Para não virar um registro por toque na tela, as alterações da mesma pessoa
-- numa OP ABERTA são juntadas em blocos de até 15 minutos (fica o valor antes do
-- bloco e o valor depois). Com a OP encerrada, cada gravação é um registro.
-- Quem grava são os gatilhos abaixo; nenhum usuário escreve nesta tabela.

create table if not exists public.ops_historico (
  id bigint generated always as identity primary key,
  op_id uuid not null references public.ops(id) on delete cascade,
  em timestamptz not null default now(),        -- primeira alteração do registro
  ate timestamptz not null default now(),       -- última alteração juntada neste registro
  por uuid,                                     -- quem alterou (nulo = direto no banco)
  criou boolean not null default false,         -- o registro começa com a criação da OP
  op_aberta boolean not null default false,     -- tudo neste registro foi feito com a OP aberta
  transacao bigint not null default txid_current(),
  mudancas jsonb not null default '{}'::jsonb
);
create index if not exists ops_historico_op on public.ops_historico (op_id, id);

-- Junta as mudanças ao registro em curso ou abre um registro novo.
create or replace function public.historico_registrar(p_op uuid, p_mudancas jsonb, p_criou boolean, p_aberta boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  h public.ops_historico%rowtype;
  k text;
  v jsonb;
  novo jsonb;
  m jsonb;
begin
  if not p_criou and coalesce(p_mudancas, '{}'::jsonb) = '{}'::jsonb then
    return;
  end if;

  select * into h from public.ops_historico x where x.op_id = p_op order by x.id desc limit 1;
  if found and (
       h.transacao = txid_current()
       or (h.op_aberta and p_aberta and h.por is not distinct from auth.uid() and h.em > now() - interval '15 minutes')
     ) then
    m := h.mudancas;
    for k, v in select * from jsonb_each(coalesce(p_mudancas, '{}'::jsonb)) loop
      -- Campo que já estava no registro: mantém o valor de antes do registro.
      novo := case when m ? k then jsonb_build_object('de', m -> k -> 'de', 'para', v -> 'para') else v end;
      if (novo -> 'de') is not distinct from (novo -> 'para') then
        m := m - k;                       -- voltou ao valor de antes: não houve mudança
      else
        m := m || jsonb_build_object(k, novo);
      end if;
    end loop;
    if m = '{}'::jsonb and not h.criou then
      delete from public.ops_historico x where x.id = h.id;
    else
      update public.ops_historico x
         set mudancas = m, ate = now(), op_aberta = h.op_aberta and p_aberta
       where x.id = h.id;
    end if;
  else
    insert into public.ops_historico (op_id, por, criou, op_aberta, mudancas)
    values (p_op, auth.uid(), p_criou, p_aberta, coalesce(p_mudancas, '{}'::jsonb));
  end if;
end
$$;

-- OP: compara cada campo de antes e depois.
create or replace function public.ops_historico_op()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  a jsonb;
  d jsonb;
  k text;
  m jsonb := '{}'::jsonb;
  -- Carimbos automáticos não contam como alteração.
  ignorar constant text[] := array['id','origem','criado_por','criado_em','alterado_por','alterado_em','sincronizado_em','fechada_em'];
begin
  if tg_op = 'INSERT' then
    -- A carga do histórico da planilha não é um lançamento.
    if new.origem <> 'planilha' then
      perform public.historico_registrar(new.id, '{}'::jsonb, true, new.status = 'aberta');
    end if;
    return null;
  end if;

  a := to_jsonb(old);
  d := to_jsonb(new);
  for k in select jsonb_object_keys(d) loop
    if k = any (ignorar) or (a -> k) is not distinct from (d -> k) then
      continue;
    end if;
    if k = 'analise_ia' then
      -- Da avaliação por IA guarda só a nota e a data; o texto fica na própria OP.
      m := m || jsonb_build_object(k, jsonb_build_object(
        'de', case when jsonb_typeof(a -> k) = 'object' then jsonb_build_object('nota', a -> k -> 'nota_aparencia', 'em', a -> k -> 'em') end,
        'para', case when jsonb_typeof(d -> k) = 'object' then jsonb_build_object('nota', d -> k -> 'nota_aparencia', 'em', d -> k -> 'em') end));
    else
      m := m || jsonb_build_object(k, jsonb_build_object('de', a -> k, 'para', d -> k));
    end if;
  end loop;
  perform public.historico_registrar(new.id, m, false, old.status = 'aberta' and new.status = 'aberta');
  return null;
end
$$;

-- Retrabalho: contagem por motivo.
create or replace function public.ops_historico_retrabalho()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_op uuid;
  v_motivo text;
  v_de integer;
  v_para integer;
  v_aberta boolean;
begin
  if tg_op = 'DELETE' then
    v_op := old.op_id; v_motivo := old.motivo; v_de := old.quantidade; v_para := 0;
  elsif tg_op = 'INSERT' then
    v_op := new.op_id; v_motivo := new.motivo; v_de := 0; v_para := new.quantidade;
  else
    v_op := new.op_id; v_motivo := new.motivo; v_de := old.quantidade; v_para := new.quantidade;
  end if;
  if coalesce(v_de, 0) = coalesce(v_para, 0) then
    return null;
  end if;
  select o.status = 'aberta' into v_aberta from public.ops o where o.id = v_op;
  if found then
    perform public.historico_registrar(
      v_op,
      jsonb_build_object('retrabalho.' || v_motivo, jsonb_build_object('de', coalesce(v_de, 0), 'para', coalesce(v_para, 0))),
      false, v_aberta);
  end if;
  return null;
end
$$;

-- Paradas: inclusão, alteração e remoção.
create or replace function public.ops_historico_parada()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_op uuid;
  v_id uuid;
  v_de text;
  v_para text;
  v_aberta boolean;
begin
  if tg_op <> 'INSERT' then
    v_op := old.op_id; v_id := old.id; v_de := old.minutos || ' min · ' || old.motivo;
  end if;
  if tg_op <> 'DELETE' then
    v_op := new.op_id; v_id := new.id; v_para := new.minutos || ' min · ' || new.motivo;
  end if;
  if v_de is not distinct from v_para then
    return null;
  end if;
  select o.status = 'aberta' into v_aberta from public.ops o where o.id = v_op;
  if found then
    perform public.historico_registrar(
      v_op, jsonb_build_object('parada.' || v_id, jsonb_build_object('de', v_de, 'para', v_para)), false, v_aberta);
  end if;
  return null;
end
$$;

-- Fotos: inclusão e remoção.
create or replace function public.ops_historico_foto()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_op uuid;
  v_id uuid;
  v_de text;
  v_para text;
  v_aberta boolean;
begin
  if tg_op = 'DELETE' then
    v_op := old.op_id; v_id := old.id; v_de := old.tipo;
  else
    v_op := new.op_id; v_id := new.id; v_para := new.tipo;
  end if;
  select o.status = 'aberta' into v_aberta from public.ops o where o.id = v_op;
  if found then
    perform public.historico_registrar(
      v_op, jsonb_build_object('foto.' || v_id, jsonb_build_object('de', v_de, 'para', v_para)), false, v_aberta);
  end if;
  return null;
end
$$;

drop trigger if exists ops_historico on public.ops;
create trigger ops_historico
  after insert or update on public.ops
  for each row execute function public.ops_historico_op();

drop trigger if exists op_retrabalho_historico on public.op_retrabalho;
create trigger op_retrabalho_historico
  after insert or update or delete on public.op_retrabalho
  for each row execute function public.ops_historico_retrabalho();

drop trigger if exists op_paradas_historico on public.op_paradas;
create trigger op_paradas_historico
  after insert or update or delete on public.op_paradas
  for each row execute function public.ops_historico_parada();

drop trigger if exists op_fotos_historico on public.op_fotos;
create trigger op_fotos_historico
  after insert or delete on public.op_fotos
  for each row execute function public.ops_historico_foto();

-- Leitura: qualquer usuário ativo. Escrita: só os gatilhos.
alter table public.ops_historico enable row level security;
drop policy if exists ops_historico_ler on public.ops_historico;
create policy ops_historico_ler on public.ops_historico for select to authenticated
  using ((select public.usuario_ativo()));

revoke all on public.ops_historico from anon, authenticated;
grant select on public.ops_historico to authenticated;
revoke execute on function public.historico_registrar(uuid, jsonb, boolean, boolean) from public, anon, authenticated;
revoke execute on function public.ops_historico_op(), public.ops_historico_retrabalho(),
  public.ops_historico_parada(), public.ops_historico_foto() from public, anon, authenticated;

-- 5) Catálogo da planilha de produtos (118 SKUs). Produto novo entra; no que já
--    existia, entram derivação, caixa e espécie. Molde e embalagens por caixa
--    que já estavam preenchidos no banco são mantidos.
insert into public.produtos as p
  (codigo, descricao, molde, molde_a_confirmar, peso_nominal_kg, embalagens_por_caixa, derivacao, peso_caixa_kg, especie)
values
  ('05398002051261-1013', 'LOMBO SALMON SASHIMI S/P S/E 250GR BDJ SKIN PACK', '3x1', false, 0.25, 16, 'FRESCATTO ISP CXA 04', 4, 'SALMON FRESCO'),
  ('0604200200134F-1058', 'LOMBO DOURADO S/P S/E S/CL SKIN BDJ PDV', '3x1', true, null, null, 'FRESC CXA PDV PF', null, 'DOURADO'),
  ('06042002001341-1058', 'LOMBO DOURADO S/P S/E S/CL SKIN BDJ PDV', '3x1', false, null, null, 'FRESC CXA PDV PF', null, 'DOURADO'),
  ('06126030001341-1058', 'LOMBO MECA PEDACOS S/P S/E S/CL SKIN BDJ PDV', '3x1', false, null, null, 'FRESC CXA PDV PF', null, 'MECA'),
  ('06126030001351-1058', 'LOMBO MECA PEDACOS S/P S/E S/CL SKIN PREMIUM PDV', '2x1', false, null, null, 'FRESC CXA PDV PF', null, 'MECA'),
  ('06161010001341-1058', 'LOMBO PREGO S/P S/E DEF S/CL SKIN BDJ PDV', '3x1', false, null, null, 'FRESC CXA PDV PF', null, 'PREGO'),
  ('0622203000134F-1058', 'LOMBO PIRARUCU PEDACOS S/P S/E S/CL SKIN BDJ', null, true, null, null, 'FRESC CXA PDV PF', null, 'NAMORADO'),
  ('06222030001341-1058', 'LOMBO PIRARUCU PEDACOS S/P S/E S/CL SKIN BDJ PDV', '2x1', false, null, null, 'FRESC CXA PDV PF', null, 'PIRARUCU'),
  ('06224030001341-1058', 'LOMBO FILHOTE PEDACOS S/P S/E S/CL SKIN BDJ PDV', '3x1', false, null, null, 'FRESC CXA PDV PF', null, 'FILHOTE'),
  ('06224030001371-1058', 'LOMBO FILHOTE PEDACOS S/P S/E S/CL SKIN G BDJ PDV', '2x1', false, null, null, 'FRESC CXA PDV PF', null, 'FILHOTE'),
  ('0634402500133F-1058', 'LOMBO BACALHAU G.MORHUA DESSALG S/CL GOLD SKIN BDJ PDV', null, true, null, null, 'FRESC CXA PDV PF', null, 'BACALHAU'),
  ('06344025001331-1058', 'LOMBO BACALHAU G.MORHUA DESS S/CL GOLD SKIN BDJPDV', '3x1', false, null, null, 'FRESC CXA PDV PF', null, 'BACALHAU'),
  ('0908409931213E-086', 'F. SALMON PEDACOS SKIN 8-10', null, true, null, null, 'TAB', null, 'SALMON FRESCO'),
  ('0908409931413E-086', 'F. SALMON PEDACOS SKIN 10-12', null, true, null, null, 'TAB', null, 'SALMON FRESCO'),
  ('0908409931513E-086', 'F. SALMON PEDACOS SKIN 12-14', null, true, null, null, 'TAB', null, 'SALMON FRESCO'),
  ('0938907200103M-815', 'F SALMON PEDACOS SKIN S/CL BDJ PDV', null, true, null, null, 'MPR ISP', null, 'SALMON FRESCO'),
  ('10035092300521-1058', 'F. CONGRO ROSA PEDACOS S/P S/E 5 OZ SKIN BDJ PDV', '3x1', false, 0.142, null, 'FRESC CXA PDV PF', null, 'CONGRO'),
  ('10042092001521-1058', 'F. DOURADO PEDACOS S/P S/E S/CL SKIN BDJ PDV', '2x1', false, null, null, 'FRESC CXA PDV PF', null, 'DOURADO'),
  ('10045092001521-1058', 'F. GAROUPA PEDACOS S/P S/E S/CL SKIN BDJ PDV', '2x1', false, null, null, 'FRESC CXA PDV PF', null, 'GAROUPA'),
  ('10049002001521-1058', 'F. LINGUADO S/P S/E S/CL SKIN BDJ PDV', '2x1', false, null, null, 'FRESC CXA PDV PF', null, 'LINGUADO'),
  ('1006809324659F-964', 'F. PESCADA AMARELA PEDACOS S/E 500GR SKIN PREMIUM', '2x1', true, 0.5, 15, 'FRESCATTO CXA 7,5', 7.5, 'PESCADA AMARELA'),
  ('1006809324659R-964', 'F. PESCADA AMARELA PEDACOS S/E 500GR SKIN PREMIUM', '2x1', true, 0.5, 15, 'FRESCATTO CXA 7,5', 7.5, 'PESCADA AMARELA'),
  ('10068093246591-220', 'F. PESCADA AMARELA PEDACOS S/E 500GR SKIN PREMIUM', '2x1', false, 0.5, 12, 'FRESCATTO CXA 06', 6, 'PESCADA AMARELA'),
  ('10068093246591-964', 'F. PESCADA AMARELA PEDACOS S/E 500GR SKIN PREMIUM', '2x1', false, 0.5, 15, 'FRESCATTO CXA 7,5', 7.5, 'PESCADA AMARELA'),
  ('10096033246581-1075', 'F. TRUTA DEF S/E 150GR SKIN PREMIUM', '2x1', false, 0.15, 24, 'FRESC CXA 3,6 PF', 3.6, 'TRUTA'),
  ('10125002001501-1058', 'F. TILAPIA S/P S/E S/CL SKIN PDV', '3x1', false, null, null, 'FRESC CXA PDV PF', null, 'TILAPIA'),
  ('10125002001521-1058', 'F. TILAPIA S/P S/E S/CL SKIN BDJ PDV', '2x1', false, null, null, 'FRESC CXA PDV PF', null, 'TILAPIA'),
  ('10126092001521-1058', 'F. MECA PEDACOS S/P S/E S/CL SKIN BDJ PDV', '3x1', false, null, null, 'FRESC CXA PDV PF', null, 'MECA'),
  ('10126092001571-1058', 'F. MECA PEDACOS S/P S/E S/CL SKIN PREMIUM PDV', '2x1', false, null, null, 'FRESC CXA PDV PF', null, 'MECA'),
  ('10126108001501-1058', 'F. MECA PEDACOS BARRIGA S/P S/E S/CL SKIN PDV', '3x1', false, null, null, 'FRESC CXA PDV PF', null, 'MECA'),
  ('10166001246521-1058', 'F. ABADEJO S/P SKIN BDJ PDV', '3x1', false, null, null, 'FRESC CXA PDV PF', null, 'ABADEJO'),
  ('10224092001521-1058', 'F. FILHOTE PEDACOS S/P S/E S/CL SKIN BDJ PDV', '2x1', false, null, null, 'FRESC CXA PDV PF', null, 'FILHOTE'),
  ('10238002001521-1058', 'F. SEABASS S/P S/E S/CL SKIN BDJ PDV', '3x1', false, null, null, 'FRESC CXA PDV PF', null, 'SEABASS'),
  ('10238009001521-1058', 'F. SEABASS S/E S/CL SKIN BDJ PDV', '3x1', false, null, null, 'FRESC CXA PDV PF', null, 'SEABASS'),
  ('10256093246551-1058', 'F. SALMON PREM COHO PEDACOS S/E BDJ SKIN PDV', '3x1', false, null, null, 'FRESC CXA PDV PF', null, 'SALMON'),
  ('10256093283531-1061', 'F. SALMON PREM COHO PEDACOS S/E 7 Oz SKIN BDJ', '3x1', false, 0.198, null, 'FRESC CXA 4 PF', 4, 'SALMON'),
  ('10263092001521-1058', 'F. HALIBUT PEDACOS S/P S/E S/CL SKIN BDJ PDV', '3x1', false, null, null, 'FRESC CXA PDV PF', null, 'HALIBUT'),
  ('1026900924652F-1058', 'F. BLACK COD S/E SKIN BDJ PDV', '3x1', true, null, null, 'FRESC CXA PDV PF', null, 'BLACK COD'),
  ('10269009246521-1058', 'F. BLACK COD S/E SKIN BDJ PDV', '3x1', false, null, null, 'FRESC CXA PDV PF', null, 'BLACK COD'),
  ('10269009246521-1059', 'F. BLACK COD S/E SKIN BDJ PDV', '3x1', false, null, null, 'FRESC CXA 8 PF', 8, 'BLACK COD'),
  ('10273009001501-1058', 'F. SALMON SELVAGEM PEDACOS S/E S/CL SKIN PDV', '3x1', false, null, null, 'FRESC CXA PDV PF', null, 'SALMON'),
  ('10276002001501-1059', 'F. PESCADA AMARELA PEDACOS S/P S/E S/CL SKIN PDV', '3x1', false, null, null, 'FRESC CXA 8 PF', 8, 'PESCADA AMARELA'),
  ('1027600200152F-1058', 'F.PESCADA AMARELA PEDACOS S/P S/E S/CL SKIN BDJPDV', '2x1', true, null, null, 'FRESC CXA PDV PF', null, 'PESCADA AMARELA'),
  ('10276002001521-1058', 'F.PESCADA AMARELA PEDACOS S/P S/E S/CL SKIN BDJPDV', '2x1', false, null, null, 'FRESC CXA PDV PF', null, 'PESCADA AMARELA'),
  ('10380002001521-1058', 'F. CHERNE PEDACOS S/P S/E S/CL SKIN BDJ PDV', '2x1', false, null, null, 'FRESC CXA PDV PF', null, 'CHERNE'),
  ('10385009246591-964', 'F. BADEJO PEDACOS S/E 500GR SKIN PREMIUM', '2x1', false, 0.5, 15, 'FRESCATTO CXA 7,5', 7.5, 'BADEJO'),
  ('10385009338471-220', 'F. BADEJO PEDACOS S/E 400GR SKIN PREMIUM', '2x1', false, 0.4, 15, 'FRESCATTO CXA 06', 6, 'BADEJO'),
  ('10388002001521-1058', 'F. NAMORADO PEDACOS S/P S/E S/CL SKIN BDJ PDV', '3x1', false, null, null, 'FRESC CXA PDV PF', null, 'NAMORADO'),
  ('10388002001561-1058', 'F. NAMORADO PEDACOS S/P S/E S/CL SKIN PREMIUM BDJ PDV', '2x1', false, null, null, 'FRESC CXA PDV PF', null, 'NAMORADO'),
  ('10395021001521-1058', 'F. PIRARUCU PEDACOS S/E DEF S/CL SKIN BDJ PDV', '3x1', false, null, null, 'FRESC CXA PDV PF', null, 'PIRARUCU'),
  ('10433002001521-1058', 'F. PESCADA CAMBUCU PEDACOS S/P S/E S/CL SKIN BDJPDV', '3x1', false, null, null, 'FRESC CXA PDV PF', null, 'PESCADA CAMBUCU'),
  ('14701020056241-964', 'TEN POLVO S/CL 500GR SKIN PREMIUM', '2x1', false, 0.5, 15, 'FRESCATTO CXA 7,5', 7.5, 'POLVO'),
  ('14708020001251-1058', 'TEN POLVO ESP S/CL SKIN PDV', '2x1', false, null, null, 'FRESC CXA PDV PF', null, 'POLVO'),
  ('14709020001251-1058', 'TEN POLVO IBERICO S/CL SKIN PDV', '2x1', false, null, null, 'FRESC CXA PDV PF', null, 'POLVO'),
  ('16499053001611-1105', 'AMEIJOA HOKKIGAI S/CL SKIN 200GR', '3x1', false, 0.2, 12, 'FRESC CXA 2,4 PF', 2.4, 'AMEIJOA'),
  ('16502014326631-011', 'CAMARAO CINZA DESC EVISC 25/35 250GR SKIN PREMIUM', '3x1', false, 0.25, 20, 'FRESCATTO CXA 05', 5, 'CAMARAO CINZA'),
  ('16507014034631-011', 'CAMARAO ROSA DESC EVISC 5/10 250GR SKIN PREMIUM', '3x1', false, 0.25, 20, 'FRESCATTO CXA 05', 5, 'CAMARAO ROSA'),
  ('16507014073621-010', 'CAMARAO ROSA DESC EVISC 10/15 200GR SKIN PREMIUM', '3x1', false, 0.2, null, 'ARDAPEZ CXA 18,144', 18.144, 'CAMARAO ROSA'),
  ('16507014073621-011', 'CAMARAO ROSA DESC EVISC 10/15 200GR SKIN PREMIUM', '3x1', false, 0.2, 25, 'FRESCATTO CXA 05', 5, 'CAMARAO ROSA'),
  ('16507014327631-011', 'CAMARAO ROSA DESC EVISC 12/20 250GR SKIN PREMIUM', '3x1', false, 0.25, 20, 'FRESCATTO CXA 05', 5, 'CAMARAO ROSA'),
  ('16516063001581-219', 'CAUDA LAGOSTA CTD S/CL SKIN PREMIUM', '3x1', false, null, null, 'FRESCATTO CXA 03', 3, 'LAGOSTA'),
  ('16516078001601-1058', 'CAUDA LAGOSTA PA EXP S/CL SKIN PDV', '3x1', false, null, null, 'FRESC CXA PDV PF', null, 'LAGOSTA'),
  ('16516582001591-1058', 'CAUDA LAGOSTA PA EXP CTD S/CL SKIN PREMIUM PDV', '2x1', false, null, null, 'FRESC CXA PDV PF', null, 'LAGOSTA'),
  ('16516582001601-1058', 'CAUDA LAGOSTA PA EXP CTD S/CL SKIN PDV', '3x1', false, null, null, 'FRESC CXA PDV PF', null, 'LAGOSTA'),
  ('16519022001621-219', 'VIEIRA LIMPA S/CL 200GR SKIN PREMIUM', '3x1', false, 0.2, 15, 'FRESCATTO CXA 03', 3, 'VIEIRA'),
  ('16519022175581-1058', 'VIEIRA LIMPA SKIN PREMIUM', '3x1', false, null, null, 'FRESC CXA PDV PF', null, 'VIEIRA'),
  ('16519077001601-1058', 'VIEIRA MEIA CONCHA C/OVA S/CL SKIN PDV', '3x1', false, null, null, 'FRESC CXA PDV PF', null, 'VIEIRA'),
  ('16519077001601-1069', 'VIEIRA MEIA CONCHA C/OVA S/CL SKIN PDV', '3x1', false, null, null, 'FRESC ISP CXA PDV PF', null, 'VIEIRA'),
  ('16536022263571-1058', 'VIEIRA CANADENSE LIMPA 5/12 SKIN BDJ PDV', '3x1', false, null, null, 'FRESC CXA PDV PF', null, 'VIEIRA'),
  ('16545014328631-011', 'CAMARAO ARGENTINO DESC EVISC 12/18 250GR SKIN PREMIUM', '3x1', false, 0.25, 20, 'FRESCATTO CXA 05', 5, 'CAMARAO ARGENTINO'),
  ('16548022001601-1058', 'LAGOSTA SAPATEIRA LIMPA S/CL SKIN PDV', '3x1', false, null, null, 'FRESC CXA PDV PF', null, 'LAGOSTA SAPATEIRA'),
  ('16573072175601-1058', 'CARNE BLUE CRAB JUMBO SKIN PDV', '3x1', false, null, null, 'FRESC CXA PDV PF', null, 'BLUE CRAB'),
  ('18001003001201-1033', 'MEXILHAO LIMPO S/CL 300GR SKIN PREMIUM', '3x1', false, 0.3, 18, 'FRESCATTO CXA 5,4', 5.4, 'MEXILHAO'),
  ('21911024002201-031', 'LOMBO BACALHAU G. MORHUA SALGADO S/P S/E S/CL SKIN PDV', '2x1', false, null, null, 'FRESCATTO CXA PDV', null, 'BACALHAU SALGADO'),
  ('23611037018761-1013', 'F. SALMON PEDACOS S/E 200GR BDJ SKIN PACK', '3x1', false, 0.2, 20, 'FRESCATTO ISP CXA 04', 4, 'SALMON'),
  ('23616047001701-031', 'F. SALMON PEDACOS SKIN S/CL BDJ PDV', '3x1', false, null, null, 'FRESCATTO CXA PDV', null, 'SALMON'),
  ('23616047001701-890', 'F. SALMON PEDACOS SKIN S/CL BDJ PDV', '3x1', false, null, null, 'MARINE ISP', null, 'SALMON'),
  ('2361620695049F-1013', 'F. SALMON PEDACOS ALFRESCO S/E SKIN 200GR', '3x1', true, 0.2, 20, 'FRESCATTO ISP CXA 04', 4, 'SALMON FRESCO'),
  ('2361620695049G-1013', 'F. SALMON PEDACOS ALFRESCO S/E SKIN 200GR', '3x1', true, 0.2, 20, 'FRESCATTO ISP CXA 04', 4, 'SALMON FRESCO'),
  ('2361620695049R-1013', 'F. SALMON PEDACOS ALFRESCO S/E SKIN 200GR', '3x1', true, 0.2, 20, 'FRESCATTO ISP CXA 04', 4, 'SALMON FRESCO'),
  ('23616206950491-1013', 'F. SALMON PEDACOS ALFRESCO S/E SKIN 200GR', '3x1', false, 0.2, 20, 'FRESCATTO ISP CXA 04', 4, 'SALMON FRESCO'),
  ('23616206950491-1063', 'F. SALMON PEDACOS ALFRESCO S/E SKIN 200GR', '3x1', false, 0.2, 20, 'FRESC ISP CXA 4 PF', 4, 'SALMON FRESCO'),
  ('24242234001961-1058', 'F. DOURADO PEDACOS S/P S/E S/CL SKIN BDJ PDV', '2x1', false, null, null, 'FRESC CXA PDV PF', null, 'DOURADO'),
  ('24242234001961-1059', 'F. DOURADO PEDACOS S/P S/E S/CL SKIN BDJ PDV', '2x1', false, null, null, 'FRESC CXA 8 PF', 8, 'DOURADO'),
  ('24520550001691-1104', 'CARNE CENTOLHA COZIDA S/CL SKIN 400GR', '3x1', false, 0.4, 5, 'FRESC CXA 2 PF', 2, 'CENTOLHA'),
  ('24611220167811-032', 'F. SALMON PREM PED DEF S/E S/CL SKIN BDJ 200GR', '3x1', false, 0.2, 20, 'FRESCATTO CXA 04', 4, 'SALMON'),
  ('24616047001701-031', 'F. SALMON PEDACOS SKIN S/CL BDJ PDV', '3x1', false, null, null, 'FRESCATTO CXA PDV', null, 'SALMON'),
  ('24616245167481-1123', 'F. SALMON PREM PEDACOS SASHIMI S/P S/E S/CL SKIN 150GR', '3x1', false, 0.15, 24, 'FRESCATTO CXA 3,6 PF', 3.6, 'SALMON'),
  ('24616245167481-978', 'F. SALMON PREM PEDACOS SASHIMI S/P S/E S/CL SKIN 150GR', '3x1', false, 0.15, null, 'FRESCATTO CXA 3,62', 3.62, 'SALMON'),
  ('2461670106378F-975', 'F. SALMON PREM PEDACOS S/E 600GR SKIN PREMIUM', '2x1', true, 0.6, 15, 'FRESCATTO CXA 09', 9, 'SALMON'),
  ('2461670106378G-975', 'F. SALMON PREM PEDACOS S/E 600GR SKIN PREMIUM', '2x1', true, 0.6, 15, 'FRESCATTO CXA 09', 9, 'SALMON'),
  ('2461670106378R-975', 'F. SALMON PREM PEDACOS S/E 600GR SKIN PREMIUM', '2x1', true, 0.6, 15, 'FRESCATTO CXA 09', 9, 'SALMON'),
  ('24616701063781-975', 'F. SALMON PREM PEDACOS S/E 600GR SKIN PREMIUM', '2x1', false, 0.6, 15, 'FRESCATTO CXA 09', 9, 'SALMON'),
  ('24625020001951-1070', 'MEDALHAO SALMON S/CL SKIN BDJ 500GR', '2x1', false, 0.5, 15, 'FRESC CXA 7,5 PF', 7.5, 'SALMON'),
  ('2462505417578F-964', 'MEDALHAO SALMON S/CL 500GR SKIN PREMIUM', '2x1', true, 0.5, 15, 'FRESCATTO CXA 7,5', 7.5, 'SALMON'),
  ('2462505417578G-964', 'MEDALHAO SALMON S/CL 500GR SKIN PREMIUM', '2x1', true, 0.5, 15, 'FRESCATTO CXA 7,5', 7.5, 'SALMON'),
  ('2462505417578R-964', 'MEDALHAO SALMON S/CL 500GR SKIN PREMIUM', '2x1', true, 0.5, 15, 'FRESCATTO CXA 7,5', 7.5, 'SALMON'),
  ('24625054175781-964', 'MEDALHAO SALMON S/CL 500GR SKIN PREMIUM', '2x1', false, 0.5, 15, 'FRESCATTO CXA 7,5', 7.5, 'SALMON'),
  ('24652230001981-1058', 'F. SALMON PEDACOS S/E S/CL SKIN PREMIUM PDV', '2x1', false, null, null, 'FRESC CXA PDV PF', null, 'SALMON'),
  ('24652701001621-1058', 'F. SALMON PREM PEDACOS S/E S/CL SKIN PDV', '3x1', false, null, null, 'FRESC CXA PDV PF', null, 'SALMON'),
  ('2465270100197F-1058', 'F. SALMON PREM PEDACOS S/E S/CL SKIN G PDV', '2x1', true, null, null, 'FRESC CXA PDV PF', null, 'SALMON'),
  ('24652701001971-1058', 'F. SALMON PREM PEDACOS S/E S/CL SKIN G PDV', '2x1', false, null, null, 'FRESC CXA PDV PF', null, 'SALMON'),
  ('24652701001971-1077', 'F. SALMON PREM PEDACOS S/E S/CL SKIN G PDV', '2x1', false, null, null, 'HNT CXA 10', 10, 'SALMON'),
  ('2465270105399F-1077', 'F. SALMON PREM PEDACOS S/E SKIN 500GR', '2x1', true, 0.5, 20, 'HNT CXA 10', 10, 'SALMON'),
  ('24652701053991-1077', 'F. SALMON PREM PEDACOS S/E SKIN 500GR', '2x1', false, 0.5, 20, 'HNT CXA 10', 10, 'SALMON'),
  ('2465270117478F-1061', 'F.SALMON PREM PEDACOS S/E SKIN 200GR', '3x1', true, 0.2, 20, 'FRESC CXA 4 PF', 4, 'SALMON'),
  ('24652701174781-1061', 'F.SALMON PREM PEDACOS S/E SKIN 200GR', '3x1', false, 0.2, 20, 'FRESC CXA 4 PF', 4, 'SALMON'),
  ('24655020001951-1070', 'MEDALHAO ATUM S/CL SKIN BDJ 500GR', '2x1', false, 0.5, 15, 'FRESC CXA 7,5 PF', 7.5, 'ATUM'),
  ('24661054176781-1109', 'MIX FRUTOS DO MAR S/CL 300GR SKIN PREMIUM', '2x1', false, 0.3, 15, 'FRESCATTO CXA 4,5', 4.5, 'PAELLA'),
  ('2466202005394F-1064', 'HAMBURGUER ATUM SKIN BDJ 240GR', '3x1', true, 0.24, 20, 'FRESC CXA 4,8 PF', 4.8, 'ATUM'),
  ('24662020053941-1064', 'HAMBURGUER ATUM SKIN BDJ 240GR', '3x1', false, 0.24, 20, 'FRESC CXA 4,8 PF', 4.8, 'ATUM'),
  ('2466402076180F-597', 'HAMBURGUER SALMON 240GR SKIN', '3x1', true, 0.24, 20, 'FRESCATTO CXA 4,8', 4.8, 'SALMON'),
  ('2466402076180G-597', 'HAMBURGUER SALMON 240GR SKIN', '3x1', true, 0.24, 20, 'FRESCATTO CXA 4,8', 4.8, 'SALMON'),
  ('24664020761801-032', 'HAMBURGUER SALMON 240GR SKIN', '3x1', false, 0.24, null, 'FRESCATTO CXA 04', 4, 'SALMON'),
  ('24664020761801-1064', 'HAMBURGUER SALMON 240GR SKIN', '3x1', false, 0.24, 20, 'FRESC CXA 4,8 PF', 4.8, 'SALMON'),
  ('24664020761801-597', 'HAMBURGUER SALMON 240GR SKIN', '3x1', false, 0.24, 20, 'FRESCATTO CXA 4,8', 4.8, 'SALMON'),
  ('2467602005394F-1064', 'HAMBURGUER DOURADO SKIN BDJ 240GR', '3x1', true, 0.24, 20, 'FRESC CXA 4,8 PF', 4.8, 'DOURADO'),
  ('24676020053941-1064', 'HAMBURGUER DOURADO SKIN BDJ 240GR', '3x1', false, 0.24, 20, 'FRESC CXA 4,8 PF', 4.8, 'DOURADO')
on conflict (codigo) do update set
  derivacao = excluded.derivacao,
  peso_caixa_kg = excluded.peso_caixa_kg,
  especie = excluded.especie,
  molde = coalesce(p.molde, excluded.molde),
  molde_a_confirmar = case when p.derivacao is null then excluded.molde_a_confirmar else p.molde_a_confirmar end,
  embalagens_por_caixa = coalesce(p.embalagens_por_caixa, excluded.embalagens_por_caixa);

-- Conferência: deve mostrar 118 (ou mais, se já houver produtos incluídos à mão) e true nas outras três colunas.
select
  (select count(*) from public.produtos) as produtos,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'produtos' and column_name = 'molde_a_confirmar') = 1 as versao_nova,
  to_regclass('public.ops_historico') is not null as historico,
  (select pg_get_constraintdef(c.oid) like '%gestor%' from pg_constraint c where c.conname = 'perfis_papel_check') as perfil_gestor;
