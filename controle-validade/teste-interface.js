#!/usr/bin/env node
// Teste da interface no Chromium (Playwright), com a data do aparelho fixa e a impressão simulada:
//   node teste-interface.js            roda os testes
//   node teste-interface.js --capturas roda e regrava as imagens de capturas/
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

const SEGUNDA = '2026-11-16T12:00:00'; // segunda-feira, meio-dia

(async () => {
  await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
  const url = 'http://127.0.0.1:' + servidor.address().port + '/';
  const nav = await playwright.chromium.launch();
  const capturas = process.argv.includes('--capturas');
  let n = 0;

  async function abrir(opcoes, previa) {
    const ctx = await nav.newContext(Object.assign({ viewport: { width: 412, height: 860 }, deviceScaleFactor: capturas ? 2 : 1, locale: 'pt-BR', serviceWorkers: 'block' }, opcoes));
    const pag = await ctx.newPage();
    await pag.clock.setFixedTime(new Date(SEGUNDA));
    await pag.addInitScript((modoPrevia) => {
      window.__impressoes = 0;
      window.print = () => { window.__impressoes++; };
      if (modoPrevia) window.MODO_PREVIA = true;
    }, !!previa);
    const erros = [];
    pag.on('console', (m) => { if (m.type() === 'error') erros.push(m.text()); });
    pag.on('pageerror', (e) => erros.push(String(e)));
    await pag.goto(url);
    return { ctx, pag, erros };
  }

  async function teste(nome, fn) { await fn(); n++; console.log('ok  ' + nome); }
  // O aviso some sozinho em poucos segundos; sai da frente para não cobrir a tela na imagem.
  const foto = async (pag, arq, inteira) => {
    if (!capturas) return;
    await pag.evaluate(() => { document.getElementById('aviso').hidden = true; });
    await pag.screenshot({ path: path.join(__dirname, 'capturas', arq), fullPage: !!inteira });
  };
  const contagem = (pag) => pag.$$eval('.tiles .tile-n', (els) => els.map((e) => e.textContent));
  const aba = (pag, nome) => pag.click('.abas button[data-aba="' + nome + '"]');
  const semSobraLateral = async (pag, onde) => {
    const sobra = await pag.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(sobra <= 0, onde + ': a página rola para o lado (' + sobra + 'px)');
  };
  const escolherProduto = async (pag, nome) => {
    await aba(pag, 'etiquetar');
    if (await pag.$('[data-acao="trocar-produto"]')) await pag.click('[data-acao="trocar-produto"]');
    await pag.click('.filtro-grupos [data-grupo=""]');   // o grupo escolhido antes continua marcado
    await pag.click('.prod:has-text("' + nome + '")');
  };
  const validadeNaPrevia = (pag) => pag.textContent('#previa .etq-val b');

  const { ctx, pag, erros } = await abrir();

  await teste('abre no painel, com os dados de exemplo nas quatro situações', async () => {
    assert.deepStrictEqual(await contagem(pag), ['2', '3', '3', '7']);
    assert.strictEqual(await pag.textContent('#hoje'), 'Cozinha Modelo · seg, 16/11');
    assert.deepStrictEqual(await pag.$$eval('#lista h2', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim())),
      ['Vencidos 2', 'Vencem hoje 3', 'Vencem em até 2 dias 3', 'No prazo 7']);
    assert.ok(await pag.isVisible('.exemplo'));
    const primeiro = await pag.textContent('#lista .item');
    assert.ok(/Tomate em cubos/.test(primeiro) && /venceu ontem/.test(primeiro), primeiro);
    await semSobraLateral(pag, 'Validades');
    await foto(pag, '1-validades.png');
  });

  await teste('filtra pela situação, pelo local e pela busca', async () => {
    await pag.click('.tile[data-sit="vencido"]');
    assert.strictEqual(await pag.locator('#lista .item').count(), 2);
    await pag.click('.tile[data-sit="vencido"]');
    assert.strictEqual(await pag.locator('#lista .item').count(), 15);
    await pag.selectOption('#filtro-local', 'Freezer');
    assert.strictEqual(await pag.locator('#lista .item').count(), 4);
    await pag.selectOption('#filtro-local', '');
    await pag.fill('#busca', 'queijo');
    assert.strictEqual(await pag.locator('#lista .item').count(), 1);
    assert.ok(/validade do fabricante/.test(await pag.textContent('#lista .item')));
    await pag.fill('#busca', 'nada disso');
    assert.ok(/Nada encontrado/.test(await pag.textContent('#lista')));
    await pag.fill('#busca', '');
  });

  await teste('dá baixa como usado, desfaz e descarta com motivo', async () => {
    await pag.click('#lista .item:has-text("Tomate em cubos") [data-usar]');
    assert.deepStrictEqual(await contagem(pag), ['1', '3', '3', '7']);
    assert.ok(/marcado como usado/.test(await pag.textContent('#aviso')));
    await pag.click('#aviso-acao');
    assert.deepStrictEqual(await contagem(pag), ['2', '3', '3', '7']);
    await pag.click('#lista .item:has-text("Tomate em cubos") [data-descartar]');
    assert.strictEqual(await pag.inputValue('#frm input[name="motivo"]:checked'), 'Vencido');
    await pag.selectOption('#desc-por', 'Carla');
    await foto(pag, '2-descartar.png');
    await pag.click('#frm button[type="submit"]');
    assert.deepStrictEqual(await contagem(pag), ['1', '3', '3', '7']);
    // Item ainda no prazo: o motivo sugerido muda.
    await pag.click('#lista .item:has-text("Brigadeiro") [data-descartar]');
    assert.strictEqual(await pag.inputValue('#frm input[name="motivo"]:checked'), 'Sobra de produção');
    await pag.click('#frm [data-acao="fechar"]');
    assert.deepStrictEqual(await contagem(pag), ['1', '3', '3', '7']);
  });

  await teste('etiqueta: escolhe o produto e a prévia calcula a validade', async () => {
    await aba(pag, 'etiquetar');
    await pag.click('.filtro-grupos button:has-text("Molhos e bases")');
    assert.strictEqual(await pag.locator('.prod').count(), 4);
    await semSobraLateral(pag, 'Etiquetar, escolha');
    await foto(pag, '3-escolher-produto.png');
    await pag.click('.prod:has-text("Molho de tomate")');
    assert.strictEqual(await pag.textContent('#previa .etq-nome'), 'Molho de tomate');
    assert.strictEqual(await validadeNaPrevia(pag), 'QUI 19/11/26');
    assert.strictEqual(await pag.textContent('#emitir'), 'Imprimir e registrar 1 etiqueta');
    await pag.check('#modo-congelado', { force: true });
    assert.strictEqual(await validadeNaPrevia(pag), 'QUA 16/12/26');
    await pag.check('#modo-resfriado', { force: true });
    await pag.selectOption('#etq-local', 'Câmara fria');
    await pag.selectOption('#etq-resp', 'Ana');
    await pag.fill('#etq-qtd', '2 kg');
    await pag.click('[data-passo="1"]');
    await pag.click('[data-passo="1"]');
    assert.strictEqual(await pag.textContent('#emitir'), 'Imprimir e registrar 3 etiquetas');
    assert.ok(/numeradas de 000112 a 000114/.test(await pag.textContent('#previa-nota')), await pag.textContent('#previa-nota'));
    assert.ok(/Resp\. Ana · Câmara fria · 2 kg/.test(await pag.textContent('#previa .etq-pe')));
    await semSobraLateral(pag, 'Etiquetar, formulário');
    await foto(pag, '4-etiquetar.png', true);
  });

  await teste('etiqueta: nada do texto vaza para fora do papel', async () => {
    for (const tamanho of ['60x40', '50x30', '100x50']) {
      await pag.evaluate((t) => { const e = document.querySelector('#previa .etq'); const [l, a] = t.split('x'); e.style.setProperty('--l', l); e.style.setProperty('--a', a); }, tamanho);
      const folga = await pag.evaluate(() => {
        const papel = document.querySelector('#previa .etq').getBoundingClientRect();
        return Array.from(document.querySelectorAll('#previa .etq-dentro > *')).map((el) => {
          const r = el.getBoundingClientRect();
          return { cls: el.className, cabe: r.top >= papel.top - 0.5 && r.bottom <= papel.bottom + 0.5 && r.left >= papel.left - 0.5 && r.right <= papel.right + 0.5 && el.scrollWidth <= el.clientWidth + 1 };
        }).filter((x) => !x.cabe);
      });
      assert.deepStrictEqual(folga, [], 'etiqueta ' + tamanho);
    }
  });

  await teste('etiqueta: imprime uma por página no tamanho do rolo e registra', async () => {
    await pag.click('#emitir');
    assert.ok(/3 etiquetas registradas/.test(await pag.textContent('#aviso')));
    assert.strictEqual(await pag.evaluate(() => window.__impressoes), 1);
    assert.strictEqual(await pag.locator('#impressao .etq').count(), 3);
    assert.deepStrictEqual(await pag.$$eval('#impressao .etq-topo span:last-child', (els) => els.map((e) => e.textContent)), ['Nº 000112', 'Nº 000113', 'Nº 000114']);
    assert.ok(/size: 60mm 40mm/.test(await pag.textContent('#pagina')));
    await pag.emulateMedia({ media: 'print' });
    const caixa = await pag.locator('#impressao .etq').first().boundingBox();
    assert.ok(Math.abs(caixa.width - 60 * 96 / 25.4) < 1 && Math.abs(caixa.height - 40 * 96 / 25.4) < 1, JSON.stringify(caixa));
    assert.strictEqual(await pag.isVisible('main'), false, 'só as etiquetas vão para o papel');
    await pag.emulateMedia({ media: 'screen' });
    assert.ok(await pag.isVisible('.grade'), 'volta para a escolha do produto');
    await pag.click('#aviso-acao');
    assert.deepStrictEqual(await contagem(pag), ['1', '3', '3', '10']);
    await pag.click('#lista .item:has-text("000113") [data-reimprimir]');
    assert.strictEqual(await pag.evaluate(() => window.__impressoes), 2);
    assert.strictEqual(await pag.locator('#impressao .etq').count(), 1);
  });

  await teste('etiqueta: preparo retroativo, validade em horas e teto do fabricante', async () => {
    await escolherProduto(pag, 'Molho de tomate');
    assert.strictEqual(await pag.inputValue('#etq-local'), 'Câmara fria', 'local fica para a próxima etiqueta');
    await pag.selectOption('#etq-quando', 'outra');
    assert.strictEqual(await pag.inputValue('#etq-feito'), '2026-11-16T12:00');
    await pag.fill('#etq-feito', '2026-11-14T09:00');
    assert.strictEqual(await validadeNaPrevia(pag), 'TER 17/11/26');
    await pag.fill('#etq-feito', '2026-11-20T09:00');
    assert.ok(/não pode ficar no futuro/.test(await pag.textContent('#previa')));
    await pag.click('#emitir');
    assert.ok(/não pode ficar no futuro/.test(await pag.textContent('#etq-erro')));
    assert.strictEqual(await pag.evaluate(() => window.__impressoes), 2, 'não imprime com erro');

    // Trocar de produto mantém o que já foi preenchido (aqui, a data errada continua pedindo correção).
    await escolherProduto(pag, 'Salmão em cubos');
    assert.ok(/não pode ficar no futuro/.test(await pag.textContent('#previa')));
    await pag.selectOption('#etq-quando', 'agora');
    assert.strictEqual(await validadeNaPrevia(pag), '17/11/26 12:00');

    await escolherProduto(pag, 'Queijo muçarela');
    assert.strictEqual(await validadeNaPrevia(pag), 'SÁB 21/11/26');
    await pag.click('#etq-orig summary');
    await pag.fill('#etq-lote', 'L77');
    await pag.fill('#etq-valorig', '2026-11-18');
    assert.strictEqual(await validadeNaPrevia(pag), 'QUA 18/11/26');
    assert.ok(/Encurtada pela validade do fabricante/.test(await pag.textContent('#previa-nota')));
    assert.ok(/Lote L77/.test(await pag.textContent('#previa .etq-pe')));
    await pag.fill('#etq-valorig', '2026-11-10');
    assert.ok(/validade do fabricante já passou/.test(await pag.textContent('#previa')));
    // O lote e a validade do fabricante são daquela embalagem: não acompanham a troca de produto.
    await escolherProduto(pag, 'Presunto fatiado');
    assert.strictEqual(await validadeNaPrevia(pag), 'QUI 19/11/26');
    assert.strictEqual(await pag.inputValue('#etq-lote'), '');
    await pag.click('[data-acao="trocar-produto"]');
  });

  await teste('produtos: cadastra, valida, edita e exclui', async () => {
    await aba(pag, 'produtos');
    assert.strictEqual(await pag.locator('#lista .item').count(), 24);
    await semSobraLateral(pag, 'Produtos');
    await foto(pag, '5-produtos.png');
    await pag.click('[data-acao="novo-produto"]');
    await pag.click('#frm button[type="submit"]');
    assert.ok(/Escreva o nome/.test(await pag.textContent('#dlg-erro')));
    await pag.fill('#p-nome', 'Molho pesto');
    await pag.fill('#p-grupo', 'Molhos e bases');
    await pag.click('#frm button[type="submit"]');
    assert.ok(/pelo menos um modo/.test(await pag.textContent('#dlg-erro')));
    await pag.fill('#p-n-resfriado', '5');
    await pag.fill('#p-n-congelado', '12');
    await pag.selectOption('#p-un-congelado', 'h');
    await foto(pag, '6-novo-produto.png');
    await pag.click('#frm button[type="submit"]');
    assert.strictEqual(await pag.isVisible('#dlg'), false);
    const item = pag.locator('#lista .item:has-text("Molho pesto")');
    assert.deepStrictEqual(await item.locator('.chip').allTextContents(), ['Resfriado 5 dias', 'Congelado 12 horas']);
    await pag.fill('#prod-busca', 'pesto');
    assert.strictEqual(await pag.locator('#lista .item').count(), 1);
    await pag.click('#lista [data-editar]');
    assert.strictEqual(await pag.inputValue('#p-n-congelado'), '12');
    assert.strictEqual(await pag.inputValue('#p-un-congelado'), 'h');
    await pag.fill('#p-n-congelado', '');
    await pag.click('#frm button[type="submit"]');
    assert.deepStrictEqual(await pag.locator('#lista .chip').allTextContents(), ['Resfriado 5 dias']);
    await pag.click('#lista [data-etiquetar]');
    assert.strictEqual(await pag.textContent('#previa .etq-nome'), 'Molho pesto');
    assert.strictEqual(await validadeNaPrevia(pag), 'SÁB 21/11/26');
    await aba(pag, 'produtos');
    await pag.click('#lista [data-editar]');
    await pag.click('[data-acao="excluir-produto"]');
    assert.strictEqual(await pag.textContent('[data-acao="excluir-produto"]'), 'Confirmar exclusão');
    await pag.click('[data-acao="excluir-produto"]');
    await pag.fill('#prod-busca', '');
    assert.strictEqual(await pag.locator('#lista .item').count(), 24);
  });

  await teste('perdas: resumo, barras e últimas baixas por período', async () => {
    await aba(pag, 'perdas');
    const mes = await contagem(pag);
    assert.ok(+mes[0] > 100 && +mes[1] > 50 && +mes[2] > 10 && /^\d+%$/.test(mes[3]), mes.join(' '));
    assert.strictEqual(await pag.textContent('.barras .b-nome'), 'Vencido');
    const larguras = await pag.$$eval('.cartao:first-child .b-val', (els) => els.map((e) => parseFloat(e.style.width)));
    assert.strictEqual(larguras[0], 100);
    assert.ok(larguras.every((l, i) => i === 0 || l <= larguras[i - 1]), 'barras em ordem decrescente');
    const linha = await pag.textContent('tbody tr');
    assert.ok(/Tomate em cubos/.test(linha) && /Descartada/.test(linha) && /Vencido/.test(linha) && /Carla/.test(linha), linha);
    await semSobraLateral(pag, 'Perdas');
    await foto(pag, '7-perdas.png', true);
    await pag.check('#periodo-7', { force: true });
    const semana = await contagem(pag);
    assert.ok(+semana[0] < +mes[0] && +semana[1] < +mes[1], semana.join(' '));
    const baixou = pag.waitForEvent('download');
    await pag.click('[data-acao="exportar"]');
    const planilha = fs.readFileSync(await (await baixou).path(), 'utf8');
    assert.ok(planilha.startsWith('﻿Número;Produto;Grupo'));
    assert.ok(/000114;Molho de tomate;Molhos e bases;Resfriado;Câmara fria;2 kg;Ana;16\/11\/26 12:00;19\/11\/26 23:59;;;Ativa, no prazo/.test(planilha));
  });

  await teste('ajustes: nome da casa, alerta e regra do 1º dia valem na hora', async () => {
    await aba(pag, 'ajustes');
    await semSobraLateral(pag, 'Ajustes');
    await foto(pag, '8-ajustes.png', true);
    await pag.fill('#cfg-casa', 'Bistrô Teste');
    await pag.fill('#cfg-alerta', '4');
    await pag.check('#cfg-contar');
    await pag.fill('#cfg-equipe', 'Ana\nBia\n\nana');
    await pag.selectOption('#cfg-tamanho', '100x50');
    assert.strictEqual(await pag.textContent('#hoje'), 'Bistrô Teste · seg, 16/11');
    await aba(pag, 'validades');
    assert.strictEqual(await pag.textContent('.tile[data-sit="breve"] .tile-r'), 'Vencem em até 4 dias');
    assert.deepStrictEqual(await contagem(pag), ['1', '3', '8', '5']);
    await escolherProduto(pag, 'Molho de tomate');
    assert.strictEqual(await validadeNaPrevia(pag), 'QUA 18/11/26');
    assert.ok(/conta como 1º dia/.test(await pag.textContent('#previa-nota')));
    assert.strictEqual(await pag.textContent('#previa .etq-casa'), 'Bistrô Teste');
    assert.deepStrictEqual(await pag.$$eval('#etq-resp option', (els) => els.map((e) => e.textContent)), ['Não informar', 'Ana', 'Bia']);
    assert.strictEqual(await pag.evaluate(() => getComputedStyle(document.querySelector('#previa .etq')).getPropertyValue('--l')), '100');
  });

  await teste('o que foi feito continua lá depois de fechar e abrir', async () => {
    await pag.goto(url + '#perdas');
    assert.ok(await pag.isVisible('.barras'), 'abre na aba do endereço');
    await aba(pag, 'validades');
    assert.strictEqual(await pag.textContent('#hoje'), 'Bistrô Teste · seg, 16/11');
    assert.deepStrictEqual(await contagem(pag), ['1', '3', '8', '5']);
  });

  await teste('começar do zero apaga o exemplo e mantém o catálogo', async () => {
    await pag.click('[data-acao="zerar"]');
    await pag.click('#frm button[type="submit"]');
    assert.strictEqual(await pag.isVisible('.exemplo'), false);
    assert.deepStrictEqual(await contagem(pag), ['0', '0', '0', '0']);
    assert.ok(/Nenhuma etiqueta ativa/.test(await pag.textContent('#lista')));
    assert.strictEqual(await pag.textContent('#hoje'), 'seg, 16/11');
    await aba(pag, 'perdas');
    assert.ok(/Nenhuma baixa no período/.test(await pag.textContent('#app')));
    assert.deepStrictEqual(await contagem(pag), ['0', '0', '0', '–']);
    await aba(pag, 'produtos');
    assert.strictEqual(await pag.locator('#lista .item').count(), 24);
    await escolherProduto(pag, 'Arroz branco');
    assert.ok(await pag.isVisible('input#etq-resp'), 'sem equipe cadastrada, o responsável vira texto');
    await pag.click('#emitir');
    assert.ok(/Etiqueta Nº 000001 registrada/.test(await pag.textContent('#aviso')));
  });

  await teste('cópia de segurança: baixa, apaga tudo e restaura', async () => {
    await aba(pag, 'ajustes');
    const baixou = pag.waitForEvent('download');
    await pag.click('[data-acao="backup"]');
    const arquivo = await (await baixou).path();
    await pag.click('[data-acao="apagar"]');
    await pag.click('#frm button[type="submit"]');
    await aba(pag, 'produtos');
    assert.ok(/Nenhum produto cadastrado/.test(await pag.textContent('#lista')));
    await aba(pag, 'etiquetar');
    assert.ok(/Nenhum produto cadastrado/.test(await pag.textContent('#app')));
    await aba(pag, 'ajustes');
    await pag.setInputFiles('#arq', arquivo);
    await pag.locator('#frm:has-text("24 produtos e 1 etiqueta")').waitFor();   // a leitura do arquivo termina depois
    await pag.click('#frm button[type="submit"]');
    await aba(pag, 'validades');
    assert.deepStrictEqual(await contagem(pag), ['0', '0', '0', '1']);
    await aba(pag, 'ajustes');
    await pag.setInputFiles('#arq', { name: 'outro.json', mimeType: 'application/json', buffer: Buffer.from('{"nada":1}') });
    await pag.locator('#aviso:has-text("não é uma cópia de segurança")').waitFor();
  });

  assert.deepStrictEqual(erros, [], 'erros no console');
  await ctx.close();

  await teste('o painel acompanha o relógio sem ninguém tocar na tela', async () => {
    const a = await abrir();
    assert.deepStrictEqual(await contagem(a.pag), ['2', '3', '3', '7']);
    await a.pag.clock.install({ time: new Date(SEGUNDA) });
    await a.pag.reload();
    await a.pag.clock.fastForward('12:01:00');   // passa da meia-noite: o que vencia hoje venceu
    assert.strictEqual(await a.pag.textContent('#hoje'), 'Cozinha Modelo · ter, 17/11');
    assert.deepStrictEqual(await contagem(a.pag), ['5', '1', '3', '6']);
    assert.deepStrictEqual(a.erros, []);
    await a.ctx.close();
  });

  await teste('tema escuro e tela larga', async () => {
    const escuro = await abrir({ colorScheme: 'dark' });
    assert.notStrictEqual(await escuro.pag.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(237, 240, 244)');
    await foto(escuro.pag, '9-validades-escuro.png');
    await escuro.ctx.close();
    const largo = await abrir({ viewport: { width: 1180, height: 820 } });
    await semSobraLateral(largo.pag, 'Validades, tela larga');
    await foto(largo.pag, '10-validades-tablet.png');
    await escolherProduto(largo.pag, 'Filé de tilápia');
    await largo.pag.check('#modo-descongelado', { force: true });
    await largo.pag.selectOption('#etq-local', 'Geladeira 1 · linha quente');
    await largo.pag.selectOption('#etq-resp', 'Bruno');
    await largo.pag.fill('#etq-qtd', '3 kg');
    const form = await largo.pag.locator('#form-etq').boundingBox();
    const previa = await largo.pag.locator('.previa-col').boundingBox();
    assert.ok(previa.x > form.x + form.width, 'prévia ao lado do formulário');
    await foto(largo.pag, '11-etiquetar-tablet.png');
    assert.deepStrictEqual(largo.erros, []);
    await largo.ctx.close();
  });

  await teste('prévia publicada: sem impressão e sem arquivos', async () => {
    const p = await abrir({}, true);
    assert.strictEqual(await p.pag.locator('[data-reimprimir]').count(), 0);
    await escolherProduto(p.pag, 'Vinagrete');
    assert.strictEqual(await p.pag.textContent('#emitir'), 'Registrar 1 etiqueta');
    await p.pag.click('#emitir');
    assert.ok(/a impressão fica desligada/.test(await p.pag.textContent('#aviso')));
    assert.strictEqual(await p.pag.evaluate(() => window.__impressoes), 0);
    await aba(p.pag, 'perdas');
    assert.strictEqual(await p.pag.locator('[data-acao="exportar"]').count(), 0);
    await aba(p.pag, 'ajustes');
    assert.strictEqual(await p.pag.locator('[data-acao="backup"], [data-acao="restaurar"]').count(), 0);
    assert.deepStrictEqual(p.erros, []);
    await p.ctx.close();
  });

  await nav.close();
  servidor.close();
  console.log(`\n${n} testes passaram.` + (capturas ? ' Capturas regravadas.' : ''));
})().catch((e) => { console.error(e); process.exit(1); });
