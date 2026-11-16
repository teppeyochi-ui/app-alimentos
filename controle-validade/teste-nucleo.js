#!/usr/bin/env node
// Testes do núcleo (sem navegador):  node teste-nucleo.js
'use strict';
const assert = require('assert');
const N = require('./core.js');

let n = 0;
function teste(nome, fn) { fn(); n++; console.log('ok  ' + nome); }
const em = (ano, mes, d, h, min) => new Date(ano, mes - 1, d, h == null ? 12 : h, min || 0).getTime();
const quando = (ms) => N.fmtDataAno(ms) + ' ' + N.fmtHora(ms);

// Segunda-feira, 16/11/2026, meio-dia.
const AGORA = em(2026, 11, 16);

teste('validade em dias vence no fim do dia, n dias depois do preparo', () => {
  const c = N.calcularValidade({ feitoEm: em(2026, 11, 16, 14, 32), validade: { n: 3, un: 'd' } });
  assert.strictEqual(quando(c.venceEm), '19/11/26 23:59');
  assert.strictEqual(c.porHora, false);
  assert.strictEqual(c.limitada, false);
});

teste('com o dia do preparo contando como 1º dia, vence um dia antes', () => {
  const c = N.calcularValidade({ feitoEm: em(2026, 11, 16, 14, 32), validade: { n: 3, un: 'd' }, contarDiaPreparo: true });
  assert.strictEqual(quando(c.venceEm), '18/11/26 23:59');
  const um = N.calcularValidade({ feitoEm: em(2026, 11, 16, 8), validade: { n: 1, un: 'd' }, contarDiaPreparo: true });
  assert.strictEqual(quando(um.venceEm), '16/11/26 23:59');
});

teste('validade em horas vence na hora exata', () => {
  const c = N.calcularValidade({ feitoEm: em(2026, 11, 16, 14, 32), validade: { n: 24, un: 'h' } });
  assert.strictEqual(quando(c.venceEm), '17/11/26 14:32');
  assert.strictEqual(c.porHora, true);
});

teste('a validade do fabricante é o teto da etiqueta', () => {
  const feitoEm = em(2026, 11, 16, 8);
  const curta = N.calcularValidade({ feitoEm, validade: { n: 5, un: 'd' }, validadeOrigem: '2026-11-18' });
  assert.strictEqual(quando(curta.venceEm), '18/11/26 23:59');
  assert.strictEqual(curta.limitada, true);
  const folgada = N.calcularValidade({ feitoEm, validade: { n: 5, un: 'd' }, validadeOrigem: '2026-12-30' });
  assert.strictEqual(quando(folgada.venceEm), '21/11/26 23:59');
  assert.strictEqual(folgada.limitada, false);
});

teste('validade vira o mês e o ano certos', () => {
  const c = N.calcularValidade({ feitoEm: em(2026, 12, 30, 9), validade: { n: 3, un: 'd' } });
  assert.strictEqual(quando(c.venceEm), '02/01/27 23:59');
  assert.strictEqual(N.diaSemana(c.venceEm), 'sáb');
});

teste('sem validade cadastrada não há cálculo', () => {
  assert.strictEqual(N.calcularValidade({ feitoEm: AGORA, validade: null }), null);
  assert.strictEqual(N.calcularValidade({ feitoEm: AGORA, validade: { n: 0, un: 'd' } }), null);
});

teste('situação: vencido, hoje, em breve e no prazo', () => {
  const fim = (d) => N.fimDoDia(em(2026, 11, d));
  assert.strictEqual(N.situacao(fim(15), AGORA, 2), 'vencido');
  assert.strictEqual(N.situacao(fim(16), AGORA, 2), 'hoje');
  assert.strictEqual(N.situacao(fim(17), AGORA, 2), 'breve');
  assert.strictEqual(N.situacao(fim(18), AGORA, 2), 'breve');
  assert.strictEqual(N.situacao(fim(19), AGORA, 2), 'ok');
  assert.strictEqual(N.situacao(fim(19), AGORA, 3), 'breve');
  // Por hora: vence às 11h de hoje e já é meio-dia.
  assert.strictEqual(N.situacao(em(2026, 11, 16, 11), AGORA, 2), 'vencido');
  assert.strictEqual(N.situacao(em(2026, 11, 16, 18), AGORA, 2), 'hoje');
});

