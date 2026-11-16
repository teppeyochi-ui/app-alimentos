#!/usr/bin/env node
// Testes do núcleo e da IA (sem navegador):  node teste-nucleo.js
'use strict';
const assert = require('assert');
const N = require('./core.js');
const IA = require('./ia.js');

let n = 0;
function teste(nome, fn) { fn(); n++; console.log('ok  ' + nome); }
const perto = (a, b, tol) => assert.ok(Math.abs(a - b) <= (tol || 1e-6), `${a} ≠ ${b}`);
const dia = (ano, mes, d, h) => new Date(ano, mes - 1, d, h || 12);

// Dados de exemplo no plano original: três semanas de treino, com um teste de suor e uma dor.
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

// Perfil, objetivo e resposta da IA para um plano curto: 10K em 6 semanas, terça/quinta/sábado.
const PERFIL = Object.assign({}, N.PERFIL_VAZIO, {
  nome: 'Ana Souza', nascimento: '1990', sexo: 'feminino', peso: '62', altura: '165', experiencia: 'menos1',
  kmSemana: '12', maiorCorrida: '6', ritmoLeve: '7:10', dias: ['ter', 'qui', 'sab'], diaLongo: 'sab',
  lesoes: 'canelite no ano passado', tenis: [{ nome: 'Pegasus', kmInicial: 120, vida: 600 }],
});
const OBJETIVO = { prova: '10K da Lagoa', distancia: 10, data: '2027-01-09', meta: 'correr sem parar', tempoAlvo: '' };
function respostaIa(semanas) {
  return {
    semanas: Array.from({ length: semanas }, (_, i) => ({
      foco: i === semanas - 1 ? 'prova' : 'base',
      treinos: [
        { dia: 'ter', treino: `${4 + i} km Z2`, km: 4 + i, leve: true, hidratacao: 'A' },
        { dia: 'qui', treino: '2 Z1 + 4×400 m Z4 + 1 Z1', km: 5, leve: false, hidratacao: 'A' },
        { dia: 'sab', treino: `${6 + i} km Z2`, km: 6 + i, leve: true, hidratacao: 'B' },
      ],
    })),
    orientacoes: 'Z2 é o ritmo em que dá para conversar.',
  };
}
function comPlano() {
  const cal = N.calendario('2026-11-30', OBJETIVO.data);
  const D = N.vazio();
  D.perfil = PERFIL;
  D.objetivo = OBJETIVO;
  D.plano = N.montarPlano(respostaIa(cal.n), cal, OBJETIVO, dia(2026, 11, 27));
  return D;
}

teste('plano original: 28 semanas, datas e totais', () => {
  const D = N.vazio();
  assert.strictEqual(N.nSemanas(D), 28);
  assert.strictEqual(N.plano(D).embutido, true);
  assert.strictEqual(N.fd(N.dataSessao(D, 1, 'qua')), '18/11');
  assert.strictEqual(N.fd(N.dataSessao(D, 1, 'dom')), '22/11');
  assert.strictEqual(N.dataSessao(D, 28, 'sab').getTime(), N.dataProva(D).getTime());
  assert.strictEqual(N.fd(N.inicioSemana(D, 7)) + '–' + N.fd(N.fimSemana(D, 7)), '28/12–03/01');
  assert.strictEqual(N.kmProva(D), 21.1);
  // Km de cada semana conferidos com a página original (total: 687,1 km).
  const porSemana = [15, 14, 19, 12, 22, 18, 25, 17, 26, 23, 30, 18, 30, 26, 32, 19, 33, 28, 32, 21, 35, 27, 36, 21, 34, 24, 23, 27.1];
  porSemana.forEach((kmSemana, i) => perto(N.kmPlanejados(D, i + 1), kmSemana));
  assert.deepStrictEqual(N.PLANO_21K.map((s) => s[0]), porSemana.map((_, i) => i + 1));
});

