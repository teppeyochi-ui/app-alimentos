#!/usr/bin/env node
// Testes do núcleo do 21K Rio 2027:  node teste-nucleo.js
'use strict';
const assert = require('assert');
const N = require('./core.js');

let n = 0;
function teste(nome, fn) { fn(); n++; console.log('ok  ' + nome); }
const perto = (a, b, tol) => assert.ok(Math.abs(a - b) <= (tol || 1e-6), `${a} ≠ ${b}`);
const dia = (ano, mes, d, h) => new Date(ano, mes - 1, d, h || 12);

// Dados de exemplo: três semanas de treino, com um teste de suor e uma dor.
function exemplo() {
  const D = N.vazio();
  D.logs['1-qua'] = { status: 'feito', km: '5', tempo: '35:00', fc: '150', esf: '4', tenis: 'Novablast 5', hid: '', dor: '', dorLocal: '', obs: '' };
  D.logs['1-sex'] = { status: 'feito', km: '4', tempo: '28:00', fc: '148', esf: '3', tenis: 'Novablast 5' };
  D.logs['1-dom'] = { status: 'parcial', km: '5', tempo: '36:00', fc: '152', esf: '5', tenis: 'Novablast 5', obs: 'calor forte' };
  D.logs['2-qua'] = { status: 'feito', km: '6', tempo: '40:30', fc: '147', esf: '4', tenis: 'Evo SL' };
  D.logs['2-dom'] = { status: 'nao', km: '8', tenis: 'Novablast 5', dor: '5', dorLocal: 'joelho', obs: 'parei no aquecimento' };
  D.logs['3-qua'] = { status: 'feito', km: '6', tempo: '39:00', fc: '145', esf: '4', tenis: 'Novablast 5', dor: '2', dorLocal: 'panturrilha' };
  D.logs['3-dom'] = { status: 'feito', km: '9', tempo: '1:00:00', fc: '146', esf: '6', tenis: 'Novablast 5', pa: '78.0', pd: '77.2', liq: '400' };
  D.weeks[1] = { sono: 'bom', calor: '', obs: '', closed: true, sent: true };
  D.weeks[2] = { sono: 'ruim', calor: 'onda de calor', obs: 'semana corrida', closed: true, sent: false };
  return D;
}

teste('plano: 28 semanas, datas e totais', () => {
  assert.strictEqual(N.SEMANAS, 28);
  assert.strictEqual(N.fd(N.dataSessao(1, 'qua')), '18/11');
  assert.strictEqual(N.fd(N.dataSessao(1, 'dom')), '22/11');
  assert.strictEqual(N.dataSessao(28, 'sab').getTime(), N.PROVA.getTime());
  assert.strictEqual(N.fd(N.inicioSemana(7)) + '–' + N.fd(N.fimSemana(7)), '28/12–03/01');
  const D = N.vazio();
  assert.strictEqual(N.kmPlanejados(D, 1), 15);
  assert.strictEqual(N.kmPlanejados(D, 23), 36);
  perto(N.kmPlanejados(D, 28), 27.1);
  // Km de cada semana conferidos com a página original (total: 687,1 km).
  const porSemana = [15, 14, 19, 12, 22, 18, 25, 17, 26, 23, 30, 18, 30, 26, 32, 19, 33, 28, 32, 21, 35, 27, 36, 21, 34, 24, 23, 27.1];
  porSemana.forEach((kmSemana, i) => perto(N.kmPlanejados(D, i + 1), kmSemana));
  assert.deepStrictEqual(N.PLANO.map((s) => s[0]), porSemana.map((_, i) => i + 1));
});

