#!/usr/bin/env node
// Teste da interface no Chromium (Playwright), com o reconhecimento de voz e a
// API do Claude simulados:  node teste-interface.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
let playwright;
try { playwright = require('playwright'); } catch (e) { playwright = require('/opt/node22/lib/node_modules/playwright'); }

const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const servidor = http.createServer((req, res) => {
  const arq = path.join(__dirname, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
  if (!arq.startsWith(__dirname) || !fs.existsSync(arq)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TIPOS[path.extname(arq)] || 'application/octet-stream' });
  fs.createReadStream(arq).pipe(res);
});

// Reconhecimento de voz falso: window.__falar(texto) simula um trecho reconhecido.
function simularVoz() {
  class FalsoSR {
    start() { window.__rec = this; this.resultados = []; }
    stop() { setTimeout(() => this.onend && this.onend(), 0); }
  }
  window.SpeechRecognition = FalsoSR;
  window.__falar = (texto) => {
    const r = window.__rec;
    r.resultados.push(Object.assign([{ transcript: texto }], { isFinal: true }));
    r.onresult({ results: r.resultados });
  };
}

function sse(texto, motivo) {
  const ev = (o) => 'event: ' + o.type + '\ndata: ' + JSON.stringify(o) + '\n\n';
  const meio = Math.ceil(texto.length / 2);
  return ev({ type: 'message_start' }) +
    ev({ type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: '' } }) +
    ev({ type: 'content_block_delta', delta: { type: 'text_delta', text: texto.slice(0, meio) } }) +
    ev({ type: 'content_block_delta', delta: { type: 'text_delta', text: texto.slice(meio) } }) +
    ev({ type: 'message_delta', delta: { stop_reason: motivo || 'end_turn' } }) + ev({ type: 'message_stop' });
}

