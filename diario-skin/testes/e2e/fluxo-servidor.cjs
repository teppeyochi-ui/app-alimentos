#!/usr/bin/env node
/*
 * Teste de navegador integrado: o aplicativo (com login) contra um PostgreSQL
 * temporário com as migrações reais. Cobre os critérios de aceite 4 e 5:
 *   4. lançar em modo avião e sincronizar ao voltar a conexão, sem duplicar;
 *   5. operador não altera OP fechada; P&D altera.
 *
 *   node testes/e2e/fluxo-servidor.cjs
 *
 * Precisa do PostgreSQL 15+ instalado. Gera um build próprio, apontando para a
 * API de teste, numa pasta temporária (não mexe em dist/).
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { playwright, RAIZ, CAPTURAS, servirPasta, verificar, totalFalhas, fotoDeTeste } = require('./apoio.cjs');
const { subirBanco, subirApi, USUARIOS, SENHA } = require('./servidor-banco.cjs');

const PORTA_API = 54329;
const [ADMIN, PD, OPERADOR, NOVO] = USUARIOS;

(async () => {
  fs.mkdirSync(CAPTURAS, { recursive: true });
  console.log('Preparando: banco temporário, API de teste e build do aplicativo');
  const banco = subirBanco();
  const { servidor: api, chamadas, cortarRede } = await subirApi(banco, PORTA_API);
  // DEPURAR=1 mostra cada pedido que chega à API de teste.
  if (process.env.DEPURAR) api.on('request', (req) => { if (req.method !== 'OPTIONS') console.log('      API ←', req.method, req.url.split('?')[0]); });
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'diario-skin-build-'));
  execFileSync(process.execPath, [path.join(RAIZ, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', pasta, '--emptyOutDir', '--logLevel', 'error'], {
    cwd: RAIZ,
    env: { ...process.env, VITE_SUPABASE_URL: `http://127.0.0.1:${PORTA_API}`, VITE_SUPABASE_ANON_KEY: 'chave-anon-de-teste' },
    stdio: 'inherit',
  });
  const site = await servirPasta(pasta);
  const base = `http://127.0.0.1:${site.address().port}/`;
  const nav = await playwright.chromium.launch();
  const erros = [];

  async function abrir(opcoes) {
    const ctx = await nav.newContext({ locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', ...opcoes });
    const p = await ctx.newPage();
    p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_INTERNET_DISCONNECTED|net::ERR/.test(m.text())) erros.push(m.text()); });
    p.on('pageerror', (e) => erros.push('erro de página: ' + e.message));
    await p.goto(base);
    return { ctx, p };
  }
  async function entrar(p, usuario) {
    await p.getByRole('heading', { name: 'Entrar', exact: true }).waitFor();
    await p.getByLabel('E-mail').fill(usuario.email);
    await p.getByLabel('Senha').fill(SENHA);
    await p.getByRole('button', { name: 'Entrar', exact: true }).click();
  }
  // O reenvio automático espera um pouco mais a cada tentativa (10 s, 20 s…).
  const sincronizado = (p) => p.locator('.estado.ok', { hasText: 'Sincronizado' }).waitFor({ timeout: 45000 });
  const campo = (p, rotulo) => p.getByLabel(rotulo, { exact: true });
  const um = (consulta) => banco.sql(consulta);

  try {
    // ------------------------------------------------------------------ operador, no celular
    console.log('Operador entra e recebe os cadastros do servidor');
    const cel = await abrir({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    const p = cel.p;
    await entrar(p, OPERADOR);
    await p.getByRole('heading', { name: 'OPs em andamento' }).waitFor();
    await sincronizado(p);
    verificar(await p.locator('.abas a').count() === 2, 'operador não vê a aba Administração');
    await p.evaluate(() => navigator.serviceWorker.ready);

    await p.getByRole('button', { name: 'Nova OP' }).click();
    await p.getByRole('button', { name: /^Produto/ }).click();
    await campo(p, 'Buscar por código ou nome').fill('24616701063781-975');
    verificar(await p.locator('.lista-produtos button').count() === 2, 'catálogo veio do servidor (busca acha o salmão 600 g)');
    await p.locator('.lista-produtos button').first().click();
    await campo(p, 'OP').fill('20109999');
    await campo(p, 'Embalagens por caixa').fill('9');
    await campo(p, 'Hora de início').fill('08:00');
    await p.getByLabel('Adicionar foto da tela').setInputFiles([await fotoDeTeste(p, 'tela 417')]);
    await p.locator('.ph img').first().waitFor();
    await p.locator('.actions .stat.ok', { hasText: 'Sincronizado' }).waitFor({ timeout: 20000 });
    verificar(um("select count(*) from public.ops where origem = 'diario'") === '1', 'OP nova chegou ao servidor sozinha (salvamento automático)');
    verificar(um("select criado_por from public.ops where origem = 'diario'") === OPERADOR.id, 'servidor registrou quem criou');
    verificar(um('select count(*) from storage.objects') === '1', 'foto enviada para o armazenamento');
    await p.screenshot({ path: path.join(CAPTURAS, '9-sincronizado.png') });

    // ------------------------------------------------------------------ critério 4
    console.log('Sinal ruim: conectado, mas o servidor não responde');
    cortarRede(true);
    await campo(p, 'Lote da matéria-prima').fill('L-123');
    await p.locator('.estado.off', { hasText: 'Sem conexão' }).waitFor({ timeout: 15000 });
    verificar(true, 'envio falhou: o aplicativo mostra "Sem conexão" e guarda no aparelho');
    cortarRede(false);
    await sincronizado(p);
    verificar(um("select lote_mp from public.ops where origem = 'diario'") === 'L-123', 'quando o servidor volta, reenvia sozinho (sem tocar em nada)');

    console.log('Critério 4: modo avião no meio do lançamento');
    // Modo avião no navegador e, para valer mesmo, o servidor de teste derruba as conexões.
    await cel.ctx.setOffline(true);
    cortarRede(true);
    for (let i = 0; i < 5; i++) await p.getByRole('button', { name: 'Mais um: Sem vácuo' }).tap();
    for (let i = 0; i < 2; i++) await p.getByRole('button', { name: 'Mais um: Filme furado' }).tap();
    await campo(p, 'Minutos').fill('12');
    await p.getByRole('button', { name: 'Adicionar', exact: true }).click();
    await p.getByLabel('Adicionar foto da tela').setInputFiles([await fotoDeTeste(p, 'tela 414')]);
    await p.getByLabel('Adicionar foto do produto final').setInputFiles([await fotoDeTeste(p, 'produto')]);
    await p.locator('.ph img').nth(2).waitFor();
    await campo(p, 'Hora de fim').fill('10:30');
    await campo(p, 'Passo no fim').fill('600');
    await campo(p, 'Caixas de produto acabado').fill('110');
    await campo(p, 'Peso final (kg)').fill('620');
    await p.locator('.actions .stat', { hasText: 'sem conexão' }).waitFor({ timeout: 15000 });
    verificar(true, 'sem internet: o aplicativo mostra "Salvo no aparelho · sem conexão"');
    await p.screenshot({ path: path.join(CAPTURAS, '10-sem-conexao.png') });
    await p.getByRole('button', { name: 'Encerrar OP' }).click();
    await p.getByRole('button', { name: 'Encerrar OP' }).last().click();
    await p.getByText('OP encerrada.', { exact: true }).waitFor();

    // Segunda OP criada e encerrada inteira sem internet.
    await p.getByRole('button', { name: 'Nova OP' }).click();
    await p.getByRole('button', { name: /^Produto/ }).click();
    await campo(p, 'Buscar por código ou nome').fill('16507014073621-011');
    await p.locator('.lista-produtos button').first().click();
    await campo(p, 'Embalagens por caixa').fill('20');
    await campo(p, 'Hora de início').fill('11:00');
    await campo(p, 'Hora de fim').fill('12:00');
    await campo(p, 'Passo no fim').fill('200');
    await campo(p, 'Caixas de produto acabado').fill('25');
    await campo(p, 'Peso final (kg)').fill('102');
    await p.getByRole('button', { name: 'Encerrar OP' }).click();
    await p.getByRole('button', { name: 'Encerrar OP' }).last().click();
    await p.getByText('OP encerrada.', { exact: true }).first().waitFor();

    // Fecha e reabre o aplicativo sem internet.
    await p.reload();
    await p.getByRole('heading', { name: 'OPs em andamento' }).waitFor();
    verificar(await p.locator('.estado', { hasText: /Sem conexão · \d+ a enviar/ }).count() === 1, 'reaberto sem internet: mostra o que falta enviar');
    const noServidor = um("select count(*) || ' OP(s), ' || string_agg(status || ' com ' || coalesce(caixas::text, 'sem') || ' caixas', '; ') from public.ops where origem = 'diario'");
    verificar(noServidor === '1 OP(s), aberta com sem caixas', `enquanto isso, o servidor continua com a versão antiga (${noServidor})`);

    console.log('Critério 4: a conexão volta');
    cortarRede(false);
    await cel.ctx.setOffline(false);
    await sincronizado(p);
    const id1 = um("select id from public.ops where op = '20109999'");
    verificar(um("select count(*) from public.ops where origem = 'diario'") === '2', 'duas OPs no servidor, sem duplicar');
    verificar(um(`select status from public.ops where id = '${id1}'`) === 'fechada', 'OP encerrada offline chegou fechada');
    verificar(um(`select count(*) from public.op_retrabalho where op_id = '${id1}'`) === '7', '7 linhas de retrabalho (uma por motivo)');
    verificar(um(`select string_agg(quantidade::text, ',' order by motivo) from public.op_retrabalho where op_id = '${id1}' and quantidade > 0`) === '2,5', 'contagens: 2 furo, 5 sem vácuo');
    verificar(um(`select count(*) from public.op_paradas where op_id = '${id1}'`) === '1', '1 parada');
    verificar(um(`select count(*) from public.op_fotos where op_id = '${id1}'`) === '3', '3 registros de foto');
    verificar(um(`select count(*) from storage.objects where name like '${id1}/%'`) === '3', '3 arquivos de foto, um de cada');
    verificar(
      um(`select bandejas_formadas || '/' || embalagens_boas || '/' || round(aproveitamento * 100, 1) || '/' || retrabalho || '/' || vazias from public.ops_indicadores where id = '${id1}'`) === '1200/990/82.5/7/203',
      'view ops_indicadores: 1.200 formadas, 990 boas, 82,5%, 7 de retrabalho, 203 vazias',
    );
    verificar(um("select status || '/' || caixas from public.ops where produto_codigo = '16507014073621-011'") === 'fechada/25', 'a OP criada e encerrada offline também chegou');
    const antes = { ...chamadas };
    await p.getByRole('button', { name: /Abrir menu/ }).click();
    await p.getByRole('button', { name: 'Sincronizar agora' }).click();
    await p.locator('dialog[open]').getByText('Sincronizado').first().waitFor();
    await p.locator('dialog[open]').getByRole('button', { name: 'Fechar' }).click();
    verificar(chamadas.salvar_op === antes.salvar_op && chamadas.fotos === antes.fotos, 'sincronizar de novo não reenvia nada');

    // ------------------------------------------------------------------ critério 5
    console.log('Critério 5: operador não altera OP fechada');
    await p.goto(base + '#lancar/' + id1);
    await p.getByText('OP encerrada. Só o P&D pode alterar os dados.').waitFor();
    verificar(await campo(p, 'Caixas de produto acabado').isDisabled(), 'campos bloqueados para o operador');
    verificar(await p.getByRole('button', { name: 'Mais um: Sem vácuo' }).isDisabled(), 'contadores bloqueados');
    verificar(await p.getByRole('button', { name: 'Salvar' }).count() === 0, 'sem botão Salvar');
    await p.screenshot({ path: path.join(CAPTURAS, '11-op-fechada-operador.png') });

    console.log('Critério 5: P&D altera OP fechada (no computador)');
    const pc = await abrir({ viewport: { width: 1280, height: 900 } });
    await entrar(pc.p, PD);
    await pc.p.getByRole('heading', { name: 'OPs em andamento' }).waitFor();
    await sincronizado(pc.p);
    await pc.p.goto(base + '#painel');
    await pc.p.getByRole('heading', { name: 'OPs registradas' }).waitFor();
    verificar((await pc.p.locator('.kpi', { has: pc.p.locator('.l', { hasText: /^OPs$/ }) }).innerText()).includes('17'), 'P&D vê 17 OPs: 15 do histórico + 2 do diário');
    await pc.p.screenshot({ path: path.join(CAPTURAS, '12-painel-computador.png') });
    await pc.p.locator('tr.clicavel', { hasText: '20109999' }).click();
    verificar((await pc.p.locator('dialog[open] .dl').innerText()).includes('Olga Operadora'), 'detalhe mostra quem registrou');
    verificar(await pc.p.locator('dialog[open] .ph').count() === 3, 'detalhe mostra as 3 fotos');
    await pc.p.locator('dialog[open]').getByRole('button', { name: 'Abrir no lançamento' }).click();
    await campo(pc.p, 'Caixas de produto acabado').fill('111');
    await pc.p.getByRole('button', { name: 'Salvar' }).click();
    await pc.p.locator('.actions .stat.ok', { hasText: 'Sincronizado' }).waitFor({ timeout: 20000 });
    verificar(um(`select caixas || '/' || status from public.ops where id = '${id1}'`) === '111/fechada', 'correção do P&D gravada; a OP continua fechada');
    verificar(um(`select alterado_por from public.ops where id = '${id1}'`) === PD.id, 'servidor registrou quem alterou por último');
    verificar(um(`select criado_por from public.ops where id = '${id1}'`) === OPERADOR.id, 'quem criou continua sendo o operador');

    console.log('O celular do operador recebe a correção');
    await p.getByRole('button', { name: /Abrir menu/ }).click();
    await p.getByRole('button', { name: 'Sincronizar agora' }).click();
    await p.locator('dialog[open]').getByRole('button', { name: 'Fechar' }).click();
    const recebeu = await p.waitForFunction(() => document.getElementById('f-cx')?.value === '111', null, { timeout: 15000 }).then(() => true, () => false);
    verificar(recebeu, 'caixas = 111 no celular do operador');

    console.log('Conta nova espera a liberação');
    const novo = await abrir({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });
    await entrar(novo.p, NOVO);
    await novo.p.getByRole('heading', { name: 'Aguardando liberação' }).waitFor();
    verificar(true, 'usuário inativo fica na tela "Aguardando liberação"');
    verificar(await novo.p.getByRole('heading', { name: 'OPs em andamento' }).count() === 0, 'e não entra no aplicativo');

    console.log('Administrador libera a conta nova');
    const adm = await abrir({ viewport: { width: 1280, height: 900 } });
    await entrar(adm.p, ADMIN);
    await adm.p.getByRole('heading', { name: 'OPs em andamento' }).waitFor();
    await sincronizado(adm.p);
    await adm.p.goto(base + '#admin');
    await adm.p.getByRole('button', { name: 'Usuários' }).click();
    const cartao = adm.p.locator('section .card', { has: adm.p.locator('input[value="Nino Novo"]') });
    await cartao.getByLabel('acesso liberado').check();
    await cartao.getByRole('button', { name: 'Salvar' }).click();
    await adm.p.getByText('Usuário salvo.').waitFor();
    verificar(um(`select ativo from public.perfis where id = '${NOVO.id}'`) === 't', 'liberação gravada no servidor');
    await adm.p.screenshot({ path: path.join(CAPTURAS, '13-admin-usuarios.png') });
    await novo.p.getByRole('button', { name: 'Já fui liberado' }).click();
    await novo.p.getByRole('heading', { name: 'OPs em andamento' }).waitFor({ timeout: 15000 });
    verificar(true, 'depois de liberado, o usuário entra no aplicativo');
    verificar(um(`select public.papel_atual() is null`) === 't', 'sem login, o banco não reconhece papel nenhum');

    console.log('Senha errada');
    const errado = await abrir({ viewport: { width: 360, height: 740 } });
    await errado.p.getByRole('heading', { name: 'Entrar', exact: true }).waitFor();
    await errado.p.getByLabel('E-mail').fill(OPERADOR.email);
    await errado.p.getByLabel('Senha').fill('outra-senha');
    await errado.p.getByRole('button', { name: 'Entrar', exact: true }).click();
    await errado.p.getByText('E-mail ou senha incorretos.').waitFor();
    verificar(true, 'senha errada: mensagem em português');

    verificar(erros.length === 0, 'sem erros no console' + (erros.length ? ': ' + erros.join(' | ') : ''));
  } catch (e) {
    console.error(e);
    verificar(false, 'o teste foi interrompido: ' + e.message.split('\n')[0]);
  } finally {
    await nav.close();
    site.close();
    api.close();
    banco.parar();
    fs.rmSync(pasta, { recursive: true, force: true });
  }
  console.log(totalFalhas() ? `\n${totalFalhas()} verificação(ões) falharam.` : '\nNavegador + banco: todas as verificações passaram.');
  process.exit(totalFalhas() ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