teste('calendário: semana atual e dias para a prova', () => {
  assert.strictEqual(N.semanaAtual(dia(2026, 11, 1)), 1); // antes do início
  assert.strictEqual(N.semanaAtual(dia(2026, 11, 16, 0)), 1);
  assert.strictEqual(N.semanaAtual(dia(2026, 11, 22, 23)), 1);
  assert.strictEqual(N.semanaAtual(dia(2026, 11, 23, 0)), 2);
  assert.strictEqual(N.semanaAtual(dia(2027, 5, 29)), 28);
  assert.strictEqual(N.semanaAtual(dia(2027, 8, 1)), 28); // depois da prova
  assert.strictEqual(N.diasParaProva(dia(2026, 11, 16, 0)), 194);
  assert.strictEqual(N.diasParaProva(dia(2027, 5, 28)), 1);
  assert.strictEqual(N.diasParaProva(dia(2027, 5, 29)), 0);
  assert.strictEqual(N.diasParaProva(dia(2027, 6, 10)), 0);
});

teste('tempo e ritmo', () => {
  assert.strictEqual(N.seg('45:30'), 2730);
  assert.strictEqual(N.seg('1:05:30'), 3930);
  assert.strictEqual(N.seg('45'), 2700);
  assert.strictEqual(N.seg('abc'), 0);
  assert.strictEqual(N.seg(''), 0);
  assert.strictEqual(N.ritmo({ km: '5', tempo: '35:00' }), 420);
  assert.strictEqual(N.ritmo({ km: '0', tempo: '35:00' }), 0);
  assert.strictEqual(N.fmtRitmo(420), '7:00');
  assert.strictEqual(N.fmtRitmo(419.7), '7:00'); // nunca "6:60"
  assert.strictEqual(N.fmtRitmo(0), '–');
});

teste('rodagem leve: só Z1/Z2 sem trecho forte', () => {
  assert.ok(N.leve('5 km Z2 (Pampulha, ida e volta)'));
  assert.ok(N.leve('6 km Z2 + 4 acel.'));
  assert.ok(N.leve('10 km Z2 + teste de suor')); // o teste de suor é uma rodagem leve
  assert.ok(N.leve('6 km Z2 escutando o corpo')); // "corpo" não é RP
  assert.ok(!N.leve('7 km: 4 Z2 + 3 RP'));
  assert.ok(!N.leve('2Z1 + 2×8 min Z3 (rec 3 min) + Z1'));
  assert.ok(!N.leve('2Z1 + 5×1 km Z4 (rec 2 min) + 1 Z1'));
  assert.ok(!N.leve('Teste 5K na pista (2 aquec. + 5 forte + 1)'));
  assert.ok(!N.leve('Ensaio 1: 16 km (8 Z2 + 8 RP)'));
  assert.ok(!N.leve('21K: A PROVA'));
  assert.ok(!N.leve('10 km Z2, 2 últimos em RP'));
});

teste('registros: km feitos, ajustes no planejado e tênis', () => {
  const D = exemplo();
  assert.strictEqual(N.kmFeitos(D, 1), 14);
  assert.strictEqual(N.kmFeitos(D, 2), 6); // o "não fiz" não soma
  assert.strictEqual(N.registros(D).length, 6);
  assert.strictEqual(N.kmTenis(N.registros(D), 'Evo SL'), 6);
  assert.strictEqual(N.kmTenis(N.registros(D), 'Novablast 5'), 29);
  D.ov['4-dom'] = { t: 'Prova 10K', km: 10 };
  const s = N.sessoes(D, 4)[1];
  assert.strictEqual(s.t, 'Prova 10K');
  assert.strictEqual(s.km, 10);
  assert.strictEqual(N.kmPlanejados(D, 4), 15);
  assert.strictEqual(N.basePlano(4, 'dom')[2], 7);
});

teste('teste de suor: taxa e perda de peso', () => {
  const su = N.suor({ tempo: '1:00:00', pa: '78.0', pd: '77.2', liq: '400' });
  perto(su.taxa, 1.2);
  perto(su.perda, 0.8 / 78 * 100);
  assert.strictEqual(N.suor({ tempo: '1:00:00', pa: '78' }), null);
});

