#!/usr/bin/env node
/*
 * teste-motor.js — Testes do motor (core.js), sem dependências.
 *   node teste-motor.js                 → roda os testes
 *   node teste-motor.js --json saida.json → também grava os dados para a planilha
 */
'use strict';

const fs = require('fs');
const path = require('path');
const Core = require('./core.js');

let falhas = 0;
let total = 0;
const linhasCasos = [];

function verificar(cond, descricao, detalhe) {
  total++;
  if (!cond) {
    falhas++;
    console.log('  ✗ ' + descricao + (detalhe ? ' — ' + detalhe : ''));
  }
  return cond;
}

function quase(a, b, tol) { return Math.abs(a - b) <= (tol == null ? 1e-6 : tol); }

// -----------------------------------------------------------------------------
// 1. Varredura completa: 3 espécies × 6 apresentações × 4 condições = 72
//    configurações; mínimo, meio e máximo de cada classe. Glaciamento 15%,
//    embalagem de 1 kg.
// -----------------------------------------------------------------------------

const CONDICOES_TESTE = [
  { id: 'fresco', cfg: { condicao: 'fresco' } },
  { id: 'congelado', cfg: { condicao: 'congelado' } },
  { id: 'glaciado_compensada', cfg: { condicao: 'glaciado', glaciamento: 15, embalagem: 'compensada' } },
  { id: 'glaciado_nao_compensada', cfg: { condicao: 'glaciado', glaciamento: 15, embalagem: 'nao_compensada' } },
];

console.log('1. Varredura completa');
const configuracoes = [];
const pontos = [];
let falhasVarredura = 0;

Object.keys(Core.ESPECIES).forEach(function (especie) {
  Object.keys(Core.APRESENTACOES).forEach(function (apresentacao) {
    CONDICOES_TESTE.forEach(function (cond) {
      const cfg = Object.assign({ especie: especie, apresentacao: apresentacao, pesoDeclarado: 1000 }, cond.cfg);
      const tabela = Core.selecionarTabela(especie, apresentacao);
      const fator = cfg.condicao === 'glaciado' ? 1.15 : 1;
      let falhasCfg = 0;
      let nPontos = 0;
      tabela.classes.forEach(function (classe) {
        const f = classe.faixaG;
        [['mínimo', f[0]], ['meio', (f[0] + f[1]) / 2], ['máximo', f[1]]].forEach(function (pt) {
          const liquido = pt[1];
          const pesado = liquido * fator;
          const r = Core.avaliar(cfg, [pesado]);
          // Classes que contêm o ponto, sem tolerância.
          const contem = tabela.classes.filter(function (c) { return Core.contem(tabela, c, liquido, 0); });
          const menor = Math.min.apply(null, contem.map(Core.larguraFaixa));
          const retornada = r.classeLote;
          const ok = r.lote.situacao === 'dentro' &&
            Core.contem(tabela, retornada, liquido, 0) &&
            Math.abs(Core.larguraFaixa(retornada) - menor) < 1e-9 &&
            quase(r.unidades[0].liquido, liquido, 1e-9) &&
            isFinite(r.faixaPecas.min) && isFinite(r.faixaPecas.max);
          if (!ok) {
            falhasCfg++;
            console.log('  ✗ ' + especie + '/' + apresentacao + '/' + cond.id + ' classe ' + classe.rotulo + ' ' + pt[0] + ' ' + liquido + ' g → ' + retornada.rotulo + ' (' + r.lote.situacao + ')');
          }
          nPontos++;
          pontos.push({
            especie: Core.ESPECIES[especie].nome,
            apresentacao: Core.APRESENTACOES[apresentacao],
            condicao: cond.id,
            tabela: Core.descreverTabela(tabela),
            classe_testada: classe.rotulo,
            ponto: pt[0],
            peso_liquido_g: liquido,
            peso_pesado_g: pesado,
            classe_retornada: retornada.rotulo,
            sobrepostas: r.lote.outras.join(', '),
            faixa_pecas: r.faixaPecas.min + '–' + r.faixaPecas.max + (r.faixaPecas.proporcional ? ' (prop. ' + r.faixaPecas.coluna + ' g)' : ''),
            resultado: ok ? 'OK' : 'FALHA',
          });
        });
      });
      falhasVarredura += falhasCfg;
      configuracoes.push({
        especie: Core.ESPECIES[especie].nome,
        apresentacao: Core.APRESENTACOES[apresentacao],
        condicao: cond.id,
        tabela: Core.descreverTabela(tabela),
        unidade: tabela.unidade || '(sem unidade)',
        classes: tabela.classes.length,
        pontos: nPontos,
        falhas: falhasCfg,
      });
    });
  });
});
total += pontos.length;
falhas += falhasVarredura;
console.log('  ' + configuracoes.length + ' configurações, ' + pontos.length + ' pontos, ' + falhasVarredura + ' falhas');
verificar(configuracoes.length === 72, 'São 72 configurações', String(configuracoes.length));
verificar(pontos.length === 2352, 'São 2.352 pontos', String(pontos.length));

