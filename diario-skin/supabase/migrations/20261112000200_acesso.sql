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