teste('relatório: semanas fechadas e não enviadas, no formato da página original', () => {
  const D = exemplo();
  assert.deepStrictEqual(N.pendentes(D), [2]);
  const r = N.relatorio(D, dia(2026, 12, 7));
  assert.ok(r.includes('\nSEMANA 2 – Relatório\n'));
  assert.ok(!r.includes('SEMANA 1 –'));
  assert.ok(r.includes('Quarta 25/11 | planejado: 6 km Z2 + 4 acel. (6 km, A, N) → 6 km | tempo 40:30 | ritmo 6:45/km | FC média 147 | esforço 4 | tênis Evo SL | hidratação: nada | dor 0\n'));
  assert.ok(r.includes('Domingo 29/11 | planejado: 8 km Z2 (8 km, A, N) → não fiz | dor 5 (joelho) | obs: parei no aquecimento\n'));
  assert.ok(r.includes('Sono/cansaço: ruim | Calor/fora do normal: onda de calor | Obs. da semana: semana corrida\n'));
  assert.ok(r.includes('RESUMO DO APP: 2/28 semanas fechadas · 35 km registrados · Evo SL 56 km · Novablast 5 29 km · ritmo Z2: 3 primeiras rodagens 7:04/km, 3 últimas 6:38/km · faltam 173 dias.'));
  D.weeks[3] = { sono: 'médio', calor: '', obs: '', closed: true, sent: false };
  D.ov['3-sex'] = { t: '5 km Z1', km: 5 };
  const r3 = N.relatorio(D, dia(2026, 12, 7));
  assert.ok(r3.includes('PARCIAL') === false);
  assert.ok(r3.includes('  Teste de suor: 78.0 → 77.2 kg, bebeu 400 mL → 1.20 L/h, perda de 1.0%\n'));
  assert.ok(r3.includes('Sexta 04/12 | planejado: 5 km Z1 (5 km, A, N) → não fiz\n'));
  assert.ok(r3.includes('Ajustes no planejado registrados no app: S3 sex: 5 km Z1 (5 km)\n'));
});

teste('exportação: prompt + relatório, com aviso quando falta o prompt', () => {
  const D = exemplo();
  const semPrompt = N.textoExportacao(D, dia(2026, 12, 7));
  assert.ok(semPrompt.startsWith('[ATENÇÃO: cole o prompt atual na aba Ajustes]\n\n---\n# RELATÓRIO GERADO PELO APP (07/12/2026)\n'));
  D.prompt = '  Você é meu treinador.  ';
  assert.ok(N.textoExportacao(D, dia(2026, 12, 7)).startsWith('Você é meu treinador.\n\n---\n'));
  const vazio = N.relatorio(N.vazio(), dia(2026, 11, 16));
  assert.ok(vazio.includes('Nenhuma semana fechada pendente de envio.'));
});

teste('backup: aceita o formato da página original e recusa lixo', () => {
  const antigo = '{"logs":{"1-qua":{"status":"feito","km":"5","tempo":"35:00","tenis":"Novablast 5"}},"weeks":{},"ov":{},"prompt":"oi","evoBase":80}';
  const D = N.importar(antigo);
  assert.strictEqual(D.logs['1-qua'].km, '5');
  assert.strictEqual(D.evoBase, 80);
  assert.strictEqual(N.importar('{"logs":{}}').evoBase, 50); // campos que faltam ganham o padrão
  assert.deepStrictEqual(N.importar('{"logs":{},"weeks":null}').weeks, {});
  assert.throws(() => N.importar('{"outra":"coisa"}'));
  assert.throws(() => N.importar('[1,2]'));
  assert.throws(() => N.importar('não é json'));
  assert.deepStrictEqual(N.carregar(null), N.vazio());
  assert.deepStrictEqual(N.carregar('{quebrado'), N.vazio());
  assert.deepStrictEqual(N.importar(JSON.stringify(exemplo())), exemplo()); // ida e volta
});