// -----------------------------------------------------------------------------
// 2. Casos de referência
// -----------------------------------------------------------------------------

console.log('2. Casos de referência');
const CASOS = [
  { nome: 'Rosa, tail on cru, fresco, 1 kg', cfg: { especie: 'rosa', apresentacao: 'tailon_cru', condicao: 'fresco', pesoDeclarado: 1000 }, peso: 24, classe: '36/50', pecas: [36, 50] },
  { nome: 'Rosa, inteiro, fresco, 2 kg', cfg: { especie: 'rosa', apresentacao: 'inteiro', condicao: 'fresco', pesoDeclarado: 2000 }, peso: 40, classe: '21/30', pecas: [42, 60] },
  { nome: 'Rosa, descascado cru (des/evisc), fresco, 400 g', cfg: { especie: 'rosa', apresentacao: 'desc_cru', condicao: 'fresco', pesoDeclarado: 400 }, peso: 10, classe: '31/50', pecas: [31, 50] },
  { nome: 'Cinza, inteiro, fresco, 1 kg', cfg: { especie: 'cinza', apresentacao: 'inteiro', condicao: 'fresco', pesoDeclarado: 1000 }, peso: 22, classe: '40/50', pecas: [40, 50] },
  { nome: 'Cinza, descascado cozido, fresco, 1 kg', cfg: { especie: 'cinza', apresentacao: 'desc_cozido', condicao: 'fresco', pesoDeclarado: 1000 }, peso: 20, classe: '16/20', pecas: [45, 60] },
  { nome: 'Argentino, sem cabeça, fresco, 400 g', cfg: { especie: 'argentino', apresentacao: 'sem_cabeca', condicao: 'fresco', pesoDeclarado: 400 }, peso: 20, classe: '21/25', pecas: [19, 22] },
  { nome: 'Argentino, descascado cru, glaciado 15%, compensado, 1 kg', cfg: { especie: 'argentino', apresentacao: 'desc_cru', condicao: 'glaciado', glaciamento: 15, embalagem: 'compensada', pesoDeclarado: 1000 }, peso: 23, liquido: 20, classe: '16/20', pecas: [45, 55], proporcional: false },
  { nome: 'Idem, não compensado (869,6 g líquidos)', cfg: { especie: 'argentino', apresentacao: 'desc_cru', condicao: 'glaciado', glaciamento: 15, embalagem: 'nao_compensada', pesoDeclarado: 1000 }, peso: 23, liquido: 20, classe: '16/20', pecas: [39, 48], proporcional: true, embLiquido: 869.6 },
];

