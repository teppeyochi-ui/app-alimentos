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
  assert.deepStrictEqual(r.produto, { id: 'p1', codigo: '', tipo: 'pp', nome: 'Molho pesto', grupo: 'Outros', validades: { resfriado: { n: 3, un: 'd' }, congelado: { n: 30, un: 'd' } } });
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
  assert.ok(l[0].startsWith('Número;Código;Produto;Tipo;Grupo;Conservação'));
  assert.strictEqual(l[1], '000001;;Molho de tomate;Em processo;Molhos;Resfriado;"Geladeira; porta ""A""";2 kg;Ana;16/11/26 12:00;19/11/26 23:59;;;;;;;Ativa, no prazo;;;');
  assert.strictEqual(l[2], '000002;;Molho de tomate;Em processo;Molhos;Resfriado;;;;14/11/26 09:00;17/11/26 23:59;;;;;;;Descartada;15/11/26 10:00;Sobra de produção;Bruno');
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
  assert.strictEqual(D.produtos.length, 27);
  // Os três tipos, cada produto com o seu código (sem repetir).
  assert.deepStrictEqual(N.TIPOS.map((t) => D.produtos.filter((p) => p.tipo === t.id).length), [7, 17, 3]);
  assert.strictEqual(new Set(D.produtos.map((p) => p.codigo)).size, 27);
  assert.strictEqual(D.produtos.find((p) => p.nome === 'Camarão limpo').codigo, 'MP001');
  assert.ok(D.produtos.every((p) => N.modosDoProduto(p).length >= 1));
  assert.strictEqual(N.grupos(D).length, 9);
  const P = N.painel(D, AGORA);
  assert.strictEqual(P.itens.length, 17);
  assert.deepStrictEqual(P.contagem, { vencido: 2, hoje: 3, breve: 3, ok: 9 });
  // Os acabados apontam para a etiqueta de que foram feitos.
  const potes = D.etiquetas.find((e) => e.nome === 'Molho de tomate pote 300 g');
  assert.strictEqual(potes.tipo, 'pa');
  assert.deepStrictEqual(potes.origens.map((c) => D.etiquetas.find((e) => e.cod === c).nome), ['Molho de tomate']);
  // Três entregas encerradas, cada uma com a sua matéria-prima, e uma contagem do freezer.
  assert.deepStrictEqual(D.recebimentos.map((r) => [r.n, r.fornecedor, N.resumoRecebimento(D, r).itens.map((i) => i.nome).join()]),
    [[1, 'Frigorífico Exemplo', 'Carne moída'], [2, 'Distribuidora Exemplo', 'Farinha de trigo (aberta)'], [3, 'Laticínios Exemplo', 'Queijo muçarela fatiado']]);
  assert.ok(D.recebimentos.every((r) => r.fechadoEm >= r.abertoEm) && !N.recebimentoAberto(D) && !N.contagemAberta(D));
  assert.deepStrictEqual([D.contagens.length, D.contagens[0].local, D.contagens[0].esperadas, D.contagens[0].conferidas], [1, 'Freezer', 5, 5]);
  assert.strictEqual(N.saldo(D, AGORA).reduce((t, x) => t + x.n, 0), 17);
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
    assert.strictEqual(P.itens.length, 17);
    assert.ok(P.contagem.vencido >= 1 && P.contagem.ok >= 5);
    assert.ok(D.etiquetas.every((e) => e.feitoEm <= agora && e.venceEm > e.feitoEm));
  });
});

// ---------- código próprio, tipos e leitor ----------

teste('tamanho da etiqueta: os comuns e o informado à mão', () => {
  assert.strictEqual(N.limparTamanho('60x40'), '60x40');
  assert.strictEqual(N.limparTamanho(' 104 X 150 '), '104x150');
  assert.strictEqual(N.limparTamanho('20x40'), null, 'estreita demais');
  assert.strictEqual(N.limparTamanho('120x40'), null, 'mais larga do que a impressora');
  assert.strictEqual(N.limparTamanho('60x10'), null);
  assert.strictEqual(N.limparTamanho('grande'), null);
  assert.deepStrictEqual(N.medidas('80x60'), { l: 80, a: 60 });
  assert.deepStrictEqual(N.medidas('qualquer'), { l: 60, a: 40 });
  assert.strictEqual(N.limparConfig({ tamanho: '75x25' }).tamanho, '75x25');
  assert.strictEqual(N.limparConfig({ tamanho: '1x1' }).tamanho, '60x40');
});

