#!/usr/bin/env node
// Teste da interface no Chromium (Playwright), com a data do aparelho e a API do Claude simuladas:
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

// Resposta de exemplo da IA: terça, quinta e sábado, com o longão crescendo.
function respostaIa(semanas) {
  return {
    semanas: Array.from({ length: semanas }, (_, i) => ({
      foco: i === semanas - 1 ? 'prova' : i % 4 === 3 ? 'alívio' : 'base',
      treinos: [
        { dia: 'ter', treino: `${4 + i} km Z2`, km: 4 + i, leve: true, hidratacao: 'A' },
        { dia: 'qui', treino: '2 Z1 + 4×400 m Z4 + 1 Z1', km: 5, leve: false, hidratacao: 'A' },
        { dia: 'sab', treino: `${6 + i} km Z2`, km: 6 + i, leve: true, hidratacao: 'B' },
      ],
    })),
    orientacoes: 'Z2 é o ritmo em que dá para conversar.\nSe doer, pare e descanse.',
  };
}

// Corpo de streaming (SSE) com o texto partido em dois pedaços, como a API devolve.
function sse(objeto, motivo) {
  const texto = typeof objeto === 'string' ? objeto : JSON.stringify(objeto);
  const ev = (o) => 'event: ' + o.type + '\ndata: ' + JSON.stringify(o) + '\n\n';
  const meio = Math.ceil(texto.length / 2);
  return ev({ type: 'message_start', message: { model: 'claude-opus-5-5' } }) +
    ev({ type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: '' } }) +
    ev({ type: 'content_block_delta', delta: { type: 'text_delta', text: texto.slice(0, meio) } }) +
    ev({ type: 'content_block_delta', delta: { type: 'text_delta', text: texto.slice(meio) } }) +
    ev({ type: 'message_delta', delta: { stop_reason: motivo || 'end_turn' } }) + ev({ type: 'message_stop' });
}

const INICIO = '2026-11-16T09:00:00'; // segunda-feira da semana 1
const SEXTA = '2026-11-27T10:00:00'; // sexta-feira: um plano novo começa na segunda 30/11
const MEIO = '2027-02-24T09:00:00'; // quarta-feira da semana 15