CASOS.forEach(function (c) {
  const r = Core.avaliar(c.cfg, [c.peso]);
  const fp = r.faixaPecas;
  let ok = verificar(r.classeLote.rotulo === c.classe && r.lote.situacao === 'dentro', c.nome + ': classe', r.classeLote.rotulo + ' (' + r.lote.situacao + ')');
  ok = verificar(fp.min === c.pecas[0] && fp.max === c.pecas[1], c.nome + ': faixa de peças', fp.min + '–' + fp.max) && ok;
  if (c.liquido != null) ok = verificar(quase(r.unidades[0].liquido, c.liquido, 1e-9), c.nome + ': peso líquido', String(r.unidades[0].liquido)) && ok;
  if (c.proporcional != null) ok = verificar(fp.proporcional === c.proporcional, c.nome + ': proporcional', String(fp.proporcional)) && ok;
  if (c.embLiquido != null) ok = verificar(quase(r.embalagem.liquido, c.embLiquido, 0.05), c.nome + ': líquido no pacote', String(r.embalagem.liquido)) && ok;
  const obtido = Core.textoClasse(r) + ' | ' + Core.fmtFaixaPeso(r.tabela, r.faixaPeso) + ' | ' + Core.fmtFaixaPecas(fp) + (fp.proporcional ? ' (proporcional à coluna de ' + Core.fmtEmbalagem(fp.coluna) + ')' : '');
  console.log('  ' + (ok ? '✓' : '✗') + ' ' + c.nome + ' — ' + c.peso + ' g → ' + obtido);
  linhasCasos.push({ caso: c.nome, peso_pesado_g: c.peso, esperado: c.classe + ' | ' + c.pecas[0] + '–' + c.pecas[1], obtido: obtido, resultado: ok ? 'OK' : 'FALHA' });
});

// -----------------------------------------------------------------------------
// 3. Bordas
// -----------------------------------------------------------------------------

console.log('3. Bordas');
function borda(nome, fn) {
  const res = fn();
  console.log('  ' + (res.ok ? '✓' : '✗') + ' ' + nome + ' — ' + res.obtido);
  linhasCasos.push({ caso: 'Borda: ' + nome, peso_pesado_g: res.peso, esperado: res.esperado, obtido: res.obtido, resultado: res.ok ? 'OK' : 'FALHA' });
  verificar(res.ok, 'Borda: ' + nome, res.obtido);
}

borda('99,6 g no rosa inteiro → 7/10 por tolerância', function () {
  const r = Core.avaliar({ especie: 'rosa', apresentacao: 'inteiro', condicao: 'fresco', pesoDeclarado: 1000 }, [99.6]);
  return { peso: 99.6, esperado: '7/10 (tolerância)', obtido: r.classeLote.rotulo + ' (' + r.lote.situacao + ')', ok: r.classeLote.rotulo === '7/10' && r.lote.situacao === 'tolerancia' };
});
borda('13 g no rosa des/evisc → fora da tabela', function () {
  const r = Core.avaliar({ especie: 'rosa', apresentacao: 'desc_cru', condicao: 'fresco', pesoDeclarado: 400 }, [13]);
  return { peso: 13, esperado: 'fora da tabela', obtido: Core.textoClasse(r), ok: r.lote.situacao === 'fora' };
});
borda('80 g no inteiro da tabela geral → fora, acima, mais próxima 20/30', function () {
  const r = Core.avaliar({ especie: 'cinza', apresentacao: 'inteiro', condicao: 'fresco', pesoDeclarado: 1000 }, [80]);
  return { peso: 80, esperado: 'fora, acima, 20/30', obtido: Core.textoClasse(r), ok: r.lote.situacao === 'fora' && r.lote.posicao === 'acima' && r.classeLote.rotulo === '20/30' };
});
borda('compensado 1 kg com 15% → envasar 1.150 g brutos', function () {
  const e = Core.infoEmbalagem({ condicao: 'glaciado', glaciamento: 15, embalagem: 'compensada', pesoDeclarado: 1000 });
  return { peso: '', esperado: '1.150 g', obtido: Core.fmtEmbalagem(e.brutoEnvasar), ok: quase(e.brutoEnvasar, 1150, 1e-9) && Core.fmtEmbalagem(e.brutoEnvasar) === '1.150 g' };
});

// -----------------------------------------------------------------------------
// 4. Testes complementares do motor
// -----------------------------------------------------------------------------

console.log('4. Complementares');
const antes = falhas;