teste('código de barras: Code 128 igual ao de uma biblioteca de referência', () => {
  // Sequências geradas pelo JsBarcode (CODE128B) para os mesmos textos.
  assert.strictEqual(N.code128('ZZ000112'), '110100100001110110001011101100010100111011001001110110010011101100100111001101001110011011001110010110001001001100011101011');
  assert.strictEqual(N.code128('MP001'), '110100100001011101100011101110110100111011001001110110010011100110110110110001100011101011');
  assert.strictEqual(N.code128('ZZOK'), '1101001000011101100010111011000101000111011010110001110110010100001100011101011');
  assert.strictEqual(N.code128('Ab-12/x'), '1101001000010100011000100100001101001101110010011100110110011100101011100110011110010010110100010001100011101011');
  assert.strictEqual(N.verificador128('PJJ123C'), 55);
  // Início B, fim, e 11 módulos por símbolo (o fim tem 13).
  const b = N.code128('PA-0042/X');
  assert.ok(b.startsWith('11010010000') && b.endsWith('1100011101011'));
  assert.strictEqual(b.length, 11 * (9 + 2) + 13);
  assert.strictEqual(N.code128('AÇAÍ'), null, 'acento não entra em código de barras');
  assert.strictEqual(N.code128(''), null);
});

teste('produto: código da casa e tipo', () => {
  const D = N.vazio();
  const r = N.salvarProduto(D, { codigo: ' mp-0042/a ', tipo: 'mp', nome: 'Camarão cru', validades: { resfriado: { n: 2, un: 'd' } } });
  assert.strictEqual(r.produto.codigo, 'MP-0042/A');
  assert.strictEqual(r.produto.tipo, 'mp');
  assert.ok(/já é de Camarão cru/.test(N.salvarProduto(D, { codigo: 'MP-0042/A', nome: 'Outro', validades: { resfriado: { n: 2, un: 'd' } } }).erro));
  assert.ok(/começam com ZZ/.test(N.salvarProduto(D, { codigo: 'zz10', nome: 'Outro', validades: { resfriado: { n: 2, un: 'd' } } }).erro));
  assert.ok(/letras sem acento/.test(N.salvarProduto(D, { codigo: 'AÇÚCAR', nome: 'Outro', validades: { resfriado: { n: 2, un: 'd' } } }).erro));
  assert.ok(/letras sem acento/.test(N.salvarProduto(D, { codigo: 'A'.repeat(21), nome: 'Outro', validades: { resfriado: { n: 2, un: 'd' } } }).erro));
  const sem = N.salvarProduto(D, { nome: 'Sem código', tipo: 'xx', validades: { resfriado: { n: 2, un: 'd' } } });
  assert.strictEqual(sem.produto.codigo, '');
  assert.strictEqual(sem.produto.tipo, 'pp', 'tipo desconhecido vira "em processo"');
  // Alterar o próprio produto mantendo o código não é repetição.
  assert.ok(N.salvarProduto(D, { id: 'p1', codigo: 'MP-0042/A', tipo: 'mp', nome: 'Camarão cru limpo', validades: { resfriado: { n: 2, un: 'd' } } }).produto);
  const e = N.emitir(D, { produtoId: 'p1', modo: 'resfriado' }, AGORA).etiquetas[0];
  assert.strictEqual(e.codigo, 'MP-0042/A');
  assert.strictEqual(e.tipo, 'mp');
  assert.deepStrictEqual(e.origens, []);
});

function fabrica() {
  const D = N.vazio();
  D.config.equipe = ['José', 'Ana Lúcia'];
  D.config.locais = ['Câmara fria', 'Freezer'];
  const v = { resfriado: { n: 2, un: 'd' }, congelado: { n: 90, un: 'd' } };
  N.salvarProduto(D, { codigo: 'MP001', tipo: 'mp', nome: 'Camarão cru', validades: v });
  N.salvarProduto(D, { codigo: 'PP001', tipo: 'pp', nome: 'Recheio de camarão', validades: { resfriado: { n: 3, un: 'd' } } });
  N.salvarProduto(D, { codigo: '7891000', tipo: 'pa', nome: 'Empada de camarão', validades: { congelado: { n: 60, un: 'd' } } });
  return D;
}