(async () => {
  await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
  const url = 'http://127.0.0.1:' + servidor.address().port + '/';
  const nav = await playwright.chromium.launch();
  const capturas = process.argv.includes('--capturas');
  let n = 0;

  // respostas: fila de { status, corpo } (ou { pendurar: true }) devolvidos pela API simulada; pedidos: o que o app enviou.
  async function abrir({ hoje, dados, ui, ia, opcoes } = {}) {
    const ctx = await nav.newContext(Object.assign({ viewport: { width: 412, height: 860 }, deviceScaleFactor: capturas ? 2 : 1, locale: 'pt-BR', permissions: ['clipboard-read', 'clipboard-write'] }, opcoes));
    const pag = await ctx.newPage();
    await pag.clock.setFixedTime(new Date(hoje || INICIO));
    // Só semeia na primeira carga: recarregar a página deve mostrar o que o app salvou.
    await pag.addInitScript(([d, u, i]) => {
      if (sessionStorage.getItem('semeado')) return;
      sessionStorage.setItem('semeado', '1');
      if (d) localStorage.setItem('r21k_v1', d);
      if (u) localStorage.setItem('r21k_ui', u);
      if (i) localStorage.setItem('r21k_ia', i);
    }, [dados ? JSON.stringify(dados) : null, ui ? JSON.stringify(ui) : null, ia ? JSON.stringify(ia) : null]);
    const erros = [], pedidos = [], respostas = [];
    await pag.route('https://api.anthropic.com/**', (rota) => {
      pedidos.push({ cabecalhos: rota.request().headers(), corpo: JSON.parse(rota.request().postData()) });
      const r = respostas.shift() || { status: 500, corpo: '{}' };
      if (r.pendurar) return; // fica sem resposta até o app cancelar
      rota.fulfill({ status: r.status, contentType: r.status === 200 ? 'text/event-stream' : 'application/json', body: r.corpo });
    });
    pag.on('pageerror', (e) => erros.push(e.message));
    // Respostas de erro simuladas da API aparecem no console do navegador; não são defeito do app.
    pag.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) erros.push(m.text()); });
    pag.on('dialog', (d) => d.accept());
    await pag.goto(url);
    return { ctx, pag, erros, pedidos, respostas };
  }
  const aba = (pag, nome) => pag.click(`.abas [data-aba="${nome}"]`);
  const guardado = (pag) => pag.evaluate(() => JSON.parse(localStorage.getItem('r21k_v1')));
  const foto = (pag, nome) => (capturas ? pag.screenshot({ path: path.join(__dirname, 'capturas', nome) }) : null);
  async function teste(nome, fn) { await fn(); n++; console.log('ok  ' + nome); }

  await teste('primeira abertura: plano completo, semana atual e contagem regressiva', async () => {
    const { ctx, pag, erros } = await abrir();
    assert.strictEqual(await pag.textContent('#titulo'), 'Rafael Braga · 21K Rio 2027');
    assert.strictEqual(await pag.textContent('#hdr'), 'Faltam 194 dias · 0/28 semanas fechadas · meta: completar bem');
    assert.strictEqual(await pag.locator('.wk').count(), 28);
    assert.strictEqual(await pag.evaluate(() => window.scrollY), 0); // na semana 1 o topo fica à vista
    assert.strictEqual(await pag.locator('.ses').count(), N.PLANO_21K.reduce((a, s) => a + s[1].length, 0));
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
    for (const nome of ['plano', 'evolucao', 'perfil', 'exportar', 'ajustes']) {
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

  await teste('ajustes: prompt, backup em texto e em arquivo, backup da página antiga', async () => {
    const D = exemplo(3, false);
    const { ctx, pag, erros } = await abrir({ hoje: '2026-12-07T09:00:00', dados: D });
    await aba(pag, 'ajustes');
    await pag.fill('#pr', 'Prompt novo');
    await pag.click('[data-acao="salvar-prompt"]');
    const g = await guardado(pag);
    assert.strictEqual(g.prompt, 'Prompt novo');

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
    for (const arq of ['core.js', 'graficos.js', 'ia.js', 'app.js', 'styles.css']) assert.ok(lista.includes(arq), arq + ' fora do cache');
    // E o workflow do Pages publica cada um deles (a cópia é arquivo por arquivo).
    const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'pages-classificador.yml'), 'utf8');
    const copia = workflow.split('\n').find((l) => /^\s*cp index\.html .*_site\/treino-21k\/\s*$/.test(l));
    assert.ok(copia, 'linha de cópia do treino-21k no workflow');
    for (const arq of lista.filter((a) => a && !a.startsWith('icones/'))) assert.ok(copia.split(/\s+/).includes(arq), arq + ' não é publicado pelo workflow');
    for (const m of (await pag.content()).matchAll(/<script src="([^"]+)"/g)) assert.ok(lista.includes(m[1]), m[1] + ' fora do cache');

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

  await teste('perfil: dados, tênis e objetivo ficam guardados e valem no resto do app', async () => {
    const dados = N.vazio();
    dados.logs['1-qua'] = { status: 'feito', km: '5', tempo: '35:00', tenis: 'Novablast 5' };
    const { ctx, pag, erros } = await abrir({ hoje: '2026-11-19T19:00:00', dados });
    await aba(pag, 'perfil');
    // Começa com os dados do plano original.
    assert.strictEqual(await pag.inputValue('[name=nome]'), 'Rafael Braga');
    assert.deepStrictEqual([await pag.inputValue('[name=prova]'), await pag.inputValue('[name=distancia]'), await pag.inputValue('[name=data]')], ['21K Rio 2027', '21.1', '2027-05-29']);
    assert.strictEqual(await pag.locator('.tenis-linha').count(), 2);
    assert.strictEqual(await pag.inputValue('.tenis-linha:nth-child(1) [data-t="km"]'), '50');
    assert.ok(await pag.isChecked('[name=dia-qua]') && !(await pag.isChecked('[name=dia-seg]')));

    await pag.fill('[name=nome]', 'Rafa B.');
    await pag.fill('[name=nascimento]', '1985');
    await pag.selectOption('[name=experiencia]', '1a3');
    await pag.fill('[name=kmSemana]', '15');
    await pag.check('[name=dia-seg]');
    await pag.press('[name=kmSemana]', 'Tab');
    assert.strictEqual(await pag.textContent('#titulo'), 'Rafa B. · 21K Rio 2027'); // o cabeçalho acompanha na hora
    let g = await guardado(pag);
    assert.deepStrictEqual([g.perfil.nome, g.perfil.nascimento, g.perfil.experiencia, g.perfil.kmSemana, g.perfil.dias], ['Rafa B.', '1985', '1a3', '15', ['seg', 'qua', 'sex', 'dom']]);
    assert.deepStrictEqual(g.objetivo, { prova: '21K Rio 2027', distancia: 21.1, data: '2027-05-29', meta: 'completar bem', tempoAlvo: '' });

    // Renomear um tênis leva junto o treino já registrado; um tênis novo entra na lista.
    await pag.fill('.tenis-linha:nth-child(2) [data-t="nome"]', 'Novablast 6');
    await pag.click('[data-acao="mais-tenis"]');
    await pag.fill('.tenis-linha:nth-child(3) [data-t="nome"]', 'Trilha');
    await pag.fill('.tenis-linha:nth-child(3) [data-t="km"]', '30');
    await pag.press('.tenis-linha:nth-child(3) [data-t="km"]', 'Tab');
    g = await guardado(pag);
    assert.strictEqual(g.logs['1-qua'].tenis, 'Novablast 6');
    assert.deepStrictEqual(g.perfil.tenis, [{ nome: 'Evo SL', kmInicial: 50, vida: 720 }, { nome: 'Novablast 6', kmInicial: 0, vida: 0 }, { nome: 'Trilha', kmInicial: 30, vida: 0 }]);

    // Mudar o objetivo não mexe no plano em uso: o app avisa.
    assert.ok(await pag.locator('#p-nota').isHidden());
    await pag.fill('[name=data]', '2027-06-05');
    await pag.press('[name=data]', 'Tab');
    assert.strictEqual(await pag.textContent('#p-nota'), 'O plano em uso é para 21K Rio 2027 em 29/05/2027. Crie um treino novo para valer este objetivo.');
    assert.ok((await pag.textContent('#hdr')).startsWith('Faltam 191 dias')); // a prova do plano em uso continua em 29/05

    await aba(pag, 'plano');
    await pag.click('[data-k="1-sex"]');
    assert.deepStrictEqual(await pag.locator('[name=tenis] option').allTextContents(), ['Evo SL', 'Novablast 6', 'Trilha', 'Outro']);
    await pag.click('#frm [data-fechar]');
    await aba(pag, 'evolucao');
    const painel = await pag.textContent('#app');
    assert.ok(painel.includes('Novablast 6') && painel.includes('Trilha') && painel.includes('de ~720 km'));
    await pag.reload();
    await aba(pag, 'perfil');
    assert.strictEqual(await pag.inputValue('[name=nome]'), 'Rafa B.');
    assert.strictEqual(await pag.locator('.tenis-linha').count(), 3);
    assert.deepStrictEqual(erros, []);
    await ctx.close();
  });

  // Preenche o perfil e o objetivo de uma corredora que quer um 10K em seis semanas.
  async function preencherAna(pag) {
    await aba(pag, 'perfil');
    await pag.fill('[name=nome]', 'Ana Souza');
    await pag.fill('[name=nascimento]', '1990');
    await pag.selectOption('[name=sexo]', 'feminino');
    await pag.selectOption('[name=experiencia]', 'menos1');
    await pag.fill('[name=kmSemana]', '12');
    await pag.fill('[name=maiorCorrida]', '6');
    for (const d of ['qua', 'sex', 'dom']) await pag.uncheck(`[name=dia-${d}]`);
    for (const d of ['ter', 'qui', 'sab']) await pag.check(`[name=dia-${d}]`);
    await pag.selectOption('[name=diaLongo]', 'sab');
    await pag.fill('[name=lesoes]', 'canelite no ano passado');
    await pag.fill('[name=prova]', '10K da Lagoa');
    await pag.click('[data-acao="distancia"][data-km="10"]');
    await pag.fill('[name=data]', '2027-01-09');
    await pag.fill('[name=meta]', 'correr sem parar');
    await pag.press('[name=meta]', 'Tab');
  }

  await teste('criar treino com IA: pedido, prévia, plano em uso e volta ao anterior', async () => {
    const { ctx, pag, erros, pedidos, respostas } = await abrir({ hoje: SEXTA, dados: exemplo(1, false), ia: { chave: 'sk-ant-teste-1234', modelo: 'claude-opus-5-5' } });
    await preencherAna(pag);
    await pag.evaluate(() => { document.activeElement.blur(); window.scrollTo(0, 0); });
    await foto(pag, '6-perfil.png');
    assert.strictEqual(await pag.textContent('#p-cal'), 'O plano terá 6 semanas: de 30/11/2026 até a prova, em 09/01/2027.');
    assert.ok(await pag.locator('#p-falta').isHidden());

    respostas.push({ status: 200, corpo: sse(respostaIa(6)) });
    await pag.click('[data-acao="criar-ia"]');
    await pag.waitForSelector('#previa');
    // O que saiu para a API: chave no cabeçalho, perfil sem o nome, formato JSON e streaming.
    assert.strictEqual(pedidos.length, 1);
    assert.strictEqual(pedidos[0].cabecalhos['x-api-key'], 'sk-ant-teste-1234');
    assert.strictEqual(pedidos[0].cabecalhos['anthropic-version'], '2026-10-21');
    const corpo = pedidos[0].corpo;
    assert.deepStrictEqual([corpo.model, corpo.stream, corpo.output_config.format.type, corpo.fallbacks], ['claude-opus-5-5', true, 'json_schema', 'default']);
    assert.ok(corpo.system.includes('running coach'));
    const pedido = corpo.messages[0].content;
    assert.ok(pedido.includes('Idade: 36 anos') && pedido.includes('Volume atual: 12 km por semana') && pedido.includes('canelite'), pedido);
    assert.ok(pedido.includes('Dias disponíveis para correr: terça, quinta, sábado') && pedido.includes('Data: 2027-01-09 (sábado)'));
    assert.ok(pedido.includes('exatamente 6 semanas') && !pedido.includes('Ana'));

    // Prévia: números, gráfico, lista das semanas e orientações; nada muda antes de aceitar.
    const previa = await pag.textContent('#previa');
    assert.ok(previa.includes('6 semanas · 18 treinos · 119 km no total · maior semana 24 km · maior corrida 10 km'), previa);
    assert.ok(previa.includes('S1 · 30/11–06/12 · base') && previa.includes('Z2 é o ritmo em que dá para conversar.'));
    assert.strictEqual(await pag.locator('#g-previa path.c-feito').count(), 6);
    assert.ok(!(await guardado(pag)).plano);
    await pag.locator('#previa').scrollIntoViewIfNeeded();
    await foto(pag, '7-plano-criado.png');

    await pag.click('[data-acao="usar-plano"]');
    assert.strictEqual(await pag.textContent('#titulo'), 'Ana Souza · 10K da Lagoa');
    assert.strictEqual(await pag.textContent('#hdr'), 'Faltam 43 dias · 0/6 semanas fechadas · meta: correr sem parar');
    assert.strictEqual(await pag.locator('.wk').count(), 6);
    assert.ok((await pag.textContent('#w1 h3')).includes('S1 · 30/11–06/12') && (await pag.textContent('#w1 h3')).includes('começa 30/11'));
    assert.ok((await pag.textContent('#w6')).includes('10K da Lagoa: A PROVA'));
    assert.ok((await pag.textContent('.orienta')).includes('Se doer, pare e descanse.'));
    let g = await guardado(pag);
    assert.deepStrictEqual([g.plano.inicio, g.plano.semanas.length, g.plano.alvo.distancia, Object.keys(g.logs).length, g.perfil.nome], ['2026-11-30', 6, 10, 0, 'Ana Souza']);

    // O plano novo funciona como o original: registro, painel e relatório.
    await pag.click('[data-k="1-ter"]');
    await pag.fill('[name=tempo]', '28:40');
    await pag.click('#frm button[value=ok]');
    assert.ok((await pag.textContent('[data-k="1-ter"]')).includes('4 km em 28:40 (7:10/km)'));
    await aba(pag, 'evolucao');
    assert.strictEqual(await pag.textContent('.heroi-num'), '43');
    assert.ok((await pag.textContent('.heroi')).includes('Sábado, 09/01/2027 · 10 km') && (await pag.textContent('.heroi')).includes('Começa em 30/11/2026'));
    assert.strictEqual(await pag.locator('#g-km path.c-trilho').count(), 6);
    assert.strictEqual(await pag.locator('#g-ritmo svg').count(), 1); // a terça é marcada como treino leve pelo plano

    // O backup leva o plano e o perfil, mas nunca a chave.
    await aba(pag, 'ajustes');
    await pag.click('[data-acao="backup-gerar"]');
    const backup = await pag.inputValue('#bk');
    assert.ok(backup.includes('"plano"') && backup.includes('Ana Souza') && !backup.includes('sk-ant'));
    await pag.reload();
    assert.strictEqual(await pag.locator('.wk').count(), 6);

    // Desfazer: volta o plano original com os treinos que estavam registrados.
    await aba(pag, 'perfil');
    await pag.click('[data-acao="voltar-plano"]');
    g = await guardado(pag);
    assert.ok(!g.plano && g.logs['1-qua'] && g.weeks['1'].closed && g.perfil.nome === 'Ana Souza');
    assert.strictEqual(await pag.textContent('#titulo'), 'Ana Souza · 21K Rio 2027');
    assert.strictEqual(await pag.locator('[data-acao="voltar-plano"]').count(), 0);
    await aba(pag, 'plano');
    assert.strictEqual(await pag.locator('.wk').count(), 28);
    assert.deepStrictEqual(erros, []);
    await ctx.close();
  });

  await teste('IA: chave errada, plano incompleto, nova tentativa e cancelamento', async () => {
    const { ctx, pag, erros, pedidos, respostas } = await abrir({ hoje: SEXTA, ia: { chave: 'sk-ant-errada', modelo: 'claude-sonnet-5-5' } });
    await preencherAna(pag);
    respostas.push({ status: 401, corpo: JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }) });
    await pag.click('[data-acao="criar-ia"]');
    await pag.waitForSelector('#p-erro:not([hidden])');
    assert.strictEqual(await pag.textContent('#p-erro'), 'Chave de API inválida. Confira a chave em Ajustes.');
    assert.strictEqual(pedidos[0].corpo.model, 'claude-sonnet-5-5');
    assert.strictEqual(await pag.inputValue('[name=nome]'), 'Ana Souza'); // o formulário continua preenchido

    respostas.push({ status: 200, corpo: sse(respostaIa(5)) });
    await pag.click('[data-acao="criar-ia"]');
    await pag.waitForFunction(() => /5 semanas; eram 6/.test(document.querySelector('#p-erro').textContent));
    assert.strictEqual(await pag.locator('#previa').count(), 0);

    respostas.push({ status: 200, corpo: sse('{"semanas":[{"foco":"base","trein', 'max_tokens') });
    await pag.click('[data-acao="criar-ia"]');
    await pag.waitForFunction(() => /ficou incompleta/.test(document.querySelector('#p-erro').textContent));

    // A API recusa o pedido com o redirecionamento automático: o app tenta de novo sem ele.
    const antes = pedidos.length;
    respostas.push({ status: 400, corpo: JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'fallbacks: not supported' } }) });
    respostas.push({ status: 200, corpo: sse(respostaIa(6)) });
    await pag.click('[data-acao="criar-ia"]');
    await pag.waitForSelector('#previa');
    assert.strictEqual(pedidos.length, antes + 2);
    assert.ok(pedidos[antes].corpo.fallbacks === 'default' && !('fallbacks' in pedidos[antes + 1].corpo));
    assert.ok(await pag.locator('#p-erro').isHidden());

    // Cancelar no meio: nada muda e o botão volta.
    await pag.click('[data-acao="descartar-plano"]');
    respostas.push({ pendurar: true });
    await pag.click('[data-acao="criar-ia"]');
    await pag.waitForSelector('[data-acao="cancelar-ia"]');
    assert.ok(/Enviando o pedido… \(0:0\d\)/.test(await pag.textContent('#p-prog')));
    await pag.click('[data-acao="cancelar-ia"]');
    await pag.waitForSelector('[data-acao="criar-ia"]');
    assert.strictEqual(await pag.textContent('#aviso'), 'Criação cancelada.');
    assert.strictEqual(await pag.locator('#previa').count(), 0);
    assert.ok(!(await guardado(pag)).plano);
    assert.deepStrictEqual(erros, []);
    await ctx.close();
  });

  await teste('sem chave: guardar a chave em Ajustes ou usar o chat do Claude', async () => {
    const { ctx, pag, erros, pedidos } = await abrir({ hoje: SEXTA });
    await aba(pag, 'perfil');
    assert.ok(await pag.locator('#p-botoes button:has-text("Criar treino com IA")').isDisabled());
    assert.strictEqual(await pag.textContent('#p-falta'), 'Falta preencher: quantos km você corre por semana hoje.');
    await pag.click('[data-acao="ir-ajustes"]');
    await pag.fill('#pr', 'prompt ainda não salvo');
    await pag.fill('#ia-chave', '  sk-ant-minha-9999 ');
    await pag.selectOption('#ia-modelo', 'claude-haiku-5-5');
    await pag.click('[data-acao="salvar-ia"]');
    assert.strictEqual(await pag.inputValue('#pr'), 'prompt ainda não salvo'); // guardar a chave não apaga o que estava sendo digitado
    assert.deepStrictEqual(await pag.evaluate(() => JSON.parse(localStorage.getItem('r21k_ia'))), { chave: 'sk-ant-minha-9999', modelo: 'claude-haiku-5-5' });
    assert.strictEqual(await pag.inputValue('#ia-chave'), ''); // a chave não fica à mostra
    assert.ok((await pag.getAttribute('#ia-chave', 'placeholder')).includes('termina em 9999'));
    assert.ok(!(await pag.evaluate(() => localStorage.getItem('r21k_v1') || '')).includes('sk-ant'));

    await aba(pag, 'perfil');
    assert.ok(await pag.locator('[data-acao="criar-ia"]').isDisabled()); // ainda falta o volume semanal
    await pag.fill('[name=kmSemana]', '15');
    await pag.press('[name=kmSemana]', 'Tab');
    assert.ok(await pag.locator('[data-acao="criar-ia"]').isEnabled());
    assert.strictEqual(await pag.textContent('#p-cal'), 'O plano terá 26 semanas: de 30/11/2026 até a prova, em 29/05/2027.');

    await aba(pag, 'ajustes');
    await pag.click('[data-acao="remover-ia"]');
    assert.deepStrictEqual(await pag.evaluate(() => JSON.parse(localStorage.getItem('r21k_ia'))), { modelo: 'claude-haiku-5-5' });

    // Caminho do chat: copia o pedido, cola a resposta e vê a mesma prévia.
    await aba(pag, 'perfil');
    await pag.click('#criar summary');
    await pag.click('[data-acao="copiar-pedido"]');
    const copiado = await pag.evaluate(() => navigator.clipboard.readText());
    assert.ok(copiado.startsWith('You are an experienced running coach') && copiado.includes('exatamente 26 semanas') && copiado.includes('"hidratacao"'));
    await pag.fill('#colado', 'isto não é um plano');
    await pag.click('[data-acao="ler-resposta"]');
    assert.strictEqual(await pag.textContent('#aviso'), 'Não encontrei um plano nesse texto.');
    await pag.fill('#colado', 'Aqui está o plano:\n```json\n' + JSON.stringify(respostaIa(26)) + '\n```');
    await pag.click('[data-acao="ler-resposta"]');
    assert.ok((await pag.textContent('#previa')).includes('26 semanas'));
    await pag.click('[data-acao="usar-plano"]');
    assert.strictEqual(await pag.locator('.wk').count(), 26);
    assert.ok((await pag.textContent('#w26')).includes('21K Rio 2027: A PROVA'));
    assert.strictEqual(pedidos.length, 0); // nada saiu para a API
    assert.deepStrictEqual(erros, []);
    await ctx.close();
  });

  await teste('apagar tudo: volta ao plano original e remove a chave', async () => {
    const cal = N.calendario('2026-11-30', '2027-01-09');
    const dados = N.vazio();
    dados.perfil = Object.assign({}, N.PERFIL_VAZIO, { nome: 'Ana Souza', dias: ['ter', 'qui', 'sab'], kmSemana: '12' });
    dados.objetivo = { prova: '10K da Lagoa', distancia: 10, data: '2027-01-09', meta: '', tempoAlvo: '' };
    dados.plano = N.montarPlano(respostaIa(cal.n), cal, dados.objetivo, new Date(SEXTA));
    const { ctx, pag, erros } = await abrir({ hoje: '2026-12-09T08:00:00', dados, ia: { chave: 'sk-ant-x', modelo: 'claude-opus-5-5' } });
    assert.strictEqual(await pag.locator('.wk').count(), 6);
    assert.ok((await pag.textContent('#w2 h3')).includes('esta semana'));
    assert.strictEqual(await pag.textContent('#hdr'), 'Faltam 31 dias · 0/6 semanas fechadas'); // sem meta, sem sobra no texto
    await aba(pag, 'ajustes');
    await pag.click('[data-acao="apagar-tudo"]');
    assert.strictEqual(await pag.textContent('#titulo'), 'Rafael Braga · 21K Rio 2027');
    assert.strictEqual(await pag.evaluate(() => localStorage.getItem('r21k_ia')), null);
    await aba(pag, 'plano');
    assert.strictEqual(await pag.locator('.wk').count(), 28);
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
    await pag.screenshot({ path: path.join(__dirname, 'capturas', '8-evolucao-escuro.png'), fullPage: true });
    await ctx.close();
    console.log('capturas regravadas em capturas/');
  }

  await nav.close();
  servidor.close();
  console.log(`\n${n} testes passaram.`);
})().catch((e) => { console.error(e); process.exit(1); });