teste('calendário: semana atual, fase e dias para a prova', () => {
  const D = N.vazio();
  assert.strictEqual(N.semanaAtual(D, dia(2026, 11, 1)), 1); // antes do início
  assert.strictEqual(N.fase(D, dia(2026, 11, 1)), 'antes');
  assert.strictEqual(N.semanaAtual(D, dia(2026, 11, 16, 0)), 1);
  assert.strictEqual(N.fase(D, dia(2026, 11, 16, 0)), 'durante');
  assert.strictEqual(N.semanaAtual(D, dia(2026, 11, 22, 23)), 1);
  assert.strictEqual(N.semanaAtual(D, dia(2026, 11, 23, 0)), 2);
  assert.strictEqual(N.semanaAtual(D, dia(2027, 5, 29)), 28);
  assert.strictEqual(N.fase(D, dia(2027, 5, 30)), 'durante');
  assert.strictEqual(N.semanaAtual(D, dia(2027, 8, 1)), 28); // depois da prova
  assert.strictEqual(N.fase(D, dia(2027, 5, 31)), 'depois');
  assert.strictEqual(N.diasParaProva(D, dia(2026, 11, 16, 0)), 194);
  assert.strictEqual(N.diasParaProva(D, dia(2027, 5, 28)), 1);
  assert.strictEqual(N.diasParaProva(D, dia(2027, 5, 29)), 0);
  assert.strictEqual(N.diasParaProva(D, dia(2027, 6, 10)), 0);
});

teste('datas: leitura, segunda-feira e dia da semana', () => {
  assert.strictEqual(N.iso(N.dataIso('2027-05-29')), '2027-05-29');
  assert.strictEqual(N.dataIso('2027-02-30'), null);
  assert.strictEqual(N.dataIso('29/05/2027'), null);
  assert.strictEqual(N.dataIso(''), null);
  assert.strictEqual(N.iso(N.segunda(dia(2026, 11, 22))), '2026-11-16'); // domingo → segunda da mesma semana
  assert.strictEqual(N.iso(N.segunda(dia(2026, 11, 16))), '2026-11-16');
  assert.strictEqual(N.diaDaSemana(dia(2027, 5, 29)), 'sab');
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
  assert.deepStrictEqual(N.usoTenis(D), [{ nome: 'Evo SL', km: 56, vida: 720 }, { nome: 'Novablast 5', km: 29, vida: 0 }]);
  D.ov['4-dom'] = { t: 'Prova 10K', km: 10 };
  const s = N.sessoes(D, 4)[1];
  assert.strictEqual(s.t, 'Prova 10K');
  assert.strictEqual(s.km, 10);
  assert.strictEqual(N.kmPlanejados(D, 4), 15);
  assert.deepStrictEqual([N.basePlano(D, 4, 'dom').t, N.basePlano(D, 4, 'dom').km], ['7 km Z2 (alívio)', 7]);
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
  assert.strictEqual(N.tenis(D)[0].kmInicial, 80); // os km do Evo SL da página antiga continuam valendo
  assert.strictEqual(N.importar('{"logs":{}}').evoBase, 50); // campos que faltam ganham o padrão
  assert.deepStrictEqual(N.importar('{"logs":{},"weeks":null}').weeks, {});
  assert.throws(() => N.importar('{"outra":"coisa"}'));
  assert.throws(() => N.importar('[1,2]'));
  assert.throws(() => N.importar('não é json'));
  assert.deepStrictEqual(N.carregar(null), N.vazio());
  assert.deepStrictEqual(N.carregar('{quebrado'), N.vazio());
  assert.deepStrictEqual(N.importar(JSON.stringify(exemplo())), exemplo()); // ida e volta
  // Com perfil e plano criado: ida e volta, e um plano quebrado é recusado.
  assert.deepStrictEqual(N.importar(JSON.stringify(comPlano())), comPlano());
  const quebrado = comPlano();
  quebrado.plano.semanas = 'x';
  assert.throws(() => N.importar(JSON.stringify(quebrado)));
});

