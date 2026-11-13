-- Testes do banco: carga inicial, view de indicadores, salvar_op e políticas de acesso.
-- Rodar com testes/sql/rodar.sh (depois das migrações e da carga).

\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = notice;
-- Só interessam os avisos ✓/✗; o resultado das consultas é descartado.
\o /dev/null

create schema teste;
grant usage on schema teste to anon, authenticated;

create function teste.igual(descricao text, obtido anyelement, esperado anyelement)
returns void language plpgsql as $$
begin
  if obtido is distinct from esperado then
    raise exception '✗ % — obtido %, esperado %', descricao, obtido, esperado;
  end if;
  raise notice '  ✓ %', descricao;
end $$;

-- Roda o comando esperando erro com o código dado.
create function teste.erro(descricao text, comando text, codigo text)
returns void language plpgsql as $$
begin
  begin
    execute comando;
  exception when others then
    if sqlstate = codigo then
      raise notice '  ✓ % (recusado: %)', descricao, sqlstate;
      return;
    end if;
    raise exception '✗ % — erro %, esperado % (%)', descricao, sqlstate, codigo, sqlerrm;
  end;
  raise exception '✗ % — deveria ter sido recusado', descricao;
end $$;

-- Hora de edição usada nos envios: depois da carga inicial e sempre no passado
-- (o servidor corta em now() o que vier do futuro).
create table teste.relogio as select date_trunc('second', now()) - interval '3 hours' as base;
grant select on teste.relogio to anon, authenticated;
update public.ops set alterado_em = (select base from teste.relogio) - interval '1 day';
create function teste.t(minutos integer) returns text language sql as $$
  select to_char(((select base from teste.relogio) + make_interval(mins => minutos)) at time zone 'UTC',
                 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$$;

-- OP de teste do critério de aceite 2.
create function teste.op(alterado text, extra jsonb default '{}'::jsonb) returns jsonb language sql as $$
  select jsonb_build_object(
    'id', 'aaaaaaaa-0000-4000-8000-000000000001',
    'origem', 'diario', 'status', 'aberta', 'data', '2026-11-12',
    'produto_codigo', '24616701063781-975',
    'produto_descricao', 'F. SALMON PREM PEDACOS S/E 600GR SKIN PREMIUM',
    'op', '20109999', 'molde', '2x1', 'peso_nominal_kg', 0.6, 'embalagens_por_caixa', 9,
    'hora_inicio', '08:00', 'hora_fim', '10:30', 'passo_inicio', 0, 'passo_fim', 600,
    'caixas', 110, 'embalagens_avulsas', 0, 'peso_final_kg', 620,
    't_dome', 225, 't_pre', 110, 't1', 0.8, 't2', 1.2, 't4', 0, 't5', 0, 't6', 4.0, 't7', 0.2,
    'p_vent', 500, 'sp', 30, 'tx', 0.5, 'tmax', 10, 'parametros_origem', 'digitado',
    'criado_em', teste.t(-150), 'alterado_em', alterado,
    'retrabalho', jsonb_build_object('sem_vacuo', 5, 'furo', 2, 'ruga', 0, 'selagem', 0, 'peso', 0, 'posicao', 0, 'outro', 0),
    'paradas', jsonb_build_array(
      jsonb_build_object('id', 'bbbbbbbb-0000-4000-8000-000000000001', 'motivo', 'Troca de bobina de filme', 'minutos', 12),
      jsonb_build_object('id', 'bbbbbbbb-0000-4000-8000-000000000002', 'motivo', 'Ajuste de parâmetro', 'minutos', 8)),
    'fotos', jsonb_build_array(
      jsonb_build_object('id', 'cccccccc-0000-4000-8000-000000000001', 'tipo', 'tela',
        'caminho', 'aaaaaaaa-0000-4000-8000-000000000001/cccccccc-0000-4000-8000-000000000001.jpg',
        'tela_numero', 417, 'criado_em', teste.t(-140)))
  ) || extra
$$;

grant execute on all functions in schema teste to anon, authenticated;

-- ------------------------------------------------------------------ usuários
\echo 'Usuários e perfis'
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-4111-8111-111111111111', 'admin@exemplo.com', '{"nome":"Ana Admin"}'),
  ('22222222-2222-4222-8222-222222222222', 'pd@exemplo.com', '{"nome":"Paulo P&D"}'),
  ('33333333-3333-4333-8333-333333333333', 'operador@exemplo.com', '{}'),
  ('44444444-4444-4444-8444-444444444444', 'novo@exemplo.com', '{"nome":"  "}');

select teste.igual('criar conta cria o perfil', (select count(*) from public.perfis), 4::bigint);
select teste.igual('perfil novo entra como operador', (select count(*) from public.perfis where papel = 'operador'), 4::bigint);
select teste.igual('perfil novo entra inativo', (select count(*) from public.perfis where ativo), 0::bigint);
select teste.igual('nome vem do cadastro', (select nome from public.perfis where id = '11111111-1111-4111-8111-111111111111'), 'Ana Admin');
select teste.igual('sem nome, usa o início do e-mail', (select nome from public.perfis where id = '33333333-3333-4333-8333-333333333333'), 'operador');

update public.perfis set papel = 'admin', ativo = true where id = '11111111-1111-4111-8111-111111111111';
update public.perfis set papel = 'pd', ativo = true where id = '22222222-2222-4222-8222-222222222222';
update public.perfis set ativo = true where id = '33333333-3333-4333-8333-333333333333';

-- ------------------------------------------------------------------ carga inicial
\echo 'Carga inicial'
select teste.igual('118 SKUs no catálogo', (select count(*) from public.produtos), 118::bigint);
select teste.igual('derivação e caixa do 10068093246591-964', (select derivacao || ' / ' || peso_caixa_kg || ' / ' || embalagens_por_caixa from public.produtos where codigo = '10068093246591-964'), 'FRESCATTO CXA 7,5 / 7.5 / 15');
select teste.igual('PDV fica sem embalagens por caixa', (select count(*) from public.produtos where peso_nominal_kg is null and embalagens_por_caixa is not null), 0::bigint);
select teste.igual('6 SKUs sem molde', (select count(*) from public.produtos where molde is null), 6::bigint);
select teste.igual('27 SKUs pedem confirmação do molde (6 sem molde + 21 herdados)', (select count(*) from public.produtos where molde_a_confirmar), 27::bigint);
select teste.igual('todo SKU tem derivação e espécie', (select count(*) from public.produtos where derivacao is null or especie is null), 0::bigint);
select teste.igual('2 moldes', (select count(*) from public.moldes), 2::bigint);
select teste.igual('1 receita padrão', (select count(*) from public.receitas_padrao), 1::bigint);
select teste.igual('15 produções do histórico', (select count(*) from public.ops where origem = 'planilha' and status = 'fechada'), 15::bigint);
select teste.igual('critério 1: molde do 16507014073621-011', (select molde from public.produtos where codigo = '16507014073621-011'), '3x1');
select teste.igual('critério 1: peso nominal do 16507014073621-011', (select peso_nominal_kg from public.produtos where codigo = '16507014073621-011'), 0.2);
select teste.igual('histórico sem código fica com produto_codigo nulo', (select count(*) from public.ops where origem = 'planilha' and produto_codigo is null), 4::bigint);

\echo 'View ops_indicadores no histórico'
select teste.igual('critério 3: bandejas formadas', (select bandejas_formadas from public.ops_indicadores where data = '2026-10-10'), 1598);
select teste.igual('critério 3: embalagens boas', (select embalagens_boas from public.ops_indicadores where data = '2026-10-10'), 1365);
select teste.igual('critério 3: aproveitamento 85%', (select round(aproveitamento * 100) from public.ops_indicadores where data = '2026-10-10'), 85::numeric);
select teste.igual('histórico: perda não classificada', (select perda_nao_classificada from public.ops_indicadores where data = '2026-10-10'), 233);
select teste.igual('histórico: vazias sem valor', (select vazias from public.ops_indicadores where data = '2026-10-10'), null::integer);
select teste.igual('histórico: retrabalho sem registro', (select retrabalho from public.ops_indicadores where data = '2026-10-10'), null::integer);
select teste.igual('peso variável fica sem boas', (select embalagens_boas from public.ops_indicadores where id = '00000000-0000-4000-8000-000000000009'), null::integer);
select teste.igual('camarão 82,8 kg ÷ 0,2 kg = 414 boas', (select embalagens_boas from public.ops_indicadores where id = '00000000-0000-4000-8000-000000000010'), 414);
select teste.igual('todas as OPs aparecem na view', (select count(*) from public.ops_indicadores), 15::bigint);

-- ------------------------------------------------------------------ operador
\echo 'Operador: lança, reenvia e encerra'
set role authenticated;
select set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', false);

select teste.igual('operador lê o catálogo', (select count(*) from public.produtos), 118::bigint);
select teste.igual('salvar_op grava a OP nova', public.salvar_op(teste.op(teste.t(0))) ->> 'resultado', 'gravada');
select teste.igual('reenviar a mesma edição não muda nada', public.salvar_op(teste.op(teste.t(0))) ->> 'resultado', 'igual');
select teste.igual('edição mais velha que a do servidor é ignorada', public.salvar_op(teste.op(teste.t(-5), '{"caixas": 1}')) ->> 'resultado', 'ignorada');
select teste.igual('a ignorada não alterou a OP', (select caixas from public.ops where id = 'aaaaaaaa-0000-4000-8000-000000000001'), 110);

select teste.igual('sem duplicar: 1 OP', (select count(*) from public.ops where origem = 'diario'), 1::bigint);
select teste.igual('sem duplicar: 7 linhas de retrabalho', (select count(*) from public.op_retrabalho), 7::bigint);
select teste.igual('sem duplicar: 2 paradas', (select count(*) from public.op_paradas), 2::bigint);
select teste.igual('sem duplicar: 1 foto', (select count(*) from public.op_fotos), 1::bigint);
select teste.igual('criado_por é o operador', (select criado_por from public.ops where origem = 'diario'), '33333333-3333-4333-8333-333333333333'::uuid);
select teste.igual('criado_em vem do aparelho', (select criado_em from public.ops where origem = 'diario'), teste.t(-150)::timestamptz);

\echo 'Critério 2 pela view'
select teste.igual('bandejas formadas', (select bandejas_formadas from public.ops_indicadores where origem = 'diario'), 1200);
select teste.igual('embalagens boas', (select embalagens_boas from public.ops_indicadores where origem = 'diario'), 990);
select teste.igual('aproveitamento 82,5%', (select round(aproveitamento * 100, 1) from public.ops_indicadores where origem = 'diario'), 82.5);
select teste.igual('retrabalho', (select retrabalho from public.ops_indicadores where origem = 'diario'), 7);
select teste.igual('vazias', (select vazias from public.ops_indicadores where origem = 'diario'), 203);
select teste.igual('filme perdido 7,37 kg', (select round(filme_perdido_kg, 2) from public.ops_indicadores where origem = 'diario'), 7.37);
select teste.igual('filme de fundo perdido 5,90 kg', (select round(filme_fundo_perdido_kg, 2) from public.ops_indicadores where origem = 'diario'), 5.90);
select teste.igual('filme de tampa perdido 1,48 kg', (select round(filme_tampa_perdido_kg, 2) from public.ops_indicadores where origem = 'diario'), 1.48);
select teste.igual('filme 68 g/kg', (select round(filme_g_por_kg) from public.ops_indicadores where origem = 'diario'), 68::numeric);
select teste.igual('248 kg/h', (select round(produtividade_kg_h) from public.ops_indicadores where origem = 'diario'), 248::numeric);
select teste.igual('4,0 ciclos/min', (select round(ciclos_por_minuto, 1) from public.ops_indicadores where origem = 'diario'), 4.0);
select teste.igual('peso médio 626 g', (select round(peso_medio_kg * 1000) from public.ops_indicadores where origem = 'diario'), 626::numeric);
select teste.igual('sobrepeso 4,4%', (select round(sobrepeso * 100, 1) from public.ops_indicadores where origem = 'diario'), 4.4);
select teste.igual('minutos parados', (select minutos_parados from public.ops_indicadores where origem = 'diario'), 20);
select teste.igual('parâmetros alterados', (select parametros_alterados from public.ops_indicadores where origem = 'diario'), array['t2','sp']);
select teste.igual('nº de fotos', (select fotos from public.ops_indicadores where origem = 'diario'), 1);

\echo 'Operador: nova edição com parada removida e foto nova'
select teste.igual('edição mais nova entra', public.salvar_op(teste.op(teste.t(5), jsonb_build_object(
  'paradas', jsonb_build_array(jsonb_build_object('id', 'bbbbbbbb-0000-4000-8000-000000000002', 'motivo', 'Ajuste de parâmetro', 'minutos', 9)),
  'paradas_removidas', jsonb_build_array('bbbbbbbb-0000-4000-8000-000000000001'),
  'fotos', jsonb_build_array(jsonb_build_object('id', 'cccccccc-0000-4000-8000-000000000002', 'tipo', 'produto',
    'caminho', 'aaaaaaaa-0000-4000-8000-000000000001/cccccccc-0000-4000-8000-000000000002.jpg'))
))) ->> 'resultado', 'gravada');
select teste.igual('parada removida saiu', (select count(*) from public.op_paradas), 1::bigint);
select teste.igual('parada alterada', (select minutos from public.op_paradas), 9);
select teste.igual('foto que não veio no envio continua lá (fotos se somam)', (select count(*) from public.op_fotos), 2::bigint);

\echo 'Avaliação da foto do produto pela IA'
select teste.igual('OP sem avaliação tem nota nula na view', (select nota_aparencia_ia from public.ops_indicadores where origem = 'diario'), null::numeric);
select teste.igual('avaliação entra junto com a OP', public.salvar_op(teste.op(teste.t(6), jsonb_build_object(
  'paradas', '[]'::jsonb, 'fotos', '[]'::jsonb,
  'analise_ia', jsonb_build_object('em', teste.t(6), 'nota_aparencia', 7.5, 'diagnostico', 'Filme bem aderido; ruga leve num canto.',
    'defeitos', jsonb_build_array(jsonb_build_object('tipo', 'ruga', 'gravidade', 'leve', 'descricao', 'canto inferior')),
    'sugestoes', '[]'::jsonb, 'confianca', 'media', 'limitacoes', '', 'fotos', jsonb_build_array('cccccccc-0000-4000-8000-000000000002'))
))) ->> 'resultado', 'gravada');
select teste.igual('nota da IA na view', (select nota_aparencia_ia from public.ops_indicadores where origem = 'diario'), 7.5);
select teste.igual('diagnóstico guardado na OP', (select analise_ia ->> 'confianca' from public.ops where origem = 'diario'), 'media');
select teste.igual('avaliação que não é objeto é descartada', public.salvar_op(teste.op(teste.t(7), jsonb_build_object(
  'paradas', '[]'::jsonb, 'fotos', '[]'::jsonb, 'analise_ia', '"texto solto"'::jsonb))) ->> 'resultado', 'gravada');
select teste.igual('nota volta a ser nula', (select nota_aparencia_ia from public.ops_indicadores where origem = 'diario'), null::numeric);

select teste.igual('operador encerra a OP', public.salvar_op(teste.op(teste.t(10), '{"status":"fechada"}')) ->> 'resultado', 'gravada');
select teste.igual('status fechada', (select status from public.ops where origem = 'diario'), 'fechada');
select teste.igual('fechada_em preenchido', (select fechada_em is not null from public.ops where origem = 'diario'), true);

\echo 'Critério 5: operador não altera OP fechada'
select teste.erro('salvar_op em OP fechada', $$select public.salvar_op(teste.op(teste.t(15), '{"caixas": 1, "status": "fechada"}'))$$, '42501');
select teste.erro('reabrir OP fechada', $$select public.salvar_op(teste.op(teste.t(16), '{"status": "aberta"}'))$$, '42501');
update public.ops set caixas = 1 where id = 'aaaaaaaa-0000-4000-8000-000000000001';
select teste.igual('update direto não muda nada', (select caixas from public.ops where id = 'aaaaaaaa-0000-4000-8000-000000000001'), 110);
select teste.erro('parada em OP fechada', $$insert into public.op_paradas (op_id, motivo, minutos) values ('aaaaaaaa-0000-4000-8000-000000000001', 'Outro', 5)$$, '42501');
select teste.erro('foto em OP fechada', $$insert into public.op_fotos (op_id, tipo, caminho) values ('aaaaaaaa-0000-4000-8000-000000000001', 'tela', 'x.jpg')$$, '42501');
update public.op_retrabalho set quantidade = 99 where op_id = 'aaaaaaaa-0000-4000-8000-000000000001';
select teste.igual('retrabalho de OP fechada não muda', (select max(quantidade) from public.op_retrabalho), 5);
select teste.erro('apagar OP', $$delete from public.ops where id = 'aaaaaaaa-0000-4000-8000-000000000001'$$, '42501');
select teste.erro('operador não altera o histórico da planilha', $$select public.salvar_op(jsonb_build_object('id', '00000000-0000-4000-8000-000000000009', 'origem', 'planilha', 'status', 'fechada', 'produto_descricao', 'X', 'molde', '3x1', 'alterado_em', teste.t(20)))$$, '42501');
select teste.erro('operador não cancela', $$select public.salvar_op(teste.op(teste.t(17), '{"status": "cancelada"}'))$$, '42501');
select teste.erro('operador não cria OP de origem planilha', $$select public.salvar_op(teste.op(teste.t(18), '{"id": "aaaaaaaa-0000-4000-8000-000000000009", "origem": "planilha", "paradas": [], "fotos": []}'))$$, '42501');
update public.produtos set embalagens_por_caixa = 6 where codigo = '24616701063781-975';
select teste.igual('operador não altera o catálogo', (select embalagens_por_caixa from public.produtos where codigo = '24616701063781-975'), 15);
select teste.erro('operador não inclui receita padrão', $$insert into public.receitas_padrao (t_dome) values (200)$$, '42501');
update public.perfis set papel = 'admin' where id = '33333333-3333-4333-8333-333333333333';
select teste.igual('operador não se promove', (select papel from public.perfis where id = '33333333-3333-4333-8333-333333333333'), 'operador');

\echo 'Critério 4: OP criada e encerrada sem conexão chega inteira numa chamada'
select teste.igual('OP já fechada, com parada e foto', public.salvar_op(teste.op(teste.t(30), jsonb_build_object(
  'id', 'aaaaaaaa-0000-4000-8000-000000000002', 'status', 'fechada', 'fechada_em', teste.t(29),
  'paradas', jsonb_build_array(jsonb_build_object('id', 'bbbbbbbb-0000-4000-8000-000000000009', 'motivo', 'Outro', 'minutos', 6)),
  'fotos', jsonb_build_array(jsonb_build_object('id', 'cccccccc-0000-4000-8000-000000000009', 'tipo', 'produto',
    'caminho', 'aaaaaaaa-0000-4000-8000-000000000002/cccccccc-0000-4000-8000-000000000009.jpg'))
))) ->> 'resultado', 'gravada');
select teste.igual('chegou fechada', (select status from public.ops where id = 'aaaaaaaa-0000-4000-8000-000000000002'), 'fechada');
select teste.igual('com a hora de encerramento do aparelho', (select fechada_em from public.ops where id = 'aaaaaaaa-0000-4000-8000-000000000002'), teste.t(29)::timestamptz);
select teste.igual('com a parada', (select count(*) from public.op_paradas where op_id = 'aaaaaaaa-0000-4000-8000-000000000002'), 1::bigint);
select teste.igual('com a foto', (select count(*) from public.op_fotos where op_id = 'aaaaaaaa-0000-4000-8000-000000000002'), 1::bigint);
select teste.igual('com o retrabalho', (select count(*) from public.op_retrabalho where op_id = 'aaaaaaaa-0000-4000-8000-000000000002'), 7::bigint);
select teste.igual('reenvio depois de resposta perdida não dá erro', public.salvar_op(teste.op(teste.t(30), '{"id": "aaaaaaaa-0000-4000-8000-000000000002", "status": "fechada"}')) ->> 'resultado', 'igual');

\echo 'Armazenamento de fotos'
insert into storage.objects (bucket_id, name) values ('fotos-op', 'aaaaaaaa-0000-4000-8000-000000000001/cccccccc-0000-4000-8000-000000000001.jpg');
select teste.igual('operador envia e vê a foto', (select count(*) from storage.objects), 1::bigint);
delete from storage.objects;
select teste.igual('operador não apaga arquivo', (select count(*) from storage.objects), 1::bigint);

-- ------------------------------------------------------------------ P&D
\echo 'Critério 5: P&D altera OP fechada e histórico'
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', false);
select teste.igual('P&D corrige OP fechada', public.salvar_op(teste.op(teste.t(40), '{"status": "fechada", "caixas": 111}')) ->> 'resultado', 'gravada');
select teste.igual('correção entrou', (select caixas from public.ops where id = 'aaaaaaaa-0000-4000-8000-000000000001'), 111);
select teste.igual('continua fechada', (select status from public.ops where id = 'aaaaaaaa-0000-4000-8000-000000000001'), 'fechada');
select teste.igual('alterado_por é o P&D', (select alterado_por from public.ops where id = 'aaaaaaaa-0000-4000-8000-000000000001'), '22222222-2222-4222-8222-222222222222'::uuid);
select teste.igual('criado_por continua o operador', (select criado_por from public.ops where id = 'aaaaaaaa-0000-4000-8000-000000000001'), '33333333-3333-4333-8333-333333333333'::uuid);
select teste.igual('P&D corrige o molde da lagosta do histórico', public.salvar_op(
  (select to_jsonb(o) from public.ops o where o.id = '00000000-0000-4000-8000-000000000009')
  || jsonb_build_object('molde', '3x1', 'alterado_em', teste.t(41))) ->> 'resultado', 'gravada');
select teste.igual('molde corrigido', (select molde from public.ops where id = '00000000-0000-4000-8000-000000000009'), '3x1');
select teste.igual('origem continua planilha', (select origem from public.ops where id = '00000000-0000-4000-8000-000000000009'), 'planilha');
select teste.igual('status do histórico continua fechada', (select status from public.ops where id = '00000000-0000-4000-8000-000000000009'), 'fechada');
select teste.erro('P&D não cancela OP', $$select public.salvar_op(teste.op(teste.t(42), '{"status": "cancelada"}'))$$, '42501');
update public.moldes set filme_tampa_kg_bdj = 1 where molde = '2x1';
select teste.igual('P&D não altera pesos de filme', (select filme_tampa_kg_bdj from public.moldes where molde = '2x1'), 0.0070249);
delete from storage.objects;
select teste.igual('P&D apaga arquivo de foto', (select count(*) from storage.objects), 0::bigint);

-- ------------------------------------------------------------------ administrador
\echo 'Administrador: cancela, cadastros e usuários'
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
select teste.igual('admin cancela a OP', public.salvar_op(teste.op(teste.t(50), '{"status": "cancelada", "caixas": 111}')) ->> 'resultado', 'gravada');
select teste.igual('status cancelada', (select status from public.ops where id = 'aaaaaaaa-0000-4000-8000-000000000001'), 'cancelada');
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', false);
select teste.erro('P&D não mexe em OP cancelada', $$select public.salvar_op(teste.op(teste.t(51), '{"status": "fechada"}'))$$, '42501');
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
select teste.igual('admin restaura a OP', public.salvar_op(teste.op(teste.t(52), '{"status": "fechada", "caixas": 110}')) ->> 'resultado', 'gravada');
select teste.igual('status fechada de novo', (select status from public.ops where id = 'aaaaaaaa-0000-4000-8000-000000000001'), 'fechada');

update public.produtos set embalagens_por_caixa = 9 where codigo = '24616701063781-975';
select teste.igual('admin altera o catálogo', (select embalagens_por_caixa from public.produtos where codigo = '24616701063781-975'), 9);
insert into public.produtos (codigo, descricao, molde) values ('99999999999999-001', 'PRODUTO NOVO SKIN', '3x1');
select teste.igual('admin inclui produto', (select count(*) from public.produtos), 119::bigint);
update public.moldes set filme_tampa_kg_bdj = 0.0070250 where molde = '2x1';
select teste.igual('admin altera peso de filme', (select filme_tampa_kg_bdj from public.moldes where molde = '2x1'), 0.0070250);
insert into public.receitas_padrao (vigente_desde, t_dome, t_pre, t1, t2, t4, t5, t6, t7, p_vent, sp, tx, tmax)
  values ('2026-11-13 00:00:00-03', 225, 110, 0.8, 1.2, 0, 0, 4.0, 0.2, 500, 40, 0.5, 10);
select teste.igual('admin inclui receita padrão', (select count(*) from public.receitas_padrao), 2::bigint);
select teste.igual('OP de antes da receita nova compara com a antiga', (select parametros_alterados from public.ops_indicadores where id = 'aaaaaaaa-0000-4000-8000-000000000001'), array['t2','sp']);
select teste.igual('OP de depois compara com a nova', public.salvar_op(teste.op(teste.t(60), '{"id": "aaaaaaaa-0000-4000-8000-000000000003", "data": "2026-11-14", "paradas": [], "fotos": []}')) ->> 'resultado', 'gravada');
select teste.igual('só sp difere da receita nova', (select parametros_alterados from public.ops_indicadores where id = 'aaaaaaaa-0000-4000-8000-000000000003'), array['sp']);

update public.perfis set ativo = true, papel = 'pd' where id = '44444444-4444-4444-8444-444444444444';
select teste.igual('admin libera usuário e muda o papel', (select papel from public.perfis where id = '44444444-4444-4444-8444-444444444444'), 'pd');
update public.perfis set ativo = false, papel = 'operador' where id = '44444444-4444-4444-8444-444444444444';
select teste.erro('não fica sem administrador ativo', $$update public.perfis set papel = 'pd' where id = '11111111-1111-4111-8111-111111111111'$$, '23514');
select teste.erro('nem desativando o último admin', $$update public.perfis set ativo = false where id = '11111111-1111-4111-8111-111111111111'$$, '23514');

-- ------------------------------------------------------------------ histórico de alterações
\echo 'Histórico de alterações'
reset role;
create function teste.h(extra jsonb, minuto integer) returns jsonb language sql as $$
  select public.salvar_op(teste.op(teste.t(minuto),
    '{"id": "aaaaaaaa-0000-4000-8000-0000000000a1", "paradas": [], "fotos": [], "retrabalho": {"sem_vacuo": 5, "furo": 3}}'::jsonb || extra))
$$;
create function teste.ultimo() returns public.ops_historico language sql as $$
  select h from public.ops_historico h where h.op_id = 'aaaaaaaa-0000-4000-8000-0000000000a1' order by h.id desc limit 1
$$;
create function teste.registros() returns bigint language sql as $$
  select count(*) from public.ops_historico h where h.op_id = 'aaaaaaaa-0000-4000-8000-0000000000a1'
$$;
set role authenticated;
select set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', false);

select teste.igual('operador cria a OP', teste.h('{"caixas": 100, "retrabalho": {"sem_vacuo": 5, "furo": 2, "ruga": 0}}', 80) ->> 'resultado', 'gravada');
select teste.igual('criação: um registro só', teste.registros(), 1::bigint);
select teste.igual('marcado como criação', (teste.ultimo()).criou, true);
select teste.igual('registra quem criou', (teste.ultimo()).por, '33333333-3333-4333-8333-333333333333'::uuid);
select teste.igual('retrabalho lançado na criação entra no mesmo registro', (teste.ultimo()).mudancas -> 'retrabalho.sem_vacuo', '{"de": 0, "para": 5}'::jsonb);
select teste.igual('motivo zerado não aparece', (teste.ultimo()).mudancas ? 'retrabalho.ruga', false);

select teste.igual('operador altera caixas e conta mais um furo', teste.h('{"caixas": 105}', 81) ->> 'resultado', 'gravada');
select teste.igual('OP aberta, mesma pessoa: junta no mesmo registro', teste.registros(), 1::bigint);
select teste.igual('guarda de quanto para quanto', (teste.ultimo()).mudancas -> 'caixas', '{"de": 100, "para": 105}'::jsonb);
select teste.igual('no retrabalho fica o valor de antes do registro', (teste.ultimo()).mudancas -> 'retrabalho.furo', '{"de": 0, "para": 3}'::jsonb);
select teste.igual('operador volta as caixas ao valor de antes', teste.h('{"caixas": 100}', 82) ->> 'resultado', 'gravada');
select teste.igual('o que voltou ao valor de antes sai do registro', (teste.ultimo()).mudancas ? 'caixas', false);

select teste.igual('operador encerra', teste.h('{"caixas": 110, "status": "fechada"}', 83) ->> 'resultado', 'gravada');
select teste.igual('encerrar abre um registro novo', teste.registros(), 2::bigint);
select teste.igual('o registro do encerramento traz só a mudança de status', (teste.ultimo()).mudancas, '{"status": {"de": "aberta", "para": "fechada"}}'::jsonb);
select teste.igual('o que foi digitado antes de encerrar fica no registro da OP aberta',
  (select h.mudancas -> 'caixas' from public.ops_historico h where h.op_id = 'aaaaaaaa-0000-4000-8000-0000000000a1' order by h.id limit 1),
  '{"de": 100, "para": 110}'::jsonb);

select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', false);
select teste.igual('P&D corrige a OP encerrada', teste.h('{"caixas": 111, "status": "fechada"}', 84) ->> 'resultado', 'gravada');
select teste.igual('correção em OP encerrada: registro próprio', teste.registros(), 3::bigint);
select teste.igual('só o que mudou de verdade (o status não entra)', (teste.ultimo()).mudancas, '{"caixas": {"de": 110, "para": 111}}'::jsonb);
select teste.igual('registra quem corrigiu', (teste.ultimo()).por, '22222222-2222-4222-8222-222222222222'::uuid);
select teste.igual('P&D corrige de novo', teste.h('{"caixas": 112, "status": "fechada"}', 85) ->> 'resultado', 'gravada');
select teste.igual('OP encerrada: cada gravação é um registro', teste.registros(), 4::bigint);
select teste.igual('gravar de novo sem mudar nada', teste.h('{"caixas": 112, "status": "fechada"}', 86) ->> 'resultado', 'gravada');
select teste.igual('não cria registro', teste.registros(), 4::bigint);

select teste.igual('P&D inclui uma parada', teste.h('{"caixas": 112, "status": "fechada", "paradas": [{"id": "bbbbbbbb-0000-4000-8000-0000000000a1", "motivo": "Outro", "minutos": 9}]}', 87) ->> 'resultado', 'gravada');
select teste.igual('parada incluída fica registrada', (teste.ultimo()).mudancas, '{"parada.bbbbbbbb-0000-4000-8000-0000000000a1": {"de": null, "para": "9 min · Outro"}}'::jsonb);
select teste.igual('P&D remove a parada', teste.h('{"caixas": 112, "status": "fechada", "paradas_removidas": ["bbbbbbbb-0000-4000-8000-0000000000a1"]}', 88) ->> 'resultado', 'gravada');
select teste.igual('parada removida fica registrada', (teste.ultimo()).mudancas, '{"parada.bbbbbbbb-0000-4000-8000-0000000000a1": {"de": "9 min · Outro", "para": null}}'::jsonb);
select teste.igual('P&D inclui foto e avaliação da IA', teste.h('{"caixas": 112, "status": "fechada",
  "fotos": [{"id": "cccccccc-0000-4000-8000-0000000000a1", "tipo": "produto", "caminho": "a1/c.jpg"}],
  "analise_ia": {"em": "2026-11-13T12:00:00Z", "nota_aparencia": 8, "diagnostico": "texto longo que não vai para o histórico"}}', 89) ->> 'resultado', 'gravada');
select teste.igual('foto incluída fica registrada', (teste.ultimo()).mudancas -> 'foto.cccccccc-0000-4000-8000-0000000000a1', '{"de": null, "para": "produto"}'::jsonb);
select teste.igual('da avaliação da IA ficam a nota e a data', (teste.ultimo()).mudancas -> 'analise_ia', '{"de": null, "para": {"nota": 8, "em": "2026-11-13T12:00:00Z"}}'::jsonb);

select teste.igual('a correção da primeira OP de teste também ficou registrada',
  (select h.mudancas from public.ops_historico h where h.op_id = 'aaaaaaaa-0000-4000-8000-000000000001' and h.por = '22222222-2222-4222-8222-222222222222' order by h.id limit 1),
  '{"caixas": {"de": 110, "para": 111}}'::jsonb);
select teste.igual('correção do P&D no histórico da planilha fica registrada',
  (select h.mudancas -> 'molde' from public.ops_historico h where h.op_id = '00000000-0000-4000-8000-000000000009' order by h.id limit 1),
  '{"de": "2x1", "para": "3x1"}'::jsonb);
select teste.igual('a carga da planilha não conta como criação',
  (select count(*) from public.ops_historico h join public.ops o on o.id = h.op_id where o.origem = 'planilha' and h.criou), 0::bigint);

select teste.erro('usuário não escreve no histórico', $$insert into public.ops_historico (op_id) values ('aaaaaaaa-0000-4000-8000-0000000000a1')$$, '42501');
select teste.erro('nem altera', $$update public.ops_historico set mudancas = '{}'$$, '42501');
select teste.erro('nem apaga', $$delete from public.ops_historico$$, '42501');
select teste.erro('nem chama a função de registro', $$select public.historico_registrar('aaaaaaaa-0000-4000-8000-0000000000a1', '{"caixas": {"de": 1, "para": 2}}', false, false)$$, '42501');

-- ------------------------------------------------------------------ gestor
\echo 'Gestor: só consulta'
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
update public.perfis set papel = 'gestor', ativo = true where id = '44444444-4444-4444-8444-444444444444';
select teste.igual('admin define o perfil gestor', (select papel from public.perfis where id = '44444444-4444-4444-8444-444444444444'), 'gestor');
select teste.erro('perfil que não existe é recusado', $$update public.perfis set papel = 'chefe' where id = '44444444-4444-4444-8444-444444444444'$$, '23514');
select set_config('request.jwt.claim.sub', '44444444-4444-4444-8444-444444444444', false);
select teste.igual('gestor lê as OPs', (select count(*) >= 18 from public.ops), true);
select teste.igual('gestor lê a view de indicadores', (select count(*) >= 18 from public.ops_indicadores), true);
select teste.igual('gestor lê o histórico de alterações', teste.registros() >= 7, true);
select teste.igual('gestor lê o catálogo', (select count(*) from public.produtos), 119::bigint);
select teste.erro('gestor não cria OP', $$select public.salvar_op(teste.op(teste.t(95), '{"id": "aaaaaaaa-0000-4000-8000-0000000000a2", "paradas": [], "fotos": []}'))$$, '42501');
select teste.erro('gestor não altera OP', $$select teste.h('{"caixas": 1, "status": "fechada"}', 96)$$, '42501');
select teste.erro('gestor não inclui parada', $$insert into public.op_paradas (op_id, motivo, minutos) values ('aaaaaaaa-0000-4000-8000-0000000000a1', 'Outro', 5)$$, '42501');
select teste.erro('gestor não envia foto', $$insert into storage.objects (bucket_id, name) values ('fotos-op', 'a1/g.jpg')$$, '42501');
update public.produtos set embalagens_por_caixa = 1 where codigo = '24616701063781-975';
select teste.igual('gestor não altera o catálogo', (select embalagens_por_caixa from public.produtos where codigo = '24616701063781-975'), 9);
update public.perfis set papel = 'admin' where id = '44444444-4444-4444-8444-444444444444';
select teste.igual('gestor não muda o próprio perfil', (select papel from public.perfis where id = '44444444-4444-4444-8444-444444444444'), 'gestor');
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
update public.perfis set ativo = false, papel = 'operador' where id = '44444444-4444-4444-8444-444444444444';

-- ------------------------------------------------------------------ inativo e sem login
\echo 'Usuário inativo e sem login'
select set_config('request.jwt.claim.sub', '44444444-4444-4444-8444-444444444444', false);
select teste.igual('inativo não lê OPs', (select count(*) from public.ops), 0::bigint);
select teste.igual('inativo não lê o catálogo', (select count(*) from public.produtos), 0::bigint);
select teste.igual('inativo não lê a view', (select count(*) from public.ops_indicadores), 0::bigint);
select teste.igual('inativo não lê o histórico de alterações', (select count(*) from public.ops_historico), 0::bigint);
select teste.igual('inativo vê só o próprio perfil', (select count(*) from public.perfis), 1::bigint);
select teste.erro('inativo não grava OP', $$select public.salvar_op(teste.op(teste.t(70), '{"id": "aaaaaaaa-0000-4000-8000-000000000008", "paradas": [], "fotos": []}'))$$, '42501');
select teste.erro('inativo não envia foto', $$insert into storage.objects (bucket_id, name) values ('fotos-op', 'x/y.jpg')$$, '42501');

reset role;
set role anon;
select set_config('request.jwt.claim.sub', '', false);
select teste.erro('sem login não lê OPs', $$select count(*) from public.ops$$, '42501');
select teste.erro('sem login não lê a view', $$select count(*) from public.ops_indicadores$$, '42501');
select teste.erro('sem login não chama salvar_op', $$select public.salvar_op('{}'::jsonb)$$, '42501');
reset role;

\echo 'Carga repetida não duplica nem desfaz correções'