teste('leitor: reconhece produto, etiqueta, comando e código desconhecido', () => {
  const D = fabrica();
  N.emitir(D, { produtoId: 'p1', modo: 'resfriado', copias: 2 }, AGORA);
  assert.strictEqual(N.interpretar(D, 'MP001').produto.nome, 'Camarão cru');
  assert.strictEqual(N.interpretar(D, ' mp001\r').produto.nome, 'Camarão cru', 'minúsculas e o Enter do leitor não atrapalham');
  assert.strictEqual(N.interpretar(D, '7891000').produto.nome, 'Empada de camarão');
  assert.strictEqual(N.interpretar(D, 'ZZ000002').etiqueta.id, 'e2');
  assert.strictEqual(N.interpretar(D, 'zz000002').etiqueta.id, 'e2');
  assert.ok(/não está neste aparelho/.test(N.interpretar(D, 'ZZ000099').msg));
  assert.deepStrictEqual(N.interpretar(D, 'ZZOK'), { tipo: 'comando', comando: 'ok' });
  assert.deepStrictEqual(N.interpretar(D, 'ZZNAO'), { tipo: 'comando', comando: 'cancelar' });
  assert.deepStrictEqual(N.interpretar(D, 'ZZQ12'), { tipo: 'comando', comando: 'qtd', valor: 12 });
  assert.deepStrictEqual(N.interpretar(D, 'ZZC3'), { tipo: 'comando', comando: 'modo', valor: 'descongelado' });
  assert.deepStrictEqual(N.interpretar(D, 'ZZM1'), { tipo: 'comando', comando: 'motivo', valor: 'Vencido' });
  assert.strictEqual(N.CODIGO.pessoa('José'), 'ZZPJOSE');
  assert.strictEqual(N.CODIGO.local('Câmara fria'), 'ZZLCAMARAFRIA');
  assert.deepStrictEqual(N.interpretar(D, 'ZZPANALUCIA'), { tipo: 'comando', comando: 'pessoa', valor: 'Ana Lúcia' });
  assert.deepStrictEqual(N.interpretar(D, 'ZZLFREEZER'), { tipo: 'comando', comando: 'local', valor: 'Freezer' });
  assert.ok(/não está mais na equipe/.test(N.interpretar(D, 'ZZPMARIA').msg));
  assert.strictEqual(N.interpretar(D, 'ZZC9').tipo, 'erro');
  assert.deepStrictEqual(N.interpretar(D, 'abc123'), { tipo: 'desconhecido', codigo: 'ABC123' });
  assert.deepStrictEqual(N.interpretar(D, '   '), { tipo: 'vazio' });
  assert.strictEqual(N.interpretar(D, 'ZZ000000').tipo, 'teste');
});

// Passa uma sequência de leituras e devolve o último resultado.
function ler(D, S, codigos, agora) {
  let r = { S };
  codigos.forEach((c) => { r = N.bipar(D, r.S, c, agora || AGORA); });
  return r;
}

teste('leitor: entrada de matéria-prima só bipando', () => {
  const D = fabrica();
  let r = ler(D, N.sessao(), ['ZZPJOSE', 'MP001']);
  assert.strictEqual(r.S.modo, 'nova');
  assert.strictEqual(r.S.copias, 1);
  assert.strictEqual(r.S.conserv, 'resfriado');
  r = ler(D, r.S, ['MP001', 'MP001']);
  assert.strictEqual(r.msg, '3 etiquetas de Camarão cru', 'cada leitura do mesmo código soma uma');
  r = ler(D, r.S, ['ZZQ5', 'ZZC2', 'ZZLFREEZER']);
  assert.deepStrictEqual([r.S.copias, r.S.conserv, r.S.local], [5, 'congelado', 'Freezer']);
  assert.strictEqual(D.etiquetas.length, 0, 'nada é registrado antes de confirmar');
  r = ler(D, r.S, ['ZZOK']);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.msg, '5 etiquetas de Camarão cru: registradas.');
  assert.strictEqual(r.imprimir.length, 5);
  assert.deepStrictEqual([r.S.modo, r.S.operador], ['livre', 'José'], 'volta a esperar, com a mesma pessoa');
  const e = D.etiquetas[0];
  assert.deepStrictEqual([e.tipo, e.codigo, e.modo, e.local, e.responsavel], ['mp', 'MP001', 'congelado', 'Freezer', 'José']);
  assert.strictEqual(quando(e.venceEm), '14/02/27 23:59');
});

teste('leitor: recusa o que não faz sentido, sem perder o que estava em andamento', () => {
  const D = fabrica();
  assert.ok(/Leia primeiro/.test(ler(D, N.sessao(), ['ZZOK']).msg));
  assert.ok(/Leia primeiro/.test(ler(D, N.sessao(), ['ZZQ3']).msg));
  let r = ler(D, N.sessao(), ['MP001', 'MP001']);
  const antes = r.S;
  r = ler(D, antes, ['PP001']);
  assert.strictEqual(r.ok, false);
  assert.ok(/imprima ou cancele as etiquetas de Camarão cru/.test(r.msg));
  assert.deepStrictEqual([r.S.produtoId, r.S.copias], [antes.produtoId, 2]);
  assert.ok(/não tem validade cadastrada em descongelado/.test(ler(D, antes, ['ZZC3']).msg));
  assert.ok(/imprima ou cancele/.test(ler(D, antes, ['ZZUSO']).msg));
  assert.strictEqual(ler(D, antes, ['ZZQ0']).ok, false);
  r = ler(D, antes, ['NAOEXISTE']);
  assert.strictEqual(r.S.desconhecido, 'NAOEXISTE');
  assert.strictEqual(r.S.modo, 'nova');
  r = ler(D, r.S, ['ZZNAO']);
  assert.deepStrictEqual([r.S.modo, r.msg], ['livre', 'Cancelado.']);
  assert.strictEqual(D.etiquetas.length, 0);
  // Passando do máximo por leituras repetidas.
  r = ler(D, N.sessao(), ['MP001', 'ZZQ50', 'MP001']);
  assert.ok(/máximo é de 50/.test(r.msg));
  assert.strictEqual(r.S.copias, 50);
});

