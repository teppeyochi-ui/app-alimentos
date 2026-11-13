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