teste('painel: indicadores do topo', () => {
  const P = N.painel(exemplo(), dia(2026, 12, 7)); // segunda da semana 4
  assert.deepStrictEqual([P.n, P.semana, P.fase, P.dias, P.fechadas, P.kmProva], [28, 4, 'durante', 173, 2, 21.1]);
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
  assert.deepStrictEqual(P.tenis, [{ nome: 'Evo SL', km: 56, vida: 720 }, { nome: 'Novablast 5', km: 29, vida: 0 }]);
  assert.strictEqual(P.suor.length, 1);
  assert.strictEqual(P.suor[0].w, 3);
  perto(P.progresso, 21.5 / 194 * 100, 0.01);
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
  assert.deepStrictEqual([s3.feito, s3.longoFeito, s3.dor, s3.sono, s3.fechada, s3.longoPendente], [15, 9, 2, null, false, false]);
  assert.deepStrictEqual([s4.feito, s4.longoFeito, s4.ritmo, s4.fc, s4.esforco, s4.longoPendente], [null, null, null, null, null, true]);
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
  assert.strictEqual(fim.treinosPrevistos, N.PLANO_21K.reduce((a, s) => a + s[1].filter((x) => x[2] > 0).length, 0));
});

teste('perfil e objetivo: o padrão é o do plano original até alguém preencher', () => {
  const D = N.vazio();
  assert.strictEqual(N.titulo(D), 'Rafael Braga · 21K Rio 2027');
  assert.deepStrictEqual(N.perfil(D).dias, ['qua', 'sex', 'dom']);
  assert.deepStrictEqual(N.objetivo(D), { prova: '21K Rio 2027', distancia: 21.1, data: '2027-05-29', meta: 'completar bem', tempoAlvo: '' });
  assert.strictEqual(N.idade(D, dia(2026, 11, 16)), null);
  D.perfil = { nome: 'Ana', nascimento: '1990', tenis: [{ nome: 'Pegasus', kmInicial: 120, vida: 600 }, { nome: '' }] };
  D.objetivo = { prova: '10K', distancia: 10, data: '2027-01-09' };
  assert.strictEqual(N.titulo(D), 'Ana · 21K Rio 2027'); // o nome muda na hora; a prova só quando o plano mudar
  assert.strictEqual(N.idade(D, dia(2026, 11, 16)), 36);
  assert.deepStrictEqual(N.perfil(D).dias, []);
  assert.deepStrictEqual(N.tenis(D), [{ nome: 'Pegasus', kmInicial: 120, vida: 600 }]);
  assert.strictEqual(N.objetivo(D).meta, '');
  assert.strictEqual(N.alvo(D).distancia, 21.1);
});

teste('plano novo: semanas do calendário até a prova', () => {
  const cal = N.calendario('2026-11-30', '2027-01-09'); // prova num sábado
  assert.deepStrictEqual([cal.n, cal.diaProva, N.iso(cal.inicio), N.iso(cal.prova)], [6, 'sab', '2026-11-30', '2027-01-09']);
  assert.deepStrictEqual([N.iso(cal.semanas[5].ini), N.iso(cal.semanas[5].fim)], ['2027-01-04', '2027-01-10']);
  assert.strictEqual(N.calendario('2026-12-02', '2027-01-09').n, 6); // qualquer dia vale pela segunda da semana
  assert.strictEqual(N.calendario('2026-12-14', '2027-01-09').n, 4);
  assert.throws(() => N.calendario('2026-12-21', '2027-01-09'), /muito perto/);
  assert.throws(() => N.calendario('2027-02-01', '2027-01-09'), /muito perto/);
  assert.throws(() => N.calendario('2026-11-30', ''), /data da prova/);
  const longe = N.calendario('2026-11-30', '2028-04-02'); // mais de 40 semanas: começa mais tarde
  assert.deepStrictEqual([longe.n, N.iso(longe.inicio)], [40, '2027-06-28']);
  // Começar nesta semana só até quarta; a próxima segunda está sempre lá.
  assert.deepStrictEqual(N.opcoesInicio(dia(2026, 11, 16)).map((x) => x.iso), ['2026-11-16', '2026-11-23']);
  assert.deepStrictEqual(N.opcoesInicio(dia(2026, 11, 18)).map((x) => x.iso), ['2026-11-16', '2026-11-23']);
  assert.deepStrictEqual(N.opcoesInicio(dia(2026, 11, 19)).map((x) => x.iso), ['2026-11-23']);
});