teste('leitor: produto em processo guarda de que etiqueta foi feito', () => {
  const D = fabrica();
  ler(D, N.sessao('José'), ['MP001', 'ZZOK']);              // e1: camarão cru
  ler(D, N.sessao('José'), ['MP001', 'ZZOK']);              // e2: outro camarão
  let r = ler(D, N.sessao('Ana Lúcia'), ['PP001', 'ZZ000001', 'ZZ000002']);
  assert.strictEqual(r.msg, 'Feito com Camarão cru (Nº 000002)');
  assert.ok(/já está na lista/.test(ler(D, r.S, ['ZZ000001']).msg));
  r = ler(D, r.S, ['ZZOK']);
  assert.deepStrictEqual(r.imprimir[0].origens, [1, 2]);
  assert.strictEqual(r.imprimir[0].responsavel, 'Ana Lúcia');
  // Matéria-prima não tem origem: ler uma etiqueta no meio da entrada é engano.
  r = ler(D, N.sessao(), ['MP001', 'ZZ000001']);
  assert.ok(/imprima ou cancele/.test(r.msg));
  // Etiqueta usada pode ser origem (acabou de ser consumida); descartada, não.
  ler(D, N.sessao(), ['ZZ000001', 'ZZUSO']);
  ler(D, N.sessao(), ['ZZ000002', 'ZZM3']);
  assert.strictEqual(ler(D, N.sessao(), ['PP001', 'ZZ000001']).ok, true);
  assert.ok(/foi descartada/.test(ler(D, N.sessao(), ['PP001', 'ZZ000002']).msg));
});

teste('leitor: baixa de etiqueta lida, como usada ou descartada', () => {
  const D = fabrica();
  ler(D, N.sessao(), ['MP001', 'ZZQ3', 'ZZOK']);
  let r = ler(D, N.sessao('José'), ['ZZ000001']);
  assert.deepStrictEqual([r.S.modo, r.S.etiquetaId], ['etiqueta', 'e1']);
  assert.strictEqual(r.msg, 'Camarão cru: vence em 2 dias');
  assert.ok(/leia USADO ou DESCARTAR/.test(ler(D, r.S, ['ZZOK']).msg));
  r = ler(D, r.S, ['ZZUSO'], AGORA + N.HORA);
  assert.deepStrictEqual([r.msg, r.baixa, r.S.modo], ['Camarão cru: baixa como usado.', 'e1', 'livre']);
  assert.deepStrictEqual([D.etiquetas[0].status, D.etiquetas[0].baixaPor, D.etiquetas[0].baixaEm], ['usada', 'José', AGORA + N.HORA]);
  // Descartar pede o motivo; ler o motivo direto também descarta.
  r = ler(D, N.sessao(), ['ZZ000002', 'ZZFORA']);
  assert.deepStrictEqual([r.S.pedindoMotivo, r.msg], [true, 'Qual o motivo do descarte?']);
  assert.strictEqual(D.etiquetas[1].status, 'ativa');
  r = ler(D, r.S, ['ZZM1']);
  assert.strictEqual(r.msg, 'Camarão cru: descartado (vencido).');
  assert.deepStrictEqual([D.etiquetas[1].status, D.etiquetas[1].motivo], ['descartada', 'Vencido']);
  r = ler(D, N.sessao(), ['ZZ000003', 'ZZM4']);
  assert.strictEqual(D.etiquetas[2].motivo, 'Aparência ou cheiro');
  // Etiqueta que já teve baixa: mostra, mas não baixa de novo.
  r = ler(D, N.sessao(), ['ZZ000001']);
  assert.strictEqual(r.msg, 'Camarão cru: já teve baixa');
  assert.ok(/já teve baixa/.test(ler(D, r.S, ['ZZUSO']).msg));
  // Ler um produto com uma etiqueta aberta começa etiqueta nova.
  N.desfazerBaixa(D, 'e1');
  r = ler(D, N.sessao(), ['ZZ000001', 'MP001']);
  assert.strictEqual(r.S.modo, 'nova');
  assert.ok(/Etiqueta de teste lida/.test(ler(D, N.sessao(), ['ZZ000000']).msg));
});

