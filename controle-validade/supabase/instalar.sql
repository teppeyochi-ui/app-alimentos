-- Validade em Dia: banco de dados na nuvem (Supabase).
--
-- Como usar: no projeto do Supabase, abra SQL Editor, cole este arquivo inteiro e clique em Run.
-- Pode rodar de novo sem perigo: nada do que já foi guardado é apagado.
--
-- O que ele cria:
--   vd_registros   uma linha por registro da casa (produto, etiqueta, recebimento, contagem, ajustes)
--   vd_contadores  o próximo número livre de cada numeração da casa
--   vd_enviar      recebe as mudanças de um aparelho e junta ao que já existe
--   vd_receber     devolve o que mudou desde a última vez
--   vd_reservar    reserva uma faixa de números para um aparelho
--
-- Cada conta (o login da casa) só enxerga e só altera as próprias linhas.

create table if not exists public.vd_registros (
  casa uuid not null references auth.users (id) on delete cascade,
  tipo text not null check (tipo in ('produto', 'etiqueta', 'recebimento', 'contagem', 'config')),
  id text not null check (char_length(id) between 1 and 40),
  dados jsonb not null default '{}'::jsonb check (jsonb_typeof(dados) = 'object'),
  apagado boolean not null default false,
  atualizado_em timestamptz not null default clock_timestamp(),
  primary key (casa, tipo, id)
);

create index if not exists vd_registros_novidades on public.vd_registros (casa, atualizado_em);

create table if not exists public.vd_contadores (
  casa uuid not null references auth.users (id) on delete cascade,
  contador text not null check (contador in ('etiqueta', 'produto', 'recebimento', 'contagem')),
  proximo bigint not null default 1 check (proximo >= 1),
  primary key (casa, contador)
);

-- Ninguém mexe nas tabelas direto: a leitura é só das próprias linhas e a escrita é só pelas funções.
alter table public.vd_registros enable row level security;
alter table public.vd_contadores enable row level security;

drop policy if exists vd_registros_da_casa on public.vd_registros;
create policy vd_registros_da_casa on public.vd_registros
  for select to authenticated using (casa = (select auth.uid()));

revoke all on public.vd_registros from anon, authenticated;
revoke all on public.vd_contadores from anon, authenticated;
grant select on public.vd_registros to authenticated;