teste('plano novo: o que falta preencher antes de pedir', () => {
  assert.deepStrictEqual(N.faltaParaPlano(PERFIL, OBJETIVO), []);
  const falta = N.faltaParaPlano(N.PERFIL_VAZIO, N.ALVO_VAZIO);
  assert.strictEqual(falta.length, 4);
  assert.ok(falta.join(' ').includes('data da prova') && falta.join(' ').includes('2 dias'));
  assert.deepStrictEqual(N.faltaParaPlano(Object.assign({}, PERFIL, { kmSemana: '0' }), OBJETIVO), []); // zero é resposta válida
});

teste('plano novo: confere a resposta da IA e fecha com a prova', () => {
  const cal = N.calendario('2026-11-30', OBJETIVO.data);
  const r = respostaIa(cal.n);
  r.semanas[0].treinos.push({ dia: 'ter', treino: 'repetido', km: 3, leve: true, hidratacao: 'A' }); // dia repetido
  r.semanas[0].treinos.push({ dia: 'xyz', treino: 'dia inválido', km: 3, leve: true, hidratacao: 'A' });
  r.semanas[1].treinos.reverse(); // fora de ordem
  r.semanas[5].treinos.push({ dia: 'dom', treino: '3 km Z1 depois da prova', km: 3, leve: true, hidratacao: 'A' });
  const p = N.montarPlano(r, cal, OBJETIVO, dia(2026, 11, 27));
  assert.strictEqual(p.inicio, '2026-11-30');
  assert.strictEqual(p.criadoEm, '2026-11-27');
  assert.strictEqual(p.semanas.length, 6);
  assert.deepStrictEqual(p.semanas[0].map((x) => x.d), ['ter', 'qui', 'sab']);
  assert.deepStrictEqual(p.semanas[1].map((x) => x.d), ['ter', 'qui', 'sab']);
  assert.deepStrictEqual(p.semanas[0][0], { d: 'ter', t: '4 km Z2', km: 4, c: 'A', leve: true });
  // Última semana: nada depois da prova, e a prova com a distância do objetivo.
  assert.deepStrictEqual(p.semanas[5].map((x) => x.d), ['ter', 'qui', 'sab']);
  assert.deepStrictEqual(p.semanas[5][2], { d: 'sab', t: '10K da Lagoa: A PROVA', km: 10, c: 'D', leve: false }); // a IA pôs um treino comum no dia
  assert.deepStrictEqual(p.alvo, { prova: '10K da Lagoa', distancia: 10, data: '2027-01-09', meta: 'correr sem parar', tempoAlvo: '' });
  assert.deepStrictEqual(p.focos.slice(4), ['base', 'prova']);
  assert.ok(N.planoValido(p));
  // Sem treino no dia da prova, o app cria o da prova; se a IA descreveu a prova, o texto dela fica.
  const semProva = respostaIa(cal.n);
  semProva.semanas[5].treinos.pop();
  assert.strictEqual(N.montarPlano(semProva, cal, OBJETIVO).semanas[5][2].t, '10K da Lagoa: A PROVA');
  semProva.semanas[5].treinos.push({ dia: 'sab', treino: 'PROVA 10 km: largar em Z3', km: 10, leve: false, hidratacao: 'D' });
  assert.strictEqual(N.montarPlano(semProva, cal, OBJETIVO).semanas[5][2].t, 'PROVA 10 km: largar em Z3');
  assert.throws(() => N.montarPlano(respostaIa(5), cal, OBJETIVO), /5 semanas; eram 6/);
  assert.throws(() => N.montarPlano({ semanas: Array(6).fill({ foco: '', treinos: [] }) }, cal, OBJETIVO), /quase sem treinos/);
  assert.throws(() => N.montarPlano({ texto: 'oi' }, cal, OBJETIVO), /não trouxe um plano/);
  // Semana i: terça (4+i) + quinta 5 + sábado (6+i); a última troca o sábado pela prova de 10 km.
  assert.deepStrictEqual(N.resumoPlano(p.semanas), { n: 6, treinos: 18, total: 119, pico: 24, longao: 10, porSemana: [15, 17, 19, 21, 23, 24] });
});

