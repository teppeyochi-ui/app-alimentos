/*
 * core.js — Núcleo do Validade em Dia (sem DOM): cálculo da validade, situação
 * de cada etiqueta, baixas, relatório de perdas, exportação e dados de exemplo.
 * Funciona no navegador (window.Nucleo) e no Node (testes).
 *
 * Tudo fica num único objeto D, guardado no aparelho (localStorage, chave CHAVE):
 *   D.config     nome da casa, dias de alerta, regra de contagem, tamanho da etiqueta, locais, equipe
 *   D.produtos   catálogo: { id, codigo, tipo, nome, grupo, validades: { resfriado|congelado|descongelado|ambiente: { n, un } } }
 *                codigo é o código da própria empresa (o que vai na cartela); tipo é mp | pp | pa
 *   D.etiquetas  cada etiqueta emitida: produto (cópia do nome, tipo e código), modo, local, responsável,
 *                feitoEm, venceEm, origens (números das etiquetas de que foi feita),
 *                status ('ativa' | 'usada' | 'descartada') e dados da baixa
 *   D.recebimentos  cada entrega: { id, n, abertoEm, fechadoEm, fornecedor, nota, responsavel, obs }.
 *                   A matéria-prima etiquetada com um recebimento aberto fica ligada a ele (recebimentoId).
 *   D.contagens     cada contagem de estoque: { id, n, abertaEm, fechadaEm, responsavel, local, tipo,
 *                   lidas (números conferidos), esperadas, conferidas, faltando, baixou }.
 * Só pode haver um recebimento ou uma contagem em aberto por vez (fechadoEm / fechadaEm igual a 0).
 * Datas e horas são guardadas em milissegundos (hora do aparelho).
 *
 * Leitor de código de barras: tudo o que o app imprime para ser lido começa com RESERVA ("ZZ"),
 * só com letras maiúsculas e números, que saem iguais em qualquer teclado:
 *   ZZ000123  etiqueta nº 123        ZZOK imprimir   ZZNAO cancelar   ZZUSO usado   ZZFORA descartar
 *   ZZQ5 quantidade   ZZC1..4 conservação   ZZM1..5 motivo do descarte   ZZP<nome> pessoa   ZZL<nome> local
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
  const VERSAO = 3;       // formato dos dados guardados
  const RESERVA = 'ZZ';   // começo dos códigos do próprio app (etiquetas e comandos)

  // Etapa do produto na casa. `data` é o nome da data que vai impressa na etiqueta.
  const TIPOS = [
    { id: 'mp', nome: 'Matéria-prima', data: 'ENTRADA' },
    { id: 'pp', nome: 'Em processo', data: 'PREPARO' },
    { id: 'pa', nome: 'Produto acabado', data: 'FABRICAÇÃO' },
  ];
  const TIPO = {};
  TIPOS.forEach((t) => { TIPO[t.id] = t; });

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
  // Motivo dado pelo app ao que a contagem de estoque não achou (não vai na cartela).
  const MOTIVO_CONTAGEM = 'Não encontrado na contagem';
  const TEMPERATURA = [-40, 60];   // faixa aceita para a temperatura de chegada, em °C

  // Largura × altura do rolo, em milímetros. Estes são os mais comuns; nos Ajustes dá para informar outro.
  const TAMANHOS = {
    '60x40': { l: 60, a: 40, nome: '60 × 40 mm' },
    '50x30': { l: 50, a: 30, nome: '50 × 30 mm' },
    '100x50': { l: 100, a: 50, nome: '100 × 50 mm' },
  };
  const LARGURA = [30, 110];   // a GC420 imprime até 104 mm de largura
  const ALTURA = [20, 300];
  // 'LxA' conferido (ou null): é assim que o tamanho fica guardado nos ajustes.
  function limparTamanho(v) {
    const m = /^(\d{2,3})x(\d{2,3})$/.exec(String(v || '').replace(/\s/g, '').toLowerCase());
    if (!m) return null;
    const l = +m[1], a = +m[2];
    return l >= LARGURA[0] && l <= LARGURA[1] && a >= ALTURA[0] && a <= ALTURA[1] ? l + 'x' + a : null;
  }
  const medidas = (tamanho) => { const m = (limparTamanho(tamanho) || '60x40').split('x'); return { l: +m[0], a: +m[1] }; };

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
      versao: VERSAO,
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
        letra: 'normal',
        som: true,
      },
      produtos: [],
      etiquetas: [],
      seqRec: 0,
      recebimentos: [],
      seqCont: 0,
      contagens: [],
    };
  }

  const texto = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max || 60);
  const linhas = (v) => {
    const vistos = {};
    return (Array.isArray(v) ? v : String(v || '').split('\n'))
      .map((s) => texto(s, 40))
      .filter((s) => s && !vistos[s.toLowerCase()] && (vistos[s.toLowerCase()] = true));
  };

  // O código da empresa: maiúsculas, sem espaços. Devolve '' se não servir para código de barras.
  function limparCodigo(v) {
    const c = String(v == null ? '' : v).replace(/\s+/g, '').toUpperCase();
    return /^[A-Z0-9._\/-]{1,20}$/.test(c) ? c : '';
  }
  const limparTipo = (v) => (TIPO[v] ? v : 'pp');
  // Lista de números de etiqueta, sem repetir (máx, se dado, corta o excesso).
  const limparNumeros = (v, max) => {
    const vistos = [];
    (Array.isArray(v) ? v : []).forEach((c) => { c = Math.round(+c); if (c > 0 && vistos.indexOf(c) < 0 && (!max || vistos.length < max)) vistos.push(c); });
    return vistos;
  };
  const limparOrigens = (v) => limparNumeros(v, 12);

  // Temperatura digitada ("3,5", "-18"): { ok, valor } com o número em °C, ou valor null se ficou em branco.
  function lerTemperatura(v) {
    if (v == null || v === '') return { ok: true, valor: null };
    const t = typeof v === 'number' ? v : parseFloat(String(v).replace(/\s|°|c/gi, '').replace(/[−–]/g, '-').replace(',', '.'));
    if (!isFinite(t) || t < TEMPERATURA[0] || t > TEMPERATURA[1] || (typeof v !== 'number' && !/^[\s+\-−–]?\s*\d+([.,]\d+)?\s*(°?\s*c)?\s*$/i.test(String(v)))) return { ok: false, valor: null };
    return { ok: true, valor: Math.round(t * 10) / 10 };
  }
  const fmtTemperatura = (t) => (t == null ? '' : String(t).replace('.', ',') + ' °C');

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
      tamanho: limparTamanho(c.tamanho) || base.tamanho,
      locais: linhas(c.locais),
      equipe: linhas(c.equipe),
      letra: c.letra === 'grande' || c.letra === 'maior' ? c.letra : 'normal',
      som: c.som !== false,
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
    (Array.isArray(o.recebimentos) ? o.recebimentos : []).forEach((r) => {
      if (!r || !(r.n > 0) || !(r.abertoEm > 0) || !texto(r.fornecedor)) return;
      D.recebimentos.push({
        id: 'r' + r.n, n: +r.n, abertoEm: +r.abertoEm, fechadoEm: r.fechadoEm > 0 ? +r.fechadoEm : 0,
        fornecedor: texto(r.fornecedor, 40), nota: texto(r.nota, 20), responsavel: texto(r.responsavel, 40), obs: texto(r.obs, 200),
      });
    });
    (Array.isArray(o.contagens) ? o.contagens : []).forEach((c) => {
      if (!c || !(c.n > 0) || !(c.abertaEm > 0)) return;
      D.contagens.push({
        id: 'c' + c.n, n: +c.n, abertaEm: +c.abertaEm, fechadaEm: c.fechadaEm > 0 ? +c.fechadaEm : 0,
        responsavel: texto(c.responsavel, 40), local: texto(c.local, 40), tipo: TIPO[c.tipo] ? c.tipo : '',
        lidas: limparNumeros(c.lidas), esperadas: Math.max(0, Math.round(+c.esperadas) || 0), conferidas: Math.max(0, Math.round(+c.conferidas) || 0),
        faltando: limparNumeros(c.faltando), baixou: !!c.baixou,
      });
    });
    // Um só em aberto por vez: se o arquivo trouxer mais de um, vale o último.
    D.recebimentos.forEach((r, i) => { if (!r.fechadoEm && i < D.recebimentos.length - 1) r.fechadoEm = r.abertoEm; });
    D.contagens.forEach((c, i) => { if (!c.fechadaEm && (i < D.contagens.length - 1 || D.recebimentos.some((r) => !r.fechadoEm))) c.fechadaEm = c.abertaEm; });
    o.produtos.forEach((p) => {
      if (!p || !p.id || !texto(p.nome)) return;
      const validades = {};
      MODOS.forEach((m) => { const v = limparValidade(p.validades && p.validades[m.id]); if (v) validades[m.id] = v; });
      const codigo = limparCodigo(p.codigo);
      const livre = codigo && codigo.indexOf(RESERVA) !== 0 && !D.produtos.some((x) => x.codigo === codigo);
      D.produtos.push({ id: String(p.id), codigo: livre ? codigo : '', tipo: limparTipo(p.tipo), nome: texto(p.nome), grupo: texto(p.grupo, 30) || 'Outros', validades });
    });
    o.etiquetas.forEach((e) => {
      if (!e || !(e.cod > 0) || !(e.feitoEm > 0) || !(e.venceEm > 0) || !MODO[e.modo]) return;
      const status = e.status === 'usada' || e.status === 'descartada' ? e.status : 'ativa';
      const et = {
        id: 'e' + e.cod, cod: +e.cod, produtoId: e.produtoId || '', codigo: limparCodigo(e.codigo), tipo: limparTipo(e.tipo),
        nome: texto(e.nome) || 'Sem nome', grupo: texto(e.grupo, 30),
        modo: e.modo, local: texto(e.local, 40), responsavel: texto(e.responsavel, 40), qtd: texto(e.qtd, 20),
        feitoEm: +e.feitoEm, venceEm: +e.venceEm, porHora: !!e.porHora, limitada: !!e.limitada,
        loteOrigem: texto(e.loteOrigem, 20), validadeOrigem: deIso(e.validadeOrigem) != null ? e.validadeOrigem : '',
        origens: limparOrigens(e.origens),
        recebimentoId: D.recebimentos.some((r) => r.id === e.recebimentoId) ? e.recebimentoId : '',
        tempChegada: lerTemperatura(e.tempChegada).valor,
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
    D.seqRec = Math.max(+o.seqRec || 0, D.recebimentos.reduce((m, r) => Math.max(m, r.n), 0));
    D.seqCont = Math.max(+o.seqCont || 0, D.contagens.reduce((m, c) => Math.max(m, c.n), 0));
    return D;
  }

  // ---------- catálogo ----------
  // Cria ou altera um produto. Devolve { produto } ou { erro }.
  function salvarProduto(D, dados) {
    const nome = texto(dados.nome);
    if (!nome) return { erro: 'Escreva o nome do produto.' };
    const repetido = D.produtos.find((p) => p.id !== dados.id && p.nome.toLowerCase() === nome.toLowerCase());
    if (repetido) return { erro: 'Já existe um produto com esse nome.' };
    const codigo = limparCodigo(dados.codigo);
    if (texto(dados.codigo) && !codigo) return { erro: 'O código aceita até 20 letras sem acento, números e os sinais - . / _' };
    if (codigo.indexOf(RESERVA) === 0) return { erro: 'Códigos que começam com ' + RESERVA + ' são do próprio app (etiquetas e comandos). Use outro começo.' };
    const mesmoCodigo = codigo && D.produtos.find((p) => p.id !== dados.id && p.codigo === codigo);
    if (mesmoCodigo) return { erro: 'O código ' + codigo + ' já é de ' + mesmoCodigo.nome + '.' };
    const tipo = limparTipo(dados.tipo);
    const validades = {};
    MODOS.forEach((m) => { const v = limparValidade(dados.validades && dados.validades[m.id]); if (v) validades[m.id] = v; });
    if (!Object.keys(validades).length) return { erro: 'Informe a validade em pelo menos um modo de conservação (de 1 a 999).' };
    const grupo = texto(dados.grupo, 30) || 'Outros';
    let p = dados.id && D.produtos.find((x) => x.id === dados.id);
    if (p) { p.codigo = codigo; p.tipo = tipo; p.nome = nome; p.grupo = grupo; p.validades = validades; }
    else { p = { id: 'p' + (++D.seqProd), codigo, tipo, nome, grupo, validades }; D.produtos.push(p); }
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
    if (contagemAberta(D)) return { erro: 'Há uma contagem de estoque em andamento. Encerre a contagem antes de etiquetar.' };
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
    // Temperatura de chegada e recebimento são da matéria-prima.
    const temp = lerTemperatura(p.tipo === 'mp' ? o.tempChegada : '');
    if (!temp.ok) return { erro: 'A temperatura de chegada é um número entre ' + TEMPERATURA[0] + ' e ' + TEMPERATURA[1] + ' °C (por exemplo 3,5 ou -18).' };
    const recebimento = p.tipo === 'mp' ? recebimentoAberto(D) : null;
    const c = calcularValidade({ feitoEm, validade, contarDiaPreparo: D.config.contarDiaPreparo, validadeOrigem });
    const origens = limparOrigens(o.origens).filter((cod) => D.etiquetas.some((e) => e.cod === cod));
    return {
      copias,
      base: {
        produtoId: p.id, codigo: p.codigo, tipo: p.tipo, nome: p.nome, grupo: p.grupo, modo: o.modo,
        local: texto(o.local, 40), responsavel: texto(o.responsavel, 40), qtd: texto(o.qtd, 20),
        feitoEm, venceEm: c.venceEm, porHora: c.porHora, limitada: c.limitada,
        loteOrigem: texto(o.loteOrigem, 20), validadeOrigem, origens,
        recebimentoId: recebimento ? recebimento.id : '', tempChegada: temp.valor, status: 'ativa',
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
      novas.push(Object.assign({ id: 'e' + cod, cod }, m.base, { origens: m.base.origens.slice() }));
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
    const cab = ['Número', 'Código', 'Produto', 'Tipo', 'Grupo', 'Conservação', 'Local', 'Quantidade', 'Responsável', 'Preparo', 'Validade',
      'Lote do fabricante', 'Validade do fabricante', 'Fornecedor', 'Nota fiscal', 'Temperatura de chegada (°C)', 'Feito com',
      'Situação', 'Baixa', 'Motivo do descarte', 'Baixa feita por'];
    const rec = (e) => D.recebimentos.find((r) => r.id === e.recebimentoId) || { fornecedor: '', nota: '' };
    const corpo = D.etiquetas.slice().sort((a, b) => a.cod - b.cod).map((e) => [
      fmtCodigo(e.cod), e.codigo, e.nome, TIPO[e.tipo].nome, e.grupo, MODO[e.modo].nome, e.local, e.qtd, e.responsavel, quando(e.feitoEm), quando(e.venceEm),
      e.loteOrigem, e.validadeOrigem ? fmtDataAno(deIso(e.validadeOrigem)) : '', rec(e).fornecedor, rec(e).nota,
      e.tempChegada == null ? '' : String(e.tempChegada).replace('.', ','), e.origens.map(fmtCodigo).join(' '),
      e.status === 'ativa' ? SIT[situacao(e.venceEm, agora, D.config.alertaDias)] : (e.status === 'usada' ? 'Usada' : 'Descartada'),
      quando(e.baixaEm), e.motivo || '', e.baixaPor || '',
    ]);
    return [cab].concat(corpo).map((l) => l.map(campo).join(';')).join('\r\n') + '\r\n';
  }

  // ---------- recebimento de mercadoria ----------
  const recebimentoAberto = (D) => D.recebimentos.find((r) => !r.fechadoEm) || null;
  const contagemAberta = (D) => D.contagens.find((c) => !c.fechadaEm) || null;
  const etiquetasDoRecebimento = (D, id) => D.etiquetas.filter((e) => e.recebimentoId === id);

  // Começa a entrega de um fornecedor: a matéria-prima etiquetada daqui até o encerramento fica ligada a ela.
  function abrirRecebimento(D, o, agora) {
    if (contagemAberta(D)) return { erro: 'Há uma contagem de estoque em andamento. Encerre a contagem primeiro.' };
    const aberto = recebimentoAberto(D);
    if (aberto) return { erro: 'O recebimento Nº ' + aberto.n + ' (' + aberto.fornecedor + ') ainda está aberto. Encerre-o primeiro.' };
    const fornecedor = texto(o.fornecedor, 40);
    if (!fornecedor) return { erro: 'Informe o fornecedor.' };
    const n = ++D.seqRec;
    const r = { id: 'r' + n, n, abertoEm: agora, fechadoEm: 0, fornecedor, nota: texto(o.nota, 20), responsavel: texto(o.responsavel, 40), obs: '' };
    D.recebimentos.push(r);
    return { recebimento: r };
  }

  // Encerra a entrega. Sem nenhuma etiqueta, ela é desfeita (foi aberta por engano): devolve { vazio: true }.
  function fecharRecebimento(D, o, agora) {
    const r = recebimentoAberto(D);
    if (!r) return { erro: 'Não há recebimento aberto.' };
    if (!etiquetasDoRecebimento(D, r.id).length) {
      D.recebimentos.splice(D.recebimentos.indexOf(r), 1);
      if (r.n === D.seqRec) D.seqRec--;
      return { vazio: true, recebimento: r };
    }
    r.fechadoEm = agora;
    r.obs = texto(o && o.obs, 200);
    return { recebimento: r };
  }

  // O que chegou numa entrega, juntando as etiquetas iguais: é o que se confere com a nota fiscal.
  function resumoRecebimento(D, r) {
    const etiquetas = etiquetasDoRecebimento(D, r.id);
    const itens = [];
    etiquetas.forEach((e) => {
      let g = itens.find((x) => x.nome === e.nome && x.lote === e.loteOrigem && x.validadeOrigem === e.validadeOrigem);
      if (!g) { g = { nome: e.nome, codigo: e.codigo, lote: e.loteOrigem, validadeOrigem: e.validadeOrigem, n: 0, qtds: [], temps: [] }; itens.push(g); }
      g.n++;
      if (e.qtd && g.qtds.indexOf(e.qtd) < 0) g.qtds.push(e.qtd);
      if (e.tempChegada != null && g.temps.indexOf(e.tempChegada) < 0) g.temps.push(e.tempChegada);
    });
    return { etiquetas: etiquetas.length, itens };
  }

  // Fornecedores já usados, do mais recente para o mais antigo (para sugerir no próximo recebimento).
  function fornecedores(D) {
    const vistos = [];
    D.recebimentos.slice().reverse().forEach((r) => { if (vistos.indexOf(r.fornecedor) < 0) vistos.push(r.fornecedor); });
    return vistos;
  }

  // ---------- contagem de estoque ----------
  // Começa uma contagem: de tudo, ou só de um local e/ou de um tipo.
  function abrirContagem(D, o, agora) {
    if (contagemAberta(D)) return { erro: 'Já existe uma contagem em andamento.' };
    const rec = recebimentoAberto(D);
    if (rec) return { erro: 'O recebimento Nº ' + rec.n + ' (' + rec.fornecedor + ') está aberto. Encerre-o antes de contar o estoque.' };
    const n = ++D.seqCont;
    const c = {
      id: 'c' + n, n, abertaEm: agora, fechadaEm: 0, responsavel: texto(o && o.responsavel, 40),
      local: texto(o && o.local, 40), tipo: o && TIPO[o.tipo] ? o.tipo : '',
      lidas: [], esperadas: 0, conferidas: 0, faltando: [], baixou: false,
    };
    D.contagens.push(c);
    return { contagem: c };
  }

  const noEscopo = (c, e) => e.status === 'ativa' && (!c.tipo || e.tipo === c.tipo) && (!c.local || e.local === c.local);
  const escopoTexto = (c) => [c.local || 'Todos os locais', c.tipo ? TIPO[c.tipo].nome : ''].filter(Boolean).join(' · ');

  // Como está a contagem: quantas etiquetas ela espera, quantas já foram lidas e quais faltam.
  function andamentoContagem(D, c) {
    const esperadas = D.etiquetas.filter((e) => noEscopo(c, e));
    const faltando = esperadas.filter((e) => c.lidas.indexOf(e.cod) < 0).sort((a, b) => a.venceEm - b.venceEm || a.cod - b.cod);
    return { esperadas: esperadas.length, conferidas: esperadas.length - faltando.length, faltando };
  }

  /*
   * Uma etiqueta foi lida durante a contagem. Devolve { ok, msg } e, se a etiqueta já tinha baixa,
   * reativar: id (para a tela oferecer "desfazer a baixa e contar").
   * Numa contagem por local, etiqueta ativa achada ali com outro local (ou sem local) é conferida
   * e passa a constar naquele local: a contagem mostra onde as coisas de fato estão.
   */
  function contarEtiqueta(D, c, e) {
    const quem = e.nome + ' (Nº ' + fmtCodigo(e.cod) + ')';
    if (e.status !== 'ativa') {
      return { ok: false, reativar: e.id, msg: quem + ' teve baixa como ' + (e.status === 'usada' ? 'usada' : 'descartada') + ' em ' + fmtData(e.baixaEm) + '. Se está no estoque, desfaça a baixa.' };
    }
    if (c.tipo && e.tipo !== c.tipo) return { ok: false, msg: 'Esta contagem é só de produtos do tipo ' + TIPO[c.tipo].nome + '. ' + e.nome + ' é ' + TIPO[e.tipo].nome + '.' };
    if (c.lidas.indexOf(e.cod) >= 0) return { ok: false, msg: quem + ' já foi conferida.' };
    const mudouLocal = !!c.local && e.local !== c.local;
    if (mudouLocal) e.local = c.local;
    c.lidas.push(e.cod);
    const a = andamentoContagem(D, c);
    return { ok: true, mudou: true, msg: 'Conferida: ' + e.nome + ' (' + a.conferidas + ' de ' + a.esperadas + ').' + (mudouLocal ? ' Local atualizado para ' + c.local + '.' : '') };
  }

  // Encerra a contagem. Com o.baixar, o que não foi achado recebe baixa como descartado (motivo: MOTIVO_CONTAGEM).
  function fecharContagem(D, o, agora) {
    const c = contagemAberta(D);
    if (!c) return { erro: 'Não há contagem em andamento.' };
    const a = andamentoContagem(D, c);
    c.esperadas = a.esperadas;
    c.conferidas = a.conferidas;
    c.faltando = a.faltando.map((e) => e.cod);
    c.baixou = !!(o && o.baixar) && a.faltando.length > 0;
    c.fechadaEm = agora;
    if (c.baixou) a.faltando.forEach((e) => darBaixa(D, e.id, { tipo: 'descartada', motivo: MOTIVO_CONTAGEM, por: c.responsavel }, agora));
    return { contagem: c, faltando: a.faltando };
  }

  // Desiste da contagem em andamento (os locais já atualizados continuam valendo).
  function cancelarContagem(D) {
    const c = contagemAberta(D);
    if (!c) return false;
    D.contagens.splice(D.contagens.indexOf(c), 1);
    if (c.n === D.seqCont) D.seqCont--;
    return true;
  }

  // O que há em estoque, em etiquetas ativas por produto, com a que vence primeiro.
  function saldo(D, agora) {
    const mapa = {};
    D.etiquetas.forEach((e) => {
      if (e.status !== 'ativa') return;
      const k = e.tipo + '|' + e.nome;
      const g = mapa[k] || (mapa[k] = { nome: e.nome, codigo: e.codigo, tipo: e.tipo, n: 0, primeira: e });
      g.n++;
      if (e.venceEm < g.primeira.venceEm) g.primeira = e;
    });
    const ordem = (t) => TIPOS.findIndex((x) => x.id === t);
    return Object.keys(mapa).map((k) => {
      const g = mapa[k];
      return {
        nome: g.nome, codigo: g.codigo, tipo: g.tipo, n: g.n, venceEm: g.primeira.venceEm, porHora: g.primeira.porHora,
        sit: situacao(g.primeira.venceEm, agora, D.config.alertaDias), resta: textoRestante(g.primeira.venceEm, agora, g.primeira.porHora),
      };
    }).sort((a, b) => ordem(a.tipo) - ordem(b.tipo) || a.nome.localeCompare(b.nome, 'pt-BR'));
  }

  // ---------- dados de exemplo ----------
  // Prazos ilustrativos, só para o esboço abrir preenchido. Cada casa define os seus com o responsável técnico.
  // [nome, grupo, resfriado, congelado, descongelado, ambiente, tipo]
  const CATALOGO_EXEMPLO = [
    ['Filé de tilápia porcionado', 'Pescados', '3d', '90d', '24h', '', 'pp'],
    ['Camarão limpo', 'Pescados', '2d', '90d', '24h', '', 'mp'],
    ['Salmão em cubos (cru)', 'Pescados', '24h', '', '', '', 'pp'],
    ['Frango desfiado cozido', 'Carnes e aves', '3d', '30d', '', '', 'pp'],
    ['Carne moída', 'Carnes e aves', '2d', '90d', '24h', '', 'mp'],
    ['Bife de alcatra porcionado', 'Carnes e aves', '3d', '90d', '2d', '', 'pp'],
    ['Molho de tomate', 'Molhos e bases', '3d', '30d', '', '', 'pp'],
    ['Maionese da casa', 'Molhos e bases', '2d', '', '', '', 'pp'],
    ['Caldo de legumes', 'Molhos e bases', '3d', '30d', '', '', 'pp'],
    ['Vinagrete', 'Molhos e bases', '2d', '', '', '', 'pp'],
    ['Alface higienizada', 'Hortifrúti', '3d', '', '', '', 'pp'],
    ['Cebola picada', 'Hortifrúti', '3d', '', '', '', 'pp'],
    ['Tomate em cubos', 'Hortifrúti', '2d', '', '', '', 'pp'],
    ['Frutas cortadas', 'Hortifrúti', '2d', '', '', '', 'pp'],
    ['Queijo muçarela fatiado', 'Laticínios e frios', '5d', '', '', '', 'mp'],
    ['Presunto fatiado', 'Laticínios e frios', '3d', '', '', '', 'mp'],
    ['Creme de leite (aberto)', 'Laticínios e frios', '3d', '', '', '', 'mp'],
    ['Arroz branco cozido', 'Guarnições', '3d', '', '', '', 'pp'],
    ['Feijão cozido', 'Guarnições', '3d', '30d', '', '', 'pp'],
    ['Purê de batata', 'Guarnições', '2d', '', '', '', 'pp'],
    ['Brigadeiro (massa)', 'Confeitaria', '5d', '', '', '', 'pp'],
    ['Chantilly batido', 'Confeitaria', '2d', '', '', '', 'pp'],
    ['Farinha de trigo (aberta)', 'Secos abertos', '', '', '', '30d', 'mp'],
    ['Molho shoyu (aberto)', 'Secos abertos', '90d', '', '', '30d', 'mp'],
    ['Lasanha de carne 500 g', 'Prontos para embalar', '', '90d', '', '', 'pa'],
    ['Molho de tomate pote 300 g', 'Prontos para embalar', '15d', '', '', '', 'pa'],
    ['Brigadeiro caixa com 12', 'Prontos para embalar', '7d', '', '', '', 'pa'],
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
    // Códigos de exemplo no formato TIPO + número (MP001, PP001, PA001). Na casa valem os códigos que ela já usa.
    const conta = { mp: 0, pp: 0, pa: 0 };
    CATALOGO_EXEMPLO.forEach((l) => {
      const codigo = l[6].toUpperCase() + String(++conta[l[6]]).padStart(3, '0');
      salvarProduto(D, { codigo, tipo: l[6], nome: l[0], grupo: l[1], validades: { resfriado: val(l[2]), congelado: val(l[3]), descongelado: val(l[4]), ambiente: val(l[5]) } });
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
    const molho = juntar('Molho de tomate', 'resfriado', L[0], 'Ana', '6 L', ha(1, 15, 45));
    const queijo = juntar('Queijo muçarela fatiado', 'resfriado', L[2], 'Carla', '1 kg', ha(0, 8, 10),
      { loteOrigem: 'L2291', validadeOrigem: dataIso(somarDias(agora, 3)), tempChegada: 4.5 });
    juntar('Brigadeiro (massa)', 'resfriado', L[4], 'Diego', '3 kg', ha(0, 9, 0));
    juntar('Caldo de legumes', 'congelado', L[3], 'Ana', '8 L', ha(26, 15, 0));
    const farinha = juntar('Farinha de trigo (aberta)', 'ambiente', L[5], 'Ana', '25 kg', ha(10, 7, 30), { loteOrigem: 'F0907' });
    juntar('Feijão cozido', 'congelado', L[3], 'Diego', '5 kg', ha(5, 13, 0));
    const carne = juntar('Carne moída', 'congelado', L[3], 'Bruno', '6 kg', ha(12, 10, 0), { loteOrigem: '48213', tempChegada: -15 });
    juntar('Filé de tilápia porcionado', 'congelado', L[3], 'Bruno', '10 kg', ha(20, 16, 0));
    // Acabados, cada um ligado à etiqueta de que foi feito (a origem entra depois que os números existem).
    const potes = juntar('Molho de tomate pote 300 g', 'resfriado', L[0], 'Ana', '18 potes', ha(1, 16, 30));
    const lasanha = juntar('Lasanha de carne 500 g', 'congelado', L[3], 'Bruno', '12 un.', ha(4, 11, 0));

    // Os números seguem a ordem em que as etiquetas foram feitas.
    fila.sort((a, b) => a.feitoEm - b.feitoEm).forEach((e) => {
      e.cod = ++D.seq;
      e.id = 'e' + e.cod;
      D.etiquetas.push(e);
    });
    potes.origens = [molho.cod];
    lasanha.origens = [carne.cod];

    // Três entregas já encerradas, cada matéria-prima ligada à sua (nomes de fornecedor inventados).
    [[carne, 'Frigorífico Exemplo', '18427', ''], [farinha, 'Distribuidora Exemplo', '90412', ''], [queijo, 'Laticínios Exemplo', '5530', 'Uma caixa com a tampa amassada.']]
      .forEach((l) => {
        const e = l[0];
        const n = ++D.seqRec;
        D.recebimentos.push({ id: 'r' + n, n, abertoEm: e.feitoEm - 10 * 60e3, fechadoEm: Math.min(e.feitoEm + 15 * 60e3, agora), fornecedor: l[1], nota: l[2], responsavel: e.responsavel, obs: l[3] });
        e.recebimentoId = 'r' + n;
      });
    // E uma contagem do freezer, há três dias, com tudo no lugar.
    const noFreezer = D.etiquetas.filter((e) => e.local === L[3] && e.feitoEm < ha(3, 17, 0)).map((e) => e.cod);
    D.contagens.push({
      id: 'c1', n: ++D.seqCont, abertaEm: ha(3, 17, 0), fechadaEm: ha(3, 17, 0) + 8 * 60e3, responsavel: 'Diego', local: L[3], tipo: '',
      lidas: noFreezer, esperadas: noFreezer.length, conferidas: noFreezer.length, faltando: [], baixou: false,
    });
    return D;
  }

  // ---------- código de barras (Code 128, conjunto B) ----------
  // Larguras das barras e dos espaços de cada símbolo (tabela da norma): 0–102 dados, 104 início B, 106 fim.
  const C128 = ('212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 ' +
    '123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 ' +
    '111323 131123 131321 112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 ' +
    '231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 431111 111224 111422 121124 121421 ' +
    '141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 111242 121142 121241 114212 ' +
    '124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 114131 ' +
    '311141 411131 211412 211214 211232 2331112').split(' ');

  // Dígito verificador: (104 + soma de valor × posição) mod 103.
  function verificador128(txt) {
    let soma = 104;
    for (let i = 0; i < txt.length; i++) soma += (txt.charCodeAt(i) - 32) * (i + 1);
    return soma % 103;
  }

  // As barras de um texto: sequência de módulos, '1' preto e '0' branco (sem as margens claras). null se algum caractere não couber.
  function code128(txt) {
    txt = String(txt == null ? '' : txt);
    if (!txt || !/^[\x20-\x7e]+$/.test(txt)) return null;
    const simbolos = [104];
    for (let i = 0; i < txt.length; i++) simbolos.push(txt.charCodeAt(i) - 32);
    simbolos.push(verificador128(txt), 106);
    let bits = '';
    simbolos.forEach((v) => {
      const larguras = C128[v];
      for (let i = 0; i < larguras.length; i++) bits += (i % 2 ? '0' : '1').repeat(+larguras[i]);
    });
    return bits;
  }

  // ---------- códigos do leitor ----------
  // Nome de pessoa ou local dentro de um código: sem acento, só letras e números, até 16.
  const chave = (v) => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);
  const CODIGO = {
    ok: RESERVA + 'OK',
    cancelar: RESERVA + 'NAO',
    usado: RESERVA + 'USO',
    descartar: RESERVA + 'FORA',
    etiqueta: (cod) => RESERVA + fmtCodigo(cod),
    qtd: (n) => RESERVA + 'Q' + n,
    modo: (id) => RESERVA + 'C' + (MODOS.findIndex((m) => m.id === id) + 1),
    motivo: (m) => RESERVA + 'M' + (MOTIVOS.indexOf(m) + 1),
    pessoa: (nome) => RESERVA + 'P' + chave(nome),
    local: (nome) => RESERVA + 'L' + chave(nome),
  };
  const QTDS_CARTELA = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20, 24, 30];
  const plural = (n, um, varios) => n + ' ' + (n === 1 ? um : varios);

  // O que é este código? Produto da casa, etiqueta do app, comando da cartela ou nada conhecido.
  function interpretar(D, bruto) {
    const c = String(bruto == null ? '' : bruto).replace(/[\x00-\x1f\x7f]/g, '').trim().toUpperCase();
    if (!c) return { tipo: 'vazio' };
    const p = D.produtos.find((x) => x.codigo && x.codigo === c);
    if (p) return { tipo: 'produto', produto: p };
    if (c.indexOf(RESERVA) !== 0) return { tipo: 'desconhecido', codigo: c };
    const r = c.slice(RESERVA.length);
    if (/^\d+$/.test(r)) {
      if (+r === 0) return { tipo: 'teste' };
      const e = D.etiquetas.find((x) => x.cod === +r);
      return e ? { tipo: 'etiqueta', etiqueta: e } : { tipo: 'erro', msg: 'A etiqueta Nº ' + fmtCodigo(+r) + ' não está neste aparelho.' };
    }
    const fixo = { OK: 'ok', NAO: 'cancelar', USO: 'usado', FORA: 'descartar' }[r];
    if (fixo) return { tipo: 'comando', comando: fixo };
    let m = /^Q(\d{1,2})$/.exec(r);
    if (m) return { tipo: 'comando', comando: 'qtd', valor: +m[1] };
    m = /^C([1-9])$/.exec(r);
    if (m && MODOS[+m[1] - 1]) return { tipo: 'comando', comando: 'modo', valor: MODOS[+m[1] - 1].id };
    m = /^M([1-9])$/.exec(r);
    if (m && MOTIVOS[+m[1] - 1]) return { tipo: 'comando', comando: 'motivo', valor: MOTIVOS[+m[1] - 1] };
    m = /^([PL])(.+)$/.exec(r);
    if (m) {
      const lista = m[1] === 'P' ? D.config.equipe : D.config.locais;
      const nome = lista.find((n) => chave(n) === m[2]);
      if (nome) return { tipo: 'comando', comando: m[1] === 'P' ? 'pessoa' : 'local', valor: nome };
      return { tipo: 'erro', msg: (m[1] === 'P' ? 'Esse nome não está mais na equipe.' : 'Esse local não está mais na lista.') + ' Imprima a cartela de novo.' };
    }
    return { tipo: 'erro', msg: 'Código do app que este aparelho não conhece: ' + c };
  }

  // ---------- o leitor, passo a passo ----------
  /*
   * A tela do leitor está sempre numa de três situações (S.modo):
   *   'livre'     esperando um código
   *   'nova'      um produto foi lido: etiquetas novas a caminho (falta confirmar)
   *   'etiqueta'  uma etiqueta já impressa foi lida: dar baixa como usada ou descartada
   * bipar() recebe o código lido e devolve a situação seguinte, a frase para a tela e, se for o caso,
   * as etiquetas a imprimir. Os botões da tela mandam os mesmos códigos da cartela: é um caminho só.
   */
  const sessao = (operador) => ({ modo: 'livre', operador: operador || '', desconhecido: '' });

  function bipar(D, S, bruto, agora) {
    const L = interpretar(D, bruto);
    const com = (extra) => Object.assign({}, S, { desconhecido: '' }, extra);
    const erro = (msg) => ({ S: com(), ok: false, msg });
    const bom = (novo, msg, extra) => Object.assign({ S: novo, ok: true, msg }, extra);
    const livre = () => sessao(S.operador);

    if (L.tipo === 'vazio') return { S, ok: true, msg: '' };
    if (L.tipo === 'erro') return erro(L.msg);
    if (L.tipo === 'teste') return bom(com(), 'Etiqueta de teste lida. Impressora e leitor estão funcionando.');

    // Contagem de estoque em andamento: o leitor só confere etiquetas (e troca quem está trabalhando).
    const contagem = contagemAberta(D);
    if (contagem) {
      if (L.tipo === 'etiqueta') return Object.assign({ S: livre() }, contarEtiqueta(D, contagem, L.etiqueta));
      if (L.tipo === 'comando' && L.comando === 'pessoa') return bom(sessao(L.valor), 'Quem está trabalhando: ' + L.valor);
      return { S: livre(), ok: false, msg: 'Contagem em andamento: leia as etiquetas dos itens. Para etiquetar ou dar baixa, encerre a contagem.' };
    }
    if (L.tipo === 'desconhecido') return { S: com({ desconhecido: L.codigo }), ok: false, msg: 'Código não cadastrado: ' + L.codigo };

    const produto = S.modo === 'nova' ? D.produtos.find((x) => x.id === S.produtoId) : null;
    const etiqueta = S.modo === 'etiqueta' ? D.etiquetas.find((x) => x.id === S.etiquetaId) : null;
    if ((S.modo === 'nova' && !produto) || (S.modo === 'etiqueta' && !etiqueta)) return bipar(D, livre(), bruto, agora);
    const termine = () => erro('Antes, imprima ou cancele as etiquetas de ' + produto.nome + '.');

    if (L.tipo === 'produto') {
      const p = L.produto;
      if (S.modo === 'nova') {
        if (p.id !== produto.id) return termine();
        if (S.copias >= MAX_COPIAS) return erro('O máximo é de ' + MAX_COPIAS + ' etiquetas por vez.');
        return bom(com({ copias: S.copias + 1 }), (S.copias + 1) + ' etiquetas de ' + p.nome);
      }
      return bom({
        modo: 'nova', operador: S.operador, desconhecido: '', produtoId: p.id, conserv: modosDoProduto(p)[0].id,
        copias: 1, local: '', qtd: '', lote: '', valOrig: '', temp: '', origens: [],
      }, p.nome);
    }

    if (L.tipo === 'etiqueta') {
      const e = L.etiqueta;
      if (S.modo === 'nova') {
        // Matéria-prima não é feita de outra etiqueta; nos demais tipos, a etiqueta lida entra como origem.
        if (produto.tipo === 'mp') return termine();
        if (e.status === 'descartada') return erro('A etiqueta Nº ' + fmtCodigo(e.cod) + ' foi descartada e não pode entrar como origem.');
        if (S.origens.indexOf(e.cod) >= 0) return erro('A etiqueta Nº ' + fmtCodigo(e.cod) + ' já está na lista.');
        if (S.origens.length >= 12) return erro('O máximo é de 12 origens por etiqueta.');
        return bom(com({ origens: S.origens.concat(e.cod) }), 'Feito com ' + e.nome + ' (Nº ' + fmtCodigo(e.cod) + ')');
      }
      return bom({ modo: 'etiqueta', operador: S.operador, desconhecido: '', etiquetaId: e.id, pedindoMotivo: false },
        e.nome + ': ' + (e.status === 'ativa' ? textoRestante(e.venceEm, agora, e.porHora) : 'já teve baixa'));
    }

    const c = L.comando, v = L.valor;
    if (c === 'cancelar') return bom(livre(), S.modo === 'livre' ? 'Nada em andamento.' : 'Cancelado.');
    if (c === 'pessoa') return bom(com({ operador: v }), 'Quem está trabalhando: ' + v);

    if (S.modo === 'nova') {
      if (c === 'qtd') {
        if (!(v >= 1 && v <= MAX_COPIAS)) return erro('O número de etiquetas vai de 1 a ' + MAX_COPIAS + '.');
        return bom(com({ copias: v }), plural(v, 'etiqueta', 'etiquetas') + ' de ' + produto.nome);
      }
      if (c === 'modo') {
        if (!produto.validades[v]) return erro(produto.nome + ' não tem validade cadastrada em ' + MODO[v].nome.toLowerCase() + '.');
        return bom(com({ conserv: v }), MODO[v].nome + ': validade de ' + fmtValidade(produto.validades[v]));
      }
      if (c === 'local') return bom(com({ local: v }), 'Local: ' + v);
      if (c === 'ok') {
        const r = emitir(D, {
          produtoId: produto.id, modo: S.conserv, local: S.local, responsavel: S.operador, qtd: S.qtd, copias: S.copias,
          loteOrigem: S.lote, validadeOrigem: S.valOrig, tempChegada: S.temp, origens: S.origens,
        }, agora);
        if (r.erro) return erro(r.erro);
        const n = r.etiquetas.length;
        return bom(livre(), plural(n, 'etiqueta', 'etiquetas') + ' de ' + produto.nome + (n === 1 ? ': registrada.' : ': registradas.'), { imprimir: r.etiquetas });
      }
      return termine();
    }

    if (S.modo === 'etiqueta') {
      if (c !== 'usado' && c !== 'descartar' && c !== 'motivo') return erro('Para esta etiqueta, leia USADO ou DESCARTAR.');
      if (etiqueta.status !== 'ativa') return erro('A etiqueta Nº ' + fmtCodigo(etiqueta.cod) + ' já teve baixa.');
      if (c === 'descartar') return bom(com({ pedindoMotivo: true }), 'Qual o motivo do descarte?');
      darBaixa(D, etiqueta.id, c === 'usado' ? { tipo: 'usada', por: S.operador } : { tipo: 'descartada', motivo: v, por: S.operador }, agora);
      return bom(livre(), etiqueta.nome + (c === 'usado' ? ': baixa como usado.' : ': descartado (' + v.toLowerCase() + ').'), { baixa: etiqueta.id });
    }

    return erro('Leia primeiro o código de um produto ou de uma etiqueta.');
  }

  // A cartela de códigos para imprimir e deixar na bancada: comandos do app e os produtos que têm código.
  function cartela(D) {
    const secoes = [
      { titulo: 'Comandos', itens: [
        { nome: 'IMPRIMIR', codigo: CODIGO.ok }, { nome: 'CANCELAR', codigo: CODIGO.cancelar },
        { nome: 'USADO', codigo: CODIGO.usado }, { nome: 'DESCARTAR', codigo: CODIGO.descartar },
      ] },
      { titulo: 'Número de etiquetas', itens: QTDS_CARTELA.map((n) => ({ nome: String(n), codigo: CODIGO.qtd(n) })) },
      { titulo: 'Conservação', itens: MODOS.map((m) => ({ nome: m.nome, codigo: CODIGO.modo(m.id) })) },
      { titulo: 'Motivo do descarte', itens: MOTIVOS.map((m) => ({ nome: m, codigo: CODIGO.motivo(m) })) },
    ];
    const nomes = (titulo, lista, codigo) => {
      const itens = lista.filter((n) => chave(n)).map((n) => ({ nome: n, codigo: codigo(n) }));
      if (itens.length) secoes.push({ titulo, itens });
    };
    nomes('Quem está trabalhando', D.config.equipe, CODIGO.pessoa);
    nomes('Local', D.config.locais, CODIGO.local);
    TIPOS.forEach((t) => {
      const itens = D.produtos.filter((p) => p.tipo === t.id && p.codigo)
        .sort((a, b) => a.codigo.localeCompare(b.codigo, 'pt-BR', { numeric: true }))
        .map((p) => ({ nome: p.nome, codigo: p.codigo }));
      if (itens.length) secoes.push({ titulo: t.nome, produto: true, itens });
    });
    return secoes;
  }

  return {
    CHAVE, VERSAO, RESERVA, HORA, DIA, MAX_COPIAS, MODOS, MODO, TIPOS, TIPO, SITUACOES, MOTIVOS, TAMANHOS, LARGURA, ALTURA,
    limparTamanho, medidas, limparCodigo, code128, verificador128, chave, CODIGO, plural,
    interpretar, sessao, bipar, cartela,
    MOTIVO_CONTAGEM, TEMPERATURA, lerTemperatura, fmtTemperatura,
    recebimentoAberto, etiquetasDoRecebimento, abrirRecebimento, fecharRecebimento, resumoRecebimento, fornecedores,
    contagemAberta, abrirContagem, andamentoContagem, escopoTexto, contarEtiqueta, fecharContagem, cancelarContagem, saldo,
    inicioDoDia, fimDoDia, somarDias, diasEntre, dataIso, deIso,
    fmtData, fmtDataAno, fmtHora, diaSemana, fmtCodigo, fmtValidade,
    calcularValidade, situacao, textoRestante,
    vazio, carregar, limparConfig, linhas,
    salvarProduto, excluirProduto, modosDoProduto, grupos,
    montar, emitir, darBaixa, desfazerBaixa, painel, relatorio, csv, exemplo,
  };
});