(async () => {
  await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
  const url = 'http://127.0.0.1:' + servidor.address().port + '/';
  const nav = await playwright.chromium.launch();
  const captura = process.argv.includes('--capturas');
  let n = 0;

  // respostas: fila de { status, corpo } devolvidos pela API simulada; pedidos: o que o app enviou.
  async function abrir(opcoes, config) {
    const ctx = await nav.newContext(Object.assign({ viewport: { width: 412, height: 860 }, permissions: ['clipboard-read', 'clipboard-write'] }, opcoes));
    const pag = await ctx.newPage();
    const pedidos = [];
    const respostas = [];
    await pag.addInitScript(simularVoz);
    if (config) await pag.addInitScript((c) => localStorage.setItem('dita.config', JSON.stringify(c)), config);
    await pag.route('https://api.anthropic.com/**', (rota) => {
      pedidos.push({ cabecalhos: rota.request().headers(), corpo: JSON.parse(rota.request().postData()) });
      const r = respostas.shift() || { status: 500, corpo: '{}' };
      rota.fulfill({ status: r.status, contentType: r.status === 200 ? 'text/event-stream' : 'application/json', body: r.corpo });
    });
    const erros = [];
    pag.on('pageerror', (e) => erros.push(e.message));
    await pag.goto(url);
    return { ctx, pag, pedidos, respostas, erros };
  }

  async function ditar(pag, fala) {
    await pag.click('#btn-mic');
    await pag.waitForSelector('body[data-estado="gravando"]');
    await pag.evaluate((f) => window.__falar(f), fala);
    await pag.click('#btn-mic');
    await pag.waitForSelector('body[data-estado="ocioso"]');
  }

  async function teste(nome, fn) { await fn(); n++; console.log('ok  ' + nome); }

  await teste('sem chave: dita e usa a limpeza simples', async () => {
    const { ctx, pag, pedidos, erros } = await abrir();
    assert.ok(await pag.isVisible('#aviso'));
    if (captura) await pag.screenshot({ path: path.join(__dirname, 'capturas', '1-inicio.png') });
    await ditar(pag, 'ééé eu eu queria marcar a reunião né');
    assert.strictEqual(await pag.inputValue('#texto'), 'Eu queria marcar a reunião.');
    assert.strictEqual(await pag.textContent('#selo'), 'limpeza simples');
    assert.strictEqual(pedidos.length, 0);
    assert.deepStrictEqual(erros, []);
    await ctx.close();
  });

  await teste('com chave: texto vem da IA, é copiado, e o segundo ditado é acrescentado', async () => {
    const { ctx, pag, pedidos, respostas, erros } = await abrir({}, { chave: 'sk-ant-teste', dicionario: 'Frescatto' });
    assert.ok(await pag.isHidden('#aviso'));
    respostas.push({ status: 200, corpo: sse('Oi, João. Podemos marcar a reunião para as quatro?') });
    await pag.click('#btn-mic');
    await pag.waitForSelector('body[data-estado="gravando"]');
    await pag.evaluate(() => window.__falar('oi joão podemos marcar a reunião pras três não pras quatro'));
    assert.ok((await pag.textContent('#ao-vivo')).includes('pras quatro'));
    if (captura) await pag.screenshot({ path: path.join(__dirname, 'capturas', '2-ouvindo.png') });
    await pag.click('#btn-mic');
    await pag.waitForSelector('body[data-estado="ocioso"]');
    assert.strictEqual(await pag.inputValue('#texto'), 'Oi, João. Podemos marcar a reunião para as quatro?');
    assert.strictEqual(await pag.textContent('#selo'), 'limpo com IA');
    assert.strictEqual(await pag.evaluate(() => navigator.clipboard.readText()), 'Oi, João. Podemos marcar a reunião para as quatro?');
    const p = pedidos[0];
    assert.strictEqual(p.cabecalhos['x-api-key'], 'sk-ant-teste');
    assert.strictEqual(p.corpo.model, 'claude-opus-5-5');
    assert.ok(p.corpo.messages[0].content.includes('pras três não pras quatro'));
    assert.ok(p.corpo.system.includes('Frescatto'));
    if (captura) await pag.screenshot({ path: path.join(__dirname, 'capturas', '3-resultado.png') });

    respostas.push({ status: 200, corpo: sse('Obrigado!') });
    await ditar(pag, 'obrigado');
    assert.strictEqual(await pag.inputValue('#texto'), 'Oi, João. Podemos marcar a reunião para as quatro?\n\nObrigado!');
    await pag.click('#btn-desfazer');
    assert.strictEqual(await pag.inputValue('#texto'), 'Oi, João. Podemos marcar a reunião para as quatro?');
    assert.deepStrictEqual(erros, []);
    await ctx.close();
  });

  await teste('API recusa o fallback (400): repete sem ele', async () => {
    const { ctx, pag, pedidos, respostas } = await abrir({}, { chave: 'k' });
    respostas.push({ status: 400, corpo: '{"type":"error","error":{"type":"invalid_request_error"}}' }, { status: 200, corpo: sse('Bom dia.') });
    await ditar(pag, 'bom dia');
    assert.strictEqual(await pag.inputValue('#texto'), 'Bom dia.');
    assert.strictEqual(pedidos[0].corpo.fallbacks, 'default');
    assert.ok(!('fallbacks' in pedidos[1].corpo) && !pedidos[1].cabecalhos['anthropic-beta']);
    await ctx.close();
  });

  await teste('chave inválida (401): avisa e cai na limpeza simples', async () => {
    const { ctx, pag, respostas } = await abrir({}, { chave: 'errada', modelo: 'claude-haiku-5-5' });
    respostas.push({ status: 401, corpo: '{"type":"error","error":{"type":"authentication_error"}}' });
    await ditar(pag, 'hum bom dia pessoal');
    assert.strictEqual(await pag.inputValue('#texto'), 'Bom dia pessoal.');
    assert.ok((await pag.textContent('#toast')).includes('Chave de API inválida'));
    await ctx.close();
  });

  await teste('ajuste por voz e polir substituem o texto', async () => {
    const { ctx, pag, pedidos, respostas } = await abrir({}, { chave: 'k', copiar: false });
    await pag.fill('#texto', 'oi pessoal reunião amanhã');
    respostas.push({ status: 200, corpo: sse('Oi, pessoal. Reunião amanhã.') });
    await pag.click('#btn-polir');
    await pag.waitForFunction(() => document.getElementById('texto').value === 'Oi, pessoal. Reunião amanhã.');
    respostas.push({ status: 200, corpo: sse('Prezados, haverá reunião amanhã.') });
    await pag.click('#btn-ajustar');
    await pag.waitForSelector('body[data-estado="gravando"]');
    await pag.evaluate(() => window.__falar('deixa mais formal'));
    await pag.click('#btn-mic');
    await pag.waitForSelector('body[data-estado="ocioso"]');
    assert.strictEqual(await pag.inputValue('#texto'), 'Prezados, haverá reunião amanhã.');
    assert.ok(pedidos[1].corpo.messages[0].content.includes('<instrucao_falada>\ndeixa mais formal'));
    await ctx.close();
  });

  await teste('ajustes, estilo e histórico persistem; atalho de teclado grava', async () => {
    const { ctx, pag, pedidos, respostas, erros } = await abrir({ viewport: { width: 1100, height: 800 }, colorScheme: 'dark' });
    await pag.click('#btn-ajustes');
    await pag.fill('#cfg-chave', 'sk-nova');
    await pag.selectOption('#cfg-modelo', 'claude-sonnet-5-5');
    if (captura) await pag.screenshot({ path: path.join(__dirname, 'capturas', '4-ajustes-escuro.png') });
    await pag.click('#cfg-salvar');
    await pag.click('.chip:has-text("E-mail")');
    respostas.push({ status: 200, corpo: sse('Olá,\n\nSegue o relatório.\n\nAbraços.') });
    await pag.keyboard.press('Space');
    await pag.waitForSelector('body[data-estado="gravando"]');
    await pag.evaluate(() => window.__falar('segue o relatório'));
    await pag.keyboard.press('Space');
    await pag.waitForSelector('body[data-estado="ocioso"]');
    assert.strictEqual(pedidos[0].corpo.model, 'claude-sonnet-5-5');
    assert.ok(pedidos[0].corpo.system.includes('email body'));
    await pag.reload();
    assert.strictEqual(await pag.getAttribute('.chip:has-text("E-mail")', 'aria-checked'), 'true');
    await pag.click('#btn-historico');
    await pag.click('#lista-historico button');
    assert.strictEqual(await pag.inputValue('#texto'), 'Olá,\n\nSegue o relatório.\n\nAbraços.');
    if (captura) await pag.screenshot({ path: path.join(__dirname, 'capturas', '5-desktop-escuro.png') });
    assert.deepStrictEqual(erros, []);
    await ctx.close();
  });

  await nav.close();
  servidor.close();
  console.log('\n' + n + ' testes de interface passaram.');
})().catch((e) => { console.error(e); process.exit(1); });
