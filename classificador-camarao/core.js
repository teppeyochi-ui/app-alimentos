/*
 * core.js — Motor do Classificador de Camarão (Frescatto P&D)
 *
 * Só regras de negócio e tabelas, em funções puras, sem acesso a DOM,
 * rede ou armazenamento. Funciona no navegador (window.Core) e no Node
 * (require('./core.js')), para ser testado por teste-motor.js.
 *
 * Regras aplicadas (ver LEIA-ME.md e o prompt do projeto):
 *  - Rosa: tabela própria Frescatto em Inteiro, Descascado tail on cru e
 *    Descascado cru (bloco "DES/EVISC"); demais casos usam a tabela geral.
 *  - Tabela geral: faixa de peso = 1.000 g ÷ peças da coluna de 1 kg.
 *  - Classificação: faixa que contém o peso líquido; senão tolerância de
 *    arredondamento (±0,5 g ou ±0,5 peça); sobreposição → faixa mais
 *    estreita; nenhuma → "fora da tabela" com a classe mais próxima.
 *  - Classe do lote = classificação da média do peso líquido.
 *  - Glaciamento (IN SDA/MAPA nº 23/2019, art. 4º): até 20% do peso
 *    líquido declarado; a água de glaciamento não compõe o peso líquido.
 */
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.Core = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Constantes e cadastros
  // ---------------------------------------------------------------------------

  const ESPECIES = {
    rosa: { nome: 'Rosa', cientifico: 'Farfantepenaeus spp.' },
    cinza: { nome: 'Cinza', cientifico: 'Litopenaeus vannamei' },
    argentino: { nome: 'Argentino', cientifico: 'Pleoticus muelleri' },
  };

  const APRESENTACOES = {
    inteiro: 'Inteiro',
    sem_cabeca: 'Sem cabeça',
    desc_cru: 'Descascado cru',
    desc_cozido: 'Descascado cozido',
    tailon_cru: 'Descascado tail on cru',
    tailon_cozido: 'Descascado tail on cozido',
  };

  const CONDICOES = {
    fresco: 'Fresco/resfriado',
    congelado: 'Congelado',
    glaciado: 'Congelado glaciado',
  };

  const EMBALAGENS = {
    compensada: 'Compensada',
    nao_compensada: 'Não compensada',
  };

  // Atalhos de peso líquido declarado da embalagem (g).
  const ATALHOS_EMBALAGEM = [200, 300, 400, 500, 800, 1000, 2000, 5000];

  // IN SDA/MAPA nº 23/2019, art. 4º: glaciamento até 20% do peso líquido.
  const LIMITE_GLACIAMENTO = 20;
  const PASSO_GLACIAMENTO = 0.5;

  // Tolerâncias de arredondamento: as tabelas trazem números inteiros, então
  // um peso que caia no "vão" de arredondamento entre duas faixas é aceito.
  const TOL_G = 0.5; // faixas em gramas (tabela própria)
  const TOL_PC = 0.5; // peças na coluna de 1 kg (tabela geral)
  const EPS = 1e-9; // folga numérica de ponto flutuante

  const PESO_MAX = 1000; // g; peso de uma unidade deve ser > 0 e < 1.000 g
  const G_POR_LB = 453.59237;

  // ---------------------------------------------------------------------------
  // 4.1 Tabela Frescatto — camarão rosa (faixas em g por peça)
  // Dados copiados exatamente do documento de referência. Não alterar sem
  // revisão de P&D/Qualidade.
  // ---------------------------------------------------------------------------

  const FRESCATTO_INTEIRO = [
    { nome: '7/10', g: [100, 143], gCong: [120, 171], pecas: { 1000: [7, 10], 2000: [14, 20] } },
    { nome: '11/15', g: [67, 99], gCong: [80, 119], pecas: { 1000: [11, 15], 2000: [22, 30] } },
    { nome: '16/20', g: [49, 66], gCong: [59, 79], pecas: { 1000: [16, 20], 2000: [32, 40] } },
    { nome: '21/30', g: [33, 48], gCong: [40, 57], pecas: { 1000: [21, 30], 2000: [42, 60] } },
    { nome: '31/40', g: [25, 32], gCong: [30, 39], pecas: { 1000: [31, 40], 2000: [62, 80] } },
    { nome: '41/50', g: [20, 24], gCong: [24, 29], pecas: { 1000: [41, 50], 2000: [82, 100] } },
    { nome: '51/60', g: [16, 20], gCong: [19, 24], pecas: { 1000: [51, 60], 2000: [102, 120] } },
  ];

  const FRESCATTO_TAILON = [
    { nome: '12/16', g: [61, 83], gCong: [73, 100], pecas: { 1000: [12, 16], 2000: [24, 32] } },
    { nome: '17/25', g: [40, 60], gCong: [48, 72], pecas: { 1000: [17, 25], 2000: [34, 50] } },
    { nome: '26/35', g: [29, 39], gCong: [34, 47], pecas: { 1000: [26, 35], 2000: [52, 70] } },
    { nome: '36/50', g: [20, 28], gCong: [24, 33], pecas: { 1000: [36, 50], 2000: [72, 100] } },
    { nome: '51/70', g: [14, 20], gCong: [17, 24], pecas: { 1000: [51, 70], 2000: [102, 140] } },
    { nome: '71/200', g: [5, 14], gCong: [7, 17], pecas: { 1000: [71, 200], 2000: [142, 400] } },
  ];

  // Bloco "DES/EVISC" (descascado eviscerado, resfriado). Copiado como está:
  // o rótulo "10/15" não bate com 8–16 pç em 400 g e há vão entre 12 e 14 g.
  const FRESCATTO_DESEVISC = [
    { nome: '10/15', g: [25, 50], pecas: { 400: [8, 16] } },
    { nome: '26/30', g: [14, 24], pecas: { 400: [20, 30] } },
    { nome: '31/50', g: [8, 12], pecas: { 400: [31, 50], 2000: [155, 250] } },
  ];

  // ---------------------------------------------------------------------------
  // 4.2 Tabela geral — peças por embalagem nas colunas abaixo (g)
  // Texto copiado exatamente do documento de referência e lido por lerGeral().
  // ---------------------------------------------------------------------------

  const COLUNAS_GERAL = [200, 400, 500, 800, 1000, 2000, 5000];

  const GERAL_TEXTO = {
    inteiro: `
20-30   | 4-6,8-12,10-15,15-25,20-30,40-60,100-150
30-40   | 6-8,12-16,15-20,25-32,30-40,60-80,150-200
40-50   | 8-10,16-20,20-25,32-40,40-50,80-100,200-250
50-60   | 10-12,20-25,25-30,40-50,50-60,100-120,250-300
60-70   | 12-15,25-28,30-35,50-55,60-70,120-140,300-350
70-80   | 14-16,28-32,35-40,55-65,70-80,140-160,350-400
80-100  | 16-20,32-40,40-50,65-80,80-100,160-200,400-500
100-120 | 20-25,40-50,50-60,80-95,100-120,200-240,500-600
120-140 | 25-28,50-55,60-70,95-115,120-140,240-280,600-700
120-150 | 25-30,50-60,60-75,95-120,120-150,240-300,600-750
140-170 | 25-35,55-70,70-85,100-140,140-170,280-340,700-850
150-200 | 25-40,55-80,75-100,110-160,150-200,300-400,750-1000`,
    sem_cabeca: `
16-20   | 7-9,15-18,15-20,30-35,35-45,70-90,175-225
21-25   | 9-11,19-22,20-30,35-45,45-55,90-110,225-275
26-30   | 11-13,23-25,30-35,45-55,55-65,110-130,275-325
31-35   | 13-15,25-30,35-40,50-65,65-80,130-160,325-400
36-40   | 15-18,30-35,40-45,65-70,80-90,160-180,400-450
41-50   | 18-20,35-45,45-55,70-90,90-110,180-220,450-550
51-60   | 20-30,45-55,55-70,90-110,110-135,220-270,550-675
61-70   | 25-30,55-60,65-80,110-125,135-155,270-310,675-775
71-90   | 30-40,60-80,80-100,125-160,155-200,310-400,775-1000
91-110  | 40-50,80-100,100-125,160-195,200-245,400-490,1000-1225
111-130 | 50-60,100-115,125-145,195-230,245-290,490-580,1225-1450
111-200 | 50-90,100-175,125-220,195-350,245-440,490-880,1225-2200`,
    desc_cru: `
16-20   | 9-11,18-22,20-25,35-45,45-55,90-110,225-275
21-25   | 11-15,22-28,25-35,45-55,55-70,110-140,275-350
26-30   | 15-17,28-32,35-40,55-65,70-80,140-160,350-400
31-35   | 16-19,35-40,40-50,65-75,80-95,160-190,400-475
36-40   | 20-23,40-45,50-55,75-85,95-105,190-210,475-525
41-50   | 23-30,45-55,55-70,85-110,105-140,210-280,550-700
51-60   | 30-35,55-65,70-85,110-130,140-165,280-330,700-825
61-70   | 35-40,65-75,85-95,130-155,165-190,330-380,825-950
71-90   | 40-50,75-95,95-125,155-195,190-245,380-490,950-1225
91-110  | 50-60,96-120,125-150,195-240,245-300,490-600,1225-1500
111-130 | 60-70,120-140,150-175,240-280,300-350,600-700,1500-1750
111-200 | 60-110,120-220,150-275,240-440,300-550,600-1100,1500-2750`,
    desc_cozido: `
16-20   | 9-12,18-24,23-30,35-45,45-60,90-120,225-300
21-25   | 12-14,24-28,30-35,45-55,60-70,120-140,300-350
26-30   | 14-17,28-35,35-40,55-70,70-85,140-170,350-425
31-35   | 17-20,35-40,40-50,70-80,85-100,170-200,425-500
36-40   | 20-25,40-45,50-60,80-90,100-115,200-230,500-575
41-50   | 25-30,45-60,60-70,90-115,115-145,230-290,575-725
51-60   | 30-35,60-70,70-85,115-135,145-170,290-340,725-850
61-70   | 35-40,70-80,85-100,135-160,170-200,340-400,850-1000
71-90   | 40-50,80-105,100-130,160-205,200-260,400-520,1000-1300
91-110  | 50-65,105-125,130-160,205-250,260-315,520-630,1300-1575
111-130 | 65-75,125-150,160-185,250-300,315-370,630-740,1575-1850
111-200 | 65-115,125-230,160-285,250-460,315-570,630-1140,1575-2850`,
    tailon_cru: `
16-20   | 8-10,16-20,20-25,32-40,40-50,80-100,200-250
21-25   | 10-13,21-25,25-33,40-52,50-65,100-130,250-325
26-30   | 13-15,26-30,33-38,52-60,65-75,130-150,325-375
31-35   | 15-18,31-35,38-45,60-72,75-90,150-180,375-450
36-40   | 18-20,36-40,45-50,72-80,90-100,180-200,450-500
41-50   | 20-25,41-50,50-65,80-100,100-125,200-250,500-625
51-60   | 25-30,51-60,65-75,100-120,125-150,250-300,625-750
61-70   | 30-35,61-70,75-90,120-140,150-175,300-350,750-875
71-90   | 35-45,71-90,90-115,140-180,175-225,350-450,875-1125
91-110  | 45-55,91-110,115-140,180-220,225-275,450-550,1125-1375
111-130 | 55-65,111-130,140-165,220-260,275-325,550-650,1375-1630
111-200 | 55-100,111-200,140-250,225-400,280-500,560-1000,1400-2500`,
    tailon_cozido: `
16-20   | 8-11,16-22,20-28,32-45,40-55,80-110,200-275
21-25   | 11-13,22-25,28-33,45-52,55-65,111-130,275-325
26-30   | 13-16,25-32,33-40,52-65,65-80,130-160,325-400
31-35   | 16-19,32-38,40-48,65-75,80-95,160-190,400-475
36-40   | 19-21,38-42,47-55,75-85,95-105,190-210,475-530
41-50   | 21-25,42-55,55-70,85-110,105-135,210-270,530-675
51-60   | 25-35,55-65,70-80,110-130,135-160,270-320,675-800
61-70   | 35-40,65-75,80-95,130-150,160-185,320-370,800-925
71-90   | 40-50,75-95,95-120,150-190,185-240,370-480,925-1200
91-110  | 50-60,95-115,120-145,190-230,240-290,480-580,1200-1450
111-130 | 60-70,115-140,145-175,230-275,290-345,580-690,1450-1725
111-200 | 60-110,115-215,145-265,230-425,290-530,580-1060,1450-2650`,
  };

  // Lê o texto da tabela geral: "classe | faixa200,faixa400,...,faixa5000".
  function lerGeral(texto) {
    return texto.trim().split('\n').map(function (linha) {
      const partes = linha.split('|').map(function (s) { return s.trim(); });
      const faixas = partes[1].split(',').map(function (f) { return f.split('-').map(Number); });
      if (faixas.length !== COLUNAS_GERAL.length || faixas.some(function (f) { return f.length !== 2 || f.some(isNaN); })) {
        throw new Error('Tabela geral malformada na linha: ' + linha);
      }
      const pecas = {};
      COLUNAS_GERAL.forEach(function (c, i) { pecas[c] = faixas[i]; });
      return { nome: partes[0], pecas: pecas };
    });
  }

  // ---------------------------------------------------------------------------
  // Montagem das tabelas no formato único usado pelo motor
  //   tipo 'g'        → classificação pela faixa em gramas (tabela própria)
  //   tipo 'pecas1kg' → classificação pelas peças da coluna de 1 kg (geral)
  //   faixaG          → faixa de peso por peça em gramas [mín, máx]
  // ---------------------------------------------------------------------------

  const AVISO_DESCASCADO_GERAL =
    'Nas apresentações descascadas, o nome da classe segue a contagem do camarão sem cabeça (pç/lb); ' +
    'as colunas de embalagem já trazem a contagem real do descascado. A faixa de peso vem da coluna de 1 kg, nunca do nome da classe.';

  const AVISO_DESEVISC =
    'Bloco DES/EVISC copiado como está: o rótulo "10/15" não corresponde a 8–16 pç em 400 g, ' +
    'e há um vão entre 12 g e 14 g sem classe (peças nesse intervalo ficam "fora da tabela").';

  function montarPropria(id, bloco, linhas, unidade, avisos) {
    return {
      id: id,
      nome: 'Tabela Frescatto',
      bloco: bloco,
      tipo: 'g',
      tolerancia: TOL_G,
      unidade: unidade,
      temCongelado: linhas.some(function (l) { return !!l.gCong; }),
      avisos: avisos || [],
      classes: linhas.map(function (l) {
        return {
          nome: l.nome,
          rotulo: l.nome,
          faixaG: l.g.slice(),
          faixaCong: l.gCong ? l.gCong.slice() : null,
          pecas: l.pecas,
        };
      }),
    };
  }

  function montarGeral(apresentacao) {
    const linhas = lerGeral(GERAL_TEXTO[apresentacao]);
    const descascado = apresentacao !== 'inteiro' && apresentacao !== 'sem_cabeca';
    return {
      id: 'geral_' + apresentacao,
      nome: 'Tabela geral',
      bloco: APRESENTACOES[apresentacao],
      tipo: 'pecas1kg',
      tolerancia: TOL_PC,
      unidade: apresentacao === 'inteiro' ? 'pç/kg' : 'pç/lb',
      temCongelado: false,
      avisos: descascado ? [AVISO_DESCASCADO_GERAL] : [],
      classes: linhas.map(function (l) {
        const p1 = l.pecas[1000];
        return {
          nome: l.nome,
          rotulo: l.nome.replace('-', '/'),
          pc1kg: p1.slice(),
          // Faixa de peso = 1.000 g ÷ peças da coluna de 1 kg (máx. peças → menor peso).
          faixaG: [1000 / p1[1], 1000 / p1[0]],
          faixaCong: null,
          pecas: l.pecas,
        };
      }),
    };
  }

  const TABELAS = {
    frescatto_inteiro: montarPropria('frescatto_inteiro', 'Inteiro', FRESCATTO_INTEIRO, 'pç/kg'),
    frescatto_tailon: montarPropria('frescatto_tailon', 'Tail on', FRESCATTO_TAILON, 'pç/kg'),
    frescatto_desevisc: montarPropria('frescatto_desevisc', 'Descascado eviscerado (DES/EVISC)', FRESCATTO_DESEVISC, '', [AVISO_DESEVISC]),
  };
  Object.keys(APRESENTACOES).forEach(function (a) { TABELAS['geral_' + a] = montarGeral(a); });

  // 3.1 Qual tabela usar.
  function selecionarTabela(especie, apresentacao) {
    if (!ESPECIES[especie]) throw new Error('Espécie inválida: ' + especie);
    if (!APRESENTACOES[apresentacao]) throw new Error('Apresentação inválida: ' + apresentacao);
    if (especie === 'rosa') {
      if (apresentacao === 'inteiro') return TABELAS.frescatto_inteiro;
      if (apresentacao === 'tailon_cru') return TABELAS.frescatto_tailon;
      if (apresentacao === 'desc_cru') return TABELAS.frescatto_desevisc; // bloco "DES/EVISC"
    }
    return TABELAS['geral_' + apresentacao];
  }

  // ---------------------------------------------------------------------------
  // 3.3 Classificação
  // ---------------------------------------------------------------------------

  function larguraFaixa(classe) {
    return classe.faixaG[1] - classe.faixaG[0];
  }

  // A classe contém o peso? Tabela própria compara gramas; tabela geral
  // converte o peso em peças por kg (1.000 ÷ peso) e compara com a coluna de 1 kg.
  function contem(tabela, classe, peso, tol) {
    if (tabela.tipo === 'pecas1kg') {
      const n = 1000 / peso;
      return n >= classe.pc1kg[0] - tol - EPS && n <= classe.pc1kg[1] + tol + EPS;
    }
    return peso >= classe.faixaG[0] - tol - EPS && peso <= classe.faixaG[1] + tol + EPS;
  }

  // Entre as classes candidatas, vence a de faixa mais estreita (empate: ordem da tabela).
  function maisEstreita(candidatas) {
    return candidatas.slice().sort(function (a, b) {
      const d = larguraFaixa(a.classe) - larguraFaixa(b.classe);
      return Math.abs(d) > EPS ? d : a.indice - b.indice;
    })[0];
  }

  /**
   * Classifica um peso líquido (g) numa tabela.
   * Retorna { classe, indice, situacao: 'dentro'|'tolerancia'|'fora',
   *           outras: [rótulos das demais classes que também cabem],
   *           posicao: 'acima'|'abaixo'|null }.
   * Na situação 'fora', `classe` é a classe mais próxima.
   */
  function classificarPeso(tabela, peso) {
    const passos = [
      { situacao: 'dentro', tol: 0 },
      { situacao: 'tolerancia', tol: tabela.tolerancia },
    ];
    for (let p = 0; p < passos.length; p++) {
      const candidatas = [];
      tabela.classes.forEach(function (classe, indice) {
        if (contem(tabela, classe, peso, passos[p].tol)) candidatas.push({ classe: classe, indice: indice });
      });
      if (candidatas.length) {
        const vencedora = maisEstreita(candidatas);
        return {
          classe: vencedora.classe,
          indice: vencedora.indice,
          situacao: passos[p].situacao,
          outras: candidatas.filter(function (c) { return c !== vencedora; }).map(function (c) { return c.classe.rotulo; }),
          posicao: null,
        };
      }
    }
    // Fora da tabela: associa à classe mais próxima em gramas.
    let melhor = null;
    tabela.classes.forEach(function (classe, indice) {
      const f = classe.faixaG;
      const dist = peso < f[0] ? f[0] - peso : peso - f[1];
      if (!melhor || dist < melhor.dist - EPS) melhor = { classe: classe, indice: indice, dist: dist };
    });
    return {
      classe: melhor.classe,
      indice: melhor.indice,
      situacao: 'fora',
      outras: [],
      posicao: peso > melhor.classe.faixaG[1] ? 'acima' : 'abaixo',
    };
  }

  // ---------------------------------------------------------------------------
  // 3.4 Glaciamento e compensação
  // ---------------------------------------------------------------------------

  function fatorGlaciamento(cfg) {
    return cfg.condicao === 'glaciado' ? 1 + (Number(cfg.glaciamento) || 0) / 100 : 1;
  }

  // Peso líquido da peça = pesado ÷ (1 + glaciamento/100); fresco e congelado
  // sem glaciamento usam o peso pesado direto.
  function pesoLiquidoPeca(pesado, cfg) {
    return pesado / fatorGlaciamento(cfg);
  }

  /**
   * Pesos da embalagem.
   *  - declarado: peso líquido declarado no rótulo
   *  - liquido: peso líquido real de camarão no pacote (base da faixa de peças)
   *  - brutoEnvasar: quanto envasar (camarão + gelo) para que o líquido seja o declarado
   */
  function infoEmbalagem(cfg) {
    const declarado = Number(cfg.pesoDeclarado);
    const f = fatorGlaciamento(cfg);
    const glaciado = cfg.condicao === 'glaciado';
    const compensada = !glaciado || cfg.embalagem !== 'nao_compensada';
    return {
      declarado: declarado,
      glaciado: glaciado,
      compensada: compensada,
      // Compensada: faixa de peças sobre o declarado. Não compensada: o pacote
      // tem só declarado ÷ (1 + g) de camarão; o resto é água de glaciamento.
      liquido: compensada ? declarado : declarado / f,
      brutoEnvasar: declarado * f,
    };
  }

  // ---------------------------------------------------------------------------
  // 3.5 Faixa de peças na embalagem
  // ---------------------------------------------------------------------------

  /**
   * Coluna exatamente igual ao peso líquido → faixa da coluna.
   * Senão, proporcional à coluna de 1 kg (ou à coluna mais próxima, se a
   * classe não tiver a de 1 kg), arredondando os extremos.
   */
  function faixaPecasEmbalagem(classe, pesoLiquidoEmb) {
    const colunas = Object.keys(classe.pecas).map(Number).sort(function (a, b) { return a - b; });
    const exata = colunas.find(function (c) { return Math.abs(c - pesoLiquidoEmb) < 0.01; });
    if (exata !== undefined) {
      const r = classe.pecas[exata];
      return { min: r[0], max: r[1], coluna: exata, proporcional: false };
    }
    let base = 1000;
    if (!classe.pecas[1000]) {
      base = colunas.reduce(function (m, c) {
        return Math.abs(c - pesoLiquidoEmb) < Math.abs(m - pesoLiquidoEmb) ? c : m;
      });
    }
    const r = classe.pecas[base];
    const k = pesoLiquidoEmb / base;
    return { min: Math.round(r[0] * k), max: Math.round(r[1] * k), coluna: base, proporcional: true };
  }

  // ---------------------------------------------------------------------------
  // Estatística
  // ---------------------------------------------------------------------------

  function estatistica(valores) {
    const n = valores.length;
    if (!n) return null;
    const soma = valores.reduce(function (s, v) { return s + v; }, 0);
    const media = soma / n;
    const variancia = n > 1 ? valores.reduce(function (s, v) { return s + (v - media) * (v - media); }, 0) / (n - 1) : 0;
    const desvio = Math.sqrt(variancia);
    const ord = valores.slice().sort(function (a, b) { return a - b; });
    // Uniformidade: média dos 10% maiores ÷ média dos 10% menores (mín. 1 unidade).
    const k = Math.max(1, Math.round(n * 0.1));
    const mediaDe = function (arr) { return arr.reduce(function (s, v) { return s + v; }, 0) / arr.length; };
    const menores = mediaDe(ord.slice(0, k));
    const maiores = mediaDe(ord.slice(n - k));
    return {
      n: n,
      media: media,
      desvio: desvio,
      min: ord[0],
      max: ord[n - 1],
      cv: media > 0 ? (desvio / media) * 100 : 0,
      uniformidade: menores > 0 ? maiores / menores : null,
      unidadesUniformidade: k,
      pcKg: 1000 / media,
      pcLb: G_POR_LB / media,
    };
  }

  // ---------------------------------------------------------------------------
  // Validações e entrada
  // ---------------------------------------------------------------------------

  // Converte "12,5" ou "12.5" em número; retorna NaN se inválido.
  function lerNumero(texto) {
    if (typeof texto === 'number') return texto;
    const s = String(texto == null ? '' : texto).trim().replace(/\s/g, '').replace(',', '.');
    if (!/^\d*\.?\d+$|^\d+\.$/.test(s)) return NaN;
    return parseFloat(s);
  }

  // Rejeita peso ≤ 0 ou ≥ 1.000 g.
  function validarPeso(valor) {
    const v = lerNumero(valor);
    if (!isFinite(v)) return { ok: false, erro: 'Digite um peso válido em gramas.' };
    if (v <= 0) return { ok: false, erro: 'O peso deve ser maior que 0 g.' };
    if (v >= PESO_MAX) return { ok: false, erro: 'Peso de 1.000 g ou mais não é de uma unidade. Confira a balança.' };
    return { ok: true, valor: v };
  }

  function validarConfig(cfg) {
    const erros = [];
    if (!ESPECIES[cfg.especie]) erros.push('Escolha o tipo de camarão.');
    if (!APRESENTACOES[cfg.apresentacao]) erros.push('Escolha a apresentação.');
    if (!CONDICOES[cfg.condicao]) erros.push('Escolha a condição.');
    const d = Number(cfg.pesoDeclarado);
    if (!isFinite(d) || d <= 0) erros.push('Informe o peso líquido declarado da embalagem.');
    if (cfg.condicao === 'glaciado') {
      const g = Number(cfg.glaciamento);
      if (!isFinite(g) || g < 0) erros.push('Informe o glaciamento em %.');
      if (!EMBALAGENS[cfg.embalagem]) erros.push('Escolha embalagem compensada ou não compensada.');
    }
    return erros;
  }

  // ---------------------------------------------------------------------------
  // Formatação pt-BR
  // ---------------------------------------------------------------------------

  function fmt(x, casas) {
    if (x == null || !isFinite(x)) return '—';
    casas = casas == null ? 1 : casas;
    const neg = x < 0;
    const fixo = Math.abs(x).toFixed(casas);
    const partes = fixo.split('.');
    const inteira = partes[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return (neg ? '-' : '') + inteira + (partes[1] ? ',' + partes[1] : '');
  }

  // Formata um número removendo zeros finais desnecessários ("12,50" → "12,5").
  function fmtCurto(x, casasMax) {
    if (x == null || !isFinite(x)) return '—';
    const s = fmt(x, casasMax == null ? 2 : casasMax);
    return s.indexOf(',') >= 0 ? s.replace(/0+$/, '').replace(/,$/, '') : s;
  }

  // Peso de embalagem: 1000 → "1 kg", 400 → "400 g", 869,57 → "869,6 g".
  function fmtEmbalagem(g) {
    if (g >= 1000 && Math.abs(g % 1000) < 1e-9) return fmt(g / 1000, 0) + ' kg';
    return fmtCurto(g, 1) + ' g';
  }

  // Faixa de peso em g por peça: tabela própria em inteiros, geral com 2 casas.
  function fmtFaixaPeso(tabela, faixa) {
    const casas = tabela.tipo === 'g' ? 0 : 2;
    return fmt(faixa[0], casas) + '–' + fmt(faixa[1], casas) + ' g';
  }

  function fmtFaixaPecas(fp) {
    return fp.min + '–' + fp.max + ' pç';
  }

  // "2026-10-09" → "09/10/2026"
  function fmtData(iso) {
    if (!iso) return '';
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    if (m) return m[3] + '/' + m[2] + '/' + m[1];
    const d = new Date(iso);
    if (isNaN(d)) return String(iso);
    return pad2(d.getDate()) + '/' + pad2(d.getMonth() + 1) + '/' + d.getFullYear();
  }

  function fmtDataHora(ms) {
    const d = new Date(ms);
    if (isNaN(d)) return '';
    return pad2(d.getDate()) + '/' + pad2(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function rotuloClasse(tabela, classe) {
    return classe.rotulo + (tabela.unidade ? ' ' + tabela.unidade : '');
  }

  function descreverCondicao(cfg) {
    if (cfg.condicao !== 'glaciado') return CONDICOES[cfg.condicao] || '';
    return CONDICOES.glaciado + ' ' + fmtCurto(Number(cfg.glaciamento), 1) + '% (' + (EMBALAGENS[cfg.embalagem] || '').toLowerCase() + ')';
  }

  function descreverProduto(cfg) {
    const e = ESPECIES[cfg.especie];
    return 'Camarão ' + (e ? e.nome.toLowerCase() + ' (' + e.cientifico + ')' : '') + ', ' +
      (APRESENTACOES[cfg.apresentacao] || '').toLowerCase() + ', ' + descreverCondicao(cfg).toLowerCase();
  }

  function descreverTabela(tabela) {
    return tabela.nome + ' — ' + tabela.bloco;
  }

  // ---------------------------------------------------------------------------
  // Avisos contextuais da tela Produto
  // ---------------------------------------------------------------------------

  function avisosContexto(cfg) {
    const avisos = [];
    if (!ESPECIES[cfg.especie] || !APRESENTACOES[cfg.apresentacao]) return avisos;
    const tabela = selecionarTabela(cfg.especie, cfg.apresentacao);
    let usada = 'Tabela usada: ' + descreverTabela(tabela) + (tabela.unidade ? ' (classes em ' + tabela.unidade + ').' : ' (classes sem unidade).');
    if (tabela.tipo === 'pecas1kg') usada += ' Faixa de peso = 1.000 g ÷ peças da coluna de 1 kg.';
    else usada += ' Faixas em gramas por peça.';
    avisos.push({ status: 'info', texto: usada });
    tabela.avisos.forEach(function (t) { avisos.push({ status: 'atencao', texto: t }); });

    if (cfg.condicao === 'glaciado') {
      const g = Number(cfg.glaciamento) || 0;
      avisos.push({
        status: 'info',
        texto: 'Glaciamento: peso líquido da peça = peso pesado ÷ (1 + ' + fmtCurto(g, 1) + '%). ' +
          'A água de glaciamento não compõe o peso líquido (IN SDA/MAPA nº 23/2019, art. 4º).',
      });
      if (g > LIMITE_GLACIAMENTO) {
        avisos.push({ status: 'critico', texto: 'Glaciamento de ' + fmtCurto(g, 1) + '% acima do limite legal de ' + LIMITE_GLACIAMENTO + '% do peso líquido declarado.' });
      }
      const emb = infoEmbalagem(cfg);
      if (isFinite(emb.declarado) && emb.declarado > 0) {
        if (emb.compensada) {
          avisos.push({ status: 'ok', texto: 'Embalagem compensada: envasar ' + fmtEmbalagem(emb.brutoEnvasar) + ' brutos para ' + fmtEmbalagem(emb.declarado) + ' líquidos declarados.' });
        } else {
          avisos.push({
            status: 'critico',
            texto: 'Embalagem não compensada: o pacote tem só ' + fmtEmbalagem(emb.liquido) + ' de camarão. Declarar ' + fmtEmbalagem(emb.declarado) +
              ' como peso líquido incluiria a água de glaciamento, o que a IN 23/2019 não permite.',
          });
        }
      }
      if (tabela.temCongelado) {
        avisos.push({ status: 'info', texto: 'A média do peso pesado também será conferida com a coluna "congelado" da Tabela Frescatto.' });
      }
    } else if (cfg.condicao === 'congelado') {
      avisos.push({ status: 'info', texto: 'Congelado sem glaciamento: o peso pesado é usado direto como peso líquido.' });
    }
    return avisos;
  }

  // ---------------------------------------------------------------------------
  // Avaliação completa de um lote
  // ---------------------------------------------------------------------------

  /**
   * cfg: { especie, apresentacao, condicao, glaciamento, embalagem, pesoDeclarado }
   * pesos: pesos pesados (g) de cada unidade, na ordem da pesagem.
   */
  function avaliar(cfg, pesos) {
    const tabela = selecionarTabela(cfg.especie, cfg.apresentacao);
    const emb = infoEmbalagem(cfg);
    const unidades = (pesos || []).map(function (pesado, i) {
      const liquido = pesoLiquidoPeca(pesado, cfg);
      const c = classificarPeso(tabela, liquido);
      return {
        n: i + 1,
        pesado: pesado,
        liquido: liquido,
        classe: c.classe.rotulo,
        indice: c.indice,
        situacao: c.situacao,
        posicao: c.posicao,
      };
    });

    const base = { cfg: cfg, tabela: tabela, embalagem: emb, unidades: unidades, n: unidades.length };
    if (!unidades.length) return base;

    const liquidos = unidades.map(function (u) { return u.liquido; });
    const est = estatistica(liquidos);
    const lote = classificarPeso(tabela, est.media); // 3.3.5 classe do lote = classe da média
    const faixaPecas = faixaPecasEmbalagem(lote.classe, emb.liquido);

    // Distribuição por classe (unidades dentro ou na tolerância contam na classe).
    const distribuicao = tabela.classes.map(function (classe, i) {
      const qtd = unidades.filter(function (u) { return u.situacao !== 'fora' && u.indice === i; }).length;
      return {
        classe: classe.rotulo,
        indice: i,
        faixaPeso: classe.faixaG,
        faixaPecas: faixaPecasEmbalagem(classe, emb.liquido),
        qtd: qtd,
        pct: (qtd / unidades.length) * 100,
        doLote: i === lote.indice && lote.situacao !== 'fora',
      };
    });
    const foraUnid = unidades.filter(function (u) { return u.situacao === 'fora'; });
    const fora = { qtd: foraUnid.length, pct: (foraUnid.length / unidades.length) * 100 };

    const naClasse = lote.situacao === 'fora' ? 0 : distribuicao[lote.indice].qtd;
    const pctNaClasse = (naClasse / unidades.length) * 100;

    // Classe com mais unidades (empate: a da média, se estiver entre as maiores).
    let moda = null;
    distribuicao.forEach(function (d) {
      if (d.qtd > 0 && (!moda || d.qtd > moda.qtd || (d.qtd === moda.qtd && d.doLote))) moda = d;
    });

    // Rosa com tabela própria e glaciado: média do peso pesado x coluna "congelado".
    let conferenciaCongelado = null;
    if (cfg.condicao === 'glaciado' && tabela.temCongelado) {
      const tabCong = {
        tipo: 'g',
        tolerancia: TOL_G,
        classes: tabela.classes.map(function (c) { return { rotulo: c.rotulo, faixaG: c.faixaCong }; }),
      };
      const mediaPesado = unidades.reduce(function (s, u) { return s + u.pesado; }, 0) / unidades.length;
      const cc = classificarPeso(tabCong, mediaPesado);
      conferenciaCongelado = {
        mediaPesado: mediaPesado,
        classe: cc.classe.rotulo,
        situacao: cc.situacao,
        posicao: cc.posicao,
        faixa: cc.classe.faixaG,
        igual: cc.situacao !== 'fora' && cc.classe.rotulo === lote.classe.rotulo && lote.situacao !== 'fora',
      };
    }

    const r = Object.assign(base, {
      estatistica: est,
      lote: lote,
      classeLote: lote.classe,
      faixaPeso: lote.classe.faixaG,
      faixaPecas: faixaPecas,
      distribuicao: distribuicao,
      fora: fora,
      naClasse: naClasse,
      pctNaClasse: pctNaClasse,
      moda: moda,
      conferenciaCongelado: conferenciaCongelado,
    });
    r.analise = analisar(r);
    return r;
  }

  // Texto do destaque (a): classificação do lote.
  function textoClasse(r) {
    const t = rotuloClasse(r.tabela, r.lote.classe);
    if (r.lote.situacao === 'fora') return 'Fora da tabela (' + r.lote.posicao + ' de ' + t + ')';
    return t;
  }

  // ---------------------------------------------------------------------------
  // 3.6 Análise automática (frases curtas com status ok/atencao/critico)
  // ---------------------------------------------------------------------------

  function analisar(r) {
    const a = [];
    const t = r.tabela;
    const est = r.estatistica;
    const lote = r.lote;
    const rot = rotuloClasse(t, lote.classe);
    const faixa = fmtFaixaPeso(t, lote.classe.faixaG);
    const tol = t.tipo === 'g' ? '±0,5 g' : '±0,5 peça na coluna de 1 kg';

    // Enquadramento da média.
    if (lote.situacao === 'dentro') {
      a.push({ status: 'ok', texto: 'Média de ' + fmt(est.media, 2) + ' g/pç enquadra na classe ' + rot + ' (faixa ' + faixa + ').' });
    } else if (lote.situacao === 'tolerancia') {
      a.push({ status: 'atencao', texto: 'Média de ' + fmt(est.media, 2) + ' g/pç enquadra na classe ' + rot + ' só pela tolerância de arredondamento (' + tol + '; faixa ' + faixa + ').' });
    } else {
      a.push({ status: 'critico', texto: 'Média de ' + fmt(est.media, 2) + ' g/pç fora da tabela, ' + lote.posicao + ' da classe mais próxima ' + rot + ' (faixa ' + faixa + ').' });
    }

    // Faixas sobrepostas.
    if (lote.outras.length) {
      a.push({ status: 'atencao', texto: 'Faixas sobrepostas: a média também cabe em ' + lote.outras.join(', ') + '. Prevaleceu ' + lote.classe.rotulo + ' por ter a faixa mais estreita.' });
    }

    // % de unidades dentro da classe do lote.
    const pct = r.pctNaClasse;
    const st = pct >= 80 ? 'ok' : pct >= 60 ? 'atencao' : 'critico';
    let txt = fmt(pct, 0) + '% das unidades (' + r.naClasse + ' de ' + r.n + ') dentro da classe ' + (lote.situacao === 'fora' ? 'do lote' : lote.classe.rotulo) + '.';
    if (r.fora.qtd) txt += ' ' + r.fora.qtd + (r.fora.qtd === 1 ? ' unidade fora' : ' unidades fora') + ' da tabela.';
    a.push({ status: st, texto: txt });

    // Dispersão: classe com mais unidades ≠ classe pela média.
    if (r.moda && !r.moda.doLote) {
      a.push({ status: 'atencao', texto: 'A classe com mais unidades (' + r.moda.classe + ', ' + r.moda.qtd + ' un.) difere da classe pela média: lote com dispersão, avaliar regraduação.' });
    }

    // Compatibilidade da gramatura média com a faixa de peças da embalagem.
    const fp = r.faixaPecas;
    const estimadas = r.embalagem.liquido / est.media;
    const origem = fp.proporcional ? ' (proporcional à coluna de ' + fmtEmbalagem(fp.coluna) + ')' : '';
    const embTxt = fmtEmbalagem(r.embalagem.liquido) + (r.embalagem.compensada ? '' : ' líquidos reais');
    if (estimadas >= fp.min - 0.5 && estimadas <= fp.max + 0.5) {
      a.push({ status: 'ok', texto: 'Gramatura média compatível com ' + fmtFaixaPecas(fp) + ' em ' + embTxt + origem + ': cerca de ' + fmt(estimadas, 0) + ' pç.' });
    } else {
      a.push({ status: 'atencao', texto: 'Gramatura média daria cerca de ' + fmt(estimadas, 0) + ' pç em ' + embTxt + ', fora da faixa ' + fmtFaixaPecas(fp) + origem + '.' });
    }

    // Produto glaciado: limite legal, compensação e coluna congelado.
    if (r.cfg.condicao === 'glaciado') {
      const g = Number(r.cfg.glaciamento) || 0;
      if (g > LIMITE_GLACIAMENTO) {
        a.push({ status: 'critico', texto: 'Glaciamento de ' + fmtCurto(g, 1) + '% acima do limite de ' + LIMITE_GLACIAMENTO + '% do peso líquido declarado (IN SDA/MAPA nº 23/2019, art. 4º).' });
      } else {
        a.push({ status: 'ok', texto: 'Glaciamento de ' + fmtCurto(g, 1) + '% dentro do limite legal de ' + LIMITE_GLACIAMENTO + '% (IN SDA/MAPA nº 23/2019, art. 4º).' });
      }
      const e = r.embalagem;
      if (e.compensada) {
        a.push({ status: 'ok', texto: 'Embalagem compensada: envasar ' + fmtEmbalagem(e.brutoEnvasar) + ' brutos para ' + fmtEmbalagem(e.declarado) + ' líquidos.' });
      } else {
        a.push({
          status: 'critico',
          texto: 'Declarar ' + fmtEmbalagem(e.declarado) + ' como peso líquido incluiria a água de glaciamento, o que a IN 23/2019 não permite. ' +
            'Peso líquido real: ' + fmtEmbalagem(e.liquido) + '. Para compensar, envasar ' + fmtEmbalagem(e.brutoEnvasar) + ' brutos.',
        });
      }
      const cc = r.conferenciaCongelado;
      if (cc) {
        const base = 'Média do peso pesado (' + fmt(cc.mediaPesado, 2) + ' g) na coluna "congelado": ';
        if (cc.situacao === 'fora') {
          a.push({ status: 'atencao', texto: base + 'fora da tabela, ' + cc.posicao + ' de ' + cc.classe + '. Classe pelo peso líquido: ' + lote.classe.rotulo + '.' });
        } else if (cc.igual) {
          a.push({ status: 'ok', texto: base + 'classe ' + cc.classe + ', igual à do peso líquido.' });
        } else {
          a.push({ status: 'atencao', texto: base + 'classe ' + cc.classe + ', diferente da classe pelo peso líquido (' + lote.classe.rotulo + '). Conferir o glaciamento informado.' });
        }
      }
    }
    return a;
  }

  // ---------------------------------------------------------------------------
  // 3.7 Saídas: resumo em texto e CSV
  // ---------------------------------------------------------------------------

  const ICONE_STATUS = { ok: '✅', atencao: '⚠️', critico: '⛔', info: 'ℹ️' };

  /**
   * ident: { codigo, data (aaaa-mm-dd), lote, tecnico, local }
   */
  function resumoTexto(r, ident) {
    ident = ident || {};
    const L = [];
    L.push('CLASSIFICAÇÃO DE CAMARÃO — Frescatto P&D');
    const id = [];
    if (ident.codigo) id.push('Ensaio ' + ident.codigo);
    if (ident.data) id.push(fmtData(ident.data));
    if (ident.lote) id.push('Lote/NF ' + ident.lote);
    if (id.length) L.push(id.join(' · '));
    const quem = [];
    if (ident.tecnico) quem.push('Técnico: ' + ident.tecnico);
    if (ident.local) quem.push('Local: ' + ident.local);
    if (quem.length) L.push(quem.join(' · '));
    L.push('Produto: ' + descreverProduto(r.cfg));
    L.push('Embalagem: ' + fmtEmbalagem(r.embalagem.declarado) + ' líquido declarado' +
      (r.embalagem.glaciado ? (r.embalagem.compensada ? ' (envasar ' + fmtEmbalagem(r.embalagem.brutoEnvasar) + ' brutos)' : ' (líquido real ' + fmtEmbalagem(r.embalagem.liquido) + ')') : ''));
    L.push('Tabela: ' + descreverTabela(r.tabela));
    L.push('');
    if (!r.n) {
      L.push('Nenhuma unidade pesada.');
      return L.join('\n');
    }
    L.push('(a) Classificação: ' + textoClasse(r));
    L.push('(b) Faixa de peso: ' + fmtFaixaPeso(r.tabela, r.faixaPeso) + ' por peça');
    L.push('(c) Peças na embalagem: ' + fmtFaixaPecas(r.faixaPecas) + ' em ' + fmtEmbalagem(r.embalagem.liquido) +
      (r.faixaPecas.proporcional ? ' (proporcional à coluna de ' + fmtEmbalagem(r.faixaPecas.coluna) + ')' : ''));
    L.push('');
    L.push('ANÁLISE');
    r.analise.forEach(function (x) { L.push(ICONE_STATUS[x.status] + ' ' + x.texto); });
    L.push('');
    const e = r.estatistica;
    L.push('ESTATÍSTICA (peso líquido, n = ' + e.n + ')');
    L.push('Média ± DP: ' + fmt(e.media, 2) + ' ± ' + fmt(e.desvio, 2) + ' g');
    L.push('Mín.–máx.: ' + fmt(e.min, 2) + '–' + fmt(e.max, 2) + ' g · CV ' + fmt(e.cv, 1) + '%');
    L.push('Uniformidade: ' + fmt(e.uniformidade, 2) + ' · ' + fmt(e.pcKg, 1) + ' pç/kg · ' + fmt(e.pcLb, 1) + ' pç/lb');
    L.push('Na classe do lote: ' + fmt(r.pctNaClasse, 0) + '%');
    L.push('');
    L.push('DISTRIBUIÇÃO POR CLASSE');
    r.distribuicao.forEach(function (d) {
      if (!d.qtd && !d.doLote) return;
      L.push((d.doLote ? '▶ ' : '  ') + d.classe + ': ' + d.qtd + ' un. (' + fmt(d.pct, 0) + '%)');
    });
    if (r.fora.qtd) L.push('  Fora da tabela: ' + r.fora.qtd + ' un. (' + fmt(r.fora.pct, 0) + '%)');
    return L.join('\n');
  }

  const CSV_COLUNAS = ['codigo', 'data', 'lote', 'especie', 'apresentacao', 'condicao', 'unidade', 'peso_pesado_g', 'peso_liquido_g', 'classe', 'status'];

  function csvCampo(v) {
    const s = String(v == null ? '' : v);
    return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function linhasCsv(r, ident) {
    ident = ident || {};
    return r.unidades.map(function (u) {
      const status = u.situacao === 'fora' ? 'fora_' + u.posicao : u.situacao;
      return [
        ident.codigo || '',
        fmtData(ident.data),
        ident.lote || '',
        ESPECIES[r.cfg.especie].nome,
        APRESENTACOES[r.cfg.apresentacao],
        descreverCondicao(r.cfg),
        u.n,
        fmt(u.pesado, 2),
        fmt(u.liquido, 2),
        u.situacao === 'fora' ? 'fora (' + u.classe + ')' : u.classe,
        status,
      ].map(csvCampo).join(';');
    });
  }

  /**
   * Gera CSV (separador ";", BOM UTF-8) de uma ou mais avaliações salvas.
   * itens: [{ ident, cfg, pesos }]
   */
  function gerarCsv(itens) {
    const linhas = [CSV_COLUNAS.join(';')];
    itens.forEach(function (it) {
      Array.prototype.push.apply(linhas, linhasCsv(avaliar(it.cfg, it.pesos), it.ident));
    });
    return '﻿' + linhas.join('\r\n') + '\r\n';
  }

  // ---------------------------------------------------------------------------
  // Achados das tabelas: vãos e sobreposições (para o relatório de testes)
  // ---------------------------------------------------------------------------

  function achadosTabelas() {
    const achados = [];
    Object.keys(TABELAS).forEach(function (id) {
      const t = TABELAS[id];
      const ref = descreverTabela(t);
      t.avisos.forEach(function (av) { achados.push({ tabela: ref, tipo: 'aviso', detalhe: av }); });

      // Faixas de peso: compara cada par de classes.
      for (let i = 0; i < t.classes.length; i++) {
        for (let j = i + 1; j < t.classes.length; j++) {
          const a = t.classes[i].faixaG, b = t.classes[j].faixaG;
          const ini = Math.max(a[0], b[0]), fim = Math.min(a[1], b[1]);
          if (fim > ini + EPS) {
            achados.push({ tabela: ref, tipo: 'sobreposição de peso', detalhe: t.classes[i].rotulo + ' e ' + t.classes[j].rotulo + ' se sobrepõem em ' + fmt(ini, 2) + '–' + fmt(fim, 2) + ' g (vale a faixa mais estreita).' });
          } else if (Math.abs(fim - ini) <= EPS && t.tipo === 'g') {
            // Na tabela geral, classes contíguas compartilham o limite por construção; só se registra na própria.
            achados.push({ tabela: ref, tipo: 'limite compartilhado', detalhe: t.classes[i].rotulo + ' e ' + t.classes[j].rotulo + ' compartilham o limite ' + fmt(ini, 2) + ' g (vale a faixa mais estreita).' });
          }
        }
      }
      // Vãos entre classes vizinhas (ordenadas por peso).
      const ord = t.classes.slice().sort(function (a, b) { return a.faixaG[0] - b.faixaG[0]; });
      let maxAte = -Infinity, maxRot = null;
      ord.forEach(function (c) {
        if (maxRot && c.faixaG[0] > maxAte + EPS) {
          const vao = c.faixaG[0] - maxAte;
          const coberto = t.tipo === 'g' ? vao <= 2 * TOL_G + EPS : (1000 / maxAte - 1000 / c.faixaG[0]) <= 2 * TOL_PC + EPS;
          achados.push({
            tabela: ref,
            tipo: coberto ? 'vão coberto pela tolerância' : 'vão sem classe',
            detalhe: 'Entre ' + maxRot + ' e ' + c.rotulo + ': ' + fmt(maxAte, 2) + '–' + fmt(c.faixaG[0], 2) + ' g' +
              (coberto ? ' (coberto pela tolerância de arredondamento).' : ' (peças nesse intervalo ficam fora da tabela).'),
          });
        }
        if (c.faixaG[1] > maxAte) { maxAte = c.faixaG[1]; maxRot = c.rotulo; }
      });

      // Colunas de embalagem: proporcionalidade com a coluna de 1 kg e
      // vãos/sobreposições de peças entre classes vizinhas (só tabela geral).
      if (t.tipo === 'pecas1kg') {
        COLUNAS_GERAL.forEach(function (col) {
          if (col === 1000) return;
          t.classes.forEach(function (c) {
            const r = c.pecas[col], b = c.pecas[1000], k = col / 1000;
            const esp = [b[0] * k, b[1] * k];
            const desvio = Math.max(Math.abs(r[0] - esp[0]), Math.abs(r[1] - esp[1]));
            if (desvio > Math.max(2, 0.10 * esp[1])) {
              achados.push({ tabela: ref, tipo: 'coluna fora de proporção', detalhe: 'Classe ' + c.rotulo + ', coluna ' + fmtEmbalagem(col) + ': ' + r[0] + '–' + r[1] + ' pç; proporcional à de 1 kg seria ' + fmt(esp[0], 0) + '–' + fmt(esp[1], 0) + ' pç.' });
            }
          });
          // Classes vizinhas na ordem da tabela (exceto as faixas "largas" que já se sobrepõem no peso).
          for (let i = 0; i + 1 < t.classes.length; i++) {
            const a = t.classes[i], b = t.classes[i + 1];
            if (b.pc1kg[0] < a.pc1kg[1]) continue; // sobreposição já prevista na coluna de 1 kg
            const ra = a.pecas[col], rb = b.pecas[col];
            if (rb[0] < ra[1]) {
              achados.push({ tabela: ref, tipo: 'sobreposição na coluna', detalhe: 'Coluna ' + fmtEmbalagem(col) + ': ' + a.rotulo + ' (' + ra[0] + '–' + ra[1] + ') e ' + b.rotulo + ' (' + rb[0] + '–' + rb[1] + ') se sobrepõem.' });
            } else if (rb[0] > ra[1] + 1) {
              achados.push({ tabela: ref, tipo: 'vão na coluna', detalhe: 'Coluna ' + fmtEmbalagem(col) + ': entre ' + a.rotulo + ' (até ' + ra[1] + ') e ' + b.rotulo + ' (desde ' + rb[0] + ') faltam ' + (ra[1] + 1) + '–' + (rb[0] - 1) + ' pç.' });
            }
          }
        });
      }
    });
    return achados;
  }

  return {
    VERSAO_MOTOR: '1.0.0',
    ESPECIES: ESPECIES,
    APRESENTACOES: APRESENTACOES,
    CONDICOES: CONDICOES,
    EMBALAGENS: EMBALAGENS,
    ATALHOS_EMBALAGEM: ATALHOS_EMBALAGEM,
    LIMITE_GLACIAMENTO: LIMITE_GLACIAMENTO,
    PASSO_GLACIAMENTO: PASSO_GLACIAMENTO,
    PESO_MAX: PESO_MAX,
    COLUNAS_GERAL: COLUNAS_GERAL,
    TABELAS: TABELAS,
    selecionarTabela: selecionarTabela,
    classificarPeso: classificarPeso,
    contem: contem,
    larguraFaixa: larguraFaixa,
    pesoLiquidoPeca: pesoLiquidoPeca,
    infoEmbalagem: infoEmbalagem,
    faixaPecasEmbalagem: faixaPecasEmbalagem,
    estatistica: estatistica,
    lerNumero: lerNumero,
    validarPeso: validarPeso,
    validarConfig: validarConfig,
    avaliar: avaliar,
    textoClasse: textoClasse,
    rotuloClasse: rotuloClasse,
    avisosContexto: avisosContexto,
    resumoTexto: resumoTexto,
    gerarCsv: gerarCsv,
    achadosTabelas: achadosTabelas,
    fmt: fmt,
    fmtCurto: fmtCurto,
    fmtEmbalagem: fmtEmbalagem,
    fmtFaixaPeso: fmtFaixaPeso,
    fmtFaixaPecas: fmtFaixaPecas,
    fmtData: fmtData,
    fmtDataHora: fmtDataHora,
    descreverProduto: descreverProduto,
    descreverCondicao: descreverCondicao,
    descreverTabela: descreverTabela,
  };
});
