#!/usr/bin/env node
/*
 * Teste de navegador do fluxo completo, em celular de 360 px, no modo local
 * (sem servidor). Cobre os critérios de aceite 1, 2, 3, 4 (parte do aparelho)
 * e 6 da especificação.
 *
 *   npm run build && node testes/e2e/fluxo-local.cjs
 *
 * Grava capturas em testes/e2e/capturas/ e falha se houver erro no console.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const {
  playwright, RAIZ, CAPTURAS, servirPasta, verificar, totalFalhas, fotoDeTeste, semRolagemHorizontal, alvosPequenos,
} = require('./apoio.cjs');

(async () => {
  const dist = path.join(RAIZ, 'dist');
  if (!fs.existsSync(path.join(dist, 'index.html'))) { console.error('Rode "npm run build" antes.'); process.exit(2); }
  fs.mkdirSync(CAPTURAS, { recursive: true });
  const servidor = await servirPasta(dist);
  const base = `http://127.0.0.1:${servidor.address().port}/`;

  const nav = await playwright.chromium.launch();
  const ctx = await nav.newContext({
    viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true,
    locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', acceptDownloads: true,
  });
  const p = await ctx.newPage();
  const erros = [];
  p.on('console', (m) => { if (m.type() === 'error') erros.push(m.text()); });
  p.on('pageerror', (e) => erros.push('erro de página: ' + e.message));

  const captura = (nome) => p.screenshot({ path: path.join(CAPTURAS, nome + '.png') });
  const campo = (rotulo) => p.getByLabel(rotulo, { exact: true });
  const indicador = async (rotulo) => (await p.locator('.kpi', { has: p.locator('.l', { hasText: new RegExp('^' + rotulo + '$') }) }).innerText()).replace(/\s+/g, ' ');
  async function conferirLayout(tela) {
    verificar(await semRolagemHorizontal(p), `${tela}: sem rolagem horizontal em 360 px`);
    const pequenos = await alvosPequenos(p);
    verificar(pequenos.length === 0, `${tela}: alvos de toque com pelo menos 48 px${pequenos.length ? ' — ' + pequenos.join(' | ') : ''}`);
  }
  async function escolherProduto(busca) {
    await p.getByRole('button', { name: /^Produto/ }).click();
    await p.getByLabel('Buscar por código ou nome').fill(busca);
    await p.locator('.lista-produtos button').first().click();
  }

  await p.goto(base);
  await p.getByRole('heading', { name: 'OPs em andamento' }).waitFor();
  // Espera o service worker assumir a página (necessário para reabrir sem internet).
  await p.evaluate(() => navigator.serviceWorker.ready);

  console.log('Critério 1: produto preenche molde e peso nominal');
  await p.getByRole('button', { name: 'Nova OP' }).click();
  await escolherProduto('16507014073621-011');
  verificar((await campo('Molde').inputValue()) === '3x1', 'molde 3x1');
  verificar((await campo('Peso nominal (kg)').inputValue()) === '0,2', 'peso nominal 0,2 kg');
  verificar((await p.getByText(/^Do catálogo:/).innerText()).includes('molde 3x1 (3 bandejas por passo) · peso nominal 200 g'), 'linha de confirmação do catálogo');
  await captura('1-identificacao');
  await conferirLayout('Lançar OP');

  console.log('Critério 4: lançar sem internet (modo avião)');
  await ctx.setOffline(true);
  await p.getByRole('button', { name: 'Nova OP' }).click();
  await escolherProduto('24616701063781-975');
  verificar((await campo('Molde').inputValue()) === '2x1', 'salmão 600 g: molde 2x1');
  await campo('OP').fill('20109999');
  await campo('Embalagens por caixa').fill('9');
  await campo('Hora de início').fill('08:00');
  await campo('Temp. do produto (°C)').fill('18');
  await p.getByRole('button', { name: 'Trocar o sinal da temperatura' }).click();
  const negativa = await p.waitForFunction(() => document.getElementById('f-temp')?.value === '-18', null, { timeout: 3000 }).then(() => true, () => false);
  verificar(negativa, 'botão ± deixa a temperatura negativa');

  // Parâmetro diferente da receita padrão fica marcado em laranja.
  await p.locator('#p-t2').fill('1,2');
  verificar(await p.locator('.pf.diff #p-t2').count() === 1, 'T2 = 1,2 marcado como diferente da padrão');
  await p.locator('#p-t_dome').fill('999');
  verificar((await p.locator('.pf', { has: p.locator('#p-t_dome') }).innerText()).includes('Máximo 250'), 'temperatura acima de 250 °C é recusada');
  await p.locator('#p-t_dome').fill('225');

  await p.getByLabel('Adicionar foto da tela').setInputFiles([await fotoDeTeste(p, 'tela 417'), await fotoDeTeste(p, 'tela 414')]);
  await p.locator('.ph img').nth(1).waitFor();
  const dimensoes = await p.locator('.ph img').first().evaluate((img) => [img.naturalWidth, img.naturalHeight]);
  verificar(Math.max(...dimensoes) === 1800, `foto reduzida para 1800 px no lado maior (${dimensoes.join('×')})`);

  for (let i = 0; i < 5; i++) await p.getByRole('button', { name: 'Mais um: Sem vácuo' }).tap();
  for (let i = 0; i < 3; i++) await p.getByRole('button', { name: 'Mais um: Filme furado' }).tap();
  await p.getByRole('button', { name: 'Menos um: Filme furado' }).tap();
  await campo('Minutos').fill('12');
  await p.getByRole('button', { name: 'Adicionar', exact: true }).click();
  verificar(await p.locator('.parada').count() === 1, 'parada registrada');
  await captura('2-durante-a-producao');

  await campo('Hora de fim').fill('10:30');
  await campo('Passo no fim').fill('600');
  await campo('Caixas de produto acabado').fill('110');
  await campo('Peso final (kg)').fill('620');
  await p.getByRole('button', { name: 'Boa', exact: true }).click();
  await p.getByLabel('Adicionar foto do produto final').setInputFiles([await fotoDeTeste(p, 'produto')]);
  await p.locator('.ph img').nth(2).waitFor();
  await campo('Observações').fill('Teste de aceite.');

  console.log('Critério 2: resultado calculado ao vivo');
  const esperado = [
    ['Bandejas formadas', '1.200'], ['Embalagens boas', '990'], ['Aproveitamento', '82,5%'], ['Retrabalho', '7'], ['Vazias', '203'],
    ['Filme perdido', '7,37 kg'], ['Filme perdido', 'fundo 5,90 · tampa 1,48 kg'], ['Filme por kg de produto', '68 g/kg'],
    ['Produtividade', '248 kg/h'], ['Ciclos por minuto', '4,0'], ['Peso médio', '626 g'], ['Peso médio', 'sobrepeso 4,4%'],
  ];
  for (const [rotulo, valor] of esperado) {
    const texto = await indicador(rotulo);
    verificar(texto.includes(valor), `${rotulo}: ${valor}${texto.includes(valor) ? '' : ' (na tela: ' + texto + ')'}`);
  }
  await p.locator('#t-result').evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await captura('3-resultado');

  // Fecha e reabre o aplicativo ainda sem internet: tudo continua lá.
  await p.waitForFunction(() => document.querySelector('.actions .stat')?.textContent.includes('Salvo no aparelho'));
  await p.reload();
  await p.getByRole('heading', { name: 'Resultado desta OP' }).waitFor();
  verificar((await campo('Caixas de produto acabado').inputValue()) === '110', 'reabrir sem internet: a OP continua com os dados');
  verificar((await indicador('Retrabalho')).includes('7'), 'reabrir sem internet: contagem de retrabalho mantida');
  verificar(await p.locator('.ph img').count() === 3, 'reabrir sem internet: as 3 fotos continuam no aparelho');

  console.log('Validações ao encerrar');
  await campo('Caixas de produto acabado').fill('140');
  await p.getByRole('button', { name: 'Encerrar OP' }).click();
  verificar(await p.getByText('Boas + retrabalho passam das bandejas formadas. Confira passos e caixas.').count() === 1, 'bloqueia quando boas + retrabalho passam de 102% das formadas');
  await campo('Caixas de produto acabado').fill('110');
  await p.getByRole('button', { name: 'Encerrar OP' }).click();
  await p.getByRole('heading', { name: 'Encerrar esta OP?' }).waitFor();
  await conferirLayout('Diálogo de encerramento');
  await p.getByRole('button', { name: 'Encerrar OP' }).last().click();
  await p.getByText('OP encerrada.', { exact: true }).waitFor();
  verificar(await p.locator('.lista-ops button', { hasText: 'SALMON' }).count() === 0, 'OP encerrada sai da lista de OPs em andamento');
  await ctx.setOffline(false);

  console.log('Painel P&D');
  await p.goto(base + '#painel');
  await p.getByRole('heading', { name: 'OPs registradas' }).waitFor();
  await captura('4-painel');
  await conferirLayout('Painel');
  verificar((await p.locator('.kpi', { has: p.locator('.l', { hasText: /^OPs$/ }) }).innerText()).includes('17'), '17 OPs: 15 do histórico + 2 lançadas');

  console.log('Critério 3: histórico do salmão 600 g de 10/10/2026');
  await p.locator('.op-cartao', { hasText: '10/10/2026' }).click();
  const detalhe = (await p.locator('dialog[open] .dl').innerText()).replace(/\s+/g, ' ');
  verificar(detalhe.includes('Bandejas formadas 1.598'), '1.598 bandejas formadas');
  verificar(detalhe.includes('Embalagens boas 1.365'), '1.365 embalagens boas');
  verificar(detalhe.includes('Aproveitamento 85,4%'), 'aproveitamento 85,4% (85%)');
  await captura('5-detalhe');
  await conferirLayout('Detalhe da OP');

  console.log('Comparar duas OPs');
  await p.locator('dialog[open]').getByLabel('Comparar com outra OP').selectOption({ index: 1 });
  await p.locator('dialog[open]').getByRole('button', { name: 'Comparar', exact: true }).click();
  await p.getByRole('heading', { name: 'Comparar duas OPs' }).waitFor();
  verificar(await p.locator('dialog[open] .comp').count() >= 1, 'comparação lado a lado aberta');
  await captura('6-comparar');
  await conferirLayout('Comparação');
  await p.locator('dialog[open]').getByRole('button', { name: 'Fechar' }).click();
  await p.locator('dialog[open]').getByRole('button', { name: 'Fechar' }).click();

  console.log('Filtro por produto e parâmetro × resultado');
  await p.getByLabel('Produto', { exact: true }).selectOption('F. SALMON PREM PEDACOS S/E 600GR SKIN PREMIUM');
  verificar((await p.locator('.kpi', { has: p.locator('.l', { hasText: /^OPs$/ }) }).innerText()).includes('8'), 'filtro por produto: 8 OPs de salmão 600 g');
  await p.getByLabel('Produto', { exact: true }).selectOption('');

  console.log('Exportação');
  for (const [botao, ext] of [['Exportar XLSX', '.xlsx'], ['Exportar CSV', '.csv']]) {
    const [download] = await Promise.all([p.waitForEvent('download'), p.getByRole('button', { name: botao }).click()]);
    const destino = path.join(CAPTURAS, 'exportacao' + ext);
    await download.saveAs(destino);
    verificar(download.suggestedFilename().endsWith(ext) && fs.statSync(destino).size > 1000, `${botao}: arquivo ${download.suggestedFilename()} (${fs.statSync(destino).size} bytes)`);
  }
  const csv = fs.readFileSync(path.join(CAPTURAS, 'exportacao.csv'), 'utf8');
  verificar(csv.split('\r\n').filter(Boolean).length === 18, 'CSV: cabeçalho + 17 OPs');
  verificar(/;82,5;7;/.test(csv), 'CSV com vírgula decimal (aproveitamento 82,5)');

  console.log('Administração');
  await p.goto(base + '#admin');
  await p.getByRole('heading', { name: 'Catálogo de produtos' }).waitFor();
  await captura('7-admin');
  await conferirLayout('Administração: produtos');
  for (const secao of ['Filme por molde', 'Receita padrão', 'Usuários']) {
    await p.getByRole('button', { name: secao }).click();
    await conferirLayout('Administração: ' + secao.toLowerCase());
  }

  console.log('Operador × OP fechada (o aplicativo espelha as políticas do banco)');
  // No modo local o usuário é administrador; a regra do operador é coberta pelos testes de unidade e do banco.

  console.log('Tema escuro');
  await p.goto(base + '#lancar');
  await p.getByRole('button', { name: /Abrir menu/ }).click();
  await conferirLayout('Menu');
  await p.getByLabel('Tema').selectOption('dark');
  await p.locator('dialog[open]').getByRole('button', { name: 'Fechar' }).click();
  verificar(await p.evaluate(() => getComputedStyle(document.body).backgroundColor) === 'rgb(15, 22, 27)', 'tema escuro aplicado');
  await p.goto(base + '#painel');
  await p.getByRole('heading', { name: 'OPs registradas' }).waitFor();
  await captura('8-painel-escuro');

  verificar(erros.length === 0, 'sem erros no console' + (erros.length ? ': ' + erros.join(' | ') : ''));
  await nav.close();
  servidor.close();
  console.log(totalFalhas() ? `\n${totalFalhas()} verificação(ões) falharam.` : '\nNavegador (modo local): todas as verificações passaram.');
  process.exit(totalFalhas() ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
