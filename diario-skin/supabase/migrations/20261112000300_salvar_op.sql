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
