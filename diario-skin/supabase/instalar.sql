-- Diário da Linha Skin — instalação completa do banco num arquivo só.
-- Gerado por ferramentas/gerar-sql.mjs: junta supabase/migrations/*.sql e supabase/seed.sql.
-- Uso: Supabase → SQL Editor → colar tudo → Run. Rodar UMA vez, num projeto novo.

-- ==================== 20261112000100_esquema.sql ====================

-- Diário da Linha Skin — tabelas (seção 5 da especificação).
--
-- Diferenças em relação ao modelo da especificação, todas aditivas:
--   * ops.status aceita também 'cancelada' (o administrador cancela; ninguém apaga).
--   * ops.data pode ficar vazia só no histórico da planilha (duas linhas vieram sem data).
--   * ops.sincronizado_em: hora em que o servidor recebeu a última gravação
--     (os aparelhos usam para baixar só o que mudou).
--   * receitas_padrao.ciclo_teorico_s: ciclo teórico da estação, configurável.
--   * perfis.ativo começa falso: quem cria conta só entra depois que o
--     administrador libera.

-- Perfis de usuário
create table public.perfis (
  id uuid primary key references auth.users on delete cascade,
  nome text not null,
  papel text not null default 'operador' check (papel in ('operador','pd','admin')),
  ativo boolean not null default false
);

-- Catálogo de produtos skin
create table public.produtos (
  codigo text primary key,                 -- SKU (PROD_DER), ex.: 24616701063781-975
  descricao text not null,
  molde text check (molde in ('2x1','3x1')),               -- nulo = molde a confirmar (o operador escolhe na OP)
  peso_nominal_kg numeric check (peso_nominal_kg > 0),     -- nulo = peso variável (PDV)
  embalagens_por_caixa integer check (embalagens_por_caixa > 0),
  derivacao text,                          -- DESCR_DER, ex.: FRESCATTO CXA 7,5
  peso_caixa_kg numeric check (peso_caixa_kg > 0),         -- nulo = caixa de peso variável (PDV)
  especie text,                            -- DESCR_AGP, ex.: SALMON
  ativo boolean not null default true
);

-- Peso de filme por bandeja, por molde
create table public.moldes (
  molde text primary key,                  -- '2x1' | '3x1'
  cavidades integer not null check (cavidades > 0),
  filme_fundo_kg_bdj numeric not null check (filme_fundo_kg_bdj >= 0),
  filme_tampa_kg_bdj numeric not null check (filme_tampa_kg_bdj >= 0)
);

-- Receita padrão da máquina. Cada alteração entra como linha nova: vale a de
-- vigência mais recente e as anteriores ficam como histórico.
create table public.receitas_padrao (
  id bigint generated always as identity primary key,
  vigente_desde timestamptz not null default now(),
  t_dome numeric, t_pre numeric, t1 numeric, t2 numeric, t4 numeric, t5 numeric,
  t6 numeric, t7 numeric, p_vent numeric, sp numeric, tx numeric, tmax numeric,
  ciclo_teorico_s numeric not null default 10.3 check (ciclo_teorico_s > 0)
);

-- Ordem de produção
create table public.ops (
  id uuid primary key default gen_random_uuid(),
  origem text not null default 'diario' check (origem in ('diario','planilha')),
  status text not null default 'aberta' check (status in ('aberta','fechada','cancelada')),
  data date,
  produto_codigo text references public.produtos(codigo),
  produto_descricao text not null,         -- cópia do nome no momento do lançamento
  op text,
  molde text not null references public.moldes(molde),
  peso_nominal_kg numeric,
  embalagens_por_caixa integer,
  lote_mp text,
  temp_produto_c numeric,
  filme_fundo text, filme_tampa text, lote_filme text,
  hora_inicio time, hora_fim time,
  passo_inicio integer, passo_fim integer,
  caixas integer, embalagens_avulsas integer default 0,
  peso_final_kg numeric,
  aparencia text check (aparencia in ('boa','regular','ruim')),
  observacoes text,
  -- parâmetros da máquina nesta OP (telas 417, 414 e 412)
  t_dome numeric, t_pre numeric, t1 numeric, t2 numeric, t4 numeric, t5 numeric,
  t6 numeric, t7 numeric, p_vent numeric, sp numeric, tx numeric, tmax numeric,
  parametros_origem text check (parametros_origem in ('digitado','lido_da_foto','padrao')),
  criado_por uuid references public.perfis(id), criado_em timestamptz default now(),
  alterado_por uuid references public.perfis(id), alterado_em timestamptz default now(),
  fechada_em timestamptz,
  analise_ia jsonb,                        -- última avaliação da foto do produto pela IA (função analisar-op)
  sincronizado_em timestamptz not null default now(),
  constraint ops_data_obrigatoria check (data is not null or origem = 'planilha')
);

create index ops_sincronizado_em_idx on public.ops (sincronizado_em);
create index ops_data_idx on public.ops (data);
create index ops_produto_idx on public.ops (produto_codigo);

-- Retrabalho por motivo (uma linha por motivo com contagem)
create table public.op_retrabalho (
  op_id uuid references public.ops(id) on delete cascade,
  motivo text not null check (motivo in
    ('sem_vacuo','furo','ruga','selagem','peso','posicao','outro')),
  quantidade integer not null default 0 check (quantidade >= 0),
  primary key (op_id, motivo)
);

-- Paradas
create table public.op_paradas (
  id uuid primary key default gen_random_uuid(),
  op_id uuid not null references public.ops(id) on delete cascade,
  motivo text not null,
  minutos integer not null check (minutos > 0)
);
create index op_paradas_op_idx on public.op_paradas (op_id);

-- Fotos
create table public.op_fotos (
  id uuid primary key default gen_random_uuid(),
  op_id uuid not null references public.ops(id) on delete cascade,
  tipo text not null check (tipo in ('tela','produto')),
  caminho text not null,                   -- caminho no bucket fotos-op
  tela_numero integer,                     -- 412, 414 ou 417 quando identificado
  criado_em timestamptz default now()
);
create index op_fotos_op_idx on public.op_fotos (op_id);

-- ==================== 20261112000200_acesso.sql ====================

-- Diário da Linha Skin — quem pode o quê (políticas de acesso por linha).
--
--   * Usuário autenticado e ativo lê tudo.
--   * operador cria OPs e altera OPs com status 'aberta' (pode encerrar).
--   * pd e admin alteram qualquer OP, inclusive fechadas e de origem 'planilha'.
--   * Só admin altera produtos, moldes, receitas_padrao e perfis.
--   * Ninguém apaga OP; só o admin marca como 'cancelada' (e mexe em cancelada).

-- ---------------------------------------------------------------- funções de apoio

-- Papel do usuário da sessão; nulo se não tem perfil ou está inativo.
create or replace function public.papel_atual()
returns text language sql stable security definer set search_path = '' as $$
  select p.papel from public.perfis p where p.id = auth.uid() and p.ativo
$$;

create or replace function public.usuario_ativo()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.papel_atual() is not null
$$;

-- A OP pode receber retrabalho, paradas e fotos do usuário da sessão?
create or replace function public.pode_editar_op(p_op uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select case public.papel_atual()
    when 'admin' then true
    when 'pd' then exists (select 1 from public.ops o where o.id = p_op and o.status <> 'cancelada')
    when 'operador' then exists (select 1 from public.ops o where o.id = p_op and o.status = 'aberta')
    else false
  end
$$;

revoke execute on function public.papel_atual(), public.usuario_ativo(), public.pode_editar_op(uuid) from public, anon;
grant execute on function public.papel_atual(), public.usuario_ativo(), public.pode_editar_op(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------- gatilhos

-- Cria o perfil quando alguém cria conta. Entra como operador inativo.
create or replace function public.novo_usuario()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.perfis (id, nome)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'nome'), ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'Sem nome'
    )
  )
  on conflict (id) do nothing;
  return new;
end
$$;

create trigger ao_criar_usuario
  after insert on auth.users
  for each row execute function public.novo_usuario();

-- Não deixa o sistema ficar sem administrador ativo.
create or replace function public.perfis_guarda()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.papel = 'admin' and old.ativo and not (new.papel = 'admin' and new.ativo) then
    if not exists (select 1 from public.perfis p where p.papel = 'admin' and p.ativo and p.id <> old.id) then
      raise exception 'Precisa existir pelo menos um administrador ativo.' using errcode = '23514';
    end if;
  end if;
  return new;
end
$$;

create trigger perfis_guarda
  before update on public.perfis
  for each row execute function public.perfis_guarda();

-- Carimbos da OP: quem criou, quem alterou por último e quando chegou ao servidor.
create or replace function public.ops_carimbo()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.criado_por := coalesce(auth.uid(), new.criado_por);
    new.criado_em := least(coalesce(new.criado_em, now()), now());
  else
    new.criado_por := old.criado_por;
    new.criado_em := old.criado_em;
    new.origem := old.origem;
  end if;
  new.alterado_por := coalesce(auth.uid(), new.alterado_por);
  -- alterado_em é a hora da edição no aparelho; nunca no futuro.
  new.alterado_em := least(coalesce(new.alterado_em, now()), now());
  new.sincronizado_em := clock_timestamp();
  if new.status = 'fechada' and new.fechada_em is null and new.origem = 'diario' then
    new.fechada_em := now();
  end if;
  return new;
end
$$;

create trigger ops_carimbo
  before insert or update on public.ops
  for each row execute function public.ops_carimbo();

-- ---------------------------------------------------------------- políticas

alter table public.perfis enable row level security;
alter table public.produtos enable row level security;
alter table public.moldes enable row level security;
alter table public.receitas_padrao enable row level security;
alter table public.ops enable row level security;
alter table public.op_retrabalho enable row level security;
alter table public.op_paradas enable row level security;
alter table public.op_fotos enable row level security;

-- perfis: cada um vê o próprio; ativos veem todos (para mostrar quem registrou).
create policy perfis_ler on public.perfis for select to authenticated
  using (id = (select auth.uid()) or (select public.usuario_ativo()));
create policy perfis_alterar on public.perfis for update to authenticated
  using ((select public.papel_atual()) = 'admin')
  with check ((select public.papel_atual()) = 'admin');

-- cadastros: todos os ativos leem; só o admin altera.
create policy produtos_ler on public.produtos for select to authenticated
  using ((select public.usuario_ativo()));
create policy produtos_incluir on public.produtos for insert to authenticated
  with check ((select public.papel_atual()) = 'admin');
create policy produtos_alterar on public.produtos for update to authenticated
  using ((select public.papel_atual()) = 'admin')
  with check ((select public.papel_atual()) = 'admin');

create policy moldes_ler on public.moldes for select to authenticated
  using ((select public.usuario_ativo()));
create policy moldes_alterar on public.moldes for update to authenticated
  using ((select public.papel_atual()) = 'admin')
  with check ((select public.papel_atual()) = 'admin');

create policy receitas_ler on public.receitas_padrao for select to authenticated
  using ((select public.usuario_ativo()));
create policy receitas_incluir on public.receitas_padrao for insert to authenticated
  with check ((select public.papel_atual()) = 'admin');

-- ops
create policy ops_ler on public.ops for select to authenticated
  using ((select public.usuario_ativo()));

create policy ops_incluir on public.ops for insert to authenticated
  with check (
    case (select public.papel_atual())
      when 'admin' then true
      when 'pd' then status <> 'cancelada'
      when 'operador' then status in ('aberta','fechada') and origem = 'diario'
      else false
    end
  );

create policy ops_alterar on public.ops for update to authenticated
  using (
    case (select public.papel_atual())
      when 'admin' then true
      when 'pd' then status <> 'cancelada'
      when 'operador' then status = 'aberta'
      else false
    end
  )
  with check (
    case (select public.papel_atual())
      when 'admin' then true
      when 'pd' then status <> 'cancelada'
      when 'operador' then status in ('aberta','fechada')
      else false
    end
  );
-- Sem política de delete: ninguém apaga OP pelo aplicativo.

-- retrabalho, paradas e fotos acompanham a permissão da OP.
create policy op_retrabalho_ler on public.op_retrabalho for select to authenticated
  using ((select public.usuario_ativo()));
create policy op_retrabalho_incluir on public.op_retrabalho for insert to authenticated
  with check (public.pode_editar_op(op_id));
create policy op_retrabalho_alterar on public.op_retrabalho for update to authenticated
  using (public.pode_editar_op(op_id)) with check (public.pode_editar_op(op_id));
create policy op_retrabalho_apagar on public.op_retrabalho for delete to authenticated
  using (public.pode_editar_op(op_id));

create policy op_paradas_ler on public.op_paradas for select to authenticated
  using ((select public.usuario_ativo()));
create policy op_paradas_incluir on public.op_paradas for insert to authenticated
  with check (public.pode_editar_op(op_id));
create policy op_paradas_alterar on public.op_paradas for update to authenticated
  using (public.pode_editar_op(op_id)) with check (public.pode_editar_op(op_id));
create policy op_paradas_apagar on public.op_paradas for delete to authenticated
  using (public.pode_editar_op(op_id));

create policy op_fotos_ler on public.op_fotos for select to authenticated
  using ((select public.usuario_ativo()));
create policy op_fotos_incluir on public.op_fotos for insert to authenticated
  with check (public.pode_editar_op(op_id));
create policy op_fotos_alterar on public.op_fotos for update to authenticated
  using (public.pode_editar_op(op_id)) with check (public.pode_editar_op(op_id));
create policy op_fotos_apagar on public.op_fotos for delete to authenticated
  using (public.pode_editar_op(op_id));

-- ---------------------------------------------------------------- permissões de tabela
-- Explícitas, para não depender do padrão do projeto: tira o que vier liberado e
-- concede só o necessário. Quem não está logado (anon) não recebe nada.

revoke all on public.perfis, public.produtos, public.moldes, public.receitas_padrao,
  public.ops, public.op_retrabalho, public.op_paradas, public.op_fotos from anon, authenticated;

grant select on public.perfis, public.produtos, public.moldes, public.receitas_padrao,
  public.ops, public.op_retrabalho, public.op_paradas, public.op_fotos to authenticated;
grant update (nome, papel, ativo) on public.perfis to authenticated;
grant insert, update on public.produtos to authenticated;
grant update on public.moldes to authenticated;
grant insert on public.receitas_padrao to authenticated;
grant insert, update on public.ops to authenticated;
grant insert, update, delete on public.op_retrabalho, public.op_paradas, public.op_fotos to authenticated;

-- ==================== 20261112000300_salvar_op.sql ====================

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

-- ==================== 20261112000400_indicadores.sql ====================

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

-- ==================== 20261112000500_fotos.sql ====================

-- Diário da Linha Skin — armazenamento das fotos (bucket privado fotos-op).
--
-- Caminho de cada arquivo: <id da OP>/<id da foto>.jpg
-- O aplicativo exibe as fotos com endereços assinados de curta duração.
-- Quem está ativo envia e vê; só P&D e administrador apagam arquivos.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fotos-op', 'fotos-op', false, 5242880, array['image/jpeg'])
on conflict (id) do nothing;

create policy fotos_op_ver on storage.objects for select to authenticated
  using (bucket_id = 'fotos-op' and (select public.usuario_ativo()));

create policy fotos_op_enviar on storage.objects for insert to authenticated
  with check (bucket_id = 'fotos-op' and (select public.usuario_ativo()));

create policy fotos_op_apagar on storage.objects for delete to authenticated
  using (bucket_id = 'fotos-op' and (select public.papel_atual()) in ('pd','admin'));

-- ==================== seed.sql ====================

-- Diário da Linha Skin — carga inicial (seção 6 da especificação).
-- Gerado por ferramentas/gerar-sql.mjs a partir de dados/catalogo.csv e dados/historico.csv.
-- Pode ser rodado mais de uma vez: não duplica nem sobrescreve o que já foi alterado.

-- 6.1 Moldes e filme (kg de filme por bandeja)
--   Passo da máquina: 0,42 m × 0,27 m = 0,1134 m² de filme.
--   Fundo: Evert Skin 400 µ, 0,4952 kg/m².
--   Tampa 3x1: Solupack Skin 100 µ, 0,0826 kg/m². Tampa 2x1: Solupack Skin, 0,1239 kg/m².
insert into public.moldes (molde, cavidades, filme_fundo_kg_bdj, filme_tampa_kg_bdj) values
  ('2x1', 2, 0.0280780, 0.0070249),
  ('3x1', 3, 0.0187187, 0.0031222)
on conflict (molde) do nothing;

-- 6.2 Receita padrão da máquina (ciclo teórico da estação: 10,3 s)
insert into public.receitas_padrao
  (vigente_desde, t_dome, t_pre, t1, t2, t4, t5, t6, t7, p_vent, sp, tx, tmax, ciclo_teorico_s)
select '2026-01-01 00:00:00-03', 225, 110, 0.8, 1.0, 0.0, 0.0, 4.0, 0.2, 500, 40, 0.5, 10.0, 10.3
where not exists (select 1 from public.receitas_padrao);

-- 6.4 Catálogo de produtos skin (118 SKUs, da planilha de produtos do P&D)
--   derivacao = DESCR_DER; peso_caixa_kg = caixa escrita na derivação (vazio = PDV);
--   embalagens_por_caixa = peso da caixa ÷ peso nominal, quando a conta fecha;
--   molde vazio = a confirmar (o operador escolhe na OP).
insert into public.produtos
  (codigo, descricao, molde, peso_nominal_kg, embalagens_por_caixa, derivacao, peso_caixa_kg, especie)
values
  ('05398002051261-1013', 'LOMBO SALMON SASHIMI S/P S/E 250GR BDJ SKIN PACK', '3x1', 0.25, 16, 'FRESCATTO ISP CXA 04', 4, 'SALMON FRESCO'),
  ('0604200200134F-1058', 'LOMBO DOURADO S/P S/E S/CL SKIN BDJ PDV', '3x1', null, null, 'FRESC CXA PDV PF', null, 'DOURADO'),
  ('06042002001341-1058', 'LOMBO DOURADO S/P S/E S/CL SKIN BDJ PDV', '3x1', null, null, 'FRESC CXA PDV PF', null, 'DOURADO'),
  ('06126030001341-1058', 'LOMBO MECA PEDACOS S/P S/E S/CL SKIN BDJ PDV', '3x1', null, null, 'FRESC CXA PDV PF', null, 'MECA'),
  ('06126030001351-1058', 'LOMBO MECA PEDACOS S/P S/E S/CL SKIN PREMIUM PDV', '2x1', null, null, 'FRESC CXA PDV PF', null, 'MECA'),
  ('06161010001341-1058', 'LOMBO PREGO S/P S/E DEF S/CL SKIN BDJ PDV', '3x1', null, null, 'FRESC CXA PDV PF', null, 'PREGO'),
  ('0622203000134F-1058', 'LOMBO PIRARUCU PEDACOS S/P S/E S/CL SKIN BDJ', null, null, null, 'FRESC CXA PDV PF', null, 'NAMORADO'),
  ('06222030001341-1058', 'LOMBO PIRARUCU PEDACOS S/P S/E S/CL SKIN BDJ PDV', '2x1', null, null, 'FRESC CXA PDV PF', null, 'PIRARUCU'),
  ('06224030001341-1058', 'LOMBO FILHOTE PEDACOS S/P S/E S/CL SKIN BDJ PDV', '3x1', null, null, 'FRESC CXA PDV PF', null, 'FILHOTE'),
  ('06224030001371-1058', 'LOMBO FILHOTE PEDACOS S/P S/E S/CL SKIN G BDJ PDV', '2x1', null, null, 'FRESC CXA PDV PF', null, 'FILHOTE'),
  ('0634402500133F-1058', 'LOMBO BACALHAU G.MORHUA DESSALG S/CL GOLD SKIN BDJ PDV', null, null, null, 'FRESC CXA PDV PF', null, 'BACALHAU'),
  ('06344025001331-1058', 'LOMBO BACALHAU G.MORHUA DESS S/CL GOLD SKIN BDJPDV', '3x1', null, null, 'FRESC CXA PDV PF', null, 'BACALHAU'),
  ('0908409931213E-086', 'F. SALMON PEDACOS SKIN 8-10', null, null, null, 'TAB', null, 'SALMON FRESCO'),
  ('0908409931413E-086', 'F. SALMON PEDACOS SKIN 10-12', null, null, null, 'TAB', null, 'SALMON FRESCO'),
  ('0908409931513E-086', 'F. SALMON PEDACOS SKIN 12-14', null, null, null, 'TAB', null, 'SALMON FRESCO'),
  ('0938907200103M-815', 'F SALMON PEDACOS SKIN S/CL BDJ PDV', null, null, null, 'MPR ISP', null, 'SALMON FRESCO'),
  ('10035092300521-1058', 'F. CONGRO ROSA PEDACOS S/P S/E 5 OZ SKIN BDJ PDV', '3x1', 0.142, null, 'FRESC CXA PDV PF', null, 'CONGRO'),
  ('10042092001521-1058', 'F. DOURADO PEDACOS S/P S/E S/CL SKIN BDJ PDV', '2x1', null, null, 'FRESC CXA PDV PF', null, 'DOURADO'),
  ('10045092001521-1058', 'F. GAROUPA PEDACOS S/P S/E S/CL SKIN BDJ PDV', '2x1', null, null, 'FRESC CXA PDV PF', null, 'GAROUPA'),
  ('10049002001521-1058', 'F. LINGUADO S/P S/E S/CL SKIN BDJ PDV', '2x1', null, null, 'FRESC CXA PDV PF', null, 'LINGUADO'),
  ('1006809324659F-964', 'F. PESCADA AMARELA PEDACOS S/E 500GR SKIN PREMIUM', '2x1', 0.5, 15, 'FRESCATTO CXA 7,5', 7.5, 'PESCADA AMARELA'),
  ('1006809324659R-964', 'F. PESCADA AMARELA PEDACOS S/E 500GR SKIN PREMIUM', '2x1', 0.5, 15, 'FRESCATTO CXA 7,5', 7.5, 'PESCADA AMARELA'),
  ('10068093246591-220', 'F. PESCADA AMARELA PEDACOS S/E 500GR SKIN PREMIUM', '2x1', 0.5, 12, 'FRESCATTO CXA 06', 6, 'PESCADA AMARELA'),
  ('10068093246591-964', 'F. PESCADA AMARELA PEDACOS S/E 500GR SKIN PREMIUM', '2x1', 0.5, 15, 'FRESCATTO CXA 7,5', 7.5, 'PESCADA AMARELA'),
  ('10096033246581-1075', 'F. TRUTA DEF S/E 150GR SKIN PREMIUM', '2x1', 0.15, 24, 'FRESC CXA 3,6 PF', 3.6, 'TRUTA'),
  ('10125002001501-1058', 'F. TILAPIA S/P S/E S/CL SKIN PDV', '3x1', null, null, 'FRESC CXA PDV PF', null, 'TILAPIA'),
  ('10125002001521-1058', 'F. TILAPIA S/P S/E S/CL SKIN BDJ PDV', '2x1', null, null, 'FRESC CXA PDV PF', null, 'TILAPIA'),
  ('10126092001521-1058', 'F. MECA PEDACOS S/P S/E S/CL SKIN BDJ PDV', '3x1', null, null, 'FRESC CXA PDV PF', null, 'MECA'),
  ('10126092001571-1058', 'F. MECA PEDACOS S/P S/E S/CL SKIN PREMIUM PDV', '2x1', null, null, 'FRESC CXA PDV PF', null, 'MECA'),
  ('10126108001501-1058', 'F. MECA PEDACOS BARRIGA S/P S/E S/CL SKIN PDV', '3x1', null, null, 'FRESC CXA PDV PF', null, 'MECA'),
  ('10166001246521-1058', 'F. ABADEJO S/P SKIN BDJ PDV', '3x1', null, null, 'FRESC CXA PDV PF', null, 'ABADEJO'),
  ('10224092001521-1058', 'F. FILHOTE PEDACOS S/P S/E S/CL SKIN BDJ PDV', '2x1', null, null, 'FRESC CXA PDV PF', null, 'FILHOTE'),
  ('10238002001521-1058', 'F. SEABASS S/P S/E S/CL SKIN BDJ PDV', '3x1', null, null, 'FRESC CXA PDV PF', null, 'SEABASS'),
  ('10238009001521-1058', 'F. SEABASS S/E S/CL SKIN BDJ PDV', '3x1', null, null, 'FRESC CXA PDV PF', null, 'SEABASS'),
  ('10256093246551-1058', 'F. SALMON PREM COHO PEDACOS S/E BDJ SKIN PDV', '3x1', null, null, 'FRESC CXA PDV PF', null, 'SALMON'),
  ('10256093283531-1061', 'F. SALMON PREM COHO PEDACOS S/E 7 Oz SKIN BDJ', '3x1', 0.198, null, 'FRESC CXA 4 PF', 4, 'SALMON'),
  ('10263092001521-1058', 'F. HALIBUT PEDACOS S/P S/E S/CL SKIN BDJ PDV', '3x1', null, null, 'FRESC CXA PDV PF', null, 'HALIBUT'),
  ('1026900924652F-1058', 'F. BLACK COD S/E SKIN BDJ PDV', '3x1', null, null, 'FRESC CXA PDV PF', null, 'BLACK COD'),
  ('10269009246521-1058', 'F. BLACK COD S/E SKIN BDJ PDV', '3x1', null, null, 'FRESC CXA PDV PF', null, 'BLACK COD'),
  ('10269009246521-1059', 'F. BLACK COD S/E SKIN BDJ PDV', '3x1', null, null, 'FRESC CXA 8 PF', 8, 'BLACK COD'),
  ('10273009001501-1058', 'F. SALMON SELVAGEM PEDACOS S/E S/CL SKIN PDV', '3x1', null, null, 'FRESC CXA PDV PF', null, 'SALMON'),
  ('10276002001501-1059', 'F. PESCADA AMARELA PEDACOS S/P S/E S/CL SKIN PDV', '3x1', null, null, 'FRESC CXA 8 PF', 8, 'PESCADA AMARELA'),
  ('1027600200152F-1058', 'F.PESCADA AMARELA PEDACOS S/P S/E S/CL SKIN BDJPDV', '2x1', null, null, 'FRESC CXA PDV PF', null, 'PESCADA AMARELA'),
  ('10276002001521-1058', 'F.PESCADA AMARELA PEDACOS S/P S/E S/CL SKIN BDJPDV', '2x1', null, null, 'FRESC CXA PDV PF', null, 'PESCADA AMARELA'),
  ('10380002001521-1058', 'F. CHERNE PEDACOS S/P S/E S/CL SKIN BDJ PDV', '2x1', null, null, 'FRESC CXA PDV PF', null, 'CHERNE'),
  ('10385009246591-964', 'F. BADEJO PEDACOS S/E 500GR SKIN PREMIUM', '2x1', 0.5, 15, 'FRESCATTO CXA 7,5', 7.5, 'BADEJO'),
  ('10385009338471-220', 'F. BADEJO PEDACOS S/E 400GR SKIN PREMIUM', '2x1', 0.4, 15, 'FRESCATTO CXA 06', 6, 'BADEJO'),
  ('10388002001521-1058', 'F. NAMORADO PEDACOS S/P S/E S/CL SKIN BDJ PDV', '3x1', null, null, 'FRESC CXA PDV PF', null, 'NAMORADO'),
  ('10388002001561-1058', 'F. NAMORADO PEDACOS S/P S/E S/CL SKIN PREMIUM BDJ PDV', '2x1', null, null, 'FRESC CXA PDV PF', null, 'NAMORADO'),
  ('10395021001521-1058', 'F. PIRARUCU PEDACOS S/E DEF S/CL SKIN BDJ PDV', '3x1', null, null, 'FRESC CXA PDV PF', null, 'PIRARUCU'),
  ('10433002001521-1058', 'F. PESCADA CAMBUCU PEDACOS S/P S/E S/CL SKIN BDJPDV', '3x1', null, null, 'FRESC CXA PDV PF', null, 'PESCADA CAMBUCU'),
  ('14701020056241-964', 'TEN POLVO S/CL 500GR SKIN PREMIUM', '2x1', 0.5, 15, 'FRESCATTO CXA 7,5', 7.5, 'POLVO'),
  ('14708020001251-1058', 'TEN POLVO ESP S/CL SKIN PDV', '2x1', null, null, 'FRESC CXA PDV PF', null, 'POLVO'),
  ('14709020001251-1058', 'TEN POLVO IBERICO S/CL SKIN PDV', '2x1', null, null, 'FRESC CXA PDV PF', null, 'POLVO'),
  ('16499053001611-1105', 'AMEIJOA HOKKIGAI S/CL SKIN 200GR', '3x1', 0.2, 12, 'FRESC CXA 2,4 PF', 2.4, 'AMEIJOA'),
  ('16502014326631-011', 'CAMARAO CINZA DESC EVISC 25/35 250GR SKIN PREMIUM', '3x1', 0.25, 20, 'FRESCATTO CXA 05', 5, 'CAMARAO CINZA'),
  ('16507014034631-011', 'CAMARAO ROSA DESC EVISC 5/10 250GR SKIN PREMIUM', '3x1', 0.25, 20, 'FRESCATTO CXA 05', 5, 'CAMARAO ROSA'),
  ('16507014073621-010', 'CAMARAO ROSA DESC EVISC 10/15 200GR SKIN PREMIUM', '3x1', 0.2, null, 'ARDAPEZ CXA 18,144', 18.144, 'CAMARAO ROSA'),
  ('16507014073621-011', 'CAMARAO ROSA DESC EVISC 10/15 200GR SKIN PREMIUM', '3x1', 0.2, 25, 'FRESCATTO CXA 05', 5, 'CAMARAO ROSA'),
  ('16507014327631-011', 'CAMARAO ROSA DESC EVISC 12/20 250GR SKIN PREMIUM', '3x1', 0.25, 20, 'FRESCATTO CXA 05', 5, 'CAMARAO ROSA'),
  ('16516063001581-219', 'CAUDA LAGOSTA CTD S/CL SKIN PREMIUM', '3x1', null, null, 'FRESCATTO CXA 03', 3, 'LAGOSTA'),
  ('16516078001601-1058', 'CAUDA LAGOSTA PA EXP S/CL SKIN PDV', '3x1', null, null, 'FRESC CXA PDV PF', null, 'LAGOSTA'),
  ('16516582001591-1058', 'CAUDA LAGOSTA PA EXP CTD S/CL SKIN PREMIUM PDV', '2x1', null, null, 'FRESC CXA PDV PF', null, 'LAGOSTA'),
  ('16516582001601-1058', 'CAUDA LAGOSTA PA EXP CTD S/CL SKIN PDV', '3x1', null, null, 'FRESC CXA PDV PF', null, 'LAGOSTA'),
  ('16519022001621-219', 'VIEIRA LIMPA S/CL 200GR SKIN PREMIUM', '3x1', 0.2, 15, 'FRESCATTO CXA 03', 3, 'VIEIRA'),
  ('16519022175581-1058', 'VIEIRA LIMPA SKIN PREMIUM', '3x1', null, null, 'FRESC CXA PDV PF', null, 'VIEIRA'),
  ('16519077001601-1058', 'VIEIRA MEIA CONCHA C/OVA S/CL SKIN PDV', '3x1', null, null, 'FRESC CXA PDV PF', null, 'VIEIRA'),
  ('16519077001601-1069', 'VIEIRA MEIA CONCHA C/OVA S/CL SKIN PDV', '3x1', null, null, 'FRESC ISP CXA PDV PF', null, 'VIEIRA'),
  ('16536022263571-1058', 'VIEIRA CANADENSE LIMPA 5/12 SKIN BDJ PDV', '3x1', null, null, 'FRESC CXA PDV PF', null, 'VIEIRA'),
  ('16545014328631-011', 'CAMARAO ARGENTINO DESC EVISC 12/18 250GR SKIN PREMIUM', '3x1', 0.25, 20, 'FRESCATTO CXA 05', 5, 'CAMARAO ARGENTINO'),
  ('16548022001601-1058', 'LAGOSTA SAPATEIRA LIMPA S/CL SKIN PDV', '3x1', null, null, 'FRESC CXA PDV PF', null, 'LAGOSTA SAPATEIRA'),
  ('16573072175601-1058', 'CARNE BLUE CRAB JUMBO SKIN PDV', '3x1', null, null, 'FRESC CXA PDV PF', null, 'BLUE CRAB'),
  ('18001003001201-1033', 'MEXILHAO LIMPO S/CL 300GR SKIN PREMIUM', '3x1', 0.3, 18, 'FRESCATTO CXA 5,4', 5.4, 'MEXILHAO'),
  ('21911024002201-031', 'LOMBO BACALHAU G. MORHUA SALGADO S/P S/E S/CL SKIN PDV', '2x1', null, null, 'FRESCATTO CXA PDV', null, 'BACALHAU SALGADO'),
  ('23611037018761-1013', 'F. SALMON PEDACOS S/E 200GR BDJ SKIN PACK', '3x1', 0.2, 20, 'FRESCATTO ISP CXA 04', 4, 'SALMON'),
  ('23616047001701-031', 'F. SALMON PEDACOS SKIN S/CL BDJ PDV', '3x1', null, null, 'FRESCATTO CXA PDV', null, 'SALMON'),
  ('23616047001701-890', 'F. SALMON PEDACOS SKIN S/CL BDJ PDV', '3x1', null, null, 'MARINE ISP', null, 'SALMON'),
  ('2361620695049F-1013', 'F. SALMON PEDACOS ALFRESCO S/E SKIN 200GR', '3x1', 0.2, 20, 'FRESCATTO ISP CXA 04', 4, 'SALMON FRESCO'),
  ('2361620695049G-1013', 'F. SALMON PEDACOS ALFRESCO S/E SKIN 200GR', '3x1', 0.2, 20, 'FRESCATTO ISP CXA 04', 4, 'SALMON FRESCO'),
  ('2361620695049R-1013', 'F. SALMON PEDACOS ALFRESCO S/E SKIN 200GR', '3x1', 0.2, 20, 'FRESCATTO ISP CXA 04', 4, 'SALMON FRESCO'),
  ('23616206950491-1013', 'F. SALMON PEDACOS ALFRESCO S/E SKIN 200GR', '3x1', 0.2, 20, 'FRESCATTO ISP CXA 04', 4, 'SALMON FRESCO'),
  ('23616206950491-1063', 'F. SALMON PEDACOS ALFRESCO S/E SKIN 200GR', '3x1', 0.2, 20, 'FRESC ISP CXA 4 PF', 4, 'SALMON FRESCO'),
  ('24242234001961-1058', 'F. DOURADO PEDACOS S/P S/E S/CL SKIN BDJ PDV', '2x1', null, null, 'FRESC CXA PDV PF', null, 'DOURADO'),
  ('24242234001961-1059', 'F. DOURADO PEDACOS S/P S/E S/CL SKIN BDJ PDV', '2x1', null, null, 'FRESC CXA 8 PF', 8, 'DOURADO'),
  ('24520550001691-1104', 'CARNE CENTOLHA COZIDA S/CL SKIN 400GR', '3x1', 0.4, 5, 'FRESC CXA 2 PF', 2, 'CENTOLHA'),
  ('24611220167811-032', 'F. SALMON PREM PED DEF S/E S/CL SKIN BDJ 200GR', '3x1', 0.2, 20, 'FRESCATTO CXA 04', 4, 'SALMON'),
  ('24616047001701-031', 'F. SALMON PEDACOS SKIN S/CL BDJ PDV', '3x1', null, null, 'FRESCATTO CXA PDV', null, 'SALMON'),
  ('24616245167481-1123', 'F. SALMON PREM PEDACOS SASHIMI S/P S/E S/CL SKIN 150GR', '3x1', 0.15, 24, 'FRESCATTO CXA 3,6 PF', 3.6, 'SALMON'),
  ('24616245167481-978', 'F. SALMON PREM PEDACOS SASHIMI S/P S/E S/CL SKIN 150GR', '3x1', 0.15, null, 'FRESCATTO CXA 3,62', 3.62, 'SALMON'),
  ('2461670106378F-975', 'F. SALMON PREM PEDACOS S/E 600GR SKIN PREMIUM', '2x1', 0.6, 15, 'FRESCATTO CXA 09', 9, 'SALMON'),
  ('2461670106378G-975', 'F. SALMON PREM PEDACOS S/E 600GR SKIN PREMIUM', '2x1', 0.6, 15, 'FRESCATTO CXA 09', 9, 'SALMON'),
  ('2461670106378R-975', 'F. SALMON PREM PEDACOS S/E 600GR SKIN PREMIUM', '2x1', 0.6, 15, 'FRESCATTO CXA 09', 9, 'SALMON'),
  ('24616701063781-975', 'F. SALMON PREM PEDACOS S/E 600GR SKIN PREMIUM', '2x1', 0.6, 15, 'FRESCATTO CXA 09', 9, 'SALMON'),
  ('24625020001951-1070', 'MEDALHAO SALMON S/CL SKIN BDJ 500GR', '2x1', 0.5, 15, 'FRESC CXA 7,5 PF', 7.5, 'SALMON'),
  ('2462505417578F-964', 'MEDALHAO SALMON S/CL 500GR SKIN PREMIUM', '2x1', 0.5, 15, 'FRESCATTO CXA 7,5', 7.5, 'SALMON'),
  ('2462505417578G-964', 'MEDALHAO SALMON S/CL 500GR SKIN PREMIUM', '2x1', 0.5, 15, 'FRESCATTO CXA 7,5', 7.5, 'SALMON'),
  ('2462505417578R-964', 'MEDALHAO SALMON S/CL 500GR SKIN PREMIUM', '2x1', 0.5, 15, 'FRESCATTO CXA 7,5', 7.5, 'SALMON'),
  ('24625054175781-964', 'MEDALHAO SALMON S/CL 500GR SKIN PREMIUM', '2x1', 0.5, 15, 'FRESCATTO CXA 7,5', 7.5, 'SALMON'),
  ('24652230001981-1058', 'F. SALMON PEDACOS S/E S/CL SKIN PREMIUM PDV', '2x1', null, null, 'FRESC CXA PDV PF', null, 'SALMON'),
  ('24652701001621-1058', 'F. SALMON PREM PEDACOS S/E S/CL SKIN PDV', '3x1', null, null, 'FRESC CXA PDV PF', null, 'SALMON'),
  ('2465270100197F-1058', 'F. SALMON PREM PEDACOS S/E S/CL SKIN G PDV', '2x1', null, null, 'FRESC CXA PDV PF', null, 'SALMON'),
  ('24652701001971-1058', 'F. SALMON PREM PEDACOS S/E S/CL SKIN G PDV', '2x1', null, null, 'FRESC CXA PDV PF', null, 'SALMON'),
  ('24652701001971-1077', 'F. SALMON PREM PEDACOS S/E S/CL SKIN G PDV', '2x1', null, null, 'HNT CXA 10', 10, 'SALMON'),
  ('2465270105399F-1077', 'F. SALMON PREM PEDACOS S/E SKIN 500GR', '2x1', 0.5, 20, 'HNT CXA 10', 10, 'SALMON'),
  ('24652701053991-1077', 'F. SALMON PREM PEDACOS S/E SKIN 500GR', '2x1', 0.5, 20, 'HNT CXA 10', 10, 'SALMON'),
  ('2465270117478F-1061', 'F.SALMON PREM PEDACOS S/E SKIN 200GR', '3x1', 0.2, 20, 'FRESC CXA 4 PF', 4, 'SALMON'),
  ('24652701174781-1061', 'F.SALMON PREM PEDACOS S/E SKIN 200GR', '3x1', 0.2, 20, 'FRESC CXA 4 PF', 4, 'SALMON'),
  ('24655020001951-1070', 'MEDALHAO ATUM S/CL SKIN BDJ 500GR', '2x1', 0.5, 15, 'FRESC CXA 7,5 PF', 7.5, 'ATUM'),
  ('24661054176781-1109', 'MIX FRUTOS DO MAR S/CL 300GR SKIN PREMIUM', '2x1', 0.3, 15, 'FRESCATTO CXA 4,5', 4.5, 'PAELLA'),
  ('2466202005394F-1064', 'HAMBURGUER ATUM SKIN BDJ 240GR', '3x1', 0.24, 20, 'FRESC CXA 4,8 PF', 4.8, 'ATUM'),
  ('24662020053941-1064', 'HAMBURGUER ATUM SKIN BDJ 240GR', '3x1', 0.24, 20, 'FRESC CXA 4,8 PF', 4.8, 'ATUM'),
  ('2466402076180F-597', 'HAMBURGUER SALMON 240GR SKIN', '3x1', 0.24, 20, 'FRESCATTO CXA 4,8', 4.8, 'SALMON'),
  ('2466402076180G-597', 'HAMBURGUER SALMON 240GR SKIN', '3x1', 0.24, 20, 'FRESCATTO CXA 4,8', 4.8, 'SALMON'),
  ('24664020761801-032', 'HAMBURGUER SALMON 240GR SKIN', '3x1', 0.24, null, 'FRESCATTO CXA 04', 4, 'SALMON'),
  ('24664020761801-1064', 'HAMBURGUER SALMON 240GR SKIN', '3x1', 0.24, 20, 'FRESC CXA 4,8 PF', 4.8, 'SALMON'),
  ('24664020761801-597', 'HAMBURGUER SALMON 240GR SKIN', '3x1', 0.24, 20, 'FRESCATTO CXA 4,8', 4.8, 'SALMON'),
  ('2467602005394F-1064', 'HAMBURGUER DOURADO SKIN BDJ 240GR', '3x1', 0.24, 20, 'FRESC CXA 4,8 PF', 4.8, 'DOURADO'),
  ('24676020053941-1064', 'HAMBURGUER DOURADO SKIN BDJ 240GR', '3x1', 0.24, 20, 'FRESC CXA 4,8 PF', 4.8, 'DOURADO')
on conflict (codigo) do nothing;

-- 6.5 Histórico da planilha de controle (15 produções)
--   Sem caixas, retrabalho, paradas, parâmetros nem fotos. Linhas sem código têm
--   duas derivações possíveis no catálogo: produto_codigo fica nulo.
insert into public.ops
  (id, origem, status, data, produto_codigo, produto_descricao, op, molde, peso_nominal_kg,
   hora_inicio, hora_fim, passo_inicio, passo_fim, peso_final_kg, embalagens_avulsas)
values
  ('00000000-0000-4000-8000-000000000001', 'planilha', 'fechada', '2026-09-30', '24616701063781-975', 'F. SALMON PREM PEDACOS S/E 600GR SKIN PREMIUM', null, '2x1', 0.6, '08:00', '11:11', 0, 359, 234, null),
  ('00000000-0000-4000-8000-000000000002', 'planilha', 'fechada', '2026-09-29', '24616701063781-975', 'F. SALMON PREM PEDACOS S/E 600GR SKIN PREMIUM', null, '2x1', 0.6, '15:30', '17:25', 0, 529, 441, null),
  ('00000000-0000-4000-8000-000000000003', 'planilha', 'fechada', '2026-09-25', '24616701063781-975', 'F. SALMON PREM PEDACOS S/E 600GR SKIN PREMIUM', null, '2x1', 0.6, '12:45', '14:54', 0, 170, 99, null),
  ('00000000-0000-4000-8000-000000000004', 'planilha', 'fechada', null, '14701020056241-964', 'TEN POLVO S/CL 500GR SKIN PREMIUM', null, '2x1', 0.5, null, null, 0, 139, 90, null),
  ('00000000-0000-4000-8000-000000000005', 'planilha', 'fechada', '2026-10-05', '24625054175781-964', 'MEDALHAO SALMON S/CL 500GR SKIN PREMIUM', '20101768', '2x1', 0.5, '13:28', '14:30', 0, 208, 90, null),
  ('00000000-0000-4000-8000-000000000006', 'planilha', 'fechada', '2026-10-06', '24616701063781-975', 'F. SALMON PREM PEDACOS S/E 600GR SKIN PREMIUM', '20102595', '2x1', 0.6, '08:20', '13:15', 0, 800, 675, null),
  ('00000000-0000-4000-8000-000000000007', 'planilha', 'fechada', '2026-10-06', '24616701063781-975', 'F. SALMON PREM PEDACOS S/E 600GR SKIN PREMIUM', '20102595', '2x1', 0.6, '13:30', '16:05', 0, 419, 414, null),
  ('00000000-0000-4000-8000-000000000008', 'planilha', 'fechada', '2026-10-08', '24616701063781-975', 'F. SALMON PREM PEDACOS S/E 600GR SKIN PREMIUM', '20102595', '2x1', 0.6, '08:50', '09:38', 0, 315, 171, null),
  ('00000000-0000-4000-8000-000000000009', 'planilha', 'fechada', '2026-10-08', '16516063001581-219', 'CAUDA LAGOSTA CTD S/CL SKIN PREMIUM', '2216983', '2x1', null, '10:00', '13:20', 0, 335, 96, null),
  ('00000000-0000-4000-8000-000000000010', 'planilha', 'fechada', '2026-10-09', null, 'CAMARAO ROSA DESC EVISC 10/15 200GR SKIN PREMIUM', '2216961', '3x1', 0.2, '09:00', '11:21', 0, 275, 82.8, null),
  ('00000000-0000-4000-8000-000000000011', 'planilha', 'fechada', '2026-10-10', '24616701063781-975', 'F. SALMON PREM PEDACOS S/E 600GR SKIN PREMIUM', '20102595', '2x1', 0.6, '09:00', '11:40', 0, 799, 819, null),
  ('00000000-0000-4000-8000-000000000012', 'planilha', 'fechada', '2026-11-09', null, 'F. PESCADA AMARELA PEDACOS S/E 500GR SKIN PREMIUM', '20103597', '2x1', 0.5, null, null, 0, 313, 217.5, null),
  ('00000000-0000-4000-8000-000000000013', 'planilha', 'fechada', '2026-11-10', null, 'F. PESCADA AMARELA PEDACOS S/E 500GR SKIN PREMIUM', '20103597', '2x1', 0.5, '16:37', '16:58', 22, 102, 65.5, null),
  ('00000000-0000-4000-8000-000000000014', 'planilha', 'fechada', '2026-11-11', null, 'F. PESCADA AMARELA PEDACOS S/E 500GR SKIN PREMIUM', '20103597', '2x1', 0.5, null, null, 17, 154, 112.5, null),
  ('00000000-0000-4000-8000-000000000015', 'planilha', 'fechada', null, '16516063001581-219', 'CAUDA LAGOSTA CTD S/CL SKIN PREMIUM', null, '3x1', null, null, null, 0, 126, 23.4, null)
on conflict (id) do nothing;