// Validação de peso: rejeitar ≤ 0 e ≥ 1.000 g; aceitar vírgula e ponto.
verificar(!Core.validarPeso('0').ok, 'Rejeita 0 g');
verificar(!Core.validarPeso('-3').ok, 'Rejeita negativo');
verificar(!Core.validarPeso('1000').ok, 'Rejeita 1.000 g');
verificar(!Core.validarPeso('abc').ok, 'Rejeita texto');
verificar(Core.validarPeso('12,5').valor === 12.5, 'Aceita vírgula');
verificar(Core.validarPeso('12.5').valor === 12.5, 'Aceita ponto');
verificar(Core.validarPeso('999,9').ok, 'Aceita 999,9 g');

// Faixa de peso da tabela geral pela coluna de 1 kg (exemplo do enunciado: 45–55 pç → 18,18–22,22 g).
const tDesc = Core.selecionarTabela('argentino', 'desc_cru');
const c1620 = tDesc.classes.find(function (c) { return c.rotulo === '16/20'; });
verificar(Core.fmtFaixaPeso(tDesc, c1620.faixaG) === '18,18–22,22 g', 'Faixa 45–55 pç/kg = 18,18–22,22 g', Core.fmtFaixaPeso(tDesc, c1620.faixaG));

// Tabela usada e unidade exibida.
verificar(Core.selecionarTabela('rosa', 'inteiro').nome === 'Tabela Frescatto', 'Rosa inteiro → Tabela Frescatto');
verificar(Core.selecionarTabela('rosa', 'tailon_cru').nome === 'Tabela Frescatto', 'Rosa tail on cru → Tabela Frescatto');
verificar(Core.selecionarTabela('rosa', 'desc_cru').id === 'frescatto_desevisc', 'Rosa descascado cru → bloco DES/EVISC');
verificar(Core.selecionarTabela('rosa', 'desc_cozido').nome === 'Tabela geral', 'Rosa descascado cozido → Tabela geral');
verificar(Core.selecionarTabela('rosa', 'tailon_cozido').nome === 'Tabela geral', 'Rosa tail on cozido → Tabela geral');
verificar(Core.selecionarTabela('cinza', 'inteiro').unidade === 'pç/kg', 'Geral inteiro em pç/kg');
verificar(Core.selecionarTabela('cinza', 'sem_cabeca').unidade === 'pç/lb', 'Geral sem cabeça em pç/lb');
verificar(Core.selecionarTabela('rosa', 'inteiro').unidade === 'pç/kg', 'Frescatto inteiro em pç/kg');
verificar(Core.selecionarTabela('rosa', 'desc_cru').unidade === '', 'Des/evisc sem unidade');

// Sobreposição: 20 g no rosa inteiro cabe em 41/50 e 51/60 (larguras iguais) → cita a outra.
const rSob = Core.avaliar({ especie: 'rosa', apresentacao: 'inteiro', condicao: 'fresco', pesoDeclarado: 1000 }, [20]);
verificar(rSob.lote.outras.length === 1, 'Sobreposição citada na análise', rSob.lote.outras.join(','));
verificar(rSob.analise.some(function (a) { return /sobrepostas/.test(a.texto); }), 'Frase de faixas sobrepostas');

// Sobreposição na tabela geral: 7 g no inteiro (≈142,9 pç/kg) cabe em 120-150 e 140-170 → mais estreita 140/170.
const rSobG = Core.avaliar({ especie: 'cinza', apresentacao: 'inteiro', condicao: 'fresco', pesoDeclarado: 1000 }, [7]);
verificar(rSobG.classeLote.rotulo === '140/170', '7 g no geral inteiro → 140/170 (mais estreita)', rSobG.classeLote.rotulo + ' outras: ' + rSobG.lote.outras.join(','));

// Glaciamento acima de 20% → crítico.
const rG = Core.avaliar({ especie: 'cinza', apresentacao: 'inteiro', condicao: 'glaciado', glaciamento: 25, embalagem: 'compensada', pesoDeclarado: 1000 }, [25]);
verificar(rG.analise.some(function (a) { return a.status === 'critico' && /acima do limite/.test(a.texto); }), 'Glaciamento 25% gera crítico');