teste('texto do tempo que falta ou que passou', () => {
  const fim = (d) => N.fimDoDia(em(2026, 11, d));
  assert.strictEqual(N.textoRestante(fim(13), AGORA), 'venceu há 3 dias');
  assert.strictEqual(N.textoRestante(fim(15), AGORA), 'venceu ontem');
  assert.strictEqual(N.textoRestante(em(2026, 11, 16, 9), AGORA, true), 'venceu há 3 h');
  assert.strictEqual(N.textoRestante(em(2026, 11, 16, 11, 30), AGORA, true), 'venceu há menos de 1 hora');
  assert.strictEqual(N.textoRestante(fim(16), AGORA), 'vence hoje');
  assert.strictEqual(N.textoRestante(em(2026, 11, 16, 18, 30), AGORA, true), 'vence hoje às 18:30');
  assert.strictEqual(N.textoRestante(fim(17), AGORA), 'vence amanhã');
  assert.strictEqual(N.textoRestante(em(2026, 11, 17, 8), AGORA, true), 'vence amanhã às 08:00');
  assert.strictEqual(N.textoRestante(fim(20), AGORA), 'vence em 4 dias');
});

teste('catálogo: cria, valida, altera e exclui produto', () => {
  const D = N.vazio();
  assert.ok(N.salvarProduto(D, { nome: '  ', validades: { resfriado: { n: 3, un: 'd' } } }).erro);
  assert.ok(N.salvarProduto(D, { nome: 'Molho', validades: {} }).erro);
  assert.ok(N.salvarProduto(D, { nome: 'Molho', validades: { resfriado: { n: 0, un: 'd' } } }).erro);
  const r = N.salvarProduto(D, { nome: ' Molho  pesto ', grupo: '', validades: { resfriado: { n: '3', un: 'd' }, congelado: { n: 30, un: 'x' }, ambiente: { n: '', un: 'd' } } });
  assert.deepStrictEqual(r.produto, { id: 'p1', nome: 'Molho pesto', grupo: 'Outros', validades: { resfriado: { n: 3, un: 'd' }, congelado: { n: 30, un: 'd' } } });
  assert.ok(N.salvarProduto(D, { nome: 'molho PESTO', validades: { resfriado: { n: 1, un: 'd' } } }).erro, 'nome repetido');
  const alt = N.salvarProduto(D, { id: 'p1', nome: 'Molho pesto', grupo: 'Molhos', validades: { resfriado: { n: 12, un: 'h' } } });
  assert.strictEqual(alt.produto.id, 'p1');
  assert.strictEqual(D.produtos.length, 1);
  assert.deepStrictEqual(N.modosDoProduto(D.produtos[0]).map((m) => m.id), ['resfriado']);
  assert.strictEqual(N.fmtValidade(D.produtos[0].validades.resfriado), '12 horas');
  assert.strictEqual(N.excluirProduto(D, 'p1'), true);
  assert.strictEqual(N.excluirProduto(D, 'p1'), false);
});

function casa() {
  const D = N.vazio();
  N.salvarProduto(D, { nome: 'Molho de tomate', grupo: 'Molhos', validades: { resfriado: { n: 3, un: 'd' }, congelado: { n: 30, un: 'd' } } });
  N.salvarProduto(D, { nome: 'Salmão em cubos', grupo: 'Pescados', validades: { resfriado: { n: 24, un: 'h' } } });
  return D;
}

teste('emitir: uma etiqueta por cópia, cada uma com o seu número', () => {
  const D = casa();
  const r = N.emitir(D, { produtoId: 'p1', modo: 'resfriado', local: 'Câmara fria', responsavel: 'Ana', qtd: '2 kg', copias: 3 }, AGORA);
  assert.strictEqual(r.etiquetas.length, 3);
  assert.deepStrictEqual(r.etiquetas.map((e) => e.cod), [1, 2, 3]);
  assert.deepStrictEqual(D.etiquetas.map((e) => e.id), ['e1', 'e2', 'e3']);
  const e = r.etiquetas[0];
  assert.strictEqual(e.nome, 'Molho de tomate');
  assert.strictEqual(e.feitoEm, AGORA);
  assert.strictEqual(quando(e.venceEm), '19/11/26 23:59');
  assert.strictEqual(e.status, 'ativa');
  assert.strictEqual(N.fmtCodigo(e.cod), '000001');
});