teste('painel: indicadores do topo', () => {
  const P = N.painel(exemplo(), dia(2026, 12, 7)); // segunda da semana 4
  assert.strictEqual(P.semana, 4);
  assert.strictEqual(P.dias, 173);
  assert.strictEqual(P.fechadas, 2);
  assert.strictEqual(P.kmTotal, 35);
  assert.strictEqual(P.treinosFeitos, 6);
  assert.strictEqual(P.treinosPrevistos, 8); // S1–S3 completas; nada da S4 venceu ainda
  assert.strictEqual(P.kmPrevisto, 48);
  assert.strictEqual(P.parciais, 1);
  assert.strictEqual(P.maiorCorrida, 9);
  assert.strictEqual(P.ritmoZ2.n, 6);
  perto(P.ritmoZ2.inicio, (420 + 420 + 432) / 3);
  perto(P.ritmoZ2.atual, (405 + 390 + 400) / 3);
  perto(P.fcZ2.atual, (147 + 145 + 146) / 3);
  assert.deepStrictEqual(P.tenis, { evo: 56, nova: 29, vidaEvo: 720 });
  assert.strictEqual(P.suor.length, 1);
  assert.strictEqual(P.suor[0].w, 3);
  assert.deepStrictEqual(P.dorRecente, []); // a dor 5 foi na S2; o alerta olha só S3 e S4
  const cedo = N.painel(exemplo(), dia(2026, 12, 2));
  assert.deepStrictEqual(cedo.dorRecente, [{ w: 2, d: 'dom', dor: 5, local: 'joelho' }]);
});

teste('painel: um valor por semana para os gráficos', () => {
  const P = N.painel(exemplo(), dia(2026, 12, 7));
  assert.strictEqual(P.semanas.length, 28);
  const [s1, s2, s3, s4] = P.semanas;
  assert.deepStrictEqual([s1.plan, s1.feito, s1.longoPlan, s1.longoFeito], [15, 14, 6, 5]);
  perto(s1.ritmo, (2100 + 1680 + 2160) / 14); // tempo total ÷ km total das rodagens leves
  perto(s1.fc, 150);
  perto(s1.mpb, (60000 / (420 * 150) + 60000 / (420 * 148) + 60000 / (432 * 152)) / 3);
  perto(s1.esforco, 4);
  assert.strictEqual(s1.sono, 'bom');
  assert.strictEqual(s1.dor, null);
  assert.deepStrictEqual([s2.feito, s2.longoFeito, s2.dor, s2.dorLocal, s2.sono], [6, 6, 5, 'joelho', 'ruim']); // a dor do "não fiz" conta
  assert.deepStrictEqual([s3.feito, s3.longoFeito, s3.dor, s3.sono, s3.fechada], [15, 9, 2, null, false]);
  assert.deepStrictEqual([s4.feito, s4.longoFeito, s4.ritmo, s4.fc, s4.esforco], [null, null, null, null, null]);
  assert.strictEqual(P.semanas[27].longoPlan, 21.1);
});

teste('painel: sem registros, só o plano', () => {
  const P = N.painel(N.vazio(), dia(2026, 11, 16, 9));
  assert.strictEqual(P.semana, 1);
  assert.strictEqual(P.dias, 194);
  assert.strictEqual(P.treinosPrevistos, 0);
  assert.strictEqual(P.maiorCorrida, null);
  assert.strictEqual(P.ritmoZ2.atual, null);
  assert.ok(P.semanas.every((s) => s.feito === null && s.plan > 0));
  // Descanso de 0 km na última semana não conta como treino perdido.
  const fim = N.painel(N.vazio(), dia(2027, 5, 30));
  assert.strictEqual(fim.treinosPrevistos, N.PLANO.reduce((a, s) => a + s[1].filter((x) => x[2] > 0).length, 0));
});

console.log(`\n${n} testes passaram.`);