// Não compensado → alerta crítico com o texto legal.
const rNC = Core.avaliar(CASOS[7].cfg, [23]);
verificar(rNC.analise.some(function (a) { return a.status === 'critico' && /incluiria a água de glaciamento, o que a IN 23\/2019 não permite/.test(a.texto) && /1\.150 g/.test(a.texto); }), 'Não compensado: alerta crítico e quanto envasar');

// Rosa com tabela própria glaciado: conferência com a coluna congelado.
const rCong = Core.avaliar({ especie: 'rosa', apresentacao: 'inteiro', condicao: 'glaciado', glaciamento: 20, embalagem: 'compensada', pesoDeclarado: 1000 }, [48, 48, 48]);
verificar(rCong.conferenciaCongelado && rCong.conferenciaCongelado.classe === '21/30' && rCong.conferenciaCongelado.igual, 'Conferência congelado: 48 g (40 g líq.) → 21/30 igual', JSON.stringify(rCong.conferenciaCongelado));
const rCong2 = Core.avaliar({ especie: 'rosa', apresentacao: 'inteiro', condicao: 'glaciado', glaciamento: 5, embalagem: 'compensada', pesoDeclarado: 1000 }, [57, 57]);
verificar(rCong2.conferenciaCongelado && !rCong2.conferenciaCongelado.igual && rCong2.analise.some(function (a) { return /diferente da classe/.test(a.texto); }), 'Conferência congelado diferente gera aviso', JSON.stringify(rCong2.conferenciaCongelado));

// Estatística.
const est = Core.estatistica([10, 12, 14, 16, 18, 20, 22, 24, 26, 28]);
verificar(quase(est.media, 19) && quase(est.desvio, 6.0553, 1e-4) && quase(est.uniformidade, 2.8), 'Estatística (média, DP, uniformidade)', JSON.stringify(est));
verificar(quase(est.pcKg, 1000 / 19) && quase(est.pcLb, 453.59237 / 19), 'pç/kg e pç/lb');

// Dispersão: média numa classe, maioria em outra.
const rDisp = Core.avaliar({ especie: 'cinza', apresentacao: 'inteiro', condicao: 'fresco', pesoDeclarado: 1000 }, [21, 21, 21, 40]);
verificar(rDisp.analise.some(function (a) { return /avaliar regraduação/.test(a.texto); }), 'Dispersão → avaliar regraduação', rDisp.classeLote.rotulo);

// Status do % na classe.
const rPct = Core.avaliar({ especie: 'cinza', apresentacao: 'inteiro', condicao: 'fresco', pesoDeclarado: 1000 }, [22, 22, 22, 22, 22, 22, 22, 22, 22, 30]);
verificar(rPct.analise[rPct.analise.length - 2].status === 'ok' || rPct.analise.some(function (a) { return /90% das unidades/.test(a.texto) && a.status === 'ok'; }), '90% na classe → ok');

// Faixa de peças proporcional com coluna inexistente (300 g).
const rP = Core.avaliar({ especie: 'cinza', apresentacao: 'inteiro', condicao: 'fresco', pesoDeclarado: 300 }, [22]);
verificar(rP.faixaPecas.proporcional && rP.faixaPecas.min === 12 && rP.faixaPecas.max === 15 && rP.faixaPecas.coluna === 1000, '300 g → proporcional à coluna de 1 kg (12–15)', JSON.stringify(rP.faixaPecas));
// Des/evisc sem coluna de 1 kg → coluna mais próxima.
const rD = Core.avaliar({ especie: 'rosa', apresentacao: 'desc_cru', condicao: 'fresco', pesoDeclarado: 500 }, [30]);
verificar(rD.faixaPecas.proporcional && rD.faixaPecas.coluna === 400 && rD.faixaPecas.min === 10 && rD.faixaPecas.max === 20, 'Des/evisc 500 g → proporcional à coluna de 400 g (10–20)', JSON.stringify(rD.faixaPecas));