teste('emitir: recusa pedido que não fecha', () => {
  const D = casa();
  assert.ok(N.emitir(D, { produtoId: 'nao-existe', modo: 'resfriado' }, AGORA).erro);
  assert.ok(N.emitir(D, { produtoId: 'p2', modo: 'congelado' }, AGORA).erro, 'modo sem validade');
  assert.ok(N.emitir(D, { produtoId: 'p1', modo: 'resfriado', copias: 51 }, AGORA).erro);
  assert.ok(N.emitir(D, { produtoId: 'p1', modo: 'resfriado', feitoEm: AGORA + N.DIA }, AGORA).erro, 'preparo no futuro');
  assert.ok(N.emitir(D, { produtoId: 'p1', modo: 'resfriado', validadeOrigem: '2026-11-10' }, AGORA).erro, 'fabricante vencido');
  assert.strictEqual(D.etiquetas.length, 0);
  assert.strictEqual(D.seq, 0);
});

teste('emitir: preparo retroativo e regra do 1º dia vêm dos ajustes', () => {
  const D = casa();
  D.config.contarDiaPreparo = true;
  const r = N.emitir(D, { produtoId: 'p1', modo: 'resfriado', feitoEm: em(2026, 11, 14, 9) }, AGORA);
  assert.strictEqual(quando(r.etiquetas[0].venceEm), '16/11/26 23:59');
  const previa = N.montar(D, { produtoId: 'p2', modo: 'resfriado', copias: 2 }, AGORA);
  assert.strictEqual(previa.copias, 2);
  assert.strictEqual(quando(previa.base.venceEm), '17/11/26 12:00');
  assert.strictEqual(D.etiquetas.length, 1, 'a prévia não registra nada');
});

teste('painel: conta por situação e ordena pelo vencimento', () => {
  const D = casa();
  const mk = (feitoEm, prod) => N.emitir(D, { produtoId: prod || 'p1', modo: 'resfriado', feitoEm }, AGORA);
  mk(em(2026, 11, 16, 8));          // vence 19 → no prazo
  mk(em(2026, 11, 12, 8));          // vence 15 → vencido
  mk(em(2026, 11, 13, 8));          // vence 16 → hoje
  mk(em(2026, 11, 15, 8));          // vence 18 → em breve
  mk(em(2026, 11, 15, 11), 'p2');   // 24 h → venceu às 11h de hoje
  const P = N.painel(D, AGORA);
  assert.deepStrictEqual(P.contagem, { vencido: 2, hoje: 1, breve: 1, ok: 1 });
  assert.deepStrictEqual(P.itens.map((x) => x.sit), ['vencido', 'vencido', 'hoje', 'breve', 'ok']);
  assert.strictEqual(P.itens[1].resta, 'venceu há 1 h');
});

teste('baixa: usar, descartar e desfazer', () => {
  const D = casa();
  N.emitir(D, { produtoId: 'p1', modo: 'resfriado', copias: 2 }, AGORA);
  const u = N.darBaixa(D, 'e1', { tipo: 'usada', por: 'Ana' }, AGORA + N.HORA);
  assert.strictEqual(u.status, 'usada');
  assert.strictEqual(u.motivo, '');
  const d = N.darBaixa(D, 'e2', { tipo: 'descartada', motivo: 'Vencido', por: 'Bruno' }, AGORA + N.HORA);
  assert.strictEqual(d.status, 'descartada');
  assert.strictEqual(d.motivo, 'Vencido');
  assert.strictEqual(N.darBaixa(D, 'e2', { tipo: 'usada' }, AGORA), null, 'já baixada');
  assert.strictEqual(N.painel(D, AGORA + N.HORA).itens.length, 0);
  assert.strictEqual(N.desfazerBaixa(D, 'e2').status, 'ativa');
  assert.strictEqual(D.etiquetas[1].baixaEm, undefined);
  assert.strictEqual(N.painel(D, AGORA + N.HORA).itens.length, 1);
});