teste('cartela: todo código impresso vira barras e é entendido de volta', () => {
  const D = fabrica();
  N.salvarProduto(D, { nome: 'Sem código', validades: { resfriado: { n: 1, un: 'd' } } });
  const secoes = N.cartela(D);
  assert.deepStrictEqual(secoes.map((s) => s.titulo), ['Comandos', 'Número de etiquetas', 'Conservação', 'Motivo do descarte',
    'Quem está trabalhando', 'Local', 'Matéria-prima', 'Em processo', 'Produto acabado']);
  assert.deepStrictEqual(secoes[0].itens.map((i) => i.codigo), ['ZZOK', 'ZZNAO', 'ZZUSO', 'ZZFORA']);
  assert.deepStrictEqual(secoes[4].itens, [{ nome: 'José', codigo: 'ZZPJOSE' }, { nome: 'Ana Lúcia', codigo: 'ZZPANALUCIA' }]);
  assert.deepStrictEqual(secoes[7].itens, [{ nome: 'Recheio de camarão', codigo: 'PP001' }], 'produto sem código fica fora');
  const todos = [].concat.apply([], secoes.map((s) => s.itens));
  assert.strictEqual(new Set(todos.map((i) => i.codigo)).size, todos.length, 'nenhum código repetido');
  todos.forEach((i) => {
    assert.ok(/^[A-Z0-9]+$/.test(i.codigo), i.codigo + ': só letras maiúsculas e números');
    assert.ok(N.code128(i.codigo), i.codigo);
    assert.ok(['produto', 'comando'].indexOf(N.interpretar(D, i.codigo).tipo) >= 0, i.codigo);
  });
  // Sem equipe e sem produto com código, essas seções somem.
  assert.deepStrictEqual(N.cartela(N.vazio()).map((s) => s.titulo), ['Comandos', 'Número de etiquetas', 'Conservação', 'Motivo do descarte', 'Local']);
});

teste('dados da primeira versão continuam abrindo', () => {
  const de = N.carregar({
    versao: 1, seq: 2,
    config: { casa: 'Antiga', tamanho: '50x30' },
    produtos: [{ id: 'p1', nome: 'Caldo', grupo: 'Bases', validades: { resfriado: { n: 3, un: 'd' } } },
      { id: 'p2', codigo: 'zz1', nome: 'Reservado', validades: { resfriado: { n: 3, un: 'd' } } },
      { id: 'p3', codigo: 'a1', nome: 'Primeiro', validades: { resfriado: { n: 3, un: 'd' } } },
      { id: 'p4', codigo: 'A1', nome: 'Repetido', validades: { resfriado: { n: 3, un: 'd' } } }],
    etiquetas: [{ cod: 1, produtoId: 'p1', nome: 'Caldo', modo: 'resfriado', feitoEm: AGORA, venceEm: AGORA + N.DIA, status: 'ativa', origens: [5, 5, 'x', -1] }],
  });
  assert.strictEqual(de.versao, N.VERSAO);
  assert.deepStrictEqual(de.produtos.map((p) => [p.codigo, p.tipo]), [['', 'pp'], ['', 'pp'], ['A1', 'pp'], ['', 'pp']]);
  assert.deepStrictEqual([de.etiquetas[0].tipo, de.etiquetas[0].codigo, de.etiquetas[0].origens], ['pp', '', [5]]);
  assert.deepStrictEqual([de.config.letra, de.config.som, de.config.tamanho], ['normal', true, '50x30']);
});

// ---------- recebimento, contagem de estoque e saldo ----------

teste('temperatura de chegada: entende o que a pessoa digita', () => {
  assert.deepStrictEqual(N.lerTemperatura('3,5'), { ok: true, valor: 3.5 });
  assert.deepStrictEqual(N.lerTemperatura('-18'), { ok: true, valor: -18 });
  assert.deepStrictEqual(N.lerTemperatura(' 4.25 °C '), { ok: true, valor: 4.3 });
  assert.deepStrictEqual(N.lerTemperatura('−2'), { ok: true, valor: -2 }, 'sinal de menos tipográfico');
  assert.deepStrictEqual(N.lerTemperatura(''), { ok: true, valor: null });
  assert.deepStrictEqual(N.lerTemperatura(-15), { ok: true, valor: -15 });
  ['frio', '99', '-41', '1e3', '3,5,2', '3 graus'].forEach((v) => assert.strictEqual(N.lerTemperatura(v).ok, false, v));
  assert.strictEqual(N.fmtTemperatura(3.5), '3,5 °C');
  assert.strictEqual(N.fmtTemperatura(-18), '-18 °C');
  assert.strictEqual(N.fmtTemperatura(null), '');
});

