-- Testes do banco da nuvem. Rodam num PostgreSQL temporário, depois do imitar-supabase.sql e do instalar.sql.
-- Cada bloco entra como uma das casas (ou como visitante) e confere o que o banco responde.
\set ON_ERROR_STOP 1

create function pg_temp.entrar(quem text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', quem, false);
end $$;

-- ---------- casa um: envia, recebe, junta campos ----------
set role authenticated;
select pg_temp.entrar('11111111-1111-1111-1111-111111111111');

do $$
declare r jsonb; carimbo text; antes text;
begin
  r := public.vd_receber();
  assert jsonb_array_length(r -> 'linhas') = 0, 'banco novo começa vazio';
  assert (r ->> 'agora') ~ '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$', 'carimbo no formato combinado: ' || (r ->> 'agora');

  carimbo := public.vd_enviar('[
    {"tipo":"produto","id":"p1","campos":{"id":"p1","nome":"Camarão","validades":{"resfriado":{"n":2,"un":"d"}}}},
    {"tipo":"etiqueta","id":"e1","campos":{"cod":1,"nome":"Camarão","status":"ativa","local":"Câmara fria","qtd":"1 kg"}},
    {"tipo":"config","id":"config","campos":{"casa":"Cozinha da Vó","equipe":["José","Ana"]}}
  ]'::jsonb);
  assert carimbo ~ 'Z$', 'enviar devolve o carimbo';

  r := public.vd_receber();
  assert jsonb_array_length(r -> 'linhas') = 3, 'as três linhas voltam';
  assert (r -> 'linhas' -> 0 ->> 'id') = 'p1' and (r -> 'linhas' -> 2 ->> 'tipo') = 'config', 'na ordem em que foram gravadas';
  assert (r -> 'linhas' -> 0 ->> 'atualizado_em') < (r -> 'linhas' -> 1 ->> 'atualizado_em'), 'carimbos crescentes dentro do mesmo envio';
  antes := r -> 'linhas' -> 2 ->> 'atualizado_em';

  -- Dois aparelhos mexem em campos diferentes da mesma etiqueta: ficam as duas mudanças.
  perform public.vd_enviar('[{"tipo":"etiqueta","id":"e1","campos":{"local":"Freezer"}}]'::jsonb);
  perform public.vd_enviar('[{"tipo":"etiqueta","id":"e1","campos":{"status":"usada","baixaEm":123,"baixaPor":"Ana"}}]'::jsonb);
  r := public.vd_receber(antes::timestamptz);
  assert jsonb_array_length(r -> 'linhas') = 1, 'só o que mudou depois do carimbo';
  assert (r -> 'linhas' -> 0 -> 'dados') = '{"cod":1,"nome":"Camarão","status":"usada","local":"Freezer","qtd":"1 kg","baixaEm":123,"baixaPor":"Ana"}'::jsonb,
    'campos juntados: ' || (r -> 'linhas' -> 0 -> 'dados')::text;

  -- Desfazer a baixa manda os campos como nulos; no mesmo campo vale o último que chegou.
  perform public.vd_enviar('[{"tipo":"etiqueta","id":"e1","campos":{"status":"ativa","baixaEm":null,"baixaPor":null,"local":"Geladeira"}}]'::jsonb);
  r := public.vd_receber(antes::timestamptz);
  assert (r -> 'linhas' -> 0 -> 'dados') = '{"cod":1,"nome":"Camarão","status":"ativa","local":"Geladeira","qtd":"1 kg","baixaEm":null,"baixaPor":null}'::jsonb,
    'nulos e último valor: ' || (r -> 'linhas' -> 0 -> 'dados')::text;

  -- Excluir marca a linha; uma mudança sem "apagado" não desfaz a exclusão.
  perform public.vd_enviar('[{"tipo":"produto","id":"p1","campos":{},"apagado":true}]'::jsonb);
  perform public.vd_enviar('[{"tipo":"produto","id":"p1","campos":{"nome":"Camarão limpo"}}]'::jsonb);
  r := public.vd_receber(antes::timestamptz);
  assert (select bool_and((l ->> 'apagado')::boolean) from jsonb_array_elements(r -> 'linhas') l where l ->> 'id' = 'p1'), 'produto continua apagado';
  assert (select l -> 'dados' ->> 'nome' from jsonb_array_elements(r -> 'linhas') l where l ->> 'id' = 'p1') = 'Camarão limpo', 'mas os campos juntam';
end $$;

-- ---------- pedidos mal formados são recusados inteiros ----------
do $$
declare recusou boolean;
begin
  recusou := false;
  begin perform public.vd_enviar('{"tipo":"etiqueta"}'::jsonb); exception when others then recusou := true; end;
  assert recusou, 'mudancas que não é lista';
  recusou := false;
  begin perform public.vd_enviar('[{"tipo":"etiqueta","id":"e7","campos":{"cod":7}},{"tipo":"invasor","id":"x","campos":{}}]'::jsonb); exception when others then recusou := true; end;
  assert recusou, 'tipo desconhecido';
  assert not exists (select 1 from public.vd_registros where id = 'e7'), 'e nada do pedido recusado fica gravado';
  recusou := false;
  begin perform public.vd_enviar('[{"tipo":"etiqueta","id":"e8","campos":[1,2]}]'::jsonb); exception when others then recusou := true; end;
  assert recusou, 'campos que não é objeto';
  recusou := false;
  begin perform public.vd_enviar('[{"tipo":"etiqueta","campos":{}}]'::jsonb); exception when others then recusou := true; end;
  assert recusou, 'sem id';
end $$;

-- ---------- numeração: faixas que nunca se repetem ----------
do $$
begin
  assert public.vd_reservar('etiqueta', 1000) = 1, 'primeira faixa começa em 1';
  assert public.vd_reservar('etiqueta', 1000) = 1001, 'a seguinte começa depois';
  assert public.vd_reservar('produto', 100) = 1, 'cada numeração tem a sua conta';
  assert public.vd_reservar('etiqueta', 10, 5000) = 5000, 'minimo empurra para a frente';
  assert public.vd_reservar('etiqueta', 10, 3) = 5010, 'e nunca volta para trás';
  assert public.vd_reservar('recebimento', 50, 12) = 12, 'casa que já tinha 11 recebimentos antes da nuvem';
end $$;
do $$
declare recusou boolean := false;
begin
  begin perform public.vd_reservar('etiqueta', 0); exception when others then recusou := true; end;
  assert recusou, 'quantos precisa ser positivo';
  recusou := false;
  begin perform public.vd_reservar('qualquer', 10); exception when others then recusou := true; end;
  assert recusou, 'numeração desconhecida';
end $$;

-- ---------- paginação ----------
do $$
declare r jsonb; total int := 0; desde timestamptz := null; voltas int := 0;
begin
  perform public.vd_enviar((select jsonb_agg(jsonb_build_object('tipo', 'etiqueta', 'id', 'e' || n, 'campos', jsonb_build_object('cod', n))) from generate_series(100, 349) n));
  loop
    r := public.vd_receber(desde, 100);
    total := total + jsonb_array_length(r -> 'linhas');
    voltas := voltas + 1;
    exit when jsonb_array_length(r -> 'linhas') < 100 or voltas > 20;
    desde := (r -> 'linhas' -> 99 ->> 'atualizado_em')::timestamptz;
  end loop;
  assert total = (select count(*) from public.vd_registros where casa = '11111111-1111-1111-1111-111111111111'), 'paginando de 100 em 100 vem tudo, sem repetir: ' || total;
  assert voltas = 3, 'em 3 pedidos: ' || voltas;
end $$;

-- ---------- a tabela não aceita escrita direta ----------
do $$
declare recusou boolean := false;
begin
  begin insert into public.vd_registros (casa, tipo, id) values ('11111111-1111-1111-1111-111111111111', 'etiqueta', 'direto'); exception when insufficient_privilege then recusou := true; end;
  assert recusou, 'insert direto';
  recusou := false;
  begin update public.vd_registros set apagado = true; exception when insufficient_privilege then recusou := true; end;
  assert recusou, 'update direto';
  recusou := false;
  begin delete from public.vd_registros; exception when insufficient_privilege then recusou := true; end;
  assert recusou, 'delete direto';
  recusou := false;
  begin perform 1 from public.vd_contadores; exception when insufficient_privilege then recusou := true; end;
  assert recusou, 'contadores não são lidos direto';
end $$;

-- ---------- casa dois: não vê nem altera nada da casa um ----------
select pg_temp.entrar('22222222-2222-2222-2222-222222222222');
do $$
declare r jsonb;
begin
  r := public.vd_receber();
  assert jsonb_array_length(r -> 'linhas') = 0, 'outra casa começa vazia';
  assert (select count(*) from public.vd_registros) = 0, 'e a leitura direta só mostra as próprias linhas';
  assert public.vd_reservar('etiqueta', 1000) = 1, 'numeração própria';
  -- Mesmo id da outra casa: é outra linha.
  perform public.vd_enviar('[{"tipo":"etiqueta","id":"e1","campos":{"cod":1,"nome":"Da casa dois"}}]'::jsonb);
  r := public.vd_receber();
  assert jsonb_array_length(r -> 'linhas') = 1 and (r -> 'linhas' -> 0 -> 'dados' ->> 'nome') = 'Da casa dois', 'só a sua';
end $$;
select pg_temp.entrar('11111111-1111-1111-1111-111111111111');
do $$
begin
  assert (select dados ->> 'nome' from public.vd_registros where tipo = 'etiqueta' and id = 'e1') = 'Camarão', 'a etiqueta da casa um ficou intacta';
  assert (select count(*) from public.vd_registros where tipo = 'etiqueta' and id = 'e1') = 1, 'e ela só vê a dela';
end $$;

-- ---------- sem entrar: nada ----------
select pg_temp.entrar('');
do $$
declare recusou boolean := false;
begin
  begin perform public.vd_receber(); exception when others then recusou := true; end;
  assert recusou, 'sessão sem usuário não recebe';
  recusou := false;
  begin perform public.vd_enviar('[]'::jsonb); exception when others then recusou := true; end;
  assert recusou, 'nem envia';
  recusou := false;
  begin perform public.vd_reservar('etiqueta', 10); exception when others then recusou := true; end;
  assert recusou, 'nem reserva';
  assert (select count(*) from public.vd_registros) = 0, 'e não lê linha de ninguém';
end $$;
reset role;
set role anon;
do $$
declare recusou boolean := false;
begin
  begin perform public.vd_receber(); exception when insufficient_privilege then recusou := true; end;
  assert recusou, 'visitante não chama as funções';
  recusou := false;
  begin perform 1 from public.vd_registros; exception when insufficient_privilege then recusou := true; end;
  assert recusou, 'nem lê a tabela';
end $$;
reset role;

-- ---------- apagar a conta leva os dados dela ----------
delete from auth.users where id = '22222222-2222-2222-2222-222222222222';
do $$
begin
  assert not exists (select 1 from public.vd_registros where casa = '22222222-2222-2222-2222-222222222222'), 'registros da conta apagada';
  assert not exists (select 1 from public.vd_contadores where casa = '22222222-2222-2222-2222-222222222222'), 'contadores da conta apagada';
  assert (select count(*) from public.vd_registros) > 250, 'a outra casa continua lá';
end $$;

select 'banco: todos os testes passaram' as resultado;