teste('relatório de perdas no período', () => {
  const D = casa();
  for (let i = 0; i < 6; i++) N.emitir(D, { produtoId: 'p1', modo: 'resfriado', feitoEm: em(2026, 11, 14, 9) }, AGORA);
  N.emitir(D, { produtoId: 'p2', modo: 'resfriado', feitoEm: em(2026, 11, 1, 9) }, AGORA);   // fora dos 7 dias
  N.darBaixa(D, 'e1', { tipo: 'usada' }, em(2026, 11, 15, 10));
  N.darBaixa(D, 'e2', { tipo: 'usada' }, em(2026, 11, 15, 11));
  N.darBaixa(D, 'e3', { tipo: 'usada' }, em(2026, 11, 16, 9));
  N.darBaixa(D, 'e4', { tipo: 'descartada', motivo: 'Vencido' }, em(2026, 11, 16, 10));
  N.darBaixa(D, 'e7', { tipo: 'descartada', motivo: 'Aparência ou cheiro' }, em(2026, 11, 2, 10));
  const R = N.relatorio(D, AGORA, 7);
  assert.strictEqual(R.emitidas, 6);
  assert.strictEqual(R.usadas, 3);
  assert.strictEqual(R.descartadas, 1);
  assert.strictEqual(R.aproveitamento, 75);
  assert.deepStrictEqual(R.porMotivo, [{ nome: 'Vencido', n: 1 }]);
  assert.deepStrictEqual(R.porProduto, [{ nome: 'Molho de tomate', n: 1, total: 4 }]);
  assert.deepStrictEqual(R.baixas.map((e) => e.id), ['e4', 'e3', 'e2', 'e1']);
  const R30 = N.relatorio(D, AGORA, 30);
  assert.strictEqual(R30.emitidas, 7);
  assert.strictEqual(R30.descartadas, 2);
  assert.strictEqual(N.relatorio(N.vazio(), AGORA, 7).aproveitamento, null);
});

teste('planilha: uma linha por etiqueta, com campos protegidos', () => {
  const D = casa();
  N.emitir(D, { produtoId: 'p1', modo: 'resfriado', local: 'Geladeira; porta "A"', qtd: '2 kg', responsavel: 'Ana' }, AGORA);
  N.emitir(D, { produtoId: 'p1', modo: 'resfriado', feitoEm: em(2026, 11, 14, 9) }, AGORA);
  N.darBaixa(D, 'e2', { tipo: 'descartada', motivo: 'Sobra de produção', por: 'Bruno' }, em(2026, 11, 15, 10));
  const l = N.csv(D, AGORA).split('\r\n');
  assert.strictEqual(l.length, 4);
  assert.ok(l[0].startsWith('Número;Produto;Grupo;Conservação'));
  assert.strictEqual(l[1], '000001;Molho de tomate;Molhos;Resfriado;"Geladeira; porta ""A""";2 kg;Ana;16/11/26 12:00;19/11/26 23:59;;;Ativa, no prazo;;;');
  assert.strictEqual(l[2], '000002;Molho de tomate;Molhos;Resfriado;;;;14/11/26 09:00;17/11/26 23:59;;;Descartada;15/11/26 10:00;Sobra de produção;Bruno');
});

teste('guardar e reabrir devolve os mesmos dados', () => {
  const D = casa();
  D.config.casa = 'Bistrô';
  N.emitir(D, { produtoId: 'p1', modo: 'congelado', copias: 2, validadeOrigem: '2027-01-10', loteOrigem: 'L9' }, AGORA);
  N.darBaixa(D, 'e1', { tipo: 'descartada', motivo: 'Outro', por: 'Ana' }, AGORA);
  const de = N.carregar(JSON.stringify(D));
  assert.deepStrictEqual(de, D);
  assert.strictEqual(N.carregar('isto não é JSON'), null);
  assert.strictEqual(N.carregar('{"produtos":1}'), null);
  assert.strictEqual(N.carregar(null), null);
});

