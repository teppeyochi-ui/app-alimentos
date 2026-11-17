#!/usr/bin/env node
// Teste da interface no Chromium (Playwright), com a data do aparelho fixa e a impressão simulada:
//   node teste-interface.js            roda os testes
//   node teste-interface.js --capturas roda e regrava as imagens de capturas/
'use strict';
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const N = require('./core.js');
const { criarServidorFalso } = require('./supabase/teste/servidor-falso.js');
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

  async function abrir(opcoes, previa, preparar) {
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
    if (preparar) await preparar(pag);
    await pag.goto(url);
    return { ctx, pag, erros };
  }

  async function teste(nome, fn) { await fn(); n++; console.log('ok  ' + nome); }
  // O aviso some sozinho em poucos segundos; sai da frente para não cobrir a tela na imagem.
  const foto = async (pag, arq, inteira) => {
    if (!capturas) return;
    await pag.evaluate((inteira) => { document.getElementById('aviso').hidden = true; if (!inteira) window.scrollTo(0, 0); }, !!inteira);
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
    assert.deepStrictEqual(await contagem(pag), ['2', '3', '3', '9']);
    assert.strictEqual(await pag.textContent('#hoje'), 'Cozinha Modelo · seg, 16/11');
    assert.deepStrictEqual(await pag.$$eval('#lista h2', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim())),
      ['Vencidos 2', 'Vencem hoje 3', 'Vencem em até 2 dias 3', 'No prazo 9']);
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
    assert.strictEqual(await pag.locator('#lista .item').count(), 17);
    await pag.selectOption('#filtro-local', 'Freezer');
    assert.strictEqual(await pag.locator('#lista .item').count(), 5);
    await pag.selectOption('#filtro-local', '');
    await pag.selectOption('#filtro-tipo', 'pa');
    assert.strictEqual(await pag.locator('#lista .item').count(), 2);
    assert.ok(/Feito com Nº 000109 \(Molho de tomate\)/.test(await pag.textContent('#lista')), 'o acabado mostra de que etiqueta foi feito');
    await pag.selectOption('#filtro-tipo', 'mp');
    assert.strictEqual(await pag.locator('#lista .item').count(), 4);
    await pag.selectOption('#filtro-tipo', '');
    await pag.fill('#busca', 'mp001');
    assert.strictEqual(await pag.locator('#lista .item').count(), 1, 'busca pelo código do produto');
    await pag.fill('#busca', 'ZZ000110');
    assert.ok(/pote 300 g/.test(await pag.textContent('#lista .item')), 'busca pelo código da etiqueta');
    await pag.fill('#busca', 'queijo');
    assert.strictEqual(await pag.locator('#lista .item').count(), 1);
    assert.ok(/validade do fabricante/.test(await pag.textContent('#lista .item')));
    await pag.fill('#busca', 'nada disso');
    assert.ok(/Nada encontrado/.test(await pag.textContent('#lista')));
    await pag.fill('#busca', '');
  });

  await teste('dá baixa como usado, desfaz e descarta com motivo', async () => {
    await pag.click('#lista .item:has-text("Tomate em cubos") [data-usar]');
    assert.deepStrictEqual(await contagem(pag), ['1', '3', '3', '9']);
    assert.ok(/marcado como usado/.test(await pag.textContent('#aviso')));
    await pag.click('#aviso-acao');
    assert.deepStrictEqual(await contagem(pag), ['2', '3', '3', '9']);
    await pag.click('#lista .item:has-text("Tomate em cubos") [data-descartar]');
    assert.strictEqual(await pag.inputValue('#frm input[name="motivo"]:checked'), 'Vencido');
    await pag.selectOption('#desc-por', 'Carla');
    await foto(pag, '2-descartar.png');
    await pag.click('#frm button[type="submit"]');
    assert.deepStrictEqual(await contagem(pag), ['1', '3', '3', '9']);
    // Item ainda no prazo: o motivo sugerido muda.
    await pag.click('#lista .item:has-text("Brigadeiro") [data-descartar]');
    assert.strictEqual(await pag.inputValue('#frm input[name="motivo"]:checked'), 'Sobra de produção');
    await pag.click('#frm [data-acao="fechar"]');
    assert.deepStrictEqual(await contagem(pag), ['1', '3', '3', '9']);
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
    assert.ok(/numeradas de 000114 a 000116/.test(await pag.textContent('#previa-nota')), await pag.textContent('#previa-nota'));
    assert.ok(/Resp\. Ana · Câmara fria · 2 kg/.test(await pag.textContent('#previa .etq-pe')));
    await semSobraLateral(pag, 'Etiquetar, formulário');
    await foto(pag, '4-etiquetar.png', true);
  });

  await teste('etiqueta: nada vaza do papel e as barras cabem, em cada tamanho de rolo', async () => {
    // Nome comprido, rodapé cheio: o pior caso para caber.
    await pag.fill('#etq-qtd', '12,5 kg');
    for (const [tamanho, pontos] of [['60x40', 3], ['50x30', 2], ['100x50', 4], ['104x150', 4], ['40x25', 2]]) {
      await aba(pag, 'ajustes');
      if (await pag.$('#cfg-tamanho option[value="' + tamanho + '"]')) await pag.selectOption('#cfg-tamanho', tamanho);
      else {
        await pag.selectOption('#cfg-tamanho', 'outro');
        await pag.fill('#cfg-larg', tamanho.split('x')[0]);
        await pag.fill('#cfg-alt', tamanho.split('x')[1]);
        await pag.locator('#cfg-alt').blur();
      }
      await aba(pag, 'etiquetar');
      const medida = await pag.evaluate(() => {
        const papel = document.querySelector('#previa .etq').getBoundingClientRect();
        const fora = Array.from(document.querySelectorAll('#previa .etq-dentro > *, #previa .cb')).filter((el) => {
          const r = el.getBoundingClientRect();
          const cortado = !el.matches('.etq-pe, .cb') && el.scrollWidth > el.clientWidth + 1;
          return r.top < papel.top - 0.5 || r.bottom > papel.bottom + 0.5 || r.left < papel.left - 0.5 || r.right > papel.right + 0.5 || cortado;
        }).map((el) => el.className.baseVal || el.className);
        const cb = document.querySelector('#previa .cb');
        const l = +getComputedStyle(document.querySelector('#previa .etq')).getPropertyValue('--l');
        // Largura das barras em milímetros no papel, e quantos módulos elas têm.
        // (clientWidth: a largura do papel sem a borda que só existe na prévia.)
        return { fora, mm: cb.getBoundingClientRect().width / document.querySelector('#previa .etq').clientWidth * l, modulos: +cb.getAttribute('viewBox').split(' ')[2] };
      });
      assert.deepStrictEqual(medida.fora, [], 'etiqueta ' + tamanho);
      // Cada módulo ocupa um número inteiro de pontos da impressora (8 pontos por mm).
      assert.ok(Math.abs(medida.mm / medida.modulos / 0.125 - pontos) < 0.02, tamanho + ': ' + (medida.mm / medida.modulos / 0.125).toFixed(3) + ' pontos por módulo');
    }
    // Tamanho que a impressora não aceita: avisa e mantém o anterior.
    await aba(pag, 'ajustes');
    await pag.fill('#cfg-larg', '150');
    await pag.locator('#cfg-larg').blur();
    assert.ok(await pag.isVisible('#cfg-tam-erro'));
    await pag.selectOption('#cfg-tamanho', '60x40');
    assert.strictEqual(await pag.isVisible('#cfg-tam-erro'), false);
    assert.strictEqual(await pag.isVisible('#cfg-larg'), false);
    await aba(pag, 'etiquetar');
    await pag.fill('#etq-qtd', '2 kg');
  });

  await teste('etiqueta: imprime uma por página no tamanho do rolo e registra', async () => {
    await pag.click('#emitir');
    assert.ok(/3 etiquetas registradas/.test(await pag.textContent('#aviso')));
    assert.strictEqual(await pag.evaluate(() => window.__impressoes), 1);
    assert.strictEqual(await pag.locator('#impressao .etq').count(), 3);
    assert.deepStrictEqual(await pag.$$eval('#impressao .etq-num', (els) => els.map((e) => e.textContent)), ['ZZ000114', 'ZZ000115', 'ZZ000116']);
    assert.ok(/size: 60mm 40mm/.test(await pag.textContent('#pagina')));
    await pag.emulateMedia({ media: 'print' });
    const caixa = await pag.locator('#impressao .etq').first().boundingBox();
    assert.ok(Math.abs(caixa.width - 60 * 96 / 25.4) < 1 && Math.abs(caixa.height - 40 * 96 / 25.4) < 1, JSON.stringify(caixa));
    assert.strictEqual(await pag.isVisible('main'), false, 'só as etiquetas vão para o papel');
    await pag.emulateMedia({ media: 'screen' });
    assert.ok(await pag.isVisible('.grade'), 'volta para a escolha do produto');
    await pag.click('#aviso-acao');
    assert.deepStrictEqual(await contagem(pag), ['1', '3', '3', '12']);
    await pag.click('#lista .item:has-text("000115") [data-reimprimir]');
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
    assert.strictEqual(await pag.locator('#lista .item').count(), 27);
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
    assert.strictEqual(await pag.locator('#lista .item').count(), 27);
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
    assert.ok(planilha.startsWith('﻿Número;Código;Produto;Tipo;Grupo'));
    assert.ok(/000116;PP005;Molho de tomate;Em processo;Molhos e bases;Resfriado;Câmara fria;2 kg;Ana;16\/11\/26 12:00;19\/11\/26 23:59;;;;;;;Ativa, no prazo/.test(planilha));
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
    assert.deepStrictEqual(await contagem(pag), ['1', '3', '8', '7']);
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
    assert.deepStrictEqual(await contagem(pag), ['1', '3', '8', '7']);
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
    assert.strictEqual(await pag.locator('#lista .item').count(), 27);
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
    await pag.locator('#frm:has-text("27 produtos e 1 etiqueta")').waitFor();   // a leitura do arquivo termina depois
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
    assert.deepStrictEqual(await contagem(a.pag), ['2', '3', '3', '9']);
    await a.pag.clock.install({ time: new Date(SEGUNDA) });
    await a.pag.reload();
    await a.pag.clock.fastForward('12:01:00');   // passa da meia-noite: o que vencia hoje venceu
    assert.strictEqual(await a.pag.textContent('#hoje'), 'Cozinha Modelo · ter, 17/11');
    assert.deepStrictEqual(await contagem(a.pag), ['5', '1', '3', '8']);
    assert.deepStrictEqual(a.erros, []);
    await a.ctx.close();
  });

  // ---------- leitor de código de barras, cartela e impressora ----------
  // bipe: o que o leitor faz no campo de leitura (digita o código e aperta Enter).
  const bipe = async (p, codigo) => { await p.fill('#leitor-campo', codigo); await p.press('#leitor-campo', 'Enter'); };
  // leitorSolto: o leitor disparado com o cursor onde estiver, tecla a tecla.
  const leitorSolto = async (p, codigo) => { await p.keyboard.type(codigo); await p.keyboard.press('Enter'); };
  const retorno = (p) => p.textContent('.retorno p');
  // Refaz a sequência de módulos a partir dos retângulos desenhados, como o leitor enxerga.
  const barrasDe = (p, seletor) => p.$$eval(seletor, (svgs) => svgs.map((svg) => {
    const bits = Array(+svg.getAttribute('viewBox').split(' ')[2]).fill('0');
    svg.querySelectorAll('rect').forEach((r) => { for (let i = +r.getAttribute('x'), f = i + +r.getAttribute('width'); i < f; i++) bits[i] = '1'; });
    return { codigo: svg.dataset.codigo, bits: bits.join('') };
  }));
  const confereBarras = (lidas) => lidas.forEach((b) => assert.strictEqual(b.bits, '0'.repeat(10) + N.code128(b.codigo) + '0'.repeat(10), 'barras de ' + b.codigo));
  const MM = 96 / 25.4;   // pixels por milímetro no papel

  const L = await abrir({ viewport: { width: 1180, height: 820 } });

  await teste('leitor: entrada de matéria-prima do começo ao fim, só bipando', async () => {
    const p = L.pag;
    await aba(p, 'leitor');
    assert.strictEqual(await p.evaluate(() => document.activeElement.id), 'leitor-campo', 'o cursor já espera no campo de leitura');
    await foto(p, '12-leitor.png');
    await bipe(p, 'ZZPBRUNO');
    assert.strictEqual(await retorno(p), 'Quem está trabalhando: Bruno');
    assert.strictEqual(await p.inputValue('#leitor-operador'), 'Bruno');
    await bipe(p, 'mp001');
    assert.strictEqual(await p.textContent('.leitor-nome'), 'Camarão limpo');
    assert.strictEqual(await p.textContent('.sobre'), 'Etiqueta nova · Matéria-prima · MP001');
    assert.strictEqual(await p.textContent('#leitor-vence'), 'Vence qua 18/11 · Resfriado, 2 dias');
    await bipe(p, 'MP001');
    await bipe(p, 'MP001');
    assert.strictEqual(await p.textContent('#leitor-n'), '3', 'cada leitura do mesmo código soma uma etiqueta');
    await bipe(p, 'ZZQ5');
    await bipe(p, 'ZZC2');
    assert.strictEqual(await p.textContent('#leitor-vence'), 'Vence dom 14/02 · Congelado, 90 dias');
    assert.strictEqual(await p.getAttribute('.escolha.on', 'data-bip'), 'ZZC2');
    assert.strictEqual(await p.textContent('#leitor-ok'), 'Imprimir 5 etiquetas');
    assert.strictEqual(await p.textContent('#previa .etq-tipo'), 'MATÉRIA-PRIMA');
    assert.strictEqual(await p.textContent('#previa .etq-linha span'), 'ENTRADA');
    assert.strictEqual(await p.locator('.origens').count(), 0, 'matéria-prima não tem origem');
    // Campos opcionais: a prévia acompanha sem tirar o cursor do campo.
    await p.fill('#lt-lote', 'L2291');
    await p.fill('#lt-valorig', '2026-12-20');
    assert.strictEqual(await p.textContent('#leitor-vence'), 'Vence dom 20/12 · Congelado, 90 dias (encurtada pela validade do fabricante)');
    assert.ok(/Resp\. Bruno · Lote L2291/.test(await p.textContent('#previa .etq-pe')));
    await foto(p, '13-leitor-entrada.png');
    // Ler outro produto no meio é recusado, e nada do que foi preenchido se perde.
    await bipe(p, 'PP001');
    assert.strictEqual(await retorno(p), 'Antes, imprima ou cancele as etiquetas de Camarão limpo.');
    assert.strictEqual(await p.getAttribute('.retorno', 'role'), 'alert');
    assert.strictEqual(await p.inputValue('#lt-lote'), 'L2291');
    assert.strictEqual(await p.textContent('#leitor-n'), '5');
    await bipe(p, 'ZZOK');
    assert.strictEqual(await retorno(p), '5 etiquetas de Camarão limpo: registradas.');
    assert.strictEqual(await p.evaluate(() => window.__impressoes), 1);
    assert.deepStrictEqual(await p.$$eval('#impressao .etq-num', (els) => els.map((e) => e.textContent)), ['ZZ000114', 'ZZ000115', 'ZZ000116', 'ZZ000117', 'ZZ000118']);
    assert.ok(await p.isVisible('.leitor-livre'), 'volta a esperar a próxima leitura');
    assert.strictEqual(await p.evaluate(() => document.activeElement.id), 'leitor-campo');
    assert.ok(/5 etiquetas de Camarão limpo: registradas/.test(await p.textContent('.leituras')));
  });

  await teste('etiqueta impressa: as barras dizem o número certo, em pontos inteiros da impressora', async () => {
    const p = L.pag;
    const lidas = await barrasDe(p, '#impressao .cb');
    assert.deepStrictEqual(lidas.map((b) => b.codigo), ['ZZ000114', 'ZZ000115', 'ZZ000116', 'ZZ000117', 'ZZ000118']);
    confereBarras(lidas);
    await p.emulateMedia({ media: 'print' });
    const caixa = await p.locator('#impressao .cb').first().boundingBox();
    const papel = await p.locator('#impressao .etq').first().boundingBox();
    await p.emulateMedia({ media: 'screen' });
    // 123 módulos + 20 de margem clara, 3 pontos de 0,125 mm cada: 53,6 mm numa etiqueta de 60 mm.
    assert.ok(Math.abs(caixa.width - 143 * 3 * 0.125 * MM) < 0.5, 'largura das barras: ' + (caixa.width / MM).toFixed(2) + ' mm');
    assert.ok(caixa.height >= 6 * MM, 'altura das barras: ' + (caixa.height / MM).toFixed(2) + ' mm');
    assert.ok(caixa.x >= papel.x && caixa.x + caixa.width <= papel.x + papel.width && caixa.y + caixa.height <= papel.y + papel.height, 'barras dentro do papel');
  });

  await teste('leitor: lê a etiqueta e dá baixa como usada ou descartada', async () => {
    const p = L.pag;
    await bipe(p, 'ZZ000114');
    assert.strictEqual(await p.textContent('.sobre'), 'Etiqueta Nº 000114 · Matéria-prima');
    assert.strictEqual(await p.textContent('.leitor-cartao .pill'), 'vence em 34 dias');
    await foto(p, '14-leitor-baixa.png');
    await bipe(p, 'ZZUSO');
    assert.strictEqual(await retorno(p), 'Camarão limpo: baixa como usado.');
    await p.click('[data-acao="desfazer-leitor"]');
    assert.strictEqual(await retorno(p), 'Camarão limpo: baixa desfeita.');
    // Pelos botões grandes da tela, que mandam os mesmos códigos.
    await bipe(p, 'ZZ000114');
    await p.click('[data-bip="ZZFORA"]');
    assert.strictEqual(await retorno(p), 'Qual o motivo do descarte?');
    assert.deepStrictEqual(await p.locator('.escolha strong').allTextContents(), N.MOTIVOS);
    await p.click('.escolha:has-text("Embalagem danificada")');
    assert.strictEqual(await retorno(p), 'Camarão limpo: descartado (embalagem danificada).');
    // Etiqueta que já teve baixa: mostra o que aconteceu e deixa desfazer.
    await bipe(p, 'ZZ000114');
    assert.ok(/Baixa em 16\/11 às 12:00: descartada \(embalagem danificada\) por Bruno\./.test(await p.textContent('.leitor-cartao')));
    assert.strictEqual(await p.locator('[data-bip="ZZUSO"]').count(), 0);
    await p.click('[data-acao="desfazer-aberta"]');
    assert.ok(await p.isVisible('[data-bip="ZZUSO"]'));
    await bipe(p, 'ZZNAO');
    assert.ok(await p.isVisible('.leitor-livre'));
    await bipe(p, 'ZZ000999');
    assert.strictEqual(await retorno(p), 'A etiqueta Nº 000999 não está neste aparelho.');
    await bipe(p, 'ZZOK');
    assert.strictEqual(await retorno(p), 'Leia primeiro o código de um produto ou de uma etiqueta.');
  });

  await teste('leitor: produto em processo guarda a origem; código novo vira cadastro', async () => {
    const p = L.pag;
    await bipe(p, 'PP005');
    assert.strictEqual(await p.textContent('.leitor-nome'), 'Molho de tomate');
    assert.ok(/leia a etiqueta do que foi usado/.test(await p.textContent('.origens')));
    assert.strictEqual(await p.locator('#lt-lote').count(), 0, 'lote do fabricante é só da matéria-prima');
    await bipe(p, 'ZZ000115');
    assert.strictEqual(await retorno(p), 'Feito com Camarão limpo (Nº 000115)');
    await p.click('[data-tira-origem="115"]');
    assert.strictEqual(await p.locator('.origens li').count(), 0);
    await bipe(p, 'ZZ000115');
    await bipe(p, 'ZZ000116');
    assert.deepStrictEqual(await p.locator('.origens li span').allTextContents(), ['Nº 000115 (Camarão limpo)', 'Nº 000116 (Camarão limpo)']);
    await p.click('#leitor-ok');
    assert.strictEqual(await retorno(p), '1 etiqueta de Molho de tomate: registrada.');
    await aba(p, 'validades');
    await p.fill('#busca', 'ZZ000119');
    assert.ok(/Feito com Nº 000115 \(Camarão limpo\), Nº 000116 \(Camarão limpo\)/.test(await p.textContent('#lista .item')));
    assert.ok(/Bruno/.test(await p.textContent('#lista .item')), 'quem está trabalhando vira o responsável');
    await p.fill('#busca', '');
    // Código que o app não conhece (o da caixa do fornecedor, por exemplo): cadastra e segue.
    await aba(p, 'leitor');
    await bipe(p, '7891234567895');
    assert.strictEqual(await retorno(p), 'Código não cadastrado: 7891234567895');
    await p.click('[data-acao="cadastrar-lido"]');
    assert.strictEqual(await p.inputValue('#p-codigo'), '7891234567895');
    assert.ok(await p.isChecked('#p-tipo-mp'));
    await p.fill('#p-nome', 'Azeite 500 ml');
    await p.fill('#p-n-ambiente', '60');
    await p.click('#frm button[type="submit"]');
    assert.strictEqual(await p.textContent('.leitor-nome'), 'Azeite 500 ml', 'depois de cadastrar, a etiqueta já está a caminho');
    assert.strictEqual(await p.textContent('#leitor-vence'), 'Vence sex 15/01 · Ambiente, 60 dias');
    await bipe(p, 'ZZNAO');
    // O começo ZZ é do app: não pode ser código de produto.
    await aba(p, 'produtos');
    await p.click('[data-acao="novo-produto"]');
    await p.fill('#p-nome', 'Teste');
    await p.fill('#p-codigo', 'zz10');
    await p.fill('#p-n-resfriado', '2');
    await p.click('#frm button[type="submit"]');
    assert.ok(/começam com ZZ/.test(await p.textContent('#dlg-erro')));
    await p.fill('#p-codigo', 'MP001');
    await p.click('#frm button[type="submit"]');
    assert.ok(/já é de Camarão limpo/.test(await p.textContent('#dlg-erro')));
    await p.click('#frm [data-acao="fechar"]');
    await p.fill('#prod-busca', '7891234');
    assert.ok(/Azeite 500 ml/.test(await p.textContent('#lista .item')), 'busca pelo código');
    assert.deepStrictEqual(await p.locator('#lista h2').allTextContents().then((t) => t.map((x) => x.replace(/\s+/g, ' ').trim())), ['Matéria-prima 1']);
    await p.fill('#prod-busca', '');
    assert.deepStrictEqual(L.erros, []);
  });

  await teste('leitor: funciona de qualquer aba, e o Enter do leitor não aperta botão', async () => {
    const p = L.pag;
    await aba(p, 'validades');
    await p.focus('#lista .item [data-descartar]');
    await leitorSolto(p, 'MP001');
    assert.strictEqual(await p.isVisible('#dlg'), false, 'o Enter não abriu o descarte');
    assert.strictEqual(await p.textContent('.leitor-nome'), 'Camarão limpo', 'a leitura levou para a aba Leitor');
    // Leitura que cai num campo opcional: vale como leitura, e o que estava escrito ali continua.
    await p.fill('#lt-qtd', '2 kg');
    await p.focus('#lt-qtd');
    await leitorSolto(p, 'ZZQ4');
    assert.strictEqual(await p.textContent('#leitor-n'), '4');
    assert.strictEqual(await p.inputValue('#lt-qtd'), '2 kg');
    // Texto comum no campo opcional: fica no campo, e o Enter devolve o cursor ao campo de leitura.
    await p.focus('#lt-lote');
    await leitorSolto(p, 'LOTE77');
    assert.strictEqual(await p.inputValue('#lt-lote'), 'LOTE77');
    assert.strictEqual(await p.evaluate(() => document.activeElement.id), 'leitor-campo');
    assert.strictEqual(await p.textContent('#leitor-n'), '4');
    await bipe(p, 'ZZNAO');
    // Digitação lenta de uma pessoa fora de um campo não é leitura.
    await aba(p, 'perdas');
    await p.keyboard.type('MP001', { delay: 260 });
    await p.keyboard.press('Enter');
    assert.ok(await p.isVisible('.barras'), 'continua na aba Perdas');
    assert.deepStrictEqual(L.erros, []);
  });

  await teste('cartela de códigos: tudo o que está nela é lido de volta', async () => {
    const p = L.pag;
    await aba(p, 'leitor');
    await p.click('[data-acao="abrir-cartela"]');
    assert.deepStrictEqual(await p.locator('.folha .cart-sec h3').allTextContents(),
      ['Comandos', 'Número de etiquetas', 'Conservação', 'Motivo do descarte', 'Quem está trabalhando', 'Local', 'Matéria-prima', 'Em processo', 'Produto acabado']);
    const lidas = await barrasDe(p, '.folha .cb');
    assert.strictEqual(lidas.length, 4 + 15 + 4 + 5 + 4 + 6 + 28);
    confereBarras(lidas);
    assert.deepStrictEqual(await p.locator('.folha .cart-sec:first-of-type .cart-cel strong').allTextContents(), ['IMPRIMIR', 'CANCELAR', 'USADO', 'DESCARTAR']);
    // Nenhum código espremido na célula; os compridos ocupam duas colunas.
    assert.strictEqual(await p.$$eval('.folha .cart-cel', (cs) => cs.filter((c) => c.querySelector('.cb').getBoundingClientRect().width > c.clientWidth - 2).length), 0);
    assert.deepStrictEqual(await p.locator('.folha .cart-cel.dupla strong').allTextContents(),
      ['Câmara fria', 'Geladeira 1 · linha quente', 'Geladeira 2 · saladas', 'Confeitaria', 'Estoque seco', 'Azeite 500 ml'], 'códigos com mais de 10 caracteres');
    await semSobraLateral(p, 'Cartela');
    await foto(p, '15-cartela.png', true);
    const antes = await p.evaluate(() => window.__impressoes);
    await p.click('[data-acao="imprimir-cartela"]');
    assert.strictEqual(await p.evaluate(() => window.__impressoes), antes + 1);
    assert.ok(/size: A4/.test(await p.textContent('#pagina')));
    confereBarras(await barrasDe(p, '#impressao .cb'));
    await p.emulateMedia({ media: 'print' });
    const zzok = await p.locator('#impressao .cb[data-codigo="ZZOK"]').boundingBox();
    const folha = await p.locator('#impressao .cart').boundingBox();
    const celulas = await p.$$eval('#impressao .cart-cel', (cs) => cs.filter((c) => c.querySelector('.cb').getBoundingClientRect().width > c.clientWidth - 2).length);
    await p.emulateMedia({ media: 'screen' });
    assert.ok(Math.abs(zzok.width - (N.code128('ZZOK').length + 20) * 0.33 * MM) < 0.5, 'módulo de 0,33 mm na folha');
    assert.ok(zzok.height >= 11.5 * MM);
    assert.strictEqual(celulas, 0, 'no papel também cabe');
    assert.ok(folha.width > 0);
    // A mesma cartela em etiquetas, para quem só tem a impressora de etiquetas.
    await p.click('[data-acao="imprimir-cartela-etq"]');
    assert.ok(/size: 60mm 40mm/.test(await p.textContent('#pagina')));
    assert.strictEqual(await p.locator('#impressao .etq-codigo').count(), lidas.length - 2);
    assert.ok(/2 códigos não couberam/.test(await p.textContent('#aviso')));
    confereBarras(await barrasDe(p, '#impressao .cb'));
    await p.click('[data-acao="fechar-cartela"]');
    assert.ok(await p.isVisible('#leitor-campo'));
  });

  await teste('impressora: etiqueta de teste, tamanho das letras e ajuda', async () => {
    const p = L.pag;
    await aba(p, 'ajustes');
    await semSobraLateral(p, 'Ajustes');
    await foto(p, '16-ajustes-impressora.png');
    await p.click('[data-acao="etiqueta-teste"]');
    assert.strictEqual(await p.textContent('#impressao .etq-num'), 'ZZ000000');
    assert.strictEqual(await p.textContent('#impressao .etq-nome'), 'Etiqueta de teste');
    confereBarras(await barrasDe(p, '#impressao .cb'));
    await p.click('#ajuda-impressora summary');
    assert.strictEqual(await p.locator('#ajuda-impressora li').count(), 6);
    await p.selectOption('#cfg-letra', 'maior');
    assert.strictEqual(await p.evaluate(() => getComputedStyle(document.documentElement).fontSize), '20px');
    await aba(p, 'leitor');
    await bipe(p, 'ZZ000000');
    assert.strictEqual(await retorno(p), 'Etiqueta de teste lida. Impressora e leitor estão funcionando.');
    assert.deepStrictEqual(L.erros, []);
    await L.ctx.close();
  });

  await teste('leitor no celular, com letras muito grandes: nada vaza da tela', async () => {
    const c = await abrir();
    await aba(c.pag, 'ajustes');
    await c.pag.selectOption('#cfg-letra', 'maior');
    for (const nome of ['validades', 'leitor', 'etiquetar', 'produtos', 'perdas', 'ajustes']) { await aba(c.pag, nome); await semSobraLateral(c.pag, nome + ' com letras grandes'); }
    await aba(c.pag, 'leitor');
    await bipe(c.pag, 'PP001');
    await bipe(c.pag, 'ZZQ12');
    await semSobraLateral(c.pag, 'Leitor, etiqueta nova');
    await foto(c.pag, '17-leitor-celular.png', true);
    await bipe(c.pag, 'ZZNAO');
    await bipe(c.pag, 'ZZ000110');
    await bipe(c.pag, 'ZZFORA');
    await semSobraLateral(c.pag, 'Leitor, motivo do descarte');
    assert.deepStrictEqual(c.erros, []);
    await c.ctx.close();
  });

  await teste('quem já usava a primeira versão: o exemplo é renovado e os dados de verdade ficam', async () => {
    const antigo = (exemplo) => {
      const d = JSON.parse(JSON.stringify(N.exemplo(new Date(SEGUNDA).getTime())));
      d.versao = 1;
      d.exemplo = exemplo;
      d.produtos.forEach((x) => { delete x.codigo; delete x.tipo; });
      d.etiquetas.forEach((x) => { delete x.codigo; delete x.tipo; delete x.origens; });
      d.produtos.length = 24;
      d.config.casa = 'Casa Antiga';
      return JSON.stringify(d);
    };
    const m = await abrir();
    await m.pag.evaluate((json) => localStorage.setItem('validade_em_dia_v1', json), antigo(true));
    await m.pag.reload();
    assert.strictEqual(await m.pag.textContent('#hoje'), 'Cozinha Modelo · seg, 16/11', 'exemplo antigo dá lugar ao novo');
    await aba(m.pag, 'leitor');
    await bipe(m.pag, 'PA001');
    assert.strictEqual(await m.pag.textContent('.leitor-nome'), 'Lasanha de carne 500 g');
    await m.pag.evaluate((json) => localStorage.setItem('validade_em_dia_v1', json), antigo(false));
    await m.pag.reload();
    assert.strictEqual(await m.pag.textContent('#hoje'), 'Casa Antiga · seg, 16/11', 'dados de verdade continuam');
    await aba(m.pag, 'produtos');
    assert.strictEqual(await m.pag.locator('#lista .item').count(), 24);
    assert.deepStrictEqual(await m.pag.locator('#lista h2').allTextContents().then((t) => t.map((x) => x.replace(/\s+/g, ' ').trim())), ['Em processo 24']);
    assert.ok(/sem código/.test(await m.pag.textContent('#lista .item')));
    await aba(m.pag, 'leitor');
    await m.pag.click('[data-acao="abrir-cartela"]');
    assert.ok(/24 produtos sem código ficaram de fora/.test(await m.pag.textContent('#app')));
    assert.deepStrictEqual(m.erros, []);
    await m.ctx.close();
  });

  // ---------- recebimento de mercadoria e contagem de estoque ----------
  const R = await abrir({ viewport: { width: 1180, height: 820 } });

  await teste('recebimento: fornecedor e nota uma vez só, e cada matéria-prima lida entra nele', async () => {
    const p = R.pag;
    await aba(p, 'leitor');
    await p.click('[data-acao="comecar-recebimento"]');
    await p.click('#frm button[type="submit"]');
    assert.strictEqual(await p.textContent('#dlg-erro'), 'Informe o fornecedor.');
    await p.fill('#rec-fornecedor', 'Pescados Atlântico');
    await p.fill('#rec-nota', '4471');
    await p.click('#frm button[type="submit"]');
    assert.strictEqual(await retorno(p), 'Recebimento Nº 4 aberto: Pescados Atlântico. Leia o código de cada produto que chegou.');
    assert.strictEqual(await p.textContent('.faixa p'), 'Recebimento Nº 4 · Pescados Atlântico · NF 4471 · 0 etiquetas');
    assert.strictEqual(await p.locator('[data-acao="comecar-recebimento"]').count(), 0, 'já há um aberto');
    assert.strictEqual(await p.evaluate(() => document.activeElement.id), 'leitor-campo');
    // Matéria-prima: lote, temperatura de chegada e três volumes.
    await bipe(p, 'MP001');
    assert.ok(/Entra no recebimento Nº 4 \(Pescados Atlântico\)\./.test(await p.textContent('.leitor-cartao')));
    await p.fill('#lt-lote', 'L9');
    await p.fill('#lt-temp', '3,5');
    await p.fill('#lt-qtd', '2 kg');
    await bipe(p, 'ZZQ3');
    assert.strictEqual(await p.inputValue('#lt-temp'), '3,5', 'o que foi digitado continua depois de outra leitura');
    await foto(p, '18-recebimento.png');
    await bipe(p, 'ZZOK');
    assert.strictEqual(await retorno(p), '3 etiquetas de Camarão limpo: registradas.');
    assert.ok(/NF 4471 · 3 etiquetas/.test(await p.textContent('.faixa p')));
    // Temperatura que não é número: o app avisa na hora e não imprime.
    await bipe(p, 'MP002');
    await p.fill('#lt-temp', 'frio');
    assert.ok(/temperatura de chegada é um número/.test(await p.textContent('#leitor-vence')));
    const antes = await p.evaluate(() => window.__impressoes);
    await bipe(p, 'ZZOK');
    assert.ok(/temperatura de chegada é um número/.test(await retorno(p)));
    assert.strictEqual(await p.evaluate(() => window.__impressoes), antes);
    await p.fill('#lt-temp', '-15');
    await bipe(p, 'ZZC2');
    await bipe(p, 'ZZOK');
    assert.strictEqual(await retorno(p), '1 etiqueta de Carne moída: registrada.');
    // Produto em processo feito durante o recebimento não entra nele.
    await bipe(p, 'PP001');
    assert.strictEqual(await p.locator('#lt-temp').count(), 0);
    await bipe(p, 'ZZOK');
    assert.ok(/NF 4471 · 4 etiquetas/.test(await p.textContent('.faixa p')));
    // A etiqueta lida depois mostra de onde veio.
    await bipe(p, 'ZZ000114');
    assert.ok(/Recebimento Nº 4 · Pescados Atlântico · NF 4471 · lote L9 · chegou a 3,5 °C/.test(await p.textContent('.leitor-cartao')));
    await bipe(p, 'ZZNAO');
  });

  await teste('recebimento: ao encerrar, mostra o que chegou para conferir com a nota', async () => {
    const p = R.pag;
    await p.click('[data-acao="encerrar-recebimento"]');
    assert.deepStrictEqual(await p.$$eval('#frm tbody tr', (trs) => trs.map((tr) => Array.from(tr.cells).map((c) => c.textContent))),
      [['Camarão limpo', '3', '2 kg', 'L9', '', '3,5 °C'], ['Carne moída', '1', '', '', '', '-15 °C']]);
    await p.fill('#rec-obs', 'Faltou uma caixa de camarão.');
    await foto(p, '19-encerrar-recebimento.png');
    await p.click('#frm button[type="submit"]');
    assert.strictEqual(await retorno(p), 'Recebimento Nº 4 encerrado: 4 etiquetas de Pescados Atlântico.');
    assert.strictEqual(await p.locator('.faixa').count(), 0);
    assert.ok(await p.isVisible('[data-acao="comecar-recebimento"]'));
    // Fora de um recebimento, a matéria-prima sai sem fornecedor (e a tela diz isso).
    await bipe(p, 'MP001');
    assert.ok(/Sem recebimento aberto/.test(await p.textContent('.leitor-cartao')));
    await bipe(p, 'ZZNAO');
    // Histórico na aba Estoque.
    await aba(p, 'estoque');
    assert.strictEqual(await p.locator('#recebimentos .item').count(), 4);
    const primeiro = await p.textContent('#recebimentos .item');
    assert.ok(/Nº 4 · Pescados Atlântico/.test(primeiro) && /NF 4471 · 4 etiquetas/.test(primeiro) && /Camarão limpo ×3, Carne moída ×1/.test(primeiro) && /Obs\.: Faltou uma caixa de camarão\./.test(primeiro), primeiro);
    await p.click('#recebimentos [data-ver-recebimento="r4"]');
    assert.strictEqual(await p.locator('#frm tbody tr').count(), 2);
    assert.ok(/Faltou uma caixa/.test(await p.textContent('#frm')));
    await p.click('#frm [data-acao="fechar"]');
    // Saldo: o camarão que já existia mais os três que chegaram.
    assert.deepStrictEqual(await p.$$eval('#saldo tbody tr', (trs) => trs.filter((tr) => tr.cells[0].textContent === 'Camarão limpo').map((tr) => [tr.cells[1].textContent, tr.cells[2].textContent, tr.cells[3].textContent])),
      [['MP001', 'Matéria-prima', '4']]);
    assert.ok(/22 etiquetas ativas/.test(await p.textContent('#app h2')));
    await semSobraLateral(p, 'Estoque');
    // O fornecedor fica de sugestão; recebimento aberto por engano e encerrado vazio é desfeito.
    await p.click('[data-acao="comecar-recebimento"]');
    assert.strictEqual(await p.getAttribute('#rec-fornecedores option', 'value'), 'Pescados Atlântico');
    await p.fill('#rec-fornecedor', 'Engano');
    await p.click('#frm button[type="submit"]');
    await p.click('[data-acao="encerrar-recebimento"]');
    assert.ok(/Nenhuma etiqueta foi emitida/.test(await p.textContent('#frm')));
    await p.click('#frm button[type="submit"]');
    assert.strictEqual(await retorno(p), 'Recebimento desfeito: nenhuma etiqueta tinha sido emitida.');
    await aba(p, 'estoque');
    assert.strictEqual(await p.locator('#recebimentos .item').count(), 4);
    // No painel e na aba Etiquetar a chegada também aparece.
    await aba(p, 'validades');
    await p.fill('#busca', 'ZZ000117');
    assert.ok(/Recebimento Nº 4 · Pescados Atlântico · NF 4471 · chegou a -15 °C/.test(await p.textContent('#lista .item')));
    await p.fill('#busca', '');
    await escolherProduto(p, 'Camarão limpo');
    assert.ok(await p.isVisible('#etq-temp'));
    assert.ok(/Sem recebimento aberto/.test(await p.textContent('#form-etq')));
    await p.fill('#etq-temp', 'quente');
    assert.ok(/temperatura de chegada é um número/.test(await p.textContent('#previa')));
    await p.click('[data-acao="trocar-produto"]');
    assert.deepStrictEqual(R.erros, []);
  });

  await teste('contagem de estoque: o leitor confere, mostra o que falta e o que estava fora do lugar', async () => {
    const p = R.pag;
    await aba(p, 'estoque');
    await p.click('[data-acao="comecar-contagem"]');
    await p.selectOption('#cont-local', 'Freezer');
    await p.click('#frm button[type="submit"]');
    assert.strictEqual(await retorno(p), 'Contagem Nº 2 começou: Freezer. Leia a etiqueta de cada item.');
    assert.strictEqual(await p.textContent('.sobre'), 'Contagem de estoque Nº 2 · Freezer');
    assert.strictEqual(await p.textContent('.leitor-nome'), '0 de 5 conferidas');
    await bipe(p, 'ZZ000018');
    assert.ok(/^Conferida: .+ \(1 de 5\)\.$/.test(await retorno(p)), await retorno(p));
    await bipe(p, 'ZZ000018');
    assert.ok(/já foi conferida/.test(await retorno(p)));
    assert.strictEqual(await p.getAttribute('.retorno', 'role'), 'alert');
    for (const c of ['ZZ000037', 'ZZ000063', 'ZZ000087']) await bipe(p, c);
    assert.strictEqual(await p.textContent('.leitor-nome'), '4 de 5 conferidas');
    // No meio da contagem não se etiqueta nem se dá baixa.
    await bipe(p, 'MP001');
    assert.ok(/Contagem em andamento: leia as etiquetas/.test(await retorno(p)));
    assert.strictEqual(await p.textContent('.leitor-nome'), '4 de 5 conferidas');
    await escolherProduto(p, 'Vinagrete');
    assert.ok(/contagem de estoque em andamento/.test(await p.textContent('#previa')));
    await p.click('[data-acao="trocar-produto"]');
    // Item de outro local achado no freezer: é conferido e passa a constar ali.
    await aba(p, 'leitor');
    await bipe(p, 'ZZ000110');
    assert.strictEqual(await retorno(p), 'Conferida: Molho de tomate pote 300 g (5 de 6). Local atualizado para Freezer.');
    // Etiqueta que já tinha baixa, mas o item está ali: desfaz a baixa e confere.
    await bipe(p, 'ZZ000001');
    assert.ok(/teve baixa como (usada|descartada) em \d\d\/\d\d\. Se está no estoque, desfaça a baixa\./.test(await retorno(p)));
    await p.click('[data-acao="reativar-contar"]');
    assert.ok(/\(6 de 7\)\. Local atualizado para Freezer\.$/.test(await retorno(p)), await retorno(p));
    await p.click('#cont-faltam summary');
    assert.deepStrictEqual(await p.locator('#cont-faltam li').allTextContents(), ['Nº 000090 Lasanha de carne 500 g']);
    await bipe(p, 'ZZ000999');
    assert.ok(await p.isVisible('#cont-faltam li'), 'a lista do que falta continua aberta depois de outra leitura');
    await foto(p, '20-contagem.png');
    // A contagem fica guardada: fechar e abrir o app continua de onde parou.
    await p.goto(url + '#estoque');
    assert.strictEqual(await p.textContent('.faixa p'), 'Contagem de estoque Nº 2 em andamento · Freezer · 6 de 7 conferidas');
    await p.click('[data-acao="comecar-recebimento"]');
    assert.ok(/contagem de estoque em andamento/.test(await p.textContent('#aviso')));
    await p.click('.faixa [data-aba="leitor"]');
    assert.strictEqual(await p.textContent('.leitor-nome'), '6 de 7 conferidas');
  });

  await teste('contagem de estoque: ao encerrar, decide o que fazer com o que não foi achado', async () => {
    const p = R.pag;
    await p.click('[data-acao="encerrar-contagem"]');
    assert.ok(/6 de 7 conferidas/.test(await p.textContent('#frm')));
    assert.ok(/Nº 000090 Lasanha de carne 500 g · Freezer · vence em \d+ dias/.test(await p.textContent('#frm .lista-simples')));
    assert.ok(await p.isChecked('#cont-deixar'), 'por padrão, nada recebe baixa');
    await foto(p, '21-encerrar-contagem.png');
    await p.check('#cont-baixar');
    await p.click('#frm button[type="submit"]');
    assert.strictEqual(await retorno(p), 'Contagem Nº 2 encerrada: 6 de 7 conferidas; 1 não encontrada recebeu baixa.');
    assert.ok(await p.isVisible('.leitor-livre'));
    await bipe(p, 'ZZ000090');
    assert.ok(/Baixa em 16\/11 às 12:00: descartada \(não encontrado na contagem\)/.test(await p.textContent('.leitor-cartao')));
    await bipe(p, 'ZZNAO');
    await aba(p, 'estoque');
    assert.strictEqual(await p.locator('#contagens .item').count(), 2);
    const primeira = await p.textContent('#contagens .item');
    assert.ok(/Nº 2 · Freezer/.test(primeira) && /6 de 7 conferidas/.test(primeira) && /1 não encontrada: Nº 000090 \(Lasanha de carne 500 g\)\. Recebeu baixa\./.test(primeira), primeira);
    await foto(p, '22-estoque.png', true);
    await aba(p, 'perdas');
    assert.ok((await p.locator('.cartao:first-child .b-nome').allTextContents()).indexOf('Não encontrado na contagem') >= 0);
    // Contagem de tudo, encerrada sem dar baixa; e desistir de uma contagem.
    await aba(p, 'estoque');
    await p.click('[data-acao="comecar-contagem"]');
    await p.selectOption('#cont-tipo', 'pa');
    await p.click('#frm button[type="submit"]');
    assert.strictEqual(await p.textContent('.sobre'), 'Contagem de estoque Nº 3 · Todos os locais · Produto acabado');
    assert.strictEqual(await p.textContent('.leitor-nome'), '0 de 1 conferidas');
    await bipe(p, 'ZZ000114');
    assert.strictEqual(await retorno(p), 'Esta contagem é só de produtos do tipo Produto acabado. Camarão limpo é Matéria-prima.');
    await p.click('[data-acao="encerrar-contagem"]');
    await p.click('#frm button[type="submit"]');
    assert.strictEqual(await retorno(p), 'Contagem Nº 3 encerrada: 0 de 1 conferidas; 1 não encontrada ficou como estava.');
    await aba(p, 'estoque');
    await p.click('[data-acao="comecar-contagem"]');
    await p.click('#frm button[type="submit"]');
    await p.click('[data-acao="desistir-contagem"]');
    assert.deepStrictEqual(await p.locator('#frm .dlg-pe button').allTextContents(), ['Continuar contando', 'Desistir da contagem']);
    await p.click('#frm button[type="submit"]');
    assert.strictEqual(await retorno(p), 'Contagem descartada.');
    await aba(p, 'estoque');
    assert.strictEqual(await p.locator('#contagens .item').count(), 3);
    // Com recebimento aberto não se conta o estoque.
    await p.click('[data-acao="comecar-recebimento"]');
    await p.fill('#rec-fornecedor', 'Pescados Atlântico');
    await p.click('#frm button[type="submit"]');
    await aba(p, 'estoque');
    assert.ok(/Recebimento Nº 5 · Pescados Atlântico · aberto · 0 etiquetas/.test(await p.textContent('.faixa p')));
    await p.click('[data-acao="comecar-contagem"]');
    assert.ok(/recebimento Nº 5 está aberto/.test(await p.textContent('#aviso')));
    assert.deepStrictEqual(R.erros, []);
    await R.ctx.close();
  });

  await teste('recebimento e contagem no celular: nada vaza da tela', async () => {
    const c = await abrir();
    await aba(c.pag, 'estoque');
    await semSobraLateral(c.pag, 'Estoque');
    await c.pag.click('#recebimentos [data-ver-recebimento]');
    await semSobraLateral(c.pag, 'Ver recebimento');
    await c.pag.click('#frm [data-acao="fechar"]');
    await c.pag.click('[data-acao="comecar-contagem"]');
    await c.pag.click('#frm button[type="submit"]');
    await bipe(c.pag, 'ZZ000090');
    await c.pag.click('#cont-faltam summary');
    await semSobraLateral(c.pag, 'Leitor, contagem');
    await c.pag.click('[data-acao="encerrar-contagem"]');
    await semSobraLateral(c.pag, 'Encerrar contagem');
    await c.pag.click('#frm [data-acao="fechar"]');
    assert.ok(await c.pag.evaluate(() => { const b = document.querySelector('.abas button.on').getBoundingClientRect(); return b.left >= 0 && b.right <= window.innerWidth; }), 'a aba aberta fica à vista');
    assert.deepStrictEqual(c.erros, []);
    await c.ctx.close();
  });

  // ---------- nuvem: vários aparelhos (janelas) ligados ao mesmo Supabase de mentira ----------
  const nuvem = await criarServidorFalso();
  nuvem.criarConta('casa@exemplo.com', 'segredo');
  // O arquivo nuvem-config.js do app publicado, apontando para o servidor de mentira.
  const comNuvem = (pag) => pag.route('**/nuvem-config.js', (rota) => rota.fulfill({ contentType: 'text/javascript', body: 'window.NUVEM = ' + JSON.stringify({ url: nuvem.url, chave: nuvem.chave }) + ';' }));
  const linhasDaCasa = () => nuvem.linhas('casa@exemplo.com');
  // Espera uma condição ficar verdadeira (a sincronização acontece sozinha, alguns instantes depois de cada mudança).
  const ate = async (condicao, oQue) => {
    for (let i = 0; i < 100; i++) { if (await condicao()) return; await new Promise((ok) => setTimeout(ok, 100)); }
    assert.fail('não aconteceu a tempo: ' + oQue);
  };
  const emDia = (p) => p.locator('#selo-nuvem:has-text("Nuvem em dia")').waitFor();
  // Faz o aparelho conferir a nuvem agora (o mesmo gatilho de quando a conexão volta).
  const puxar = (p) => p.evaluate(() => window.dispatchEvent(new Event('online')));
  const ligar = async (p, senha) => {
    await aba(p, 'ajustes');
    await p.fill('#nv-email', 'casa@exemplo.com');
    await p.fill('#nv-senha', senha || 'segredo');
    await p.click('#nv-ligar');
  };
  // Pedidos recusados de propósito (senha errada, sessão vencida, servidor fora) aparecem no console do navegador.
  const errosDoApp = (x) => x.erros.filter((e) => !/Failed to load resource|net::ERR_/.test(e));

  const A = await abrir({ viewport: { width: 1180, height: 820 } }, false, comNuvem);
  const B = await abrir({ viewport: { width: 1180, height: 820 } }, false, comNuvem);

  await teste('nuvem: o primeiro aparelho leva os dados da casa para a nuvem', async () => {
    const p = A.pag;
    await aba(p, 'ajustes');
    assert.ok(await p.isVisible('#cartao-nuvem #nv-email'), 'com o endereço no arquivo, só falta a conta da casa');
    assert.strictEqual(await p.locator('[data-acao="nuvem-trocar-config"]').count(), 0);
    assert.strictEqual(await p.isVisible('#selo-nuvem'), false, 'sem nuvem ligada, nada no topo');
    await ligar(p, 'errada');
    await p.locator('#nv-erro:has-text("E-mail ou senha não conferem.")').waitFor();
    assert.strictEqual(await p.isVisible('#selo-nuvem'), false);
    // A casa começa de verdade: sai o exemplo, fica o catálogo, entram o nome e a equipe.
    await aba(p, 'validades');
    await p.click('[data-acao="zerar"]');
    await p.click('#frm button[type="submit"]');
    await aba(p, 'ajustes');
    await p.fill('#cfg-casa', 'Cozinha da Vó');
    await p.fill('#cfg-equipe', 'José\nAna');
    await p.locator('#cfg-equipe').blur();
    await ligar(p);
    await p.locator('#nv-proposta').waitFor();
    assert.strictEqual(await p.textContent('#nv-proposta'), 'A nuvem da casa ainda está vazia. Os dados deste aparelho (27 produtos e 0 etiquetas) serão enviados para ela e passam a ser os dados da casa.');
    await foto(p, '23-ligar-nuvem.png');
    assert.strictEqual(Object.keys(linhasDaCasa()).length, 0, 'nada vai para a nuvem antes da confirmação');
    await p.click('#frm button[type="submit"]');
    await emDia(p);
    assert.strictEqual(Object.keys(linhasDaCasa()).length, 28, '27 produtos e os ajustes da casa');
    assert.deepStrictEqual([linhasDaCasa()['config|config'].dados.casa, linhasDaCasa()['config|config'].dados.equipe], ['Cozinha da Vó', ['José', 'Ana']]);
    assert.strictEqual(linhasDaCasa()['config|config'].dados.tamanho, undefined, 'tamanho da etiqueta é de cada aparelho');
    assert.ok(/^Ligado como casa@exemplo\.com · aparelho [A-Z2-9]{4}$/.test(await p.textContent('#cartao-nuvem p')), await p.textContent('#cartao-nuvem p'));
    await p.locator('#nv-situacao:has-text("Em dia. Última sincronização às 12:00.")').waitFor();
    // Com a nuvem ligada, o que apagaria os dados de todos some dos Ajustes.
    assert.strictEqual(await p.locator('[data-acao="apagar"], [data-acao="exemplos"], [data-acao="restaurar"]').count(), 0);
    assert.strictEqual(await p.locator('[data-acao="backup"]').count(), 1);
    await semSobraLateral(p, 'Ajustes com a nuvem');
    await foto(p, '24-nuvem-ligada.png', true);
    // Etiquetas saem com os números da faixa reservada e sobem sozinhas.
    await aba(p, 'leitor');
    for (const c of ['MP001', 'ZZQ3', 'ZZOK']) await bipe(p, c);
    assert.deepStrictEqual(await p.$$eval('#impressao .etq-num', (els) => els.map((e) => e.textContent)), ['ZZ000001', 'ZZ000002', 'ZZ000003']);
    await ate(() => !!linhasDaCasa()['etiqueta|e3'], 'as etiquetas chegarem à nuvem');
    assert.strictEqual(linhasDaCasa()['etiqueta|e1'].dados.nome, 'Camarão limpo');
    await emDia(p);
  });

  await teste('nuvem: o segundo aparelho recebe tudo, e os dois trabalham juntos', async () => {
    const a = A.pag, b = B.pag;
    await ligar(b);
    await b.locator('#nv-proposta').waitFor();
    assert.strictEqual(await b.textContent('#nv-proposta'), 'Os dados de exemplo deste aparelho saem de cena. Entram os dados que a casa já tem na nuvem.');
    await b.click('#frm button[type="submit"]');
    await emDia(b);
    assert.strictEqual(await b.textContent('#hoje'), 'Cozinha da Vó · seg, 16/11');
    await aba(b, 'validades');
    assert.strictEqual(await b.isVisible('.exemplo'), false);
    assert.deepStrictEqual(await contagem(b), ['0', '0', '3', '0']);
    await aba(b, 'produtos');
    assert.strictEqual(await b.locator('#lista .item').count(), 27);
    // B dá baixa numa etiqueta de A; A vê sem ninguém tocar na tela.
    await aba(a, 'validades');
    await aba(b, 'leitor');
    assert.deepStrictEqual(await b.$$eval('#leitor-operador option', (els) => els.map((e) => e.textContent)), ['Não informar', 'José', 'Ana'], 'a equipe veio da nuvem');
    await bipe(b, 'ZZPANA');
    await bipe(b, 'ZZ000002');
    await bipe(b, 'ZZUSO');
    await ate(() => linhasDaCasa()['etiqueta|e2'].dados.status === 'usada', 'a baixa chegar à nuvem');
    await puxar(a);
    await ate(async () => (await contagem(a))[2] === '2', 'a baixa aparecer no painel do outro aparelho');
    // B etiqueta: número da faixa dele, que nunca bate com a de A.
    await bipe(b, 'PP001');
    await bipe(b, 'ZZOK');
    assert.strictEqual(await b.textContent('#impressao .etq-num'), 'ZZ001001');
    await ate(() => !!linhasDaCasa()['etiqueta|e1001'], 'a etiqueta de B chegar à nuvem');
    await puxar(a);
    await a.locator('#lista .item:has-text("Nº 001001")').waitFor();
    assert.ok(/Filé de tilápia porcionado/.test(await a.textContent('#lista .item:has-text("Nº 001001")')));
    assert.ok(/· Ana/.test(await a.textContent('#lista .item:has-text("Nº 001001")')), 'com o responsável lido em B');
    // Ajuste da casa mudado em B vale em A.
    await aba(b, 'ajustes');
    await b.fill('#cfg-alerta', '4');
    await b.locator('#cfg-alerta').blur();
    await ate(() => linhasDaCasa()['config|config'].dados.alertaDias === 4, 'o ajuste chegar à nuvem');
    await puxar(a);
    await a.locator('.tile[data-sit="breve"]:has-text("Vencem em até 4 dias")').waitFor();
    // Recebimento aberto em A: é de A. B vê no histórico, mas segue livre.
    await aba(a, 'leitor');
    await a.click('[data-acao="comecar-recebimento"]');
    await a.fill('#rec-fornecedor', 'Pescados Sul');
    await a.click('#frm button[type="submit"]');
    assert.ok(/Recebimento Nº 1 · Pescados Sul/.test(await a.textContent('.faixa p')));
    await ate(() => !!linhasDaCasa()['recebimento|r1'], 'o recebimento chegar à nuvem');
    await puxar(b);
    await aba(b, 'estoque');
    await b.locator('#recebimentos .item:has-text("Pescados Sul")').waitFor();
    assert.ok(/em aberto em outro aparelho/.test(await b.textContent('#recebimentos .item')));
    assert.strictEqual(await b.locator('.faixa').count(), 0);
    await aba(b, 'leitor');
    assert.ok(await b.isVisible('[data-acao="comecar-recebimento"]'), 'B pode abrir o seu');
    await bipe(a, 'MP002');
    await bipe(a, 'ZZOK');
    await a.click('[data-acao="encerrar-recebimento"]');
    await a.click('#frm button[type="submit"]');
    await ate(() => linhasDaCasa()['recebimento|r1'].dados.fechadoEm > 0, 'o encerramento chegar à nuvem');
    await puxar(b);
    await aba(b, 'estoque');
    await ate(async () => !/em aberto em outro aparelho/.test(await b.textContent('#recebimentos .item')), 'o recebimento aparecer encerrado em B');
    assert.ok(/Carne moída ×1/.test(await b.textContent('#recebimentos .item')));
    assert.deepStrictEqual(errosDoApp(A).concat(errosDoApp(B)), []);
  });

  await teste('nuvem: sem internet o aparelho segue etiquetando, e tudo vai quando a conexão volta', async () => {
    const a = A.pag, b = B.pag;
    nuvem.fora = true;
    await aba(a, 'leitor');
    for (const c of ['PP005', 'ZZQ2', 'ZZOK']) await bipe(a, c);
    assert.deepStrictEqual(await a.$$eval('#impressao .etq-num', (els) => els.map((e) => e.textContent)), ['ZZ000005', 'ZZ000006'], 'os números reservados continuam valendo sem conexão');
    await a.locator('#selo-nuvem:has-text("Sem conexão · 2 por enviar")').waitFor();
    assert.strictEqual(linhasDaCasa()['etiqueta|e5'], undefined);
    await aba(a, 'ajustes');
    await a.locator('#nv-situacao:has-text("Sem conexão com a nuvem.")').waitFor();
    assert.ok(/2 mudanças por enviar/.test(await a.textContent('#nv-situacao')));
    // Fechar e abrir o app sem conexão: a fila continua lá.
    await a.reload();
    await a.locator('#selo-nuvem:has-text("Sem conexão · 2 por enviar")').waitFor();
    nuvem.fora = false;
    await puxar(a);
    await emDia(a);
    assert.strictEqual(linhasDaCasa()['etiqueta|e6'].dados.nome, 'Molho de tomate');
    await puxar(b);
    await aba(b, 'validades');
    await b.locator('#lista .item:has-text("Nº 000006")').waitFor();
    // Aberto de novo, com conexão: continua ligado, sem pedir senha e sem mandar nada repetido.
    const antes = nuvem.pedidos.filter((x) => x.caminho === '/rest/v1/rpc/vd_enviar').length;
    await a.reload();
    await emDia(a);
    assert.strictEqual(nuvem.pedidos.filter((x) => x.caminho === '/rest/v1/rpc/vd_enviar').length, antes);
    assert.ok(/Cozinha da Vó/.test(await a.textContent('#hoje')));
  });

  await teste('nuvem: sessão terminada pede a senha de novo, sem perder o que foi feito', async () => {
    const a = A.pag;
    nuvem.derrubarSessoes();
    await aba(a, 'validades');
    await a.click('#lista .item:has-text("Nº 000005") [data-usar]');
    await a.locator('#selo-nuvem:has-text("Nuvem: entrar de novo")').waitFor();
    assert.notStrictEqual(linhasDaCasa()['etiqueta|e5'].dados.status, 'usada');
    await a.click('#selo-nuvem');
    await a.locator('#cartao-nuvem:has-text("A sessão na nuvem terminou.")').waitFor();
    assert.ok(/1 mudança na fila/.test(await a.textContent('#cartao-nuvem')));
    assert.strictEqual(await a.inputValue('#nv-email'), 'casa@exemplo.com');
    await foto(a, '25-nuvem-entrar-de-novo.png');
    await a.fill('#nv-senha', 'errada');
    await a.click('#nv-ligar');
    await a.locator('#nv-erro:has-text("E-mail ou senha não conferem.")').waitFor();
    await a.fill('#nv-senha', 'segredo');
    await a.click('#nv-ligar');
    await emDia(a);
    assert.strictEqual(linhasDaCasa()['etiqueta|e5'].dados.status, 'usada', 'a baixa feita sem sessão foi enviada');
    assert.deepStrictEqual(errosDoApp(A), []);
  });

  await teste('nuvem: desligar um aparelho; ligar outro digitando o endereço; banco ainda não instalado', async () => {
    const b = B.pag;
    await puxar(b);
    await aba(b, 'ajustes');
    await b.click('[data-acao="nuvem-desligar"]');
    assert.ok(/deixa de enviar e de receber/.test(await b.textContent('#frm')));
    await b.click('#frm button[type="submit"]');
    assert.ok(await b.isVisible('#nv-email'), 'volta a oferecer a ligação');
    assert.strictEqual(await b.isVisible('#selo-nuvem'), false);
    assert.strictEqual(await b.locator('[data-acao="apagar"]').count(), 1, 'e os dados voltam a ser só dele');
    await aba(b, 'leitor');
    await bipe(b, 'PP001');
    await bipe(b, 'ZZOK');
    assert.strictEqual(await b.textContent('#impressao .etq-num'), 'ZZ001002', 'segue numerando a partir do maior número que conhece');
    assert.strictEqual(linhasDaCasa()['etiqueta|e1002'], undefined, 'e nada mais sobe');
    // Aparelho com dados próprios tentando entrar numa casa que já tem dados: avisa que serão substituídos.
    await ligar(b);
    await b.locator('#nv-proposta').waitFor();
    assert.ok(/A casa já tem dados na nuvem\. Os dados deste aparelho \(27 produtos e \d+ etiquetas\) serão substituídos pelos da nuvem\./.test(await b.textContent('#nv-proposta')), await b.textContent('#nv-proposta'));
    await b.click('[data-acao="nuvem-cancelar"]');
    assert.ok(await b.isVisible('#nv-email'), 'cancelou: nada muda');
    await aba(b, 'validades');
    assert.ok(await b.isVisible('#lista .item:has-text("Nº 001002")'));
    await B.ctx.close();
    // Sem o arquivo de configuração preenchido: o app pede o endereço e a chave neste aparelho.
    const C = await abrir({ viewport: { width: 1180, height: 820 } });
    const c = C.pag;
    await aba(c, 'ajustes');
    assert.ok(await c.isVisible('#nv-url') && !(await c.isVisible('#nv-email')));
    await c.fill('#nv-url', 'meu projeto');
    await c.fill('#nv-chave', nuvem.chave);
    await c.click('#cartao-nuvem button[type="submit"]');
    assert.ok(/começa com https:\/\//.test(await c.textContent('#nv-erro')));
    await c.fill('#nv-url', nuvem.url + '/');
    await c.click('#cartao-nuvem button[type="submit"]');
    assert.ok(await c.isVisible('#nv-email'));
    assert.strictEqual(await c.locator('[data-acao="nuvem-trocar-config"]').count(), 1);
    // O banco ainda não foi instalado no projeto: o app diz isso e não liga.
    nuvem.semBanco = true;
    await ligar(c);
    await c.locator('#nv-erro:has-text("se o banco foi instalado")').waitFor();
    assert.strictEqual(await c.isVisible('#selo-nuvem'), false);
    nuvem.semBanco = false;
    await ligar(c);
    await c.locator('#nv-proposta').waitFor();
    await c.click('#frm button[type="submit"]');
    await emDia(c);
    await aba(c, 'validades');
    await c.locator('#lista .item:has-text("Nº 001001")').waitFor();
    assert.strictEqual(await c.locator('#lista .item:has-text("Nº 001002")').count(), 0, 'o que B fez depois de desligado ficou só em B');
    // Três aparelhos já passaram pela casa: cada um com a sua faixa de números.
    await aba(c, 'leitor');
    await bipe(c, 'PP001');
    await bipe(c, 'ZZOK');
    assert.strictEqual(await c.textContent('#impressao .etq-num'), 'ZZ002001');
    assert.deepStrictEqual(errosDoApp(C), []);
    await C.ctx.close();
    await A.ctx.close();
    await nuvem.fechar();
  });

  await teste('duas abas no mesmo aparelho: só a aberta por último trabalha', async () => {
    const x = await abrir();
    await aba(x.pag, 'leitor');
    const outra = await x.ctx.newPage();
    await outra.goto(url);
    await x.pag.locator('#frm:has-text("O app foi aberto em outra aba")').waitFor();
    await x.pag.keyboard.press('Escape');
    assert.ok(await x.pag.isVisible('#continuar-aqui'), 'o aviso não fecha com Esc');
    // A aba nova trabalha normalmente e guarda o que faz.
    await outra.click('#lista .item:has-text("Tomate em cubos") [data-usar]');
    assert.deepStrictEqual(await outra.$$eval('.tiles .tile-n', (els) => els.map((e) => e.textContent)), ['1', '3', '3', '9']);
    // "Continuar aqui" recarrega com o que a outra fez, e é a outra que para.
    await x.pag.click('#continuar-aqui');
    await outra.locator('#frm:has-text("O app foi aberto em outra aba")').waitFor();
    await aba(x.pag, 'validades');
    assert.deepStrictEqual(await contagem(x.pag), ['1', '3', '3', '9']);
    assert.strictEqual(await x.pag.isVisible('#dlg'), false);
    assert.deepStrictEqual(x.erros, []);
    await x.ctx.close();
  });

  await teste('publicação: o workflow copia todos os arquivos que o app carrega', async () => {
    const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'pages-classificador.yml'), 'utf8');
    const copia = workflow.split('cd controle-validade')[1].split('cd ..')[0];
    const pagina = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
    const carregados = Array.from(pagina.matchAll(/(?:src|href)="([^"#:]+\.(?:js|css|webmanifest))"/g), (m) => m[1]);
    const guardados = Array.from(fs.readFileSync(path.join(__dirname, 'sw.js'), 'utf8').matchAll(/'\.\/([^']+\.(?:js|css|html|webmanifest))'/g), (m) => m[1]);
    assert.ok(carregados.indexOf('nuvem.js') >= 0 && carregados.indexOf('nuvem-config.js') >= 0);
    carregados.concat(guardados, ['index.html', 'sw.js']).forEach((arq) => assert.ok(new RegExp('\\s' + arq.replace('.', '\\.') + '\\s').test(copia), arq + ' não é publicado pelo workflow'));
    carregados.forEach((arq) => assert.ok(guardados.indexOf(arq) >= 0, arq + ' não fica guardado para uso sem internet'));
    assert.ok(/working-directory: controle-validade\s+run: node teste-nuvem\.js/.test(workflow));
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
    await aba(p.pag, 'leitor');
    await p.pag.fill('#leitor-campo', 'MP001');
    await p.pag.press('#leitor-campo', 'Enter');
    assert.strictEqual(await p.pag.textContent('#leitor-ok'), 'Registrar 1 etiqueta');
    await p.pag.click('#leitor-ok');
    assert.strictEqual(await p.pag.textContent('.retorno p'), '1 etiqueta de Camarão limpo: registrada. Nesta prévia a impressão fica desligada.');
    await p.pag.click('[data-acao="abrir-cartela"]');
    assert.ok(await p.pag.isVisible('.folha .cart'));
    assert.strictEqual(await p.pag.locator('[data-acao="imprimir-cartela"], [data-acao="imprimir-cartela-etq"]').count(), 0);
    assert.strictEqual(await p.pag.evaluate(() => window.__impressoes), 0);
    await aba(p.pag, 'perdas');
    assert.strictEqual(await p.pag.locator('[data-acao="exportar"]').count(), 0);
    await aba(p.pag, 'ajustes');
    assert.strictEqual(await p.pag.locator('[data-acao="backup"], [data-acao="restaurar"], [data-acao="etiqueta-teste"]').count(), 0);
    assert.strictEqual(await p.pag.locator('#cartao-nuvem').count(), 0, 'e sem nuvem');
    assert.deepStrictEqual(p.erros, []);
    await p.ctx.close();
  });

  await nav.close();
  servidor.close();
  console.log(`\n${n} testes passaram.` + (capturas ? ' Capturas regravadas.' : ''));
})().catch((e) => { console.error(e); process.exit(1); });