teste('plano criado em uso: datas, prova, treinos leves e relatório', () => {
  const D = comPlano();
  assert.deepStrictEqual([N.plano(D).embutido, N.nSemanas(D), N.kmProva(D), N.iso(N.dataProva(D))], [false, 6, 10, '2027-01-09']);
  assert.strictEqual(N.titulo(D), 'Ana Souza · 10K da Lagoa');
  assert.strictEqual(N.fd(N.dataSessao(D, 1, 'ter')), '01/12');
  assert.strictEqual(N.fase(D, dia(2026, 11, 27)), 'antes');
  assert.strictEqual(N.semanaAtual(D, dia(2026, 12, 9)), 2);
  assert.strictEqual(N.diasParaProva(D, dia(2027, 1, 8)), 1);
  // "Leve" vem da marca do plano; se o texto for ajustado à mão, vale o texto.
  const [ter, qui] = N.sessoes(D, 1);
  assert.deepStrictEqual([N.ehLeve(ter), N.ehLeve(qui), ter.s, ter.c], [true, false, '', 'A']);
  // Código e indicação de tênis fora do conhecido (backup editado à mão) não passam adiante.
  D.plano.semanas[0][0].c = '"><img>';
  D.plano.semanas[0][0].s = '<b>';
  assert.deepStrictEqual([N.sessoes(D, 1)[0].c, N.sessoes(D, 1)[0].s], ['A', '']);
  D.plano.semanas[0][0].c = 'A';
  delete D.plano.semanas[0][0].s;
  D.ov['1-ter'] = { t: '4 km com 2 em RP', km: 4 };
  assert.strictEqual(N.ehLeve(N.sessoes(D, 1)[0]), false);
  delete D.ov['1-ter'];
  D.logs['1-ter'] = { status: 'feito', km: '4', tempo: '28:40', fc: '150', esf: '4', tenis: 'Pegasus' };
  D.logs['1-qui'] = { status: 'feito', km: '5', tempo: '31:00', fc: '165', esf: '7', tenis: 'Pegasus' };
  D.weeks[1] = { sono: 'bom', calor: '', obs: '', closed: true, sent: false };
  const P = N.painel(D, dia(2026, 12, 9));
  assert.deepStrictEqual([P.n, P.semana, P.kmProva, P.treinosFeitos, P.treinosPrevistos], [6, 2, 10, 2, 4]);
  perto(P.semanas[0].ritmo, 430); // só a terça é leve
  assert.deepStrictEqual(P.tenis, [{ nome: 'Pegasus', km: 129, vida: 600 }]);
  const r = N.relatorio(D, dia(2026, 12, 9));
  assert.ok(r.includes('Terça 01/12 | planejado: 4 km Z2 (4 km, A) → 4 km | tempo 28:40'));
  assert.ok(r.includes('RESUMO DO APP: 1/6 semanas fechadas · 9 km registrados · Pegasus 129 km · ritmo Z2'));
});