teste('recebimento: abre, liga a matéria-prima etiquetada e encerra', () => {
  const D = fabrica();
  assert.ok(/Informe o fornecedor/.test(N.abrirRecebimento(D, { fornecedor: ' ' }, AGORA).erro));
  const r = N.abrirRecebimento(D, { fornecedor: ' Pescados  Sul ', nota: '123', responsavel: 'José' }, AGORA).recebimento;
  assert.deepStrictEqual([r.id, r.n, r.fornecedor, r.nota, r.responsavel, r.fechadoEm], ['r1', 1, 'Pescados Sul', '123', 'José', 0]);
  assert.strictEqual(N.recebimentoAberto(D), r);
  assert.ok(/Nº 1 \(Pescados Sul\) ainda está aberto/.test(N.abrirRecebimento(D, { fornecedor: 'Outro' }, AGORA).erro));
  // Matéria-prima entra no recebimento, com a temperatura; produto em processo, não.
  const mp = N.emitir(D, { produtoId: 'p1', modo: 'resfriado', copias: 3, loteOrigem: 'L1', tempChegada: '3,5', qtd: '2 kg' }, AGORA).etiquetas;
  assert.deepStrictEqual([mp[0].recebimentoId, mp[0].tempChegada], ['r1', 3.5]);
  N.emitir(D, { produtoId: 'p1', modo: 'congelado', copias: 2, loteOrigem: 'L2', tempChegada: '-18' }, AGORA);
  const pp = N.emitir(D, { produtoId: 'p2', modo: 'resfriado', tempChegada: '3' }, AGORA).etiquetas[0];
  assert.deepStrictEqual([pp.recebimentoId, pp.tempChegada], ['', null]);
  assert.ok(/temperatura de chegada é um número entre -40 e 60/.test(N.emitir(D, { produtoId: 'p1', modo: 'resfriado', tempChegada: 'frio' }, AGORA).erro));
  // O resumo junta as etiquetas iguais: é o que se confere com a nota.
  const resumo = N.resumoRecebimento(D, r);
  assert.strictEqual(resumo.etiquetas, 5);
  assert.deepStrictEqual(resumo.itens, [
    { nome: 'Camarão cru', codigo: 'MP001', lote: 'L1', validadeOrigem: '', n: 3, qtds: ['2 kg'], temps: [3.5] },
    { nome: 'Camarão cru', codigo: 'MP001', lote: 'L2', validadeOrigem: '', n: 2, qtds: [], temps: [-18] },
  ]);
  const f = N.fecharRecebimento(D, { obs: ' uma caixa  amassada ' }, AGORA + N.HORA);
  assert.deepStrictEqual([f.recebimento.fechadoEm, f.recebimento.obs], [AGORA + N.HORA, 'uma caixa amassada']);
  assert.strictEqual(N.recebimentoAberto(D), null);
  assert.strictEqual(N.emitir(D, { produtoId: 'p1', modo: 'resfriado' }, AGORA).etiquetas[0].recebimentoId, '', 'depois de encerrado, não liga mais');
  // Aberto por engano e encerrado sem etiqueta: é desfeito.
  N.abrirRecebimento(D, { fornecedor: 'Engano' }, AGORA);
  assert.strictEqual(N.fecharRecebimento(D, {}, AGORA).vazio, true);
  assert.deepStrictEqual([D.recebimentos.length, D.seqRec], [1, 1]);
  assert.ok(N.fecharRecebimento(D, {}, AGORA).erro);
  N.abrirRecebimento(D, { fornecedor: 'Laticínios Norte' }, AGORA);
  N.emitir(D, { produtoId: 'p1', modo: 'resfriado' }, AGORA);
  N.fecharRecebimento(D, {}, AGORA);
  assert.deepStrictEqual(N.fornecedores(D), ['Laticínios Norte', 'Pescados Sul']);
  // Fornecedor, nota e temperatura vão para a planilha, e tudo sobrevive a guardar e reabrir.
  assert.ok(/;L1;;Pescados Sul;123;3,5;;Ativa, vence em breve/.test(N.csv(D, AGORA).split('\r\n')[1]));
  assert.deepStrictEqual(N.carregar(JSON.stringify(D)), D);
});

teste('leitor: a temperatura digitada e o recebimento aberto valem na leitura', () => {
  const D = fabrica();
  N.abrirRecebimento(D, { fornecedor: 'Pescados Sul' }, AGORA);
  let r = ler(D, N.sessao('José'), ['MP001']);
  assert.strictEqual(r.S.temp, '');
  r = N.bipar(D, Object.assign({}, r.S, { temp: '2,5' }), 'ZZOK', AGORA);
  assert.deepStrictEqual([r.imprimir[0].recebimentoId, r.imprimir[0].tempChegada], ['r1', 2.5]);
  // Temperatura que não é número: avisa e não perde o que estava na tela.
  r = ler(D, N.sessao(), ['MP001', 'MP001']);
  r = N.bipar(D, Object.assign({}, r.S, { temp: 'gelado' }), 'ZZOK', AGORA);
  assert.deepStrictEqual([r.ok, r.S.modo, r.S.copias], [false, 'nova', 2]);
  assert.ok(/temperatura de chegada/.test(r.msg));
});

