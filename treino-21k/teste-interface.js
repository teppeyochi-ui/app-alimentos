#!/usr/bin/env node
// Teste da interface no Chromium (Playwright), com a data do aparelho simulada:
//   node teste-interface.js            roda os testes
//   node teste-interface.js --capturas roda e regrava as imagens de capturas/
'use strict';
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
let playwright;
try { playwright = require('playwright'); } catch (e) { playwright = require('/opt/node22/lib/node_modules/playwright'); }
const N = require('./core.js');

const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const servidor = http.createServer((req, res) => {
  const arq = path.join(__dirname, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
  if (!arq.startsWith(__dirname) || !fs.existsSync(arq)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TIPOS[path.extname(arq)] || 'application/octet-stream' });
  fs.createReadStream(arq).pipe(res);
});

// Treinos de exemplo até a semana `ate` (sempre os mesmos): ritmo melhorando, FC caindo,
// alguns treinos perdidos, uma dor forte na S9 e os dois testes de suor.
function exemplo(ate, emAndamento) {
  let x = 5;
  const rnd = () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648;
  const D = N.vazio();
  for (let w = 1; w <= ate; w++) {
    N.sessoes(D, w).forEach((s, i) => {
      if (w === ate && emAndamento && i > 0) return;
      if (rnd() < 0.08) { D.logs[s.k] = { status: 'nao', km: String(s.km), tenis: 'Novablast 5', obs: 'viagem' }; return; }
      const leve = N.leve(s.t);
      const kmFeito = +(s.km * (0.92 + rnd() * 0.14)).toFixed(1);
      const t = Math.round(kmFeito * ((leve ? 428 - w * 2.6 : 395 - w * 2.2) + (rnd() - 0.5) * 14));
      const tempo = (t >= 3600 ? Math.floor(t / 3600) + ':' + String(Math.floor(t % 3600 / 60)).padStart(2, '0') : Math.floor(t / 60)) + ':' + String(t % 60).padStart(2, '0');
      const dorForte = w === 9 && i === 0;
      D.logs[s.k] = {
        status: rnd() < 0.1 ? 'parcial' : 'feito', km: String(kmFeito), tempo,
        fc: String(Math.round((leve ? 153 - w * 0.45 : 166) + (rnd() - 0.5) * 5)),
        esf: String(Math.round((leve ? 3.5 : 6.5) + rnd() * 2)),
        tenis: s.s === 'E' ? 'Evo SL' : 'Novablast 5', hid: '',
        dor: dorForte ? '5' : rnd() < 0.2 ? String(1 + Math.floor(rnd() * 3)) : '',
        dorLocal: dorForte ? 'joelho direito' : '', obs: '',
      };
      if (/suor/.test(s.t)) Object.assign(D.logs[s.k], { pa: '78.4', pd: w === 5 ? '77.6' : '76.6', liq: '500' });
    });
    if (w < ate || !emAndamento) D.weeks[w] = { sono: ['bom', 'bom', 'médio', 'bom', 'ruim', 'médio'][Math.floor(rnd() * 6)], calor: '', obs: '', closed: true, sent: w < ate - 1 };
  }
  D.prompt = 'Você é meu treinador de corrida. Analise o relatório abaixo e ajuste o plano se necessário.';
  return D;
}

const INICIO = '2026-11-16T09:00:00'; // segunda-feira da semana 1
const MEIO = '2027-02-24T09:00:00'; // quarta-feira da semana 15

