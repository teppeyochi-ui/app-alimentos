#!/usr/bin/env node
/*
 * teste-interface.js — Teste de interface com Playwright (celular 390×844, toque).
 *   node teste-interface.js
 * Sobe um servidor local sem dependências, percorre o fluxo completo,
 * grava screenshots em capturas/ e falha se houver erro no console.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
let playwright;
try { playwright = require('playwright'); } catch (e) { playwright = require('/opt/node22/lib/node_modules/playwright'); }

const RAIZ = __dirname;
const CAPTURAS = path.join(RAIZ, 'capturas');
const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml',
};

function servidor() {
  return new Promise((ok) => {
    const s = http.createServer((req, res) => {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (p.endsWith('/')) p += 'index.html';
      const arq = path.join(RAIZ, path.normalize(p).replace(/^([/\\])+/, ''));
      if (!arq.startsWith(RAIZ) || !fs.existsSync(arq) || fs.statSync(arq).isDirectory()) { res.writeHead(404); res.end('404'); return; }
      res.writeHead(200, { 'Content-Type': TIPOS[path.extname(arq)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      fs.createReadStream(arq).pipe(res);
    });
    s.listen(0, '127.0.0.1', () => ok(s));
  });
}

let falhas = 0;
function verificar(cond, msg) {
  console.log((cond ? '  ✓ ' : '  ✗ ') + msg);
  if (!cond) falhas++;
}

(async () => {
  fs.mkdirSync(CAPTURAS, { recursive: true });
  const srv = await servidor();
  const url = 'http://localhost:' + srv.address().port + '/index.html';
  const nav = await playwright.chromium.launch();
  const ctx = await nav.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', colorScheme: 'light', acceptDownloads: true,
  });
  const pag = await ctx.newPage();
  const errosConsole = [];
  pag.on('console', (m) => { if (m.type() === 'error') errosConsole.push(m.text()); });
  pag.on('pageerror', (e) => errosConsole.push(String(e)));

  const tocar = (sel) => pag.locator(sel).first().tap();
  // Captura de página inteira: topo e navegação deixam de ser fixos só na imagem.
  async function capturaInteira(arq) {
    const estilo = await pag.addStyleTag({ content: '.topo,.faixa-viva{position:relative!important;top:0!important}.nav-inferior{position:relative!important}main{padding-bottom:16px!important}.toast{display:none!important}' });
    await pag.screenshot({ path: path.join(CAPTURAS, arq), fullPage: true });
    await estilo.evaluate((e) => e.remove());
  }
  const tecla = (t) => tocar('.teclado [data-tecla="' + t + '"]');
  async function digitarPeso(txt) { for (const ch of txt) await tecla(ch); }

  try {
    console.log('Abrindo ' + url);
    await pag.goto(url);
    await pag.waitForSelector('#tela-produto:not([hidden])');

    // ---------- Produto: argentino, descascado cru, glaciado 15% compensado, 1 kg ----------
    console.log('Produto');
    await tocar('[data-grupo="especie"] [data-valor="argentino"]');
    await tocar('[data-grupo="apresentacao"] [data-valor="desc_cru"]');
    await tocar('[data-grupo="condicao"] [data-valor="glaciado"]');
    verificar(await pag.isVisible('#bloco-glaciado'), 'Bloco de glaciamento aparece');
    for (let i = 0; i < 10; i++) await tocar('#glac-mais'); // 10% → 15%
    verificar((await pag.textContent('#glac-valor')) === '15,0%', 'Glaciamento em 15,0%');
    await tocar('[data-grupo="embalagem"] [data-valor="compensada"]');
    await tocar('#atalhos-peso [data-peso="1000"]');
    await pag.fill('[data-ident="codigo"]', 'PD-TESTE-01');
    await pag.fill('[data-ident="lote"]', 'NF 4521');
    await pag.fill('[data-ident="tecnico"]', 'Técnico de teste');
    await pag.fill('[data-ident="local"]', 'Linha 2');
    const avisos = await pag.textContent('#avisos');
    verificar(/Tabela geral — Descascado cru/.test(avisos), 'Aviso mostra a tabela usada');
    verificar(/envasar 1\.150 g brutos/.test(avisos), 'Aviso de compensação: envasar 1.150 g');
    await capturaInteira('1-produto.png');

    // ---------- Pesagem: 8 unidades pelo teclado do app ----------
    console.log('Pesagem');
    await tocar('#btn-iniciar');
    await pag.waitForSelector('#tela-pesagem:not([hidden])');
    // Peso inválido é rejeitado com mensagem.
    await digitarPeso('1000');
    await tocar('#btn-adicionar');
    verificar(/1\.000 g ou mais/.test(await pag.textContent('#visor-erro')), 'Rejeita 1.000 g com mensagem clara');
    for (let i = 0; i < 4; i++) await tecla('apagar');

    const pesos = ['23', '22,5', '24', '23,5', '21', '25', '22', '23']; // média 23 g → 20 g líquido
    for (const p of pesos) { await digitarPeso(p); await tocar('#btn-adicionar'); }
    verificar((await pag.locator('#lista-unidades li[data-i]').count()) === 8, '8 unidades na lista');
    const faixa = await pag.textContent('#faixa-viva');
    verificar(/16\/20/.test(faixa) && /45–55 pç/.test(faixa), 'Faixa ao vivo: 16/20 e 45–55 pç');

    // Teclado físico + desfazer.
    await pag.keyboard.type('21.5');
    await pag.keyboard.press('Enter');
    verificar((await pag.locator('#lista-unidades li[data-i]').count()) === 9, 'Teclado físico adiciona unidade');
    await tocar('#btn-desfazer');
    verificar((await pag.locator('#lista-unidades li[data-i]').count()) === 8, 'Desfazer remove a última');

    // Toque duplo: o primeiro toque só arma.
    await tocar('#lista-unidades li[data-i="0"] button');
    verificar((await pag.locator('#lista-unidades li.armado').count()) === 1, 'Primeiro toque pede confirmação visual');
    await pag.waitForTimeout(2700);
    verificar((await pag.locator('#lista-unidades li.armado').count()) === 0 && (await pag.locator('#lista-unidades li[data-i]').count()) === 8, 'Sem segundo toque, nada é removido');
    // Toque duplo de fato remove.
    await digitarPeso('30');
    await tocar('#btn-adicionar');
    await tocar('#lista-unidades li[data-i="8"] button');
    await tocar('#lista-unidades li[data-i="8"] button');
    verificar((await pag.locator('#lista-unidades li[data-i]').count()) === 8, 'Toque duplo remove a unidade');
    await digitarPeso('23');
    await pag.evaluate(() => { document.getElementById('toast').hidden = true; });
    await pag.screenshot({ path: path.join(CAPTURAS, '2-pesagem.png'), fullPage: false });
    for (let i = 0; i < 2; i++) await tecla('apagar');

    // ---------- Resultado ----------
    console.log('Resultado');
    await tocar('.nav-inferior [data-ir="resultado"]');
    await pag.waitForSelector('#destaque-classe');
    verificar(/16\/20 pç\/lb/.test(await pag.textContent('#destaque-classe')), '(a) Classificação 16/20 pç/lb');
    verificar(/18,18–22,22 g/.test(await pag.textContent('#destaque-peso')), '(b) Faixa de peso 18,18–22,22 g');
    verificar(/45–55 pç/.test(await pag.textContent('#destaque-pecas')), '(c) Faixa de peças 45–55 pç');
    verificar((await pag.locator('#analise li').count()) >= 4, 'Análise com frases de status');
    verificar((await pag.locator('#enquadramento .enq-linha.do-lote').count()) === 1, 'Linha da classe do lote em destaque');
    await capturaInteira('3-resultado.png');

    // CSV (sem Web Share no Chromium de teste → download).
    const [download] = await Promise.all([pag.waitForEvent('download'), tocar('[data-acao="csv"]')]);
    const csv = fs.readFileSync(await download.path(), 'utf8');
    verificar(csv.charCodeAt(0) === 0xFEFF && csv.includes('codigo;data;lote;especie;apresentacao;condicao;unidade;peso_pesado_g;peso_liquido_g;classe;status'), 'CSV baixado com BOM e cabeçalho');

    await tocar('[data-acao="salvar"]');
    verificar(/salva/.test(await pag.textContent('#toast')), 'Avaliação salva');

    // ---------- Histórico ----------
    console.log('Histórico');
    await tocar('.nav-inferior [data-ir="historico"]');
    verificar((await pag.locator('#lista-historico li').count()) === 1, 'Histórico com 1 avaliação');
    verificar(/PD-TESTE-01/.test(await pag.textContent('#lista-historico')), 'Histórico mostra o código');
    await pag.screenshot({ path: path.join(CAPTURAS, '4-historico.png'), fullPage: true });

    await pag.reload();
    await pag.waitForSelector('#tela-historico:not([hidden])');
    verificar((await pag.locator('#lista-historico li').count()) === 1, 'Histórico persiste após recarregar');

    // Abrir em modo leitura.
    await tocar('#lista-historico [data-abrir]');
    verificar(await pag.isVisible('.aviso-leitura'), 'Abre o resultado em modo leitura');
    await tocar('[data-acao="excluir"]');
    verificar(await pag.isVisible('.confirmar'), 'Excluir pede confirmação na tela');
    await tocar('[data-acao="excluir-nao"]');
    await tocar('[data-acao="voltar-historico"]');

    // ---------- Offline ----------
    console.log('Offline');
    await pag.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    await pag.reload(); // garante que a página está sob controle do service worker
    await pag.waitForFunction(() => !!navigator.serviceWorker.controller);
    await ctx.setOffline(true);
    await pag.reload();
    await pag.waitForSelector('.nav-inferior');
    verificar((await pag.title()) === 'Classificador de Camarão', 'App abre offline');
    verificar((await pag.locator('#lista-historico li').count()) === 1, 'Histórico disponível offline');
    await ctx.setOffline(false);

    // Tema escuro (captura extra).
    await tocar('.nav-inferior [data-ir="resultado"]');
    await tocar('#btn-tema');
    await tocar('#btn-tema');
    verificar((await pag.getAttribute('html', 'data-theme')) === 'dark', 'Tema escuro aplicado');
    await pag.screenshot({ path: path.join(CAPTURAS, '5-resultado-escuro.png'), fullPage: false });
  } catch (e) {
    falhas++;
    console.log('  ✗ Erro no teste: ' + (e && e.stack || e));
    await pag.screenshot({ path: path.join(CAPTURAS, 'erro.png'), fullPage: true }).catch(() => {});
  }

  // Ignora o aviso do Chromium sobre a falha de rede esperada no modo offline, se houver.
  const erros = errosConsole.filter((t) => !/net::ERR_INTERNET_DISCONNECTED/.test(t));
  verificar(erros.length === 0, 'Zero erros no console' + (erros.length ? ': ' + erros.join(' | ') : ''));

  await nav.close();
  srv.close();
  console.log('');
  console.log(falhas ? 'RESULTADO: FALHOU — ' + falhas + ' falha(s)' : 'RESULTADO: OK — interface sem falhas');
  process.exit(falhas ? 1 : 0);
})();