teste('contagem de estoque: confere pelo leitor, acha o que falta e dá baixa', () => {
  const D = fabrica();
  N.emitir(D, { produtoId: 'p1', modo: 'congelado', local: 'Freezer', copias: 3 }, AGORA);      // e1 a e3: matéria-prima no freezer
  N.emitir(D, { produtoId: 'p2', modo: 'resfriado', local: 'Câmara fria', copias: 2 }, AGORA);  // e4 e e5: em processo na câmara
  N.emitir(D, { produtoId: 'p1', modo: 'congelado' }, AGORA);                                   // e6: matéria-prima sem local
  N.darBaixa(D, 'e3', { tipo: 'usada' }, AGORA);
  // Recebimento e contagem não andam juntos.
  N.abrirRecebimento(D, { fornecedor: 'X' }, AGORA);
  assert.ok(/Encerre-o antes de contar o estoque/.test(N.abrirContagem(D, {}, AGORA).erro));
  N.fecharRecebimento(D, {}, AGORA);
  const c = N.abrirContagem(D, { local: 'Freezer', responsavel: 'José' }, AGORA).contagem;
  assert.strictEqual(N.escopoTexto(c), 'Freezer');
  assert.ok(/Já existe uma contagem/.test(N.abrirContagem(D, {}, AGORA).erro));
  assert.ok(/contagem de estoque em andamento/.test(N.abrirRecebimento(D, { fornecedor: 'X' }, AGORA).erro));
  assert.ok(/contagem de estoque em andamento/.test(N.emitir(D, { produtoId: 'p1', modo: 'congelado' }, AGORA).erro), 'não se etiqueta no meio da contagem');
  let a = N.andamentoContagem(D, c);
  assert.deepStrictEqual([a.esperadas, a.conferidas, a.faltando.map((e) => e.cod)], [2, 0, [1, 2]]);
  let r = ler(D, N.sessao('José'), ['ZZ000001']);
  assert.deepStrictEqual([r.ok, r.msg, r.mudou], [true, 'Conferida: Camarão cru (1 de 2).', true]);
  r = ler(D, r.S, ['ZZ000001']);
  assert.deepStrictEqual([r.ok, r.msg], [false, 'Camarão cru (Nº 000001) já foi conferida.']);
  // Achada no freezer sem local, ou cadastrada em outro lugar: conta e passa a constar ali.
  r = ler(D, r.S, ['ZZ000006']);
  assert.strictEqual(r.msg, 'Conferida: Camarão cru (2 de 3). Local atualizado para Freezer.');
  assert.strictEqual(D.etiquetas[5].local, 'Freezer');
  r = ler(D, r.S, ['ZZ000004']);
  assert.strictEqual(r.msg, 'Conferida: Recheio de camarão (3 de 4). Local atualizado para Freezer.');
  // Achada uma que já tinha baixa: não conta sozinha, oferece desfazer.
  r = ler(D, r.S, ['ZZ000003']);
  assert.deepStrictEqual([r.ok, r.reativar], [false, 'e3']);
  assert.ok(/Camarão cru \(Nº 000003\) teve baixa como usada em 16\/11/.test(r.msg));
  // No meio da contagem o leitor só confere.
  ['MP001', 'ZZOK', 'ZZUSO', 'ZZQ3', 'NADA'].forEach((cod) => {
    r = ler(D, r.S, [cod]);
    assert.ok(!r.ok && /Contagem em andamento: leia as etiquetas/.test(r.msg), cod);
    assert.strictEqual(r.S.modo, 'livre');
  });
  r = ler(D, r.S, ['ZZPANALUCIA']);
  assert.strictEqual(r.S.operador, 'Ana Lúcia');
  a = N.andamentoContagem(D, c);
  assert.deepStrictEqual([a.esperadas, a.conferidas, a.faltando.map((e) => e.cod)], [4, 3, [2]]);
  const f = N.fecharContagem(D, { baixar: true }, AGORA + N.HORA);
  assert.deepStrictEqual([f.contagem.esperadas, f.contagem.conferidas, f.contagem.faltando, f.contagem.baixou, f.contagem.fechadaEm], [4, 3, [2], true, AGORA + N.HORA]);
  assert.deepStrictEqual([D.etiquetas[1].status, D.etiquetas[1].motivo, D.etiquetas[1].baixaPor], ['descartada', N.MOTIVO_CONTAGEM, 'José']);
  assert.strictEqual(N.contagemAberta(D), null);
  assert.ok(N.emitir(D, { produtoId: 'p1', modo: 'congelado' }, AGORA).etiquetas, 'encerrada a contagem, volta a etiquetar');
  // Contagem por tipo; encerrar sem dar baixa; cancelar.
  const c2 = N.abrirContagem(D, { tipo: 'pp' }, AGORA).contagem;
  assert.strictEqual(N.escopoTexto(c2), 'Todos os locais · Em processo');
  r = ler(D, N.sessao(), ['ZZ000001']);
  assert.strictEqual(r.msg, 'Esta contagem é só de produtos do tipo Em processo. Camarão cru é Matéria-prima.');
  r = ler(D, r.S, ['ZZ000005']);
  assert.strictEqual(r.msg, 'Conferida: Recheio de camarão (1 de 2).', 'sem local na contagem, ninguém muda de lugar');
  assert.strictEqual(D.etiquetas[4].local, 'Câmara fria');
  const f2 = N.fecharContagem(D, { baixar: false }, AGORA);
  assert.deepStrictEqual([f2.contagem.conferidas, f2.contagem.faltando, f2.contagem.baixou, D.etiquetas[3].status], [1, [4], false, 'ativa']);
  N.abrirContagem(D, {}, AGORA);
  assert.strictEqual(N.cancelarContagem(D), true);
  assert.strictEqual(N.cancelarContagem(D), false);
  assert.deepStrictEqual([D.contagens.length, D.seqCont], [2, 2]);
  assert.ok(N.fecharContagem(D, {}, AGORA).erro);
  // Tudo achado: nada para dar baixa, mesmo pedindo.
  N.abrirContagem(D, { local: 'Câmara fria' }, AGORA);
  ler(D, N.sessao(), ['ZZ000005']);
  assert.deepStrictEqual([N.fecharContagem(D, { baixar: true }, AGORA).contagem.baixou, D.etiquetas[4].status], [false, 'ativa']);
  assert.deepStrictEqual(N.carregar(JSON.stringify(D)), D);
});