(async () => {
  await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
  const url = 'http://127.0.0.1:' + servidor.address().port + '/';
  const nav = await playwright.chromium.launch();
  const capturas = process.argv.includes('--capturas');
  let n = 0;

  async function abrir({ hoje, dados, ui, opcoes } = {}) {
    const ctx = await nav.newContext(Object.assign({ viewport: { width: 412, height: 860 }, deviceScaleFactor: capturas ? 2 : 1, permissions: ['clipboard-read', 'clipboard-write'] }, opcoes));
    const pag = await ctx.newPage();
    await pag.clock.setFixedTime(new Date(hoje || INICIO));
    // Só semeia na primeira carga: recarregar a página deve mostrar o que o app salvou.
    await pag.addInitScript(([d, u]) => {
      if (sessionStorage.getItem('semeado')) return;
      sessionStorage.setItem('semeado', '1');
      if (d) localStorage.setItem('r21k_v1', d);
      if (u) localStorage.setItem('r21k_ui', u);
    }, [dados ? JSON.stringify(dados) : null, ui ? JSON.stringify(ui) : null]);
    const erros = [];
    pag.on('pageerror', (e) => erros.push(e.message));
    pag.on('console', (m) => { if (m.type() === 'error') erros.push(m.text()); });
    pag.on('dialog', (d) => d.accept());
    await pag.goto(url);
    return { ctx, pag, erros };
  }
  const aba = (pag, nome) => pag.click(`.abas [data-aba="${nome}"]`);
  const guardado = (pag) => pag.evaluate(() => JSON.parse(localStorage.getItem('r21k_v1')));
  const foto = (pag, nome) => (capturas ? pag.screenshot({ path: path.join(__dirname, 'capturas', nome) }) : null);
  async function teste(nome, fn) { await fn(); n++; console.log('ok  ' + nome); }

  await teste('primeira abertura: plano completo, semana atual e contagem regressiva', async () => {
    const { ctx, pag, erros } = await abrir();
    assert.strictEqual(await pag.textContent('#hdr'), 'Faltam 194 dias · 0/28 semanas fechadas · meta: completar bem');
    assert.strictEqual(await pag.locator('.wk').count(), 28);
    assert.strictEqual(await pag.evaluate(() => window.scrollY), 0); // na semana 1 o topo fica à vista
    assert.strictEqual(await pag.locator('.ses').count(), N.PLANO.reduce((a, s) => a + s[1].length, 0));
    assert.ok((await pag.textContent('#w1 h3')).includes('S1 · 16/11–22/11'));
    assert.ok((await pag.textContent('#w1 h3')).includes('esta semana'));
    assert.strictEqual(await pag.textContent('#w1 .km'), '0/15 km');
    assert.ok((await pag.textContent('#w28')).includes('21K: A PROVA'));
    assert.deepStrictEqual(erros, []);
    await ctx.close();
  });

  await teste('registrar treino: salva no formato da página original e mostra o ritmo', async () => {
    const { ctx, pag, erros } = await abrir({ hoje: '2026-11-18T19:00:00' });
    assert.ok((await pag.textContent('[data-k="1-qua"]')).includes('Hoje'));
    await pag.click('[data-k="1-qua"]');
    assert.strictEqual(await pag.inputValue('[name=km]'), '5'); // km planejado já vem preenchido
    assert.strictEqual(await pag.inputValue('[name=tenis]'), 'Novablast 5');
    await pag.fill('[name=km]', '5.2');
    await pag.fill('[name=tempo]', '36:24');
    await pag.fill('[name=fc]', '151');
    await pag.fill('[name=esf]', '4');
    await foto(pag, '2-registro.png');
    await pag.click('#frm button[value=ok]');
    const linha = await pag.textContent('[data-k="1-qua"]');
    assert.ok(linha.includes('5,2 km em 36:24 (7:00/km)'), linha);
    assert.strictEqual(await pag.getAttribute('[data-k="1-qua"] .st', 'aria-label'), 'Feito');
    assert.strictEqual(await pag.textContent('#w1 .km'), '5,2/15 km');
    const D = await guardado(pag);
    assert.deepStrictEqual(D.logs['1-qua'], { status: 'feito', km: '5.2', tempo: '36:24', fc: '151', esf: '4', tenis: 'Novablast 5', hid: '', dor: '', dorLocal: '', obs: '', pa: '', pd: '', liq: '' });
    assert.deepStrictEqual(D.ov, {});
    await pag.reload();
    assert.ok((await pag.textContent('[data-k="1-qua"]')).includes('5,2 km em 36:24'));
    assert.deepStrictEqual(erros, []);
    await ctx.close();
  });

  await teste('formulário: Enter salva, tempo inválido não passa, "não fiz" e apagar', async () => {
    const { ctx, pag } = await abrir();
    await pag.click('[data-k="1-sex"]');
    await pag.fill('[name=tempo]', '28:00');
    await pag.press('[name=tempo]', 'Enter');
    assert.strictEqual((await guardado(pag)).logs['1-sex'].tempo, '28:00');

    await pag.click('[data-k="1-dom"]');
    await pag.fill('[name=tempo]', 'quarenta');
    await pag.click('#frm button[value=ok]');
    assert.ok(await pag.evaluate(() => document.querySelector('#dlg').open)); // continua aberto
    assert.ok(!(await guardado(pag)).logs['1-dom']);
    await pag.selectOption('[name=status]', 'nao');
    await pag.fill('[name=dor]', '5');
    await pag.click('#frm button[value=ok]');
    assert.strictEqual(await pag.getAttribute('[data-k="1-dom"] .st', 'aria-label'), 'Não fiz');
    assert.strictEqual(await pag.textContent('#w1 .km'), '4/15 km');

    await pag.click('[data-k="1-dom"]');
    await pag.click('#frm [data-apagar]');
    assert.ok(!(await guardado(pag)).logs['1-dom']);
    assert.strictEqual(await pag.getAttribute('[data-k="1-dom"] .st', 'aria-label'), 'Sem registro');

    await pag.click('[data-k="2-qua"]');
    await pag.click('#frm [data-fechar]'); // cancelar não grava nada
    assert.ok(!(await guardado(pag)).logs['2-qua']);
    await ctx.close();
  });

  await teste('ajustar o planejado: troca o treino da semana e volta ao original', async () => {
    const { ctx, pag } = await abrir();
    await pag.click('[data-k="4-dom"]');
    await pag.click('#frm details:last-of-type summary');
    await pag.fill('[name=pt]', 'Prova 10K');
    await pag.fill('[name=pk]', '10');
    await pag.selectOption('[name=status]', 'nao');
    await pag.click('#frm button[value=ok]');
    assert.ok((await pag.textContent('[data-k="4-dom"]')).includes('Prova 10K'));
    assert.strictEqual(await pag.textContent('#w4 .km'), '0/15 km');
    assert.deepStrictEqual((await guardado(pag)).ov, { '4-dom': { t: 'Prova 10K', km: 10 } });
    await pag.click('[data-k="4-dom"]');
    await pag.fill('[name=pt]', '7 km Z2 (alívio)');
    await pag.fill('[name=pk]', '7');
    await pag.click('#frm button[value=ok]');
    assert.deepStrictEqual((await guardado(pag)).ov, {});
    await ctx.close();
  });

  await teste('fechar semana, exportar para o Claude e marcar como enviada', async () => {
    const D = exemplo(1, false);
    delete D.weeks[1];
    const { ctx, pag, erros } = await abrir({ hoje: '2026-11-23T08:00:00', dados: D });
    await pag.click('#w1 [data-acao="semana"]');
    await pag.selectOption('[name=sono]', 'médio');
    await pag.fill('[name=calor]', '34 °C no domingo');
    await pag.click('#frm button[value=ok]');
    assert.ok((await pag.textContent('#w1 .wk-pe')).includes('ainda não enviada'));
    assert.ok((await pag.textContent('#hdr')).includes('1/28 semanas fechadas'));

    await aba(pag, 'exportar');
    const texto = await pag.inputValue('#out');
    assert.ok(texto.startsWith('Você é meu treinador de corrida.'));
    assert.ok(texto.includes('# RELATÓRIO GERADO PELO APP (23/11/2026)'));
    assert.ok(texto.includes('SEMANA 1 – Relatório'));
    assert.ok(texto.includes('Sono/cansaço: médio | Calor/fora do normal: 34 °C no domingo'));
    assert.ok((await pag.textContent('#app')).includes('Pendentes de envio: S1.'));
    await pag.click('[data-acao="copiar"]');
    assert.strictEqual(await pag.evaluate(() => navigator.clipboard.readText()), texto);
    await foto(pag, '5-exportar.png');

    await pag.click('[data-acao="enviadas"]');
    assert.strictEqual((await guardado(pag)).weeks[1].sent, true);
    assert.ok((await pag.inputValue('#out')).includes('Nenhuma semana fechada pendente de envio.'));
    await aba(pag, 'plano');
    assert.ok((await pag.textContent('#w1 .wk-pe')).includes('e enviada ao Claude'));
    assert.deepStrictEqual(erros, []);
    await ctx.close();
  });

  await teste('evolução sem registros: mostra o plano e explica o que falta', async () => {
    const { ctx, pag, erros } = await abrir();
    await aba(pag, 'evolucao');
    assert.strictEqual(await pag.textContent('.heroi-num'), '194');
    assert.ok((await pag.textContent('#app')).includes('Ainda não há treinos registrados'));
    assert.strictEqual(await pag.locator('#g-km path.c-trilho').count(), 28);
    assert.strictEqual(await pag.locator('#g-km path.c-feito').count(), 0);
    assert.strictEqual(await pag.locator('#g-ritmo').count(), 0);
    assert.ok((await pag.textContent('#app')).includes('Aparece depois da primeira rodagem Z2'));
    assert.deepStrictEqual(erros, []);
    await ctx.close();
  });

  await teste('evolução com treinos: indicadores, gráficos, dica e tabela', async () => {
    const D = exemplo(15, true);
    const P = N.painel(D, new Date(MEIO));
    const { ctx, pag, erros } = await abrir({ hoje: MEIO, dados: D });
    await aba(pag, 'evolucao');
    await foto(pag, '3-evolucao.png');
    assert.strictEqual(await pag.textContent('.heroi-num'), String(P.dias));
    assert.ok((await pag.textContent('.medidor-pe')).includes('Semana 15 de 28'));
    const kpi = await pag.textContent('.kpi');
    assert.ok(kpi.includes(`${P.treinosFeitos} de ${P.treinosPrevistos}`), kpi);
    assert.ok(kpi.includes(N.fmtRitmo(P.ritmoZ2.atual)), kpi);
    assert.ok(kpi.includes('mais rápido que no início'), kpi);
    assert.ok(kpi.includes('% desde a S1'), kpi);

    // Um gráfico por medida, todos com as 28 semanas.
    for (const id of ['km', 'longo', 'ritmo', 'fc', 'mpb', 'esf', 'dor', 'sono']) assert.strictEqual(await pag.locator(`#g-${id} svg`).count(), 1, id);
    assert.strictEqual(await pag.locator('#g-km path.c-trilho').count(), 28);
    assert.strictEqual(await pag.locator('#g-km path.c-feito').count(), P.semanas.filter((s) => s.feito > 0).length);
    assert.strictEqual(await pag.locator('#g-dor path.c-critico').count(), 1); // a dor 5 da S9
    assert.strictEqual(await pag.locator('#g-sono circle').count(), 14);
    assert.strictEqual(await pag.locator('.sinal').count(), 1); // teste de suor da S10 acima de 2%
    assert.ok((await pag.textContent('#app')).includes('de ~720 km'));

    // Dica ao passar o dedo/mouse: valores da semana 5, no gráfico de km.
    const caixa = await pag.locator('#g-km svg').boundingBox();
    const xSemana = (w) => caixa.x + 40 + (caixa.width - 52) / 28 * (w - 0.5);
    await pag.mouse.move(xSemana(5), caixa.y + 60);
    const dica = await pag.textContent('#g-km .g-dica');
    assert.ok(dica.includes('S5 · 14/12–20/12'), dica);
    assert.ok(dica.includes('Planejado22 km'), dica);
    assert.ok(dica.includes('Feito' + (Math.round(P.semanas[4].feito * 10) / 10).toLocaleString('pt-BR') + ' km'), dica);
    // Teclado: seta para a direita vai para a semana 6.
    await pag.focus('#g-km svg');
    await pag.keyboard.press('ArrowRight');
    assert.ok((await pag.textContent('#g-km .g-dica')).includes('S6 · 21/12–27/12'));
    // Nos gráficos pequenos a dica junta as três medidas e só um gráfico fica com dica aberta.
    await pag.locator('#g-fc svg').scrollIntoViewIfNeeded();
    const c2 = await pag.locator('#g-fc svg').boundingBox();
    await pag.mouse.move(c2.x + 40 + (c2.width - 52) / 28 * 2.5, c2.y + 40);
    const dicaZ2 = await pag.textContent('#g-fc .g-dica');
    assert.ok(/S3 · .*Ritmo.*FC média.*Metros por batimento/.test(dicaZ2), dicaZ2);
    assert.ok(await pag.locator('#g-km .g-dica').isHidden());
    assert.strictEqual(await pag.locator('#g-ritmo .g-foco').getAttribute('visibility'), 'visible');

    // Tabela com os mesmos números.
    await pag.click('figure:has(#g-km) summary');
    assert.strictEqual(await pag.locator('figure:has(#g-km) tbody tr').count(), 28);
    assert.ok((await pag.textContent('figure:has(#g-km) tbody tr:nth-child(5)')).includes('22 km'));
    assert.deepStrictEqual(erros, []);
    await ctx.close();
  });

  await teste('evolução: recorte "Até hoje", alerta de dor recente e tela estreita', async () => {
    const D = exemplo(9, true);
    const { ctx, pag, erros } = await abrir({ hoje: '2027-01-14T09:00:00', dados: D, opcoes: { viewport: { width: 320, height: 640 } } });
    await aba(pag, 'evolucao');
    assert.ok((await pag.textContent('.alerta-dor')).includes('S9 Quarta (5/10, joelho direito)'));
    await pag.click('[data-p="hoje"]');
    assert.strictEqual(await pag.locator('#g-km path.c-trilho').count(), 9);
    assert.strictEqual(await pag.getAttribute('[data-p="hoje"]', 'aria-pressed'), 'true');
    await pag.reload(); // a escolha fica guardada
    await aba(pag, 'evolucao');
    assert.strictEqual(await pag.locator('#g-km path.c-trilho').count(), 9);
    // Nada estoura a largura da tela, nem no celular mais estreito.
    for (const nome of ['plano', 'evolucao', 'exportar', 'ajustes']) {
      await aba(pag, nome);
      const sobra = await pag.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.strictEqual(sobra, 0, nome);
    }
    // Girar o celular redesenha os gráficos na nova largura.
    await aba(pag, 'evolucao');
    await pag.setViewportSize({ width: 640, height: 320 });
    await pag.waitForFunction(() => document.querySelector('#g-km svg').getAttribute('width') > 500);
    assert.deepStrictEqual(erros, []);
    await ctx.close();
  });

  await teste('ajustes: prompt, km do Evo SL, backup em texto e backup da página antiga', async () => {
    const D = exemplo(3, false);
    const { ctx, pag, erros } = await abrir({ hoje: '2026-12-07T09:00:00', dados: D });
    await aba(pag, 'ajustes');
    await pag.fill('#pr', 'Prompt novo');
    await pag.click('[data-acao="salvar-prompt"]');
    await pag.fill('#evo', '80');
    await pag.click('[data-acao="salvar-evo"]');
    let g = await guardado(pag);
    assert.strictEqual(g.prompt, 'Prompt novo');
    assert.strictEqual(g.evoBase, 80);

    await pag.click('[data-acao="backup-gerar"]');
    const backup = await pag.inputValue('#bk');
    assert.deepStrictEqual(JSON.parse(backup), g);
    await pag.click('[data-acao="apagar-tudo"]');
    assert.deepStrictEqual((await guardado(pag)).logs, {});
    await pag.fill('#bk', backup);
    await pag.click('[data-acao="backup-restaurar"]');
    assert.deepStrictEqual(await guardado(pag), g);

    await pag.fill('#bk', 'isto não é um backup');
    await pag.click('[data-acao="backup-restaurar"]');
    assert.strictEqual(await pag.textContent('#aviso'), 'Backup inválido.');
    assert.deepStrictEqual(await guardado(pag), g); // nada foi perdido

    // Backup gerado pela página antiga (mesma chave e formato).
    await pag.fill('#bk', '{"logs":{"1-qua":{"status":"feito","km":"5","tempo":"35:00","tenis":"Novablast 5"}},"weeks":{},"ov":{},"prompt":"antigo","evoBase":50}');
    await pag.click('[data-acao="backup-restaurar"]');
    await aba(pag, 'plano');
    assert.ok((await pag.textContent('[data-k="1-qua"]')).includes('5 km em 35:00 (7:00/km)'));

    // Backup em arquivo.
    await aba(pag, 'ajustes');
    const [baixado] = await Promise.all([pag.waitForEvent('download'), pag.click('[data-acao="backup-baixar"]')]);
    assert.strictEqual(baixado.suggestedFilename(), 'backup-21k-2026-12-07.json');
    const arq = await baixado.path();
    assert.strictEqual(JSON.parse(fs.readFileSync(arq, 'utf8')).prompt, 'antigo');
    await pag.click('[data-acao="apagar-tudo"]');
    await pag.setInputFiles('#arq', arq);
    await pag.waitForFunction(() => JSON.parse(localStorage.getItem('r21k_v1')).prompt === 'antigo');
    assert.deepStrictEqual(erros, []);
    await ctx.close();
  });

  await teste('instalável: manifesto, ícones, service worker e abertura sem internet', async () => {
    const { ctx, pag, erros } = await abrir({ dados: exemplo(2, false) });
    const manifesto = JSON.parse(fs.readFileSync(path.join(__dirname, 'manifest.webmanifest'), 'utf8'));
    assert.strictEqual(manifesto.display, 'standalone');
    assert.ok(manifesto.icons.some((i) => i.sizes === '192x192') && manifesto.icons.some((i) => i.sizes === '512x512' && i.purpose === 'maskable'));
    for (const i of manifesto.icons) assert.strictEqual((await pag.request.get(url + i.src)).status(), 200, i.src);
    assert.strictEqual(await pag.getAttribute('link[rel=manifest]', 'href'), 'manifest.webmanifest');
    // Tudo o que o service worker guarda existe de fato.
    const sw = fs.readFileSync(path.join(__dirname, 'sw.js'), 'utf8');
    const lista = sw.slice(sw.indexOf('APP_SHELL = ['), sw.indexOf('];')).match(/'\.\/[^']*'/g).map((s) => s.slice(3, -1));
    for (const arq of lista) assert.ok(fs.existsSync(path.join(__dirname, arq || 'index.html')), arq);
    for (const arq of ['core.js', 'graficos.js', 'app.js', 'styles.css']) assert.ok(lista.includes(arq), arq + ' fora do cache');

    await pag.evaluate(() => navigator.serviceWorker.ready);
    await pag.waitForFunction(() => navigator.serviceWorker.controller !== null);
    await ctx.setOffline(true);
    await pag.reload();
    assert.strictEqual(await pag.locator('.wk').count(), 28);
    await aba(pag, 'evolucao');
    assert.strictEqual(await pag.locator('#g-km svg').count(), 1);
    assert.deepStrictEqual(erros, []);
    await ctx.close();
  });

  await teste('botão de instalar aparece quando o navegador oferece e some depois de dispensado', async () => {
    const { ctx, pag } = await abrir();
    assert.strictEqual(await pag.locator('.faixa').count(), 0);
    await pag.evaluate(() => {
      const ev = new Event('beforeinstallprompt');
      ev.prompt = () => { window.__pediu = true; };
      ev.userChoice = Promise.resolve({ outcome: 'accepted' });
      window.dispatchEvent(ev);
    });
    assert.ok((await pag.textContent('.faixa')).includes('Instale o app'));
    await aba(pag, 'ajustes');
    assert.strictEqual(await pag.locator('#cartao-instalar [data-acao="instalar"]').count(), 1);
    await pag.click('#cartao-instalar [data-acao="instalar"]');
    assert.strictEqual(await pag.evaluate(() => window.__pediu), true);
    // Dispensar a faixa vale para as próximas aberturas.
    const oferecer = () => pag.evaluate(() => window.dispatchEvent(new Event('beforeinstallprompt')));
    await aba(pag, 'plano');
    await oferecer();
    await pag.click('.faixa [data-acao="fechar-faixa"]');
    assert.strictEqual(await pag.locator('.faixa').count(), 0);
    await pag.reload();
    await oferecer();
    assert.strictEqual(await pag.locator('.faixa').count(), 0);
    await ctx.close();
  });

  await teste('celular: tocar no gráfico mostra a dica e tocar fora fecha', async () => {
    const { ctx, pag, erros } = await abrir({ hoje: MEIO, dados: exemplo(15, true), opcoes: { hasTouch: true, isMobile: true } });
    await aba(pag, 'evolucao');
    await pag.locator('#g-longo svg').scrollIntoViewIfNeeded();
    const c = await pag.locator('#g-longo svg').boundingBox();
    await pag.touchscreen.tap(c.x + 40 + (c.width - 52) / 28 * 9.5, c.y + 80);
    assert.ok((await pag.textContent('#g-longo .g-dica')).includes('S10 · 18/01–24/01'));
    assert.ok(await pag.locator('#g-longo .g-dica').isVisible());
    await pag.touchscreen.tap(c.x + 100, c.y - 40); // título do cartão
    assert.ok(await pag.locator('#g-longo .g-dica').isHidden());
    assert.deepStrictEqual(erros, []);
    await ctx.close();
  });

  if (capturas) {
    const D = exemplo(15, true);
    let { ctx, pag } = await abrir({ hoje: MEIO, dados: D });
    await pag.waitForTimeout(300);
    await foto(pag, '1-plano.png');
    await aba(pag, 'evolucao');
    await pag.locator('.filtro').scrollIntoViewIfNeeded();
    await pag.evaluate(() => window.scrollBy(0, 430));
    await foto(pag, '4-evolucao-graficos.png');
    await ctx.close();
    ({ ctx, pag } = await abrir({ hoje: MEIO, dados: D, opcoes: { viewport: { width: 1100, height: 1500 }, colorScheme: 'dark' } }));
    await aba(pag, 'evolucao');
    await pag.screenshot({ path: path.join(__dirname, 'capturas', '6-evolucao-escuro.png'), fullPage: true });
    await ctx.close();
    console.log('capturas regravadas em capturas/');
  }

  await nav.close();
  servidor.close();
  console.log(`\n${n} testes passaram.`);
})().catch((e) => { console.error(e); process.exit(1); });