teste('IA: o pedido leva o perfil sem o nome, o objetivo e as semanas', () => {
  const cal = N.calendario('2026-11-30', OBJETIVO.data);
  const pedido = IA.pedidoPlano({ perfil: PERFIL, objetivo: OBJETIVO, calendario: cal, idade: 36, hoje: dia(2026, 11, 27) });
  assert.ok(!pedido.includes('Ana'));
  assert.ok(pedido.includes('Idade: 36 anos'));
  assert.ok(pedido.includes('Experiência: corre há menos de 1 ano'));
  assert.ok(pedido.includes('Volume atual: 12 km por semana'));
  assert.ok(pedido.includes('Dias disponíveis para correr: terça, quinta, sábado'));
  assert.ok(pedido.includes('Lesões, dores ou limitações: canelite no ano passado'));
  assert.ok(pedido.includes('FC máxima: não informado'));
  assert.ok(pedido.includes('Distância: 10 km'));
  assert.ok(pedido.includes('Data: 2027-01-09 (sábado)'));
  assert.ok(pedido.includes('S1: 2026-11-30 a 2026-12-06'));
  assert.ok(pedido.includes('S6: 2027-01-04 a 2027-01-10 (prova: sábado, 2027-01-09)'));
  assert.ok(pedido.includes('exatamente 6 semanas'));
  const chat = IA.textoParaChat({ perfil: PERFIL, objetivo: OBJETIVO, calendario: cal, idade: 36, hoje: dia(2026, 11, 27) });
  assert.ok(chat.includes(pedido) && chat.includes('"hidratacao"') && chat.startsWith('You are an experienced running coach'));
});

teste('IA: requisição com streaming, formato JSON e modelo padrão', () => {
  const r = IA.montarRequisicao({ chave: 'sk-teste', sistema: 'S', usuario: 'U', esquema: IA.ESQUEMA_PLANO });
  const corpo = JSON.parse(r.init.body);
  assert.strictEqual(r.url, 'https://api.anthropic.com/v1/messages');
  assert.strictEqual(r.init.headers['x-api-key'], 'sk-teste');
  assert.strictEqual(r.init.headers['anthropic-version'], '2026-10-21');
  assert.strictEqual(r.init.headers['anthropic-dangerous-direct-browser-access'], 'true');
  assert.strictEqual(corpo.model, 'claude-opus-5-5');
  assert.strictEqual(corpo.stream, true);
  assert.deepStrictEqual(corpo.output_config, { effort: 'high', format: { type: 'json_schema', schema: IA.ESQUEMA_PLANO } });
  assert.deepStrictEqual(corpo.messages, [{ role: 'user', content: 'U' }]);
  assert.ok(!('temperature' in corpo) && !('thinking' in corpo) && !('tool_choice' in corpo));
  // Redirecionamento automático só onde o modelo aceita, e pode ser desligado.
  assert.strictEqual(corpo.fallbacks, 'default');
  assert.strictEqual(r.init.headers['anthropic-beta'], 'server-side-fallback-2026-07-01');
  const sem = IA.montarRequisicao({ chave: 'k', sistema: 'S', usuario: 'U', esquema: {}, semFallback: true });
  assert.ok(!('fallbacks' in JSON.parse(sem.init.body)) && !sem.init.headers['anthropic-beta']);
  const haiku = IA.montarRequisicao({ chave: 'k', modelo: 'claude-haiku-5-5', sistema: 'S', usuario: 'U', esquema: {} });
  assert.strictEqual(JSON.parse(haiku.init.body).model, 'claude-haiku-5-5');
  assert.ok(!('fallbacks' in JSON.parse(haiku.init.body)));
  assert.strictEqual(IA.modeloPorId('modelo-que-nao-existe').id, 'claude-opus-5-5');
});

teste('IA: o esquema da resposta segue as regras de saída estruturada', () => {
  const visitar = (no) => {
    if (no.type === 'object') {
      assert.strictEqual(no.additionalProperties, false);
      assert.deepStrictEqual(no.required.slice().sort(), Object.keys(no.properties).sort());
      Object.values(no.properties).forEach(visitar);
    } else if (no.type === 'array') visitar(no.items);
    for (const proibido of ['minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems']) assert.ok(!(proibido in no), proibido);
  };
  visitar(IA.ESQUEMA_PLANO);
});