-- Carimbo de data e hora sempre no mesmo formato (UTC, com microssegundos): dá para comparar como texto.
create or replace function public.vd_carimbo(quando timestamptz)
returns text language sql immutable set search_path = '' as $$
  select to_char(quando at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
$$;

/*
 * Recebe as mudanças de um aparelho: uma lista de { tipo, id, campos, apagado }.
 * Os campos recebidos são juntados aos que a linha já tem. Assim, se um aparelho mudou o local de uma
 * etiqueta enquanto outro dava baixa nela, as duas mudanças ficam. No mesmo campo, vale quem chegou por último.
 */
create or replace function public.vd_enviar(mudancas jsonb)
returns text language plpgsql security definer set search_path = '' as $$
declare
  quem uuid := auth.uid();
  m jsonb;
begin
  if quem is null then
    raise exception 'Entre com a conta da casa.' using errcode = '28000';
  end if;
  if mudancas is null or jsonb_typeof(mudancas) <> 'array' then
    raise exception 'mudancas deve ser uma lista.' using errcode = '22023';
  end if;
  if jsonb_array_length(mudancas) > 2000 then
    raise exception 'No máximo 2000 mudanças por vez.' using errcode = '22023';
  end if;
  for m in select * from jsonb_array_elements(mudancas) loop
    if jsonb_typeof(m) <> 'object' or coalesce(m ->> 'tipo', '') = '' or coalesce(m ->> 'id', '') = ''
       or jsonb_typeof(coalesce(m -> 'campos', '{}'::jsonb)) <> 'object' then
      raise exception 'Mudança mal formada: %', left(m::text, 200) using errcode = '22023';
    end if;
    insert into public.vd_registros as r (casa, tipo, id, dados, apagado, atualizado_em)
    values (quem, m ->> 'tipo', m ->> 'id', coalesce(m -> 'campos', '{}'::jsonb), coalesce((m ->> 'apagado')::boolean, false), clock_timestamp())
    on conflict (casa, tipo, id) do update
      set dados = r.dados || excluded.dados,
          apagado = case when m ? 'apagado' and m -> 'apagado' <> 'null'::jsonb then excluded.apagado else r.apagado end,
          atualizado_em = clock_timestamp();
  end loop;
  return public.vd_carimbo(clock_timestamp());
end;
$$;

/*
 * Devolve o que mudou depois de `desde` (ou tudo, se vier vazio), em ordem, no máximo `limite` linhas:
 *   { "agora": carimbo, "linhas": [ { tipo, id, dados, apagado, atualizado_em } ] }
 * O aparelho pede de novo a partir do carimbo da última linha até vir menos do que o limite.
 */
create or replace function public.vd_receber(desde timestamptz default null, limite integer default 1000)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  quem uuid := auth.uid();
  resposta jsonb;
begin
  if quem is null then
    raise exception 'Entre com a conta da casa.' using errcode = '28000';
  end if;
  select jsonb_build_object(
    'agora', public.vd_carimbo(clock_timestamp()),
    'linhas', coalesce(jsonb_agg(jsonb_build_object(
      'tipo', l.tipo, 'id', l.id, 'dados', l.dados, 'apagado', l.apagado, 'atualizado_em', public.vd_carimbo(l.atualizado_em)
    ) order by l.atualizado_em, l.tipo, l.id), '[]'::jsonb))
  into resposta
  from (
    select r.tipo, r.id, r.dados, r.apagado, r.atualizado_em
    from public.vd_registros r
    where r.casa = quem and (desde is null or r.atualizado_em > desde)
    order by r.atualizado_em, r.tipo, r.id
    limit least(greatest(coalesce(limite, 1000), 1), 5000)
  ) l;
  return resposta;
end;
$$;

/*
 * Reserva uma faixa de `quantos` números da numeração `contador` e devolve o primeiro.
 * Cada aparelho usa só os números das suas faixas: dois aparelhos nunca dão o mesmo número,
 * mesmo trabalhando sem internet. `minimo` serve para a casa que já tinha números em uso antes da nuvem.
 */
create or replace function public.vd_reservar(contador text, quantos integer, minimo bigint default 1)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  quem uuid := auth.uid();
  primeiro bigint;
begin
  if quem is null then
    raise exception 'Entre com a conta da casa.' using errcode = '28000';
  end if;
  if quantos is null or quantos < 1 or quantos > 5000 then
    raise exception 'quantos vai de 1 a 5000.' using errcode = '22023';
  end if;
  insert into public.vd_contadores as c (casa, contador, proximo)
  values (quem, vd_reservar.contador, greatest(coalesce(minimo, 1), 1) + quantos)
  on conflict on constraint vd_contadores_pkey do update
    set proximo = greatest(c.proximo, coalesce(minimo, 1)) + quantos
  returning c.proximo - quantos into primeiro;
  return primeiro;
end;
$$;

-- Só quem entrou com a conta da casa chama as funções.
revoke all on function public.vd_enviar(jsonb) from public, anon;
revoke all on function public.vd_receber(timestamptz, integer) from public, anon;
revoke all on function public.vd_reservar(text, integer, bigint) from public, anon;
grant execute on function public.vd_enviar(jsonb) to authenticated;
grant execute on function public.vd_receber(timestamptz, integer) to authenticated;
grant execute on function public.vd_reservar(text, integer, bigint) to authenticated;
grant execute on function public.vd_carimbo(timestamptz) to authenticated;