teste('reabrir descarta o que veio quebrado e acerta a numeração', () => {
  const de = N.carregar({
    seq: 1,
    config: { alertaDias: 99, tamanho: '1x1', locais: 'A\n\nA\nB', equipe: ['Ana', ' ana ', 'Bia'] },
    produtos: [{ id: 'p7', nome: 'Caldo', validades: { resfriado: { n: 3, un: 'd' }, congelado: { n: -1, un: 'd' } } }, { nome: 'sem id' }],
    etiquetas: [
      { cod: 9, nome: 'Caldo', modo: 'resfriado', feitoEm: AGORA, venceEm: AGORA + N.DIA, status: 'qualquer' },
      { cod: 10, nome: 'Caldo', modo: 'inexistente', feitoEm: AGORA, venceEm: AGORA + N.DIA },
    ],
  });
  assert.strictEqual(de.config.alertaDias, 2);
  assert.strictEqual(de.config.tamanho, '60x40');
  assert.deepStrictEqual(de.config.locais, ['A', 'B']);
  assert.deepStrictEqual(de.config.equipe, ['Ana', 'Bia']);
  assert.strictEqual(de.produtos.length, 1);
  assert.deepStrictEqual(de.produtos[0].validades, { resfriado: { n: 3, un: 'd' } });
  assert.strictEqual(de.etiquetas.length, 1);
  assert.strictEqual(de.etiquetas[0].status, 'ativa');
  assert.strictEqual(de.seq, 9);
  assert.strictEqual(de.seqProd, 7);
});

teste('dados de exemplo: catálogo, painel nas quatro situações e um mês de histórico', () => {
  const D = N.exemplo(AGORA);
  assert.strictEqual(D.exemplo, true);
  assert.strictEqual(D.produtos.length, 24);
  assert.ok(D.produtos.every((p) => N.modosDoProduto(p).length >= 1));
  assert.strictEqual(N.grupos(D).length, 8);
  const P = N.painel(D, AGORA);
  assert.strictEqual(P.itens.length, 15);
  assert.deepStrictEqual(P.contagem, { vencido: 2, hoje: 3, breve: 3, ok: 7 });
  // O queijo aberto fica preso à validade do fabricante (3 dias), e não aos 5 dias do catálogo.
  const queijo = P.itens.find((x) => x.e.nome === 'Queijo muçarela fatiado');
  assert.strictEqual(queijo.e.limitada, true);
  assert.strictEqual(queijo.resta, 'vence em 3 dias');
  // Números únicos, em ordem de preparo, e nenhuma baixa no futuro.
  const cods = D.etiquetas.map((e) => e.cod);
  assert.strictEqual(new Set(cods).size, cods.length);
  assert.strictEqual(D.seq, cods.length);
  assert.ok(D.etiquetas.every((e, i) => i === 0 || D.etiquetas[i - 1].feitoEm <= e.feitoEm));
  assert.ok(D.etiquetas.every((e) => e.feitoEm <= AGORA && (e.status === 'ativa' || (e.baixaEm <= AGORA && e.baixaEm >= e.feitoEm))));
  const R = N.relatorio(D, AGORA, 30);
  assert.ok(R.usadas > 50 && R.descartadas > 10, `${R.usadas} usadas, ${R.descartadas} descartadas`);
  assert.ok(R.aproveitamento > 60 && R.aproveitamento < 95);
  assert.strictEqual(R.porMotivo[0].nome, 'Vencido');
  assert.ok(R.porProduto.every((p) => p.n <= p.total));
  // Sempre o mesmo exemplo para a mesma hora, e ele sobrevive a guardar e reabrir.
  assert.deepStrictEqual(N.exemplo(AGORA), D);
  assert.deepStrictEqual(N.carregar(JSON.stringify(D)), D);
});

teste('dados de exemplo abrem em qualquer hora do dia', () => {
  [em(2026, 11, 16, 0, 10), em(2026, 11, 16, 6), em(2026, 11, 16, 23, 50), em(2027, 1, 1, 3)].forEach((agora) => {
    const D = N.exemplo(agora);
    const P = N.painel(D, agora);
    assert.strictEqual(P.itens.length, 15);
    assert.ok(P.contagem.vencido >= 1 && P.contagem.ok >= 5);
    assert.ok(D.etiquetas.every((e) => e.feitoEm <= agora && e.venceEm > e.feitoEm));
  });
});

console.log(`\n${n} testes passaram.`);