teste('saldo: etiquetas ativas por produto, com a que vence primeiro', () => {
  const D = fabrica();
  N.emitir(D, { produtoId: 'p2', modo: 'resfriado', copias: 2 }, AGORA);
  N.emitir(D, { produtoId: 'p1', modo: 'resfriado', feitoEm: em(2026, 11, 14, 9) }, AGORA);   // vence hoje
  N.emitir(D, { produtoId: 'p1', modo: 'congelado', copias: 2 }, AGORA);
  N.darBaixa(D, 'e5', { tipo: 'usada' }, AGORA);
  assert.deepStrictEqual(N.saldo(D, AGORA).map((x) => [x.nome, x.codigo, x.tipo, x.n, x.sit, x.resta]),
    [['Camarão cru', 'MP001', 'mp', 2, 'hoje', 'vence hoje'], ['Recheio de camarão', 'PP001', 'pp', 2, 'ok', 'vence em 3 dias']]);
  assert.deepStrictEqual(N.saldo(N.vazio(), AGORA), []);
});

teste('dados da segunda versão: abrem sem recebimento nem contagem, e arquivo torto é consertado', () => {
  const base = { produtos: [{ id: 'p1', codigo: 'A1', tipo: 'mp', nome: 'Caldo', validades: { resfriado: { n: 3, un: 'd' } } }] };
  const v2 = N.carregar(Object.assign({ versao: 2, etiquetas: [{ cod: 1, tipo: 'mp', nome: 'Caldo', modo: 'resfriado', feitoEm: AGORA, venceEm: AGORA + N.DIA }] }, base));
  assert.deepStrictEqual([v2.versao, v2.recebimentos, v2.contagens, v2.seqRec, v2.seqCont], [N.VERSAO, [], [], 0, 0]);
  assert.deepStrictEqual([v2.etiquetas[0].recebimentoId, v2.etiquetas[0].tempChegada], ['', null]);
  const torto = N.carregar(Object.assign({
    etiquetas: [
      { cod: 1, tipo: 'mp', nome: 'Caldo', modo: 'resfriado', feitoEm: AGORA, venceEm: AGORA + N.DIA, recebimentoId: 'r2', tempChegada: 4 },
      { cod: 2, tipo: 'mp', nome: 'Caldo', modo: 'resfriado', feitoEm: AGORA, venceEm: AGORA + N.DIA, recebimentoId: 'r9', tempChegada: 'quente' },
    ],
    recebimentos: [{ n: 1, abertoEm: AGORA, fornecedor: 'A' }, { n: 2, abertoEm: AGORA, fornecedor: 'B' }, { n: 3, abertoEm: AGORA }],
    contagens: [{ n: 1, abertaEm: AGORA, lidas: [1, 1, 'x'] }, { n: 2, abertaEm: AGORA, tipo: 'zz' }],
  }, base));
  assert.deepStrictEqual(torto.recebimentos.map((r) => [r.id, r.fornecedor, !!r.fechadoEm]), [['r1', 'A', true], ['r2', 'B', false]], 'só o último fica aberto; sem fornecedor não entra');
  assert.deepStrictEqual(torto.contagens.map((c) => [c.id, c.tipo, c.lidas, !!c.fechadaEm]), [['c1', '', [1], true], ['c2', '', [], true]], 'com recebimento aberto, nenhuma contagem fica aberta');
  assert.deepStrictEqual(torto.etiquetas.map((e) => [e.recebimentoId, e.tempChegada]), [['r2', 4], ['', null]]);
  assert.deepStrictEqual([torto.seqRec, torto.seqCont], [2, 2]);
});

console.log(`\n${n} testes passaram.`);