// CSV: BOM, separador e colunas.
const csv = Core.gerarCsv([{ ident: { codigo: 'E-01', data: '2026-10-09', lote: 'NF 123', tecnico: 'Ana' }, cfg: CASOS[6].cfg, pesos: [23, 23.5] }]);
const linhas = csv.replace(/^﻿/, '').trim().split('\r\n');
verificar(csv.charCodeAt(0) === 0xFEFF, 'CSV com BOM UTF-8');
verificar(linhas[0] === 'codigo;data;lote;especie;apresentacao;condicao;unidade;peso_pesado_g;peso_liquido_g;classe;status', 'CSV com cabeçalho correto', linhas[0]);
verificar(linhas.length === 3 && linhas[1].split(';')[1] === '09/10/2026' && linhas[1].split(';')[7] === '23,00' && linhas[1].split(';')[8] === '20,00', 'CSV com dados e vírgula decimal', linhas[1]);

// Resumo em texto.
const resumo = Core.resumoTexto(rNC, { codigo: 'E-01', data: '2026-10-09' });
verificar(/\(a\) Classificação: 16\/20 pç\/lb/.test(resumo) && /\(c\) Peças na embalagem: 39–48 pç/.test(resumo) && /09\/10\/2026/.test(resumo), 'Resumo com (a), (b), (c) e data', resumo.split('\n').slice(0, 12).join(' / '));

// Formatação pt-BR.
verificar(Core.fmt(1234.5, 2) === '1.234,50', 'fmt 1.234,50', Core.fmt(1234.5, 2));
verificar(Core.fmtEmbalagem(869.5652) === '869,6 g' && Core.fmtEmbalagem(2000) === '2 kg', 'fmtEmbalagem');

console.log('  ' + (falhas === antes ? '✓ todos os complementares passaram' : (falhas - antes) + ' falha(s)'));

// -----------------------------------------------------------------------------
// Achados das tabelas
// -----------------------------------------------------------------------------

const achados = Core.achadosTabelas();
const porTipo = {};
achados.forEach(function (a) { porTipo[a.tipo] = (porTipo[a.tipo] || 0) + 1; });
console.log('Achados nas tabelas: ' + achados.length + ' (' + Object.keys(porTipo).map(function (k) { return porTipo[k] + ' ' + k; }).join(', ') + ')');

// -----------------------------------------------------------------------------
// Faixas de peças por embalagem (para a planilha)
// -----------------------------------------------------------------------------

const faixasEmbalagem = [];
Object.keys(Core.TABELAS).forEach(function (id) {
  const t = Core.TABELAS[id];
  t.classes.forEach(function (c) {
    const linha = { tabela: Core.descreverTabela(t), classe: c.rotulo, unidade: t.unidade || '(sem unidade)', faixa_peso: Core.fmtFaixaPeso(t, c.faixaG) };
    if (c.faixaCong) linha.faixa_congelado = Core.fmtFaixaPeso(t, c.faixaCong);
    Core.ATALHOS_EMBALAGEM.forEach(function (g) {
      const fp = Core.faixaPecasEmbalagem(c, g);
      linha[Core.fmtEmbalagem(g)] = fp.min + '–' + fp.max + (fp.proporcional ? ' *' : '');
    });
    faixasEmbalagem.push(linha);
  });
});

// -----------------------------------------------------------------------------

console.log('');
console.log(falhas === 0 ? 'RESULTADO: OK — ' + total + ' verificações, 0 falhas' : 'RESULTADO: FALHOU — ' + falhas + ' de ' + total + ' verificações');

const iJson = process.argv.indexOf('--json');
if (iJson > 0 && process.argv[iJson + 1]) {
  const saida = path.resolve(process.argv[iJson + 1]);
  fs.writeFileSync(saida, JSON.stringify({
    data: new Date().toISOString(),
    versaoMotor: Core.VERSAO_MOTOR,
    resumo: { verificacoes: total, falhas: falhas, configuracoes: configuracoes.length, pontos: pontos.length, falhasVarredura: falhasVarredura },
    configuracoes: configuracoes,
    pontos: pontos,
    casos: linhasCasos,
    faixasEmbalagem: faixasEmbalagem,
    achados: achados,
  }, null, 1));
  console.log('Dados gravados em ' + saida);
}

process.exit(falhas === 0 ? 0 : 1);
