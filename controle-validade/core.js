/*
 * core.js — Núcleo do Validade em Dia (sem DOM): cálculo da validade, situação
 * de cada etiqueta, baixas, relatório de perdas, exportação e dados de exemplo.
 * Funciona no navegador (window.Nucleo) e no Node (testes).
 *
 * Tudo fica num único objeto D, guardado no aparelho (localStorage, chave CHAVE):
 *   D.config     nome da casa, dias de alerta, regra de contagem, tamanho da etiqueta, locais, equipe
 *   D.produtos   catálogo: { id, nome, grupo, validades: { resfriado|congelado|descongelado|ambiente: { n, un } } }
 *   D.etiquetas  cada etiqueta emitida: produto (cópia do nome), modo, local, responsável,
 *                feitoEm, venceEm, status ('ativa' | 'usada' | 'descartada') e dados da baixa
 * Datas e horas são guardadas em milissegundos (hora do aparelho).
 */
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.Nucleo = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CHAVE = 'validade_em_dia_v1';
  const HORA = 3600e3;
  const DIA = 24 * HORA;
  const SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  const MAX_COPIAS = 50;

  const MODOS = [
    { id: 'resfriado', nome: 'Resfriado', faixa: 'até 4 °C' },
    { id: 'congelado', nome: 'Congelado', faixa: '−18 °C ou menos' },
    { id: 'descongelado', nome: 'Descongelado', faixa: 'até 4 °C, não recongelar' },
    { id: 'ambiente', nome: 'Ambiente', faixa: 'local seco e arejado' },
  ];
  const MODO = {};
  MODOS.forEach((m) => { MODO[m.id] = m; });

  // Da mais urgente para a menos urgente: é a ordem do painel.
  const SITUACOES = [
    { id: 'vencido', nome: 'Vencidos' },
    { id: 'hoje', nome: 'Vencem hoje' },
    { id: 'breve', nome: 'Vencem em breve' },
    { id: 'ok', nome: 'No prazo' },
  ];

  const MOTIVOS = ['Vencido', 'Sobra de produção', 'Embalagem danificada', 'Aparência ou cheiro', 'Outro'];

  // Largura × altura do rolo, em milímetros.
  const TAMANHOS = {
    '60x40': { l: 60, a: 40, nome: '60 × 40 mm' },
    '50x30': { l: 50, a: 30, nome: '50 × 30 mm' },
    '100x50': { l: 100, a: 50, nome: '100 × 50 mm' },
  };

  // ---------- datas ----------
  const d2 = (n) => String(n).padStart(2, '0');
  const inicioDoDia = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const fimDoDia = (ms) => { const d = new Date(ms); d.setHours(23, 59, 59, 999); return d.getTime(); };
  const somarDias = (ms, n) => { const d = new Date(ms); d.setDate(d.getDate() + n); return d.getTime(); };
  // Dias de calendário de a até b (o arredondamento absorve a hora a mais ou a menos do horário de verão).
  const diasEntre = (a, b) => Math.round((inicioDoDia(b) - inicioDoDia(a)) / DIA);
  const dataIso = (ms) => { const d = new Date(ms); return d.getFullYear() + '-' + d2(d.getMonth() + 1) + '-' + d2(d.getDate()); };
  function deIso(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
    if (!m) return null;
    const d = new Date(+m[1], +m[2] - 1, +m[3], 12);
    return d.getMonth() === +m[2] - 1 ? d.getTime() : null;
  }
  const fmtData = (ms) => { const d = new Date(ms); return d2(d.getDate()) + '/' + d2(d.getMonth() + 1); };
  const fmtDataAno = (ms) => fmtData(ms) + '/' + String(new Date(ms).getFullYear()).slice(2);
  const fmtHora = (ms) => { const d = new Date(ms); return d2(d.getHours()) + ':' + d2(d.getMinutes()); };
  const diaSemana = (ms) => SEMANA[new Date(ms).getDay()];
  const fmtCodigo = (n) => String(n).padStart(6, '0');
  function fmtValidade(v) {
    if (!v) return '';
    if (v.un === 'h') return v.n + (v.n === 1 ? ' hora' : ' horas');
    return v.n + (v.n === 1 ? ' dia' : ' dias');
  }

  // ---------- validade ----------
  /*
   * Quando vence o que foi feito em `feitoEm` com a validade { n, un }.
   *   un 'h': vence exatamente n horas depois.
   *   un 'd': vence no fim do dia, n dias depois do preparo. Com contarDiaPreparo,
   *           o dia do preparo é o 1º dia (regra mais conservadora): n − 1 dias depois.
   * A validade do fabricante (validadeOrigem, 'AAAA-MM-DD') é o teto: produto
   * aberto nunca vale mais do que a embalagem original.
   */
  function calcularValidade(o) {
    const v = o.validade;
    if (!v || !(v.n > 0)) return null;
    let porHora = v.un === 'h';
    let venceEm = porHora
      ? o.feitoEm + v.n * HORA
      : fimDoDia(somarDias(o.feitoEm, o.contarDiaPreparo ? v.n - 1 : v.n));
    let limitada = false;
    const teto = deIso(o.validadeOrigem);
    if (teto != null && fimDoDia(teto) < venceEm) {
      venceEm = fimDoDia(teto);
      limitada = true;
      porHora = false;
    }
    return { venceEm, porHora, limitada };
  }

  function situacao(venceEm, agora, alertaDias) {
    if (agora > venceEm) return 'vencido';
    const d = diasEntre(agora, venceEm);
    if (d === 0) return 'hoje';
    return d <= alertaDias ? 'breve' : 'ok';
  }

  function textoRestante(venceEm, agora, porHora) {
    if (agora > venceEm) {
      const d = diasEntre(venceEm, agora);
      if (d === 0) {
        const h = Math.floor((agora - venceEm) / HORA);
        return h < 1 ? 'venceu há menos de 1 hora' : 'venceu há ' + h + ' h';
      }
      return d === 1 ? 'venceu ontem' : 'venceu há ' + d + ' dias';
    }
    const d = diasEntre(agora, venceEm);
    if (d === 0) return porHora ? 'vence hoje às ' + fmtHora(venceEm) : 'vence hoje';
    if (d === 1) return porHora ? 'vence amanhã às ' + fmtHora(venceEm) : 'vence amanhã';
    return 'vence em ' + d + ' dias';
  }

  // ---------- dados ----------
  function vazio() {
    return {
      versao: 1,
      exemplo: false,
      seq: 0,
      seqProd: 0,
      config: {
        casa: '',
        alertaDias: 2,
        contarDiaPreparo: false,
        tamanho: '60x40',
        locais: ['Câmara fria', 'Geladeira', 'Freezer', 'Estoque seco'],
        equipe: [],
      },
      produtos: [],
      etiquetas: [],
    };
  }

  const texto = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max || 60);
  const linhas = (v) => {
    const vistos = {};
    return (Array.isArray(v) ? v : String(v || '').split('\n'))
      .map((s) => texto(s, 40))
      .filter((s) => s && !vistos[s.toLowerCase()] && (vistos[s.toLowerCase()] = true));
  };

  function limparValidade(v) {
    if (!v) return null;
    const n = Math.round(+v.n);
    if (!(n >= 1 && n <= 999)) return null;
    return { n, un: v.un === 'h' ? 'h' : 'd' };
  }

  function limparConfig(c) {
    const base = vazio().config;
    c = c || {};
    const alerta = Math.round(+c.alertaDias);
    return {
      casa: texto(c.casa, 40),
      alertaDias: alerta >= 1 && alerta <= 15 ? alerta : base.alertaDias,
      contarDiaPreparo: !!c.contarDiaPreparo,
      tamanho: TAMANHOS[c.tamanho] ? c.tamanho : base.tamanho,
      locais: linhas(c.locais),
      equipe: linhas(c.equipe),
    };
  }

  // Lê o que estava guardado (ou um backup). Devolve null se não der para aproveitar.
  function carregar(json) {
    let o;
    try { o = typeof json === 'string' ? JSON.parse(json) : json; } catch (e) { return null; }
    if (!o || typeof o !== 'object' || !Array.isArray(o.produtos) || !Array.isArray(o.etiquetas)) return null;
    const D = vazio();
    D.exemplo = !!o.exemplo;
    D.config = limparConfig(o.config);
    o.produtos.forEach((p) => {
      if (!p || !p.id || !texto(p.nome)) return;
      const validades = {};
      MODOS.forEach((m) => { const v = limparValidade(p.validades && p.validades[m.id]); if (v) validades[m.id] = v; });
      D.produtos.push({ id: String(p.id), nome: texto(p.nome), grupo: texto(p.grupo, 30) || 'Outros', validades });
    });
    o.etiquetas.forEach((e) => {
      if (!e || !(e.cod > 0) || !(e.feitoEm > 0) || !(e.venceEm > 0) || !MODO[e.modo]) return;
      const status = e.status === 'usada' || e.status === 'descartada' ? e.status : 'ativa';
      const et = {
        id: 'e' + e.cod, cod: +e.cod, produtoId: e.produtoId || '', nome: texto(e.nome) || 'Sem nome', grupo: texto(e.grupo, 30),
        modo: e.modo, local: texto(e.local, 40), responsavel: texto(e.responsavel, 40), qtd: texto(e.qtd, 20),
        feitoEm: +e.feitoEm, venceEm: +e.venceEm, porHora: !!e.porHora, limitada: !!e.limitada,
        loteOrigem: texto(e.loteOrigem, 20), validadeOrigem: deIso(e.validadeOrigem) != null ? e.validadeOrigem : '',
        status,
      };
      if (status !== 'ativa') {
        et.baixaEm = e.baixaEm > 0 ? +e.baixaEm : et.venceEm;
        et.baixaPor = texto(e.baixaPor, 40);
        et.motivo = status === 'descartada' ? (texto(e.motivo, 40) || 'Outro') : '';
      }
      D.etiquetas.push(et);
    });
    D.seq = Math.max(+o.seq || 0, D.etiquetas.reduce((m, e) => Math.max(m, e.cod), 0));
    D.seqProd = Math.max(+o.seqProd || 0, D.produtos.reduce((m, p) => Math.max(m, +String(p.id).replace(/\D/g, '') || 0), 0));
    return D;
  }

  // ---------- catálogo ----------
  // Cria ou altera um produto. Devolve { produto } ou { erro }.
  function salvarProduto(D, dados) {
    const nome = texto(dados.nome);
    if (!nome) return { erro: 'Escreva o nome do produto.' };
    const repetido = D.produtos.find((p) => p.id !== dados.id && p.nome.toLowerCase() === nome.toLowerCase());
    if (repetido) return { erro: 'Já existe um produto com esse nome.' };
    const validades = {};
    MODOS.forEach((m) => { const v = limparValidade(dados.validades && dados.validades[m.id]); if (v) validades[m.id] = v; });
    if (!Object.keys(validades).length) return { erro: 'Informe a validade em pelo menos um modo de conservação (de 1 a 999).' };
    const grupo = texto(dados.grupo, 30) || 'Outros';
    let p = dados.id && D.produtos.find((x) => x.id === dados.id);
    if (p) { p.nome = nome; p.grupo = grupo; p.validades = validades; }
    else { p = { id: 'p' + (++D.seqProd), nome, grupo, validades }; D.produtos.push(p); }
    return { produto: p };
  }

  // As etiquetas já emitidas guardam o nome do produto, então o histórico não se perde.
  function excluirProduto(D, id) {
    const i = D.produtos.findIndex((p) => p.id === id);
    if (i < 0) return false;
    D.produtos.splice(i, 1);
    return true;
  }

  const modosDoProduto = (p) => MODOS.filter((m) => p.validades[m.id]);
  const grupos = (D) => {
    const vistos = [];
    D.produtos.forEach((p) => { if (vistos.indexOf(p.grupo) < 0) vistos.push(p.grupo); });
    return vistos;
  };

  // ---------- etiquetas ----------
  // Confere o pedido e monta a etiqueta (ainda sem número). Devolve { base, copias } ou { erro }.
  function montar(D, o, agora) {
    const p = D.produtos.find((x) => x.id === o.produtoId);
    if (!p) return { erro: 'Escolha um produto.' };
    const validade = p.validades[o.modo];
    if (!validade) return { erro: 'Este produto não tem validade cadastrada para esse modo de conservação.' };
    const feitoEm = o.feitoEm || agora;
    if (feitoEm > agora + 60e3) return { erro: 'A data do preparo não pode ficar no futuro.' };
    const copias = Math.round(+o.copias || 1);
    if (!(copias >= 1 && copias <= MAX_COPIAS)) return { erro: 'O número de etiquetas vai de 1 a ' + MAX_COPIAS + '.' };
    const validadeOrigem = deIso(o.validadeOrigem) != null ? o.validadeOrigem : '';
    if (validadeOrigem && fimDoDia(deIso(validadeOrigem)) < feitoEm) {
      return { erro: 'A validade do fabricante já passou. Este produto não deve ser etiquetado.' };
    }
    const c = calcularValidade({ feitoEm, validade, contarDiaPreparo: D.config.contarDiaPreparo, validadeOrigem });
    return {
      copias,
      base: {
        produtoId: p.id, nome: p.nome, grupo: p.grupo, modo: o.modo,
        local: texto(o.local, 40), responsavel: texto(o.responsavel, 40), qtd: texto(o.qtd, 20),
        feitoEm, venceEm: c.venceEm, porHora: c.porHora, limitada: c.limitada,
        loteOrigem: texto(o.loteOrigem, 20), validadeOrigem, status: 'ativa',
      },
    };
  }

  // Registra as etiquetas (uma por cópia, cada uma com o seu número). Devolve { etiquetas } ou { erro }.
  function emitir(D, o, agora) {
    const m = montar(D, o, agora);
    if (m.erro) return m;
    const novas = [];
    for (let i = 0; i < m.copias; i++) {
      const cod = ++D.seq;
      novas.push(Object.assign({ id: 'e' + cod, cod }, m.base));
    }
    Array.prototype.push.apply(D.etiquetas, novas);
    return { etiquetas: novas };
  }

  function darBaixa(D, id, o, agora) {
    const e = D.etiquetas.find((x) => x.id === id);
    if (!e || e.status !== 'ativa') return null;
    e.status = o.tipo === 'descartada' ? 'descartada' : 'usada';
    e.baixaEm = agora;
    e.baixaPor = texto(o.por, 40);
    e.motivo = e.status === 'descartada' ? (texto(o.motivo, 40) || 'Outro') : '';
    return e;
  }

  function desfazerBaixa(D, id) {
    const e = D.etiquetas.find((x) => x.id === id);
    if (!e || e.status === 'ativa') return null;
    e.status = 'ativa';
    delete e.baixaEm; delete e.baixaPor; delete e.motivo;
    return e;
  }

  // Etiquetas ativas, da que vence primeiro para a que vence por último, com a contagem por situação.
  function painel(D, agora) {
    const contagem = { vencido: 0, hoje: 0, breve: 0, ok: 0 };
    const itens = D.etiquetas
      .filter((e) => e.status === 'ativa')
      .map((e) => ({ e, sit: situacao(e.venceEm, agora, D.config.alertaDias), resta: textoRestante(e.venceEm, agora, e.porHora) }))
      .sort((a, b) => a.e.venceEm - b.e.venceEm || a.e.cod - b.e.cod);
    itens.forEach((x) => { contagem[x.sit]++; });
    return { contagem, itens };
  }

  // Números da aba Perdas nos últimos `dias` dias (hoje incluído).
  function relatorio(D, agora, dias) {
    const desde = inicioDoDia(somarDias(agora, -(dias - 1)));
    const noPeriodo = (ms) => ms >= desde && ms <= agora;
    const baixas = D.etiquetas
      .filter((e) => e.status !== 'ativa' && noPeriodo(e.baixaEm))
      .sort((a, b) => b.baixaEm - a.baixaEm || b.cod - a.cod);
    const descartes = baixas.filter((e) => e.status === 'descartada');
    const contar = (lista, chave) => {
      const mapa = {};
      lista.forEach((e) => { mapa[e[chave]] = (mapa[e[chave]] || 0) + 1; });
      return mapa;
    };
    const porMotivoMapa = contar(descartes, 'motivo');
    const descartesPorProduto = contar(descartes, 'nome');
    const baixasPorProduto = contar(baixas, 'nome');
    const ordenar = (a, b) => b.n - a.n || a.nome.localeCompare(b.nome, 'pt-BR');
    return {
      dias,
      desde,
      emitidas: D.etiquetas.filter((e) => noPeriodo(e.feitoEm)).length,
      usadas: baixas.length - descartes.length,
      descartadas: descartes.length,
      aproveitamento: baixas.length ? Math.round((baixas.length - descartes.length) / baixas.length * 100) : null,
      porMotivo: Object.keys(porMotivoMapa).map((nome) => ({ nome, n: porMotivoMapa[nome] })).sort(ordenar),
      porProduto: Object.keys(descartesPorProduto)
        .map((nome) => ({ nome, n: descartesPorProduto[nome], total: baixasPorProduto[nome] }))
        .sort(ordenar),
      baixas,
    };
  }

  // Planilha de todas as etiquetas (separador ";", como o Excel em português espera).
  function csv(D, agora) {
    const campo = (v) => { const s = String(v == null ? '' : v); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const quando = (ms) => (ms ? fmtDataAno(ms) + ' ' + fmtHora(ms) : '');
    const SIT = { vencido: 'Ativa, vencida', hoje: 'Ativa, vence hoje', breve: 'Ativa, vence em breve', ok: 'Ativa, no prazo' };
    const cab = ['Número', 'Produto', 'Grupo', 'Conservação', 'Local', 'Quantidade', 'Responsável', 'Preparo', 'Validade',
      'Lote do fabricante', 'Validade do fabricante', 'Situação', 'Baixa', 'Motivo do descarte', 'Baixa feita por'];
    const corpo = D.etiquetas.slice().sort((a, b) => a.cod - b.cod).map((e) => [
      fmtCodigo(e.cod), e.nome, e.grupo, MODO[e.modo].nome, e.local, e.qtd, e.responsavel, quando(e.feitoEm), quando(e.venceEm),
      e.loteOrigem, e.validadeOrigem ? fmtDataAno(deIso(e.validadeOrigem)) : '',
      e.status === 'ativa' ? SIT[situacao(e.venceEm, agora, D.config.alertaDias)] : (e.status === 'usada' ? 'Usada' : 'Descartada'),
      quando(e.baixaEm), e.motivo || '', e.baixaPor || '',
    ]);
    return [cab].concat(corpo).map((l) => l.map(campo).join(';')).join('\r\n') + '\r\n';
  }

  // ---------- dados de exemplo ----------
  // Prazos ilustrativos, só para o esboço abrir preenchido. Cada casa define os seus com o responsável técnico.
  // [nome, grupo, resfriado, congelado, descongelado, ambiente]
  const CATALOGO_EXEMPLO = [
    ['Filé de tilápia porcionado', 'Pescados', '3d', '90d', '24h', ''],
    ['Camarão limpo', 'Pescados', '2d', '90d', '24h', ''],
    ['Salmão em cubos (cru)', 'Pescados', '24h', '', '', ''],
    ['Frango desfiado cozido', 'Carnes e aves', '3d', '30d', '', ''],
    ['Carne moída', 'Carnes e aves', '2d', '90d', '24h', ''],
    ['Bife de alcatra porcionado', 'Carnes e aves', '3d', '90d', '2d', ''],
    ['Molho de tomate', 'Molhos e bases', '3d', '30d', '', ''],
    ['Maionese da casa', 'Molhos e bases', '2d', '', '', ''],
    ['Caldo de legumes', 'Molhos e bases', '3d', '30d', '', ''],
    ['Vinagrete', 'Molhos e bases', '2d', '', '', ''],
    ['Alface higienizada', 'Hortifrúti', '3d', '', '', ''],
    ['Cebola picada', 'Hortifrúti', '3d', '', '', ''],
    ['Tomate em cubos', 'Hortifrúti', '2d', '', '', ''],
    ['Frutas cortadas', 'Hortifrúti', '2d', '', '', ''],
    ['Queijo muçarela fatiado', 'Laticínios e frios', '5d', '', '', ''],
    ['Presunto fatiado', 'Laticínios e frios', '3d', '', '', ''],
    ['Creme de leite (aberto)', 'Laticínios e frios', '3d', '', '', ''],
    ['Arroz branco cozido', 'Guarnições', '3d', '', '', ''],
    ['Feijão cozido', 'Guarnições', '3d', '30d', '', ''],
    ['Purê de batata', 'Guarnições', '2d', '', '', ''],
    ['Brigadeiro (massa)', 'Confeitaria', '5d', '', '', ''],
    ['Chantilly batido', 'Confeitaria', '2d', '', '', ''],
    ['Farinha de trigo (aberta)', 'Secos abertos', '', '', '', '30d'],
    ['Molho shoyu (aberto)', 'Secos abertos', '90d', '', '', '30d'],
  ];

  // Quem mais vai para o lixo no exemplo (chance de descarte); os demais ficam em 10%.
  const DESCARTE_EXEMPLO = {
    'Tomate em cubos': 0.5, 'Alface higienizada': 0.4, 'Maionese da casa': 0.35,
    'Chantilly batido': 0.35, 'Frutas cortadas': 0.3, 'Purê de batata': 0.25,
  };

  function exemplo(agora) {
    const D = vazio();
    D.exemplo = true;
    D.config.casa = 'Cozinha Modelo';
    D.config.locais = ['Câmara fria', 'Geladeira 1 · linha quente', 'Geladeira 2 · saladas', 'Freezer', 'Confeitaria', 'Estoque seco'];
    D.config.equipe = ['Ana', 'Bruno', 'Carla', 'Diego'];

    const val = (s) => { const m = /^(\d+)([dh])$/.exec(s); return m ? { n: +m[1], un: m[2] } : null; };
    CATALOGO_EXEMPLO.forEach((l) => {
      salvarProduto(D, { nome: l[0], grupo: l[1], validades: { resfriado: val(l[2]), congelado: val(l[3]), descongelado: val(l[4]), ambiente: val(l[5]) } });
    });
    const prod = (nome) => D.produtos.find((p) => p.nome === nome);

    // Sorteio sempre igual, para o exemplo (e os testes) não mudarem a cada abertura.
    let x = 7;
    const rnd = () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648;
    const ha = (dias, h, min) => {
      const d = new Date(somarDias(agora, -dias));
      d.setHours(h, min, 0, 0);
      return Math.min(d.getTime(), agora - 5 * 60e3);
    };

    const fila = [];
    const juntar = (nome, modo, local, resp, qtd, feitoEm, extra) => {
      const m = montar(D, Object.assign({ produtoId: prod(nome).id, modo, local, responsavel: resp, qtd, feitoEm }, extra), agora);
      fila.push(m.base);
      return m.base;
    };

    // Traz a baixa para o horário de cozinha (das 7h às 21h), sem sortear de novo.
    const emHorario = (ms) => {
      const d = new Date(ms);
      if (d.getHours() < 7) d.setHours(8 + Math.floor(ms / 60e3) % 13);
      else if (d.getHours() > 21) d.setHours(21);
      return d.getTime();
    };

    // Histórico: um mês de etiquetas já baixadas (usadas ou descartadas).
    const resfriados = D.produtos.filter((p) => p.validades.resfriado && p.validades.resfriado.un === 'd' && p.validades.resfriado.n <= 5);
    const LOCAL_DO_GRUPO = { 'Hortifrúti': 2, 'Laticínios e frios': 2, 'Confeitaria': 4, 'Molhos e bases': 0, 'Carnes e aves': 0 };
    for (let dia = 30; dia >= 1; dia--) {
      const quantas = 2 + Math.floor(rnd() * 4);
      for (let i = 0; i < quantas; i++) {
        const p = resfriados[Math.floor(rnd() * resfriados.length)];
        const local = D.config.locais[LOCAL_DO_GRUPO[p.grupo] != null ? LOCAL_DO_GRUPO[p.grupo] : 1];
        const e = juntar(p.nome, 'resfriado', local, D.config.equipe[Math.floor(rnd() * 4)], (1 + Math.floor(rnd() * 5)) + ' kg',
          ha(dia, 7 + Math.floor(rnd() * 9), Math.floor(rnd() * 60)));
        const quem = D.config.equipe[Math.floor(rnd() * 4)];
        if (rnd() < (DESCARTE_EXEMPLO[p.nome] || 0.1)) {
          const s = rnd();
          e.status = 'descartada';
          e.motivo = s < 0.55 ? 'Vencido' : s < 0.8 ? 'Sobra de produção' : s < 0.9 ? 'Aparência ou cheiro' : s < 0.97 ? 'Embalagem danificada' : 'Outro';
          e.baixaEm = e.motivo === 'Vencido' ? e.venceEm + (7 + rnd() * 5) * HORA : e.feitoEm + (0.3 + rnd() * 0.6) * (e.venceEm - e.feitoEm);
        } else {
          e.status = 'usada';
          e.motivo = '';
          e.baixaEm = e.feitoEm + (0.15 + rnd() * 0.75) * (e.venceEm - e.feitoEm);
        }
        e.baixaEm = Math.round(Math.min(emHorario(e.baixaEm), agora - (1 + rnd() * 90) * 60e3));
        e.baixaPor = quem;
      }
    }

    // Etiquetas ativas, cobrindo as quatro situações do painel.
    const L = D.config.locais;
    juntar('Tomate em cubos', 'resfriado', L[2], 'Carla', '1,5 kg', ha(3, 9, 30));
    juntar('Salmão em cubos (cru)', 'resfriado', L[1], 'Bruno', '800 g', agora - 27 * HORA);
    juntar('Maionese da casa', 'resfriado', L[2], 'Ana', '1 kg', ha(2, 10, 15));
    juntar('Alface higienizada', 'resfriado', L[2], 'Carla', '3 cubas', ha(3, 8, 40));
    juntar('Camarão limpo', 'descongelado', L[1], 'Bruno', '2 kg', agora - 19 * HORA);
    juntar('Frango desfiado cozido', 'resfriado', L[0], 'Ana', '4 kg', ha(2, 14, 0));
    juntar('Arroz branco cozido', 'resfriado', L[1], 'Diego', '2 cubas', ha(1, 11, 20));
    juntar('Molho de tomate', 'resfriado', L[0], 'Ana', '6 L', ha(1, 15, 45));
    juntar('Queijo muçarela fatiado', 'resfriado', L[2], 'Carla', '1 kg', ha(0, 8, 10),
      { loteOrigem: 'L2291', validadeOrigem: dataIso(somarDias(agora, 3)) });
    juntar('Brigadeiro (massa)', 'resfriado', L[4], 'Diego', '3 kg', ha(0, 9, 0));
    juntar('Caldo de legumes', 'congelado', L[3], 'Ana', '8 L', ha(26, 15, 0));
    juntar('Farinha de trigo (aberta)', 'ambiente', L[5], 'Ana', '25 kg', ha(10, 7, 30));
    juntar('Feijão cozido', 'congelado', L[3], 'Diego', '5 kg', ha(5, 13, 0));
    juntar('Carne moída', 'congelado', L[3], 'Bruno', '6 kg', ha(12, 10, 0));
    juntar('Filé de tilápia porcionado', 'congelado', L[3], 'Bruno', '10 kg', ha(20, 16, 0));

    // Os números seguem a ordem em que as etiquetas foram feitas.
    fila.sort((a, b) => a.feitoEm - b.feitoEm).forEach((e) => {
      e.cod = ++D.seq;
      e.id = 'e' + e.cod;
      D.etiquetas.push(e);
    });
    return D;
  }

  return {
    CHAVE, HORA, DIA, MAX_COPIAS, MODOS, MODO, SITUACOES, MOTIVOS, TAMANHOS,
    inicioDoDia, fimDoDia, somarDias, diasEntre, dataIso, deIso,
    fmtData, fmtDataAno, fmtHora, diaSemana, fmtCodigo, fmtValidade,
    calcularValidade, situacao, textoRestante,
    vazio, carregar, limparConfig, linhas,
    salvarProduto, excluirProduto, modosDoProduto, grupos,
    montar, emitir, darBaixa, desfazerBaixa, painel, relatorio, csv, exemplo,
  };
});