teste('IA: leitura do streaming até o JSON do plano', () => {
  const json = JSON.stringify(respostaIa(2));
  const ev = (o) => 'event: ' + o.type + '\ndata: ' + JSON.stringify(o) + '\n\n';
  const fluxo = ev({ type: 'message_start', message: { model: 'claude-opus-5-5' } }) +
    ev({ type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: '' } }) +
    ev({ type: 'content_block_delta', delta: { type: 'text_delta', text: json.slice(0, 90) } }) +
    ev({ type: 'content_block_delta', delta: { type: 'text_delta', text: json.slice(90) } }) +
    ev({ type: 'message_delta', delta: { stop_reason: 'end_turn' } }) + ev({ type: 'message_stop' });
  const leitor = IA.criarLeitorSSE(), estado = IA.novoEstado();
  // Pedaços que cortam eventos no meio.
  for (let i = 0; i < fluxo.length; i += 37) for (const e of leitor.alimentar(fluxo.slice(i, i + 37))) IA.aplicarEvento(estado, e);
  assert.strictEqual(estado.modelo, 'claude-opus-5-5');
  assert.strictEqual(estado.motivo, 'end_turn');
  assert.deepStrictEqual(IA.resultado(estado), respostaIa(2));
  assert.strictEqual(IA.semanasRecebidas(json), 2);
  assert.strictEqual(IA.semanasRecebidas(json.slice(0, 40)), 1);
});

teste('IA: resposta recusada, cortada, com troca de modelo e erros', () => {
  assert.throws(() => IA.resultado({ texto: '', corte: 0, motivo: 'refusal' }), /não pôde atender/);
  assert.throws(() => IA.resultado({ texto: '{"semanas":[', corte: 0, motivo: 'max_tokens' }), /incompleta/);
  assert.throws(() => IA.resultado({ texto: '{"semanas":[', corte: 0, motivo: 'end_turn' }), /incompleta/);
  // Outro modelo assumiu no meio: vale o JSON inteiro que veio depois da troca.
  const estado = IA.novoEstado();
  IA.aplicarEvento(estado, { type: 'content_block_delta', delta: { type: 'text_delta', text: '{"semanas":[{"fo' } });
  IA.aplicarEvento(estado, { type: 'content_block_start', content_block: { type: 'fallback' } });
  IA.aplicarEvento(estado, { type: 'content_block_delta', delta: { type: 'text_delta', text: '{"semanas":[],"orientacoes":"ok"}' } });
  IA.aplicarEvento(estado, { type: 'message_delta', delta: { stop_reason: 'end_turn' } });
  assert.deepStrictEqual(IA.resultado(estado), { semanas: [], orientacoes: 'ok' });
  assert.throws(() => IA.aplicarEvento(IA.novoEstado(), { type: 'error', error: { type: 'overloaded_error', message: 'x' } }), /sobrecarregado/);
  assert.ok(IA.mensagemErro(401).includes('Chave de API inválida'));
  assert.ok(IA.mensagemErro(429).includes('Limite de uso'));
  assert.strictEqual(IA.mensagemErro(400, 'invalid_request_error', 'campo x'), 'A API recusou o pedido (400): campo x');
  assert.ok(IA.mensagemErro(503).includes('503'));
});

teste('IA: resposta colada do chat, com ou sem cerca de código', () => {
  assert.deepStrictEqual(IA.lerJson('Aqui está:\n```json\n{"semanas":[],"orientacoes":"ok"}\n```\nBons treinos!'), { semanas: [], orientacoes: 'ok' });
  assert.deepStrictEqual(IA.lerJson('{"a":{"b":1}}'), { a: { b: 1 } });
  assert.throws(() => IA.lerJson('não tem plano aqui'), /Não encontrei/);
  assert.throws(() => IA.lerJson('{"semanas":[{"foco":'), /incompleto|Não encontrei/);
});

console.log(`\n${n} testes passaram.`);
