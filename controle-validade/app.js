/*
 * app.js — Telas do Validade em Dia. As regras (validade, situação, leitor, relatório)
 * ficam em core.js; aqui só se desenha a tela e se guarda o que foi feito.
 *
 * Abas: Validades (painel do que está ativo) · Leitor (operação com o leitor de código
 * de barras) · Etiquetar (o mesmo, tocando na tela) · Produtos (catálogo) · Perdas · Ajustes.
 */
(function () {
  'use strict';
  const N = window.Nucleo;
  // Ligado só na prévia publicada como página: lá o navegador não deixa imprimir nem baixar arquivo.
  const PREVIA = !!window.MODO_PREVIA;
  const VERSAO = '0.2';
  const ABAS = ['validades', 'leitor', 'etiquetar', 'produtos', 'perdas', 'ajustes'];

  const $ = (s, el) => (el || document).querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const agora = () => Date.now();
  const plural = N.plural;

  const app = $('#app');
  const dlg = $('#dlg');
  const frm = $('#frm');
  const aviso = $('#aviso');

  let D;
  const UI = {
    aba: 'validades', sit: '', local: '', tipo: '', busca: '', grupo: '', tipoEtq: '', etqBusca: '', prodBusca: '', periodo: 30,
    r: rascunho(),
    // Leitor: a situação da tela (ver bipar no núcleo), a última resposta e as leituras recentes.
    S: N.sessao(), retorno: null, log: [], cartela: false,
  };

  // O que está sendo preenchido na aba Etiquetar. Local e responsável ficam para a próxima etiqueta.
  function rascunho(antes) {
    return {
      produtoId: '', modo: '', local: antes ? antes.local : '', responsavel: antes ? antes.responsavel : '',
      qtd: '', copias: 1, quando: 'agora', feito: '', lote: '', valOrig: '', origAberto: false,
    };
  }

  // ---------- guardar ----------
  function lerGuardado() { try { return localStorage.getItem(N.CHAVE); } catch (e) { return null; } }
  function gravar() { try { localStorage.setItem(N.CHAVE, JSON.stringify(D)); } catch (e) { /* sem espaço ou sem permissão: segue só na memória */ } }

  // ---------- ícones ----------
  const ICO = {
    vencido: '<svg class="ico ico-vencido" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="9" fill="currentColor"/><path d="M6.7 6.7l6.6 6.6M13.3 6.7l-6.6 6.6" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>',
    hoje: '<svg class="ico ico-hoje" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2.2 18.6 17H1.4Z" fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M10 7.6v4.4" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/><circle cx="10" cy="14.8" r="1.1" fill="#fff"/></svg>',
    breve: '<svg class="ico ico-breve" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="9" fill="currentColor"/><path d="M10 5.2V10l3 2" fill="none" stroke="#0b0b0b" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    ok: '<svg class="ico ico-ok" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="9" fill="currentColor"/><path d="M5.8 10.4l2.8 2.8 5.6-6" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };
  const ICO_IMPRIMIR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 9V4h10v5M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2"/><path d="M7 14h10v6H7z"/></svg>';
  const ICO_BARRAS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6v12M7.5 6v12M11 6v12M13.5 6v12M17 6v12M20 6v12"/></svg>';

  const nomeSit = (s) => (s.id === 'breve' ? 'Vencem em até ' + plural(D.config.alertaDias, 'dia', 'dias') : s.nome);
  const vazioHtml = (titulo, txt) => '<div class="vazio"><strong>' + esc(titulo) + '</strong>' + esc(txt) + '</div>';
  const porNome = (a, b) => a.nome.localeCompare(b.nome, 'pt-BR');
  const validadesTexto = (p) => N.modosDoProduto(p).map((m) => m.nome + ' ' + N.fmtValidade(p.validades[m.id]));
  const etiquetaPorCod = (cod) => D.etiquetas.find((e) => e.cod === cod);
  // "Nº 000109 (Molho de tomate)" para cada etiqueta de origem.
  const origensTexto = (cods) => cods.map((c) => { const o = etiquetaPorCod(c); return 'Nº ' + N.fmtCodigo(c) + (o ? ' (' + o.nome + ')' : ''); }).join(', ');
  const quandoFeito = (e) => N.diaSemana(e.feitoEm) + ' ' + N.fmtData(e.feitoEm) + ' ' + N.fmtHora(e.feitoEm);
  const quandoVence = (e) => N.diaSemana(e.venceEm) + ' ' + N.fmtData(e.venceEm) + (e.porHora ? ' ' + N.fmtHora(e.venceEm) : '');

  // ---------- código de barras ----------
  const CLARA = 10;   // margem clara de cada lado, em módulos (o leitor precisa dela)

  // As barras em SVG, um retângulo por barra, medido em módulos. A largura real quem dá é o estilo.
  function barras(codigo) {
    const bits = N.code128(codigo);
    if (!bits) return null;
    let rets = '';
    for (let i = 0; i < bits.length;) {
      if (bits[i] === '0') { i++; continue; }
      let j = i;
      while (bits[j] === '1') j++;
      rets += '<rect x="' + (CLARA + i) + '" width="' + (j - i) + '" height="1"/>';
      i = j;
    }
    const total = bits.length + 2 * CLARA;
    return {
      total,
      svg: (estilo) => '<svg class="cb" viewBox="0 0 ' + total + ' 1" preserveAspectRatio="none" shape-rendering="crispEdges" style="' + estilo + '" role="img" aria-label="Código de barras ' + esc(codigo) + '" data-codigo="' + esc(codigo) + '">' + rets + '</svg>',
    };
  }

  /*
   * Quantos pontos da impressora cada módulo ocupa na etiqueta. A Zebra GC420 tem 203 dpi,
   * 8 pontos por milímetro: com o módulo num número inteiro de pontos (2, 3 ou 4) as barras
   * saem nítidas. Escolhe o maior que cabe na largura útil; 0 se nem o menor couber.
   */
  const PONTO = 0.125;   // mm
  function pontosPorModulo(t, total) {
    const em = Math.min(0.042 * t.l, 0.063 * t.a);
    const util = t.l - 1.8 * em;
    for (let n = 4; n >= 2; n--) if (total * n * PONTO <= util) return n;
    return 0;
  }
  // As barras prontas para caber numa etiqueta de tamanho t ('' se não couberem).
  function barrasNaEtiqueta(codigo, t) {
    const b = barras(codigo);
    const pontos = b ? pontosPorModulo(t, b.total) : 0;
    return pontos ? '<div class="etq-barras">' + b.svg('width:' + (b.total * pontos * PONTO / t.l * 100).toFixed(3) + 'cqw') + '</div>' : '';
  }

  // ---------- a etiqueta ----------
  function etiquetaHtml(e) {
    const t = N.medidas(D.config.tamanho);
    const tipo = N.TIPO[e.tipo] || N.TIPO.pp;
    const pe = [e.responsavel && 'Resp. ' + e.responsavel, e.local, e.qtd, e.loteOrigem && 'Lote ' + e.loteOrigem].filter(Boolean).join(' · ');
    const validade = e.porHora
      ? N.fmtDataAno(e.venceEm) + ' ' + N.fmtHora(e.venceEm)
      : N.diaSemana(e.venceEm).toUpperCase() + ' ' + N.fmtDataAno(e.venceEm);
    const tamanhoNome = e.nome.length > 40 ? ' muito-longo' : e.nome.length > 18 ? ' longo' : '';
    return '<div class="etq" style="--l:' + t.l + ';--a:' + t.a + '"><div class="etq-dentro">' +
      '<div class="etq-topo"><span class="etq-modo">' + N.MODO[e.modo].nome.toUpperCase() + '</span><span class="etq-tipo">' + tipo.nome.toUpperCase() + '</span></div>' +
      '<div class="etq-nome' + tamanhoNome + '">' + esc(e.nome) + '</div>' +
      '<div class="etq-linha"><span>' + tipo.data + '</span><b>' + N.fmtDataAno(e.feitoEm) + ' ' + N.fmtHora(e.feitoEm) + '</b></div>' +
      '<div class="etq-linha etq-val"><span>VALIDADE</span><b>' + validade + '</b></div>' +
      '<div class="etq-pe">' + esc(pe) + '</div>' +
      barrasNaEtiqueta(N.CODIGO.etiqueta(e.cod), t) +
      '<div class="etq-rodape"><span class="etq-num">' + N.CODIGO.etiqueta(e.cod) + '</span><span class="etq-casa">' + esc(D.config.casa) + '</span></div>' +
      '</div></div>';
  }

  // Manda um conteúdo para a impressora, com o tamanho de página dado.
  function imprimirHtml(html, pagina) {
    if (PREVIA) return;
    $('#pagina').textContent = '@page { ' + pagina + ' }';
    $('#impressao').innerHTML = html;
    window.print();
  }

  // Cada etiqueta sai numa página do tamanho do rolo; a impressora é escolhida na janela do sistema.
  function imprimir(lista) {
    if (!lista.length) return;
    const t = N.medidas(D.config.tamanho);
    imprimirHtml(lista.map(etiquetaHtml).join(''), 'size: ' + t.l + 'mm ' + t.a + 'mm; margin: 0');
  }

  // ---------- Validades ----------
  function telaValidades() {
    const P = N.painel(D, agora());
    const locais = [];
    P.itens.forEach((x) => { if (x.e.local && locais.indexOf(x.e.local) < 0) locais.push(x.e.local); });
    if (UI.local && locais.indexOf(UI.local) < 0) UI.local = '';
    return (D.exemplo
      ? '<div class="exemplo"><p><strong>Dados de exemplo.</strong> Produtos, etiquetas e histórico inventados para você experimentar.</p>' +
        '<button type="button" class="bt" data-acao="zerar">Começar do zero</button></div>'
      : '') +
      '<section class="tiles" aria-label="Etiquetas ativas por situação">' +
      N.SITUACOES.map((s) =>
        '<button type="button" class="tile' + (UI.sit === s.id ? ' on' : '') + '" data-sit="' + s.id + '" aria-pressed="' + (UI.sit === s.id) + '">' +
        '<span class="tile-n">' + P.contagem[s.id] + '</span><span class="tile-r">' + ICO[s.id] + nomeSit(s) + '</span></button>').join('') +
      '</section>' +
      '<div class="barra">' +
      '<input type="search" id="busca" placeholder="Buscar produto, código, local ou número" aria-label="Buscar nas etiquetas ativas" value="' + esc(UI.busca) + '">' +
      '<select id="filtro-tipo" aria-label="Filtrar por tipo"><option value="">Todos os tipos</option>' +
      N.TIPOS.map((t) => '<option value="' + t.id + '"' + (t.id === UI.tipo ? ' selected' : '') + '>' + t.nome + '</option>').join('') + '</select>' +
      '<select id="filtro-local" aria-label="Filtrar por local"><option value="">Todos os locais</option>' +
      locais.map((l) => '<option' + (l === UI.local ? ' selected' : '') + '>' + esc(l) + '</option>').join('') + '</select>' +
      '</div>' +
      '<div id="lista">' + listaValidades(P) + '</div>';
  }

  function listaValidades(P) {
    if (!P.itens.length) return vazioHtml('Nenhuma etiqueta ativa', 'Emita a primeira na aba Leitor ou na aba Etiquetar.');
    const termo = UI.busca.trim().toLowerCase();
    const alvo = (e) => (e.nome + ' ' + e.codigo + ' ' + e.local + ' ' + N.CODIGO.etiqueta(e.cod) + ' ' + e.responsavel).toLowerCase();
    const itens = P.itens.filter((x) =>
      (!UI.sit || x.sit === UI.sit) && (!UI.local || x.e.local === UI.local) && (!UI.tipo || x.e.tipo === UI.tipo) &&
      (!termo || alvo(x.e).indexOf(termo) >= 0));
    if (!itens.length) return vazioHtml('Nada encontrado', 'Nenhuma etiqueta ativa bate com esse filtro.');
    return N.SITUACOES.map((s) => {
      const g = itens.filter((x) => x.sit === s.id);
      if (!g.length) return '';
      return '<section class="bloco"><h2 class="grupo">' + ICO[s.id] + nomeSit(s) + ' <span class="n">' + g.length + '</span></h2>' +
        '<ul class="itens">' + g.map(itemValidade).join('') + '</ul></section>';
    }).join('');
  }

  function itemValidade(x) {
    const e = x.e;
    const meta = [N.TIPO[e.tipo].nome, N.MODO[e.modo].nome, e.local, e.qtd].filter(Boolean).join(' · ');
    const datas = 'Nº ' + N.fmtCodigo(e.cod) + ' · feito ' + quandoFeito(e) + ' · vence ' + quandoVence(e) +
      (e.limitada ? ' (validade do fabricante)' : '') +
      (e.responsavel ? ' · ' + e.responsavel : '');
    return '<li class="item"><div class="item-info">' +
      '<div class="item-nome"><span>' + esc(e.nome) + '</span><span class="pill p-' + x.sit + '">' + ICO[x.sit] + esc(x.resta) + '</span></div>' +
      '<div class="item-meta">' + esc(meta) + '</div>' +
      '<div class="item-datas mono">' + esc(datas) + '</div>' +
      (e.origens.length ? '<div class="item-datas">Feito com ' + esc(origensTexto(e.origens)) + '</div>' : '') +
      '</div><div class="item-acoes">' +
      '<button type="button" class="bt" data-usar="' + e.id + '">Usado</button>' +
      '<button type="button" class="bt bt-perigo" data-descartar="' + e.id + '">Descartar</button>' +
      (PREVIA ? '' : '<button type="button" class="bt bt-icone" data-reimprimir="' + e.id + '" title="Reimprimir etiqueta" aria-label="Reimprimir etiqueta">' + ICO_IMPRIMIR + '</button>') +
      '</div></li>';
  }

  function usar(id) {
    const e = N.darBaixa(D, id, { tipo: 'usada' }, agora());
    if (!e) return;
    gravar();
    render();
    avisar(e.nome + ' marcado como usado.', { rotulo: 'Desfazer', fn: () => desfazer(id) });
  }

  function desfazer(id) {
    N.desfazerBaixa(D, id);
    gravar();
    render();
  }

  function dialogoDescarte(id) {
    const e = D.etiquetas.find((x) => x.id === id);
    if (!e) return;
    const padrao = N.situacao(e.venceEm, agora(), D.config.alertaDias) === 'vencido' ? 'Vencido' : 'Sobra de produção';
    abrir(
      '<h2 id="dlg-titulo">Descartar ' + esc(e.nome) + '</h2>' +
      '<p class="dica mono">Nº ' + N.fmtCodigo(e.cod) + ' · ' + esc(N.textoRestante(e.venceEm, agora(), e.porHora)) + (e.qtd ? ' · ' + esc(e.qtd) : '') + '</p>' +
      '<fieldset><legend>Motivo do descarte</legend><div class="opcoes">' +
      N.MOTIVOS.map((m, i) => '<label><input type="radio" name="motivo" id="motivo-' + i + '" value="' + esc(m) + '"' + (m === padrao ? ' checked' : '') + '>' + esc(m) + '</label>').join('') +
      '</div></fieldset>' +
      (D.config.equipe.length
        ? '<label class="campo">Quem está descartando<select name="por" id="desc-por"><option value="">Não informar</option>' +
          D.config.equipe.map((n) => '<option>' + esc(n) + '</option>').join('') + '</select></label>'
        : '') +
      '<div class="dlg-pe"><button type="button" class="bt" data-acao="fechar">Cancelar</button><button type="submit" class="bt bt-prim">Registrar descarte</button></div>',
      (fd) => {
        N.darBaixa(D, id, { tipo: 'descartada', motivo: fd.get('motivo'), por: fd.get('por') }, agora());
        gravar();
        render();
        avisar(e.nome + ' descartado.', { rotulo: 'Desfazer', fn: () => desfazer(id) });
      });
  }

  // ---------- Leitor ----------
  /*
   * A tela de quem opera com o leitor de código de barras. O leitor funciona como um teclado:
   * digita o código e aperta Enter. Tudo passa por bipar(): o campo, os botões grandes da tela
   * (que mandam os mesmos códigos da cartela) e as leituras feitas com o cursor fora de um campo.
   */
  function bipar(codigo) {
    const r = N.bipar(D, UI.S, codigo, agora());
    UI.S = r.S;
    if (!r.msg) { if (UI.aba === 'leitor') focoLeitor(); return; }
    UI.retorno = { ok: r.ok, msg: r.msg + (r.imprimir && PREVIA ? ' Nesta prévia a impressão fica desligada.' : ''), baixa: r.baixa || '' };
    UI.log.unshift({ t: agora(), ok: r.ok, msg: r.msg });
    UI.log.length = Math.min(UI.log.length, 6);
    if (r.imprimir || r.baixa) gravar();
    tocar(r.ok);
    UI.cartela = false;
    if (UI.aba !== 'leitor') ir('leitor'); else render();
    if (r.imprimir) imprimir(r.imprimir);
  }

  // Um bipe curto quando deu certo e um grave quando não: quem opera olha para o produto, não para a tela.
  let audio = null;
  function tocar(ok) {
    if (!D.config.som) return;
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      const osc = audio.createOscillator();
      const vol = audio.createGain();
      osc.type = ok ? 'sine' : 'square';
      osc.frequency.value = ok ? 880 : 200;
      vol.gain.value = ok ? 0.12 : 0.08;
      osc.connect(vol);
      vol.connect(audio.destination);
      osc.start();
      osc.stop(audio.currentTime + (ok ? 0.09 : 0.35));
    } catch (e) { /* sem áudio neste aparelho */ }
  }

  // Com mouse e teclado (o caso do leitor), o campo fica sempre pronto. Em tela de toque, não: abriria o teclado a toda hora.
  const TEM_TECLADO = !window.matchMedia || window.matchMedia('(pointer: fine)').matches;
  function focoLeitor() {
    const campo = $('#leitor-campo');
    if (campo && TEM_TECLADO && !dlg.open) campo.focus();
  }

  const pedidoLeitor = () => {
    const S = UI.S;
    return { produtoId: S.produtoId, modo: S.conserv, local: S.local, responsavel: S.operador, qtd: S.qtd, copias: S.copias, loteOrigem: S.lote, validadeOrigem: S.valOrig, origens: S.origens };
  };

  function telaLeitor() {
    if (UI.cartela) return telaCartela();
    const S = UI.S;
    const produto = S.modo === 'nova' && D.produtos.find((x) => x.id === S.produtoId);
    const etiqueta = S.modo === 'etiqueta' && D.etiquetas.find((x) => x.id === S.etiquetaId);
    if ((S.modo === 'nova' && !produto) || (S.modo === 'etiqueta' && !etiqueta)) UI.S = N.sessao(S.operador);
    return '<form id="form-leitor" class="leitor-entrada" autocomplete="off" novalidate>' +
      '<label for="leitor-campo">' + ICO_BARRAS + 'Leia o código com o leitor</label>' +
      '<div class="leitor-linha"><input type="text" id="leitor-campo" autocapitalize="characters" autocomplete="off" spellcheck="false" enterkeyhint="go" placeholder="ou digite o código e aperte Enter">' +
      '<button type="submit" class="bt">Ler</button></div></form>' +
      retornoHtml() +
      (produto ? leitorNova(produto) : etiqueta ? leitorEtiqueta(etiqueta) : leitorLivre()) +
      leitorRodape();
  }

  function retornoHtml() {
    const r = UI.retorno;
    if (!r) return '';
    return '<div class="retorno ' + (r.ok ? 'bom' : 'ruim') + '" role="' + (r.ok ? 'status' : 'alert') + '">' + (r.ok ? ICO.ok : ICO.vencido) +
      '<p>' + esc(r.msg) + '</p>' +
      (r.baixa ? '<button type="button" class="bt" data-acao="desfazer-leitor">Desfazer</button>' : '') +
      (!r.ok && UI.S.desconhecido ? '<button type="button" class="bt" data-acao="cadastrar-lido">Cadastrar este código</button>' : '') +
      '</div>';
  }

  function leitorLivre() {
    return '<section class="leitor-livre"><h2>Pronto para ler</h2><ul class="leitor-guia">' +
      '<li><strong>Código de um produto</strong>, na cartela ou na caixa: começa uma etiqueta nova.</li>' +
      '<li><strong>Etiqueta já impressa</strong>: abre para dar baixa como usada ou descartada.</li>' +
      '</ul></section>';
  }

  function leitorVence(m, p) {
    if (m.erro) return '<span class="erro">' + esc(m.erro) + '</span>';
    const b = m.base;
    const modo = N.MODO[b.modo];
    return 'Vence <strong>' + N.diaSemana(b.venceEm) + ' ' + N.fmtData(b.venceEm) + (b.porHora ? ' às ' + N.fmtHora(b.venceEm) : '') + '</strong> · ' +
      modo.nome + ', ' + N.fmtValidade(p.validades[modo.id]) + (b.limitada ? ' (encurtada pela validade do fabricante)' : '');
  }
  const previaLeitor = (m) => (m.erro ? '<div class="vazio">' + esc(m.erro) + '</div>' : etiquetaHtml(Object.assign({ cod: D.seq + 1 }, m.base)));

  function leitorNova(p) {
    const S = UI.S;
    const modos = N.modosDoProduto(p);
    const m = N.montar(D, pedidoLeitor(), agora());
    const n = S.copias;
    const escolha = (codigo, on, titulo, sub) =>
      '<button type="button" class="escolha' + (on ? ' on' : '') + '" aria-pressed="' + on + '" data-bip="' + codigo + '"><strong>' + esc(titulo) + '</strong>' + (sub ? '<span>' + esc(sub) + '</span>' : '') + '</button>';
    const locais = D.config.locais.concat(S.local && D.config.locais.indexOf(S.local) < 0 ? [S.local] : []);
    return '<div class="duas">' +
      '<section class="cartao leitor-cartao">' +
      '<p class="sobre">Etiqueta nova · ' + N.TIPO[p.tipo].nome + (p.codigo ? ' · <span class="mono">' + esc(p.codigo) + '</span>' : '') + '</p>' +
      '<h2 class="leitor-nome">' + esc(p.nome) + '</h2>' +
      '<p class="leitor-vence" id="leitor-vence">' + leitorVence(m, p) + '</p>' +
      (modos.length > 1
        ? '<div class="escolhas" role="group" aria-label="Conservação">' + modos.map((mo) => escolha(N.CODIGO.modo(mo.id), mo.id === S.conserv, mo.nome, N.fmtValidade(p.validades[mo.id]))).join('') + '</div>'
        : '') +
      '<div class="leitor-qtd">' +
      '<button type="button" class="bt bt-redondo" data-bip="' + N.CODIGO.qtd(n - 1) + '" aria-label="Uma etiqueta a menos"' + (n <= 1 ? ' disabled' : '') + '>−</button>' +
      '<p><strong id="leitor-n">' + n + '</strong> ' + (n === 1 ? 'etiqueta' : 'etiquetas') + '</p>' +
      '<button type="button" class="bt bt-redondo" data-bip="' + N.CODIGO.qtd(n + 1) + '" aria-label="Uma etiqueta a mais"' + (n >= N.MAX_COPIAS ? ' disabled' : '') + '>+</button>' +
      '</div>' +
      '<p class="dica">Cada leitura do mesmo código soma uma etiqueta.</p>' +
      '<div class="campos">' +
      '<label class="campo">Quantidade no recipiente (opcional)<input type="text" id="lt-qtd" data-campo="qtd" maxlength="20" placeholder="ex.: 2 kg" autocomplete="off" value="' + esc(S.qtd) + '"></label>' +
      (locais.length
        ? '<label class="campo">Local (opcional)<select id="lt-local" data-campo="local"><option value="">Não informar</option>' +
          locais.map((l) => '<option' + (l === S.local ? ' selected' : '') + '>' + esc(l) + '</option>').join('') + '</select></label>'
        : '') +
      (p.tipo === 'mp'
        ? '<label class="campo">Lote do fabricante (opcional)<input type="text" id="lt-lote" data-campo="lote" maxlength="20" autocomplete="off" value="' + esc(S.lote) + '"></label>' +
          '<label class="campo">Validade do fabricante (opcional)<input type="date" id="lt-valorig" data-campo="valOrig" value="' + esc(S.valOrig) + '"></label>'
        : '') +
      '</div>' +
      (p.tipo === 'mp' ? '' : '<div class="origens"><strong>Feito com</strong>' +
        (S.origens.length
          ? '<ul>' + S.origens.map((c) => '<li><span>' + esc(origensTexto([c])) + '</span><button type="button" class="bt bt-mini" data-tira-origem="' + c + '" aria-label="Tirar Nº ' + N.fmtCodigo(c) + '">Tirar</button></li>').join('') + '</ul>'
          : '<span class="dica">Para guardar a origem, leia a etiqueta do que foi usado.</span>') +
        '</div>') +
      '<div class="leitor-acoes">' +
      '<button type="button" class="bt bt-prim bt-enorme" id="leitor-ok" data-bip="' + N.CODIGO.ok + '">' + (PREVIA ? 'Registrar ' : 'Imprimir ') + plural(n, 'etiqueta', 'etiquetas') + '</button>' +
      '<button type="button" class="bt bt-enorme" data-bip="' + N.CODIGO.cancelar + '">Cancelar</button>' +
      '</div></section>' +
      '<aside class="previa-col"><h2>Prévia da etiqueta</h2><div id="previa">' + previaLeitor(m) + '</div></aside>' +
      '</div>';
  }

  // Um campo opcional mudou: refaz só a data de vencimento e a prévia, sem tirar o cursor do lugar.
  function atualizarLeitor() {
    const p = D.produtos.find((x) => x.id === UI.S.produtoId);
    if (!p || !$('#leitor-vence')) return;
    const m = N.montar(D, pedidoLeitor(), agora());
    $('#leitor-vence').innerHTML = leitorVence(m, p);
    $('#previa').innerHTML = previaLeitor(m);
  }

  function leitorEtiqueta(e) {
    const S = UI.S;
    const ativa = e.status === 'ativa';
    const sit = N.situacao(e.venceEm, agora(), D.config.alertaDias);
    const meta = [N.MODO[e.modo].nome, e.local, e.qtd, e.responsavel].filter(Boolean).join(' · ');
    let acoes;
    if (!ativa) {
      acoes = '<p>Baixa em ' + N.fmtData(e.baixaEm) + ' às ' + N.fmtHora(e.baixaEm) + ': <strong>' +
        (e.status === 'usada' ? 'usada' : 'descartada (' + esc(e.motivo.toLowerCase()) + ')') + '</strong>' + (e.baixaPor ? ' por ' + esc(e.baixaPor) : '') + '.</p>' +
        '<div class="barra"><button type="button" class="bt" data-bip="' + N.CODIGO.cancelar + '">Voltar</button>' +
        '<button type="button" class="bt" data-acao="desfazer-aberta">Desfazer a baixa</button></div>';
    } else if (S.pedindoMotivo) {
      acoes = '<h3>Qual o motivo do descarte?</h3><div class="escolhas">' +
        N.MOTIVOS.map((mo) => '<button type="button" class="escolha" data-bip="' + N.CODIGO.motivo(mo) + '"><strong>' + esc(mo) + '</strong></button>').join('') + '</div>' +
        '<div class="barra"><button type="button" class="bt" data-acao="sem-motivo">Voltar</button></div>';
    } else {
      acoes = '<div class="leitor-acoes">' +
        '<button type="button" class="bt bt-prim bt-enorme" data-bip="' + N.CODIGO.usado + '">Usado</button>' +
        '<button type="button" class="bt bt-perigo bt-enorme" data-bip="' + N.CODIGO.descartar + '">Descartar</button></div>' +
        '<div class="barra"><button type="button" class="bt" data-bip="' + N.CODIGO.cancelar + '">Voltar</button>' +
        (PREVIA ? '' : '<button type="button" class="bt" data-reimprimir="' + e.id + '">Reimprimir</button>') + '</div>';
    }
    return '<section class="cartao leitor-cartao">' +
      '<p class="sobre">Etiqueta Nº ' + N.fmtCodigo(e.cod) + ' · ' + N.TIPO[e.tipo].nome + '</p>' +
      '<h2 class="leitor-nome">' + esc(e.nome) + '</h2>' +
      (ativa ? '<p><span class="pill pill-grande p-' + sit + '">' + ICO[sit] + esc(N.textoRestante(e.venceEm, agora(), e.porHora)) + '</span></p>' : '') +
      '<p class="item-meta">' + esc(meta) + '</p>' +
      '<p class="item-datas mono">feito ' + quandoFeito(e) + ' · vence ' + quandoVence(e) + '</p>' +
      (e.origens.length ? '<p class="item-datas">Feito com ' + esc(origensTexto(e.origens)) + '</p>' : '') +
      acoes + '</section>';
  }

  function leitorRodape() {
    const S = UI.S;
    const equipe = D.config.equipe.concat(S.operador && D.config.equipe.indexOf(S.operador) < 0 ? [S.operador] : []);
    return '<section class="leitor-pe">' +
      '<div class="barra">' +
      (equipe.length
        ? '<label class="campo curto">Quem está trabalhando<select id="leitor-operador"><option value="">Não informar</option>' +
          equipe.map((n) => '<option' + (n === S.operador ? ' selected' : '') + '>' + esc(n) + '</option>').join('') + '</select></label>'
        : '') +
      '<button type="button" class="bt empurra" data-acao="abrir-cartela">' + ICO_BARRAS + 'Cartela de códigos</button></div>' +
      (UI.log.length
        ? '<h2 class="grupo">Últimas leituras</h2><ul class="itens leituras">' +
          UI.log.map((l) => '<li class="item"><span class="mono">' + N.fmtHora(l.t) + '</span>' + (l.ok ? ICO.ok : ICO.vencido) + '<span>' + esc(l.msg) + '</span></li>').join('') + '</ul>'
        : '') +
      '</section>';
  }

  // ---------- cartela de códigos ----------
  const MM_CARTELA = 0.33;   // largura do módulo na folha A4, em mm
  const COLUNA_CARTELA = 56; // largura útil de uma coluna, em mm: código mais largo ocupa duas

  function cartelaHtml() {
    const celula = (item) => {
      const b = barras(item.codigo);
      const larg = b.total * MM_CARTELA;
      return '<div class="cart-cel' + (larg > COLUNA_CARTELA ? ' dupla' : '') + '">' + b.svg('width:' + larg.toFixed(2) + 'mm') +
        '<strong>' + esc(item.nome) + '</strong><span class="mono">' + esc(item.codigo) + '</span></div>';
    };
    return '<div class="cart"><header class="cart-topo"><strong>Cartela de códigos</strong><span>' + esc(D.config.casa ? D.config.casa + ' · ' : '') + N.fmtDataAno(agora()) + '</span></header>' +
      N.cartela(D).map((s) => '<section class="cart-sec"><h3>' + esc(s.titulo) + '</h3><div class="cart-grade">' + s.itens.map(celula).join('') + '</div></section>').join('') +
      '</div>';
  }

  // A mesma cartela, um código por etiqueta, para quem só tem a impressora de etiquetas.
  function cartelaEmEtiquetas() {
    const t = N.medidas(D.config.tamanho);
    let fora = 0;
    const html = N.cartela(D).map((s) => s.itens.map((item) => {
      const b = barrasNaEtiqueta(item.codigo, t);
      if (!b) { fora++; return ''; }
      return '<div class="etq etq-codigo" style="--l:' + t.l + ';--a:' + t.a + '"><div class="etq-dentro">' +
        '<div class="etq-topo"><span>' + esc(s.titulo.toUpperCase()) + '</span></div>' +
        '<div class="etq-nome' + (item.nome.length > 18 ? ' longo' : '') + '">' + esc(item.nome) + '</div>' + b +
        '<div class="etq-rodape"><span class="etq-num">' + esc(item.codigo) + '</span></div></div></div>';
    }).join('')).join('');
    return { html, fora, t };
  }

  function telaCartela() {
    const semCodigo = D.produtos.filter((p) => !p.codigo).length;
    return '<div class="barra"><button type="button" class="bt" data-acao="fechar-cartela">Voltar ao leitor</button>' +
      (PREVIA ? '' : '<button type="button" class="bt bt-prim empurra" data-acao="imprimir-cartela">Imprimir em folha A4</button>' +
        '<button type="button" class="bt" data-acao="imprimir-cartela-etq">Imprimir em etiquetas</button>') + '</div>' +
      '<p class="dica">Imprima e deixe na bancada, de preferência plastificada. Quem opera lê o código do produto, o número de etiquetas e IMPRIMIR, sem digitar nada. ' +
      (semCodigo ? plural(semCodigo, 'produto sem código ficou', 'produtos sem código ficaram') + ' de fora: preencha o código na aba Produtos. ' : '') +
      'Ao mudar a equipe, os locais ou os produtos, imprima de novo.</p>' +
      '<div class="rola folha">' + cartelaHtml() + '</div>';
  }

  // ---------- Etiquetar ----------
  function telaEtiquetar() {
    const p = UI.r.produtoId && D.produtos.find((x) => x.id === UI.r.produtoId);
    if (!p) { UI.r.produtoId = ''; return seletorProdutos(); }
    return formularioEtiqueta(p);
  }

  function seletorProdutos() {
    if (!D.produtos.length) {
      return vazioHtml('Nenhum produto cadastrado', 'Cadastre na aba Produtos o que a casa etiqueta, cada item com o seu código e a sua validade.') +
        '<div><button type="button" class="bt bt-prim" data-aba="produtos">Abrir Produtos</button></div>';
    }
    const doTipo = D.produtos.filter((p) => !UI.tipoEtq || p.tipo === UI.tipoEtq);
    const gs = N.grupos({ produtos: doTipo });
    if (UI.grupo && gs.indexOf(UI.grupo) < 0) UI.grupo = '';
    const botao = (attr, valor, atual, rotulo) => '<button type="button" ' + attr + '="' + esc(valor) + '" class="' + (atual === valor ? 'on' : '') + '" aria-pressed="' + (atual === valor) + '">' + esc(rotulo) + '</button>';
    return '<h2>Qual produto vai ser etiquetado?</h2>' +
      '<div class="barra"><input type="search" id="etq-busca" placeholder="Buscar produto ou código" aria-label="Buscar produto ou código" value="' + esc(UI.etqBusca) + '"></div>' +
      '<div class="filtro-tipos filtro" role="group" aria-label="Tipo">' + botao('data-tipo-etq', '', UI.tipoEtq, 'Todos os tipos') +
      N.TIPOS.map((t) => botao('data-tipo-etq', t.id, UI.tipoEtq, t.nome)).join('') + '</div>' +
      '<div class="filtro-grupos filtro" role="group" aria-label="Grupo">' + botao('data-grupo', '', UI.grupo, 'Todos') + gs.map((g) => botao('data-grupo', g, UI.grupo, g)).join('') + '</div>' +
      '<div id="lista">' + gradeProdutos() + '</div>';
  }

  function gradeProdutos() {
    const termo = UI.etqBusca.trim().toLowerCase();
    const ps = D.produtos.filter((p) => (!UI.tipoEtq || p.tipo === UI.tipoEtq) && (!UI.grupo || p.grupo === UI.grupo) &&
      (!termo || (p.nome + ' ' + p.codigo).toLowerCase().indexOf(termo) >= 0)).sort(porNome);
    if (!ps.length) return vazioHtml('Nada encontrado', 'Nenhum produto com esse nome ou código neste filtro.');
    return '<div class="grade">' + ps.map((p) =>
      '<button type="button" class="prod" data-produto="' + p.id + '"><strong>' + esc(p.nome) + '</strong><span>' + esc(validadesTexto(p).join(' · ')) + '</span>' +
      (p.codigo ? '<span class="mono">' + esc(p.codigo) + '</span>' : '') + '</button>').join('') + '</div>';
  }

  // Lista de escolha com o que vem dos Ajustes; sem nada cadastrado lá, vira campo de texto.
  function escolha(id, lista, valor, rotuloVazio, dica) {
    if (!lista.length) return '<input type="text" id="' + id + '" maxlength="40" placeholder="' + esc(dica) + '" value="' + esc(valor) + '">';
    const extra = valor && lista.indexOf(valor) < 0 ? [valor] : [];
    return '<select id="' + id + '"><option value="">' + esc(rotuloVazio) + '</option>' +
      lista.concat(extra).map((v) => '<option' + (v === valor ? ' selected' : '') + '>' + esc(v) + '</option>').join('') + '</select>';
  }

  function formularioEtiqueta(p) {
    const r = UI.r;
    const modos = N.modosDoProduto(p);
    if (!modos.some((m) => m.id === r.modo)) r.modo = modos[0].id;
    return '<div class="duas">' +
      '<form id="form-etq" class="cartao" novalidate>' +
      '<div class="form-topo"><div><strong>' + esc(p.nome) + '</strong><span>' + esc([N.TIPO[p.tipo].nome, p.grupo, p.codigo].filter(Boolean).join(' · ')) + '</span></div>' +
      '<button type="button" class="bt" data-acao="trocar-produto">Trocar produto</button></div>' +
      '<fieldset><legend>Conservação</legend><div class="segmentos">' +
      modos.map((m) => '<label><input type="radio" name="modo" id="modo-' + m.id + '" value="' + m.id + '"' + (m.id === r.modo ? ' checked' : '') + '>' +
        '<strong>' + m.nome + ' · ' + N.fmtValidade(p.validades[m.id]) + '</strong><span>' + m.faixa + '</span></label>').join('') +
      '</div></fieldset>' +
      '<div class="campos">' +
      '<label class="campo">Local' + escolha('etq-local', D.config.locais, r.local, 'Não informar', 'ex.: Câmara fria') + '</label>' +
      '<label class="campo">Responsável' + escolha('etq-resp', D.config.equipe, r.responsavel, 'Não informar', 'quem preparou') + '</label>' +
      '<label class="campo">Quantidade<input type="text" id="etq-qtd" maxlength="20" placeholder="ex.: 2 kg" autocomplete="off" value="' + esc(r.qtd) + '"></label>' +
      '<div class="campo"><label for="etq-copias">Número de etiquetas</label><div class="passo">' +
      '<button type="button" data-passo="-1" aria-label="Uma etiqueta a menos">−</button>' +
      '<input type="number" id="etq-copias" min="1" max="' + N.MAX_COPIAS + '" inputmode="numeric" value="' + esc(r.copias) + '">' +
      '<button type="button" data-passo="1" aria-label="Uma etiqueta a mais">+</button></div></div>' +
      '<label class="campo">' + (p.tipo === 'mp' ? 'Entrada' : 'Preparo') + '<select id="etq-quando"><option value="agora"' + (r.quando === 'agora' ? ' selected' : '') + '>Agora</option>' +
      '<option value="outra"' + (r.quando === 'outra' ? ' selected' : '') + '>Outra data e hora</option></select></label>' +
      '<label class="campo" id="etq-feito-campo"' + (r.quando === 'outra' ? '' : ' hidden') + '>Data e hora<input type="datetime-local" id="etq-feito" value="' + esc(r.feito) + '"></label>' +
      '</div>' +
      '<details id="etq-orig"' + (r.origAberto ? ' open' : '') + '><summary>Produto aberto da embalagem original</summary>' +
      '<div class="campos">' +
      '<label class="campo">Lote do fabricante<input type="text" id="etq-lote" maxlength="20" autocomplete="off" value="' + esc(r.lote) + '"></label>' +
      '<label class="campo">Validade do fabricante<input type="date" id="etq-valorig" value="' + esc(r.valOrig) + '"></label>' +
      '</div><p class="dica">A validade da etiqueta nunca passa da validade do fabricante.</p></details>' +
      '<p class="erro" id="etq-erro" role="alert" hidden></p>' +
      '<button type="submit" class="bt bt-prim bt-grande" id="emitir"></button>' +
      '</form>' +
      '<aside class="previa-col"><h2>Prévia da etiqueta</h2><div id="previa"></div><p class="dica" id="previa-nota"></p></aside>' +
      '</div>';
  }

  const agoraLocal = () => { const t = agora(); return N.dataIso(t) + 'T' + N.fmtHora(t); };

  function lerForm() {
    const f = $('#form-etq');
    if (!f) return;
    const r = UI.r;
    const modo = f.querySelector('input[name="modo"]:checked');
    r.modo = modo ? modo.value : '';
    r.local = $('#etq-local').value;
    r.responsavel = $('#etq-resp').value;
    r.qtd = $('#etq-qtd').value;
    r.copias = $('#etq-copias').value;
    r.quando = $('#etq-quando').value;
    r.feito = $('#etq-feito').value;
    r.lote = $('#etq-lote').value;
    r.valOrig = $('#etq-valorig').value;
    r.origAberto = $('#etq-orig').open;
  }

  // O rascunho no formato que o núcleo espera. feitoEm 0 = agora.
  function pedido() {
    const r = UI.r;
    let feitoEm = 0;
    if (r.quando === 'outra') {
      const t = new Date(r.feito).getTime();
      if (isNaN(t)) return { erro: 'Informe a data e a hora.' };
      feitoEm = t;
    }
    return { produtoId: r.produtoId, modo: r.modo, local: r.local, responsavel: r.responsavel, qtd: r.qtd, copias: r.copias, feitoEm, loteOrigem: r.lote, validadeOrigem: r.valOrig };
  }

  function atualizarPrevia() {
    if (!$('#form-etq')) return;
    const campoFeito = $('#etq-feito');
    if ($('#etq-quando').value === 'outra' && !campoFeito.value) campoFeito.value = agoraLocal();
    campoFeito.max = agoraLocal();
    lerForm();
    $('#etq-feito-campo').hidden = UI.r.quando !== 'outra';
    $('#etq-erro').hidden = true;
    const p = pedido();
    const m = p.erro ? p : N.montar(D, p, agora());
    const n = m.copias || 1;
    $('#emitir').textContent = (PREVIA ? 'Registrar ' : 'Imprimir e registrar ') + plural(n, 'etiqueta', 'etiquetas');
    if (m.erro) {
      $('#previa').innerHTML = '<div class="vazio">' + esc(m.erro) + '</div>';
      $('#previa-nota').textContent = '';
      return;
    }
    $('#previa').innerHTML = etiquetaHtml(Object.assign({ cod: D.seq + 1 }, m.base));
    const prod = D.produtos.find((x) => x.id === UI.r.produtoId);
    const modo = N.MODO[m.base.modo];
    $('#previa-nota').textContent = 'Validade de ' + N.fmtValidade(prod.validades[modo.id]) + ' em ' + modo.nome.toLowerCase() + ' (' + modo.faixa + ').' +
      (m.base.limitada ? ' Encurtada pela validade do fabricante.' : '') +
      (D.config.contarDiaPreparo && !m.base.porHora && !m.base.limitada ? ' O dia do preparo conta como 1º dia.' : '') +
      (n > 1 ? ' As ' + n + ' etiquetas saem numeradas de ' + N.fmtCodigo(D.seq + 1) + ' a ' + N.fmtCodigo(D.seq + n) + '.' : '');
  }

  function emitirEtiquetas() {
    lerForm();
    const p = pedido();
    const r = p.erro ? p : N.emitir(D, p, agora());
    if (r.erro) {
      const erro = $('#etq-erro');
      erro.textContent = r.erro;
      erro.hidden = false;
      return;
    }
    gravar();
    const n = r.etiquetas.length;
    UI.r = rascunho(UI.r);
    render();
    window.scrollTo(0, 0);
    avisar((n === 1 ? 'Etiqueta Nº ' + N.fmtCodigo(r.etiquetas[0].cod) + ' registrada.' : n + ' etiquetas registradas.') +
      (PREVIA ? ' Nesta prévia a impressão fica desligada.' : ''), { rotulo: 'Ver validades', fn: () => ir('validades') });
    imprimir(r.etiquetas);
  }

  // ---------- Produtos ----------
  function telaProdutos() {
    return '<div class="barra">' +
      '<input type="search" id="prod-busca" placeholder="Buscar produto, código ou grupo" aria-label="Buscar produto, código ou grupo" value="' + esc(UI.prodBusca) + '">' +
      '<button type="button" class="bt bt-prim" data-acao="novo-produto">Novo produto</button></div>' +
      (D.exemplo ? '<p class="dica">Os códigos e os prazos deste catálogo são exemplos. Use os códigos que a casa já tem e defina cada prazo com o responsável técnico e as regras da vigilância sanitária da sua cidade.</p>' : '') +
      '<div id="lista">' + listaProdutos() + '</div>';
  }

  function listaProdutos() {
    if (!D.produtos.length) return vazioHtml('Nenhum produto cadastrado', 'Cadastre o que a casa etiqueta: matéria-prima, produto em processo e produto acabado, cada item com o seu código e a sua validade.');
    const termo = UI.prodBusca.trim().toLowerCase();
    const ps = D.produtos.filter((p) => !termo || (p.nome + ' ' + p.grupo + ' ' + p.codigo).toLowerCase().indexOf(termo) >= 0);
    if (!ps.length) return vazioHtml('Nada encontrado', 'Nenhum produto, código ou grupo com esse nome.');
    return N.TIPOS.map((t) => {
      const doTipo = ps.filter((p) => p.tipo === t.id).sort((a, b) => a.grupo.localeCompare(b.grupo, 'pt-BR') || porNome(a, b));
      if (!doTipo.length) return '';
      return '<section class="bloco"><h2 class="grupo">' + t.nome + ' <span class="n">' + doTipo.length + '</span></h2><ul class="itens">' +
        doTipo.map((p) =>
          '<li class="item"><div class="item-info"><div class="item-nome"><span>' + esc(p.nome) + '</span></div>' +
          '<div class="item-meta">' + (p.codigo ? '<span class="mono">' + esc(p.codigo) + '</span>' : 'sem código') + ' · ' + esc(p.grupo) + '</div>' +
          '<div class="chips">' + validadesTexto(p).map((v) => '<span class="chip">' + esc(v) + '</span>').join('') + '</div></div>' +
          '<div class="item-acoes"><button type="button" class="bt" data-etiquetar="' + p.id + '">Etiquetar</button>' +
          '<button type="button" class="bt" data-editar="' + p.id + '">Editar</button></div></li>').join('') +
        '</ul></section>';
    }).join('');
  }

  // sugestao: { codigo } quando o cadastro nasce de um código lido que o app não conhecia.
  function dialogoProduto(id, sugestao, depois) {
    const p = id ? D.produtos.find((x) => x.id === id) : null;
    const tipoAtual = p ? p.tipo : 'mp';
    abrir(
      '<h2 id="dlg-titulo">' + (p ? 'Editar produto' : 'Novo produto') + '</h2>' +
      '<label class="campo">Nome<input type="text" id="p-nome" name="nome" maxlength="60" autocomplete="off" value="' + esc(p ? p.nome : '') + '"></label>' +
      '<label class="campo">Código<input type="text" id="p-codigo" name="codigo" maxlength="20" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="o código que a casa já usa" value="' + esc(p ? p.codigo : (sugestao && sugestao.codigo) || '') + '">' +
      '<span class="dica">É ele que vai em barras na cartela. Pode ser também o código de barras da caixa do fornecedor.</span></label>' +
      '<fieldset><legend>Tipo</legend><div class="segmentos">' +
      N.TIPOS.map((t) => '<label><input type="radio" name="tipo" id="p-tipo-' + t.id + '" value="' + t.id + '"' + (t.id === tipoAtual ? ' checked' : '') + '><strong>' + t.nome + '</strong></label>').join('') +
      '</div></fieldset>' +
      '<label class="campo">Grupo<input type="text" id="p-grupo" name="grupo" maxlength="30" list="p-grupos" autocomplete="off" placeholder="ex.: Pescados" value="' + esc(p ? p.grupo : '') + '">' +
      '<datalist id="p-grupos">' + N.grupos(D).map((g) => '<option value="' + esc(g) + '">').join('') + '</datalist></label>' +
      '<fieldset><legend>Validade depois de recebido, preparado ou aberto</legend>' +
      N.MODOS.map((m) => {
        const v = p && p.validades[m.id];
        return '<div class="linha-val"><span>' + m.nome + '<small>' + m.faixa + '</small></span>' +
          '<input type="number" id="p-n-' + m.id + '" name="n-' + m.id + '" min="1" max="999" inputmode="numeric" aria-label="Validade em ' + m.nome.toLowerCase() + '" value="' + (v ? v.n : '') + '">' +
          '<select id="p-un-' + m.id + '" name="un-' + m.id + '" aria-label="Unidade da validade em ' + m.nome.toLowerCase() + '">' +
          '<option value="d">dias</option><option value="h"' + (v && v.un === 'h' ? ' selected' : '') + '>horas</option></select></div>';
      }).join('') +
      '<p class="dica">Deixe em branco os modos que não valem para este produto.</p></fieldset>' +
      '<p class="erro" id="dlg-erro" role="alert" hidden></p>' +
      '<div class="dlg-pe">' +
      (p ? '<button type="button" class="bt bt-perigo esq" data-acao="excluir-produto" data-id="' + p.id + '">Excluir</button>' : '') +
      '<button type="button" class="bt" data-acao="fechar">Cancelar</button><button type="submit" class="bt bt-prim">Salvar</button></div>',
      (fd) => {
        const validades = {};
        N.MODOS.forEach((m) => { if (fd.get('n-' + m.id)) validades[m.id] = { n: fd.get('n-' + m.id), un: fd.get('un-' + m.id) }; });
        const r = N.salvarProduto(D, { id: p ? p.id : '', codigo: fd.get('codigo'), tipo: fd.get('tipo'), nome: fd.get('nome'), grupo: fd.get('grupo'), validades });
        if (r.erro) {
          const erro = $('#dlg-erro');
          erro.textContent = r.erro;
          erro.hidden = false;
          return false;
        }
        gravar();
        render();
        avisar(r.produto.nome + ' salvo no catálogo.');
        if (depois) depois(r.produto);
      });
  }

  // ---------- Perdas ----------
  function telaPerdas() {
    const R = N.relatorio(D, agora(), UI.periodo);
    const tile = (valor, rotulo, sub) => '<div class="tile"><span class="tile-n">' + valor + '</span><span class="tile-r">' + rotulo + '</span>' + (sub ? '<span class="tile-s">' + sub + '</span>' : '') + '</div>';
    const grafico = (lista, extra, nomeDoQue) => {
      const max = lista.reduce((m, x) => Math.max(m, x.n), 0);
      return '<div class="barras">' + lista.map((x) =>
        '<span class="b-nome">' + esc(x.nome) + '</span>' +
        '<span class="b-trilho" title="' + esc(x.nome) + ': ' + plural(x.n, nomeDoQue[0], nomeDoQue[1]) + '"><span class="b-val" style="width:' + (x.n / max * 100).toFixed(1) + '%"></span></span>' +
        '<span class="b-n">' + x.n + (extra ? ' <small>' + extra(x) + '</small>' : '') + '</span>').join('') + '</div>';
    };
    const opcao = (dias) => '<label><input type="radio" name="periodo" id="periodo-' + dias + '" value="' + dias + '"' + (UI.periodo === dias ? ' checked' : '') + '>' + dias + ' dias</label>';
    const semDescarte = '<p class="dica">Nenhum descarte registrado neste período.</p>';
    const TAG_USADA = '<span class="tag">' + ICO.ok.replace('class="ico ico-ok"', 'class="ico-ok"') + 'Usada</span>';
    const TAG_DESCARTADA = '<span class="tag">' + ICO.vencido.replace('class="ico ico-vencido"', 'class="ico-vencido"') + 'Descartada</span>';
    return '<div class="barra"><div class="segmentos peq" role="radiogroup" aria-label="Período">' + opcao(7) + opcao(30) + '</div>' +
      (PREVIA ? '' : '<button type="button" class="bt empurra" data-acao="exportar">Exportar planilha</button>') + '</div>' +
      '<section class="tiles" aria-label="Resumo do período">' +
      tile(R.emitidas, 'Etiquetas emitidas') +
      tile(R.usadas, 'Usadas') +
      tile(R.descartadas, 'Descartadas') +
      tile(R.aproveitamento == null ? '–' : R.aproveitamento + '%', 'Aproveitamento', 'usadas sobre as baixadas') +
      '</section>' +
      '<div class="duas-iguais">' +
      '<section class="cartao"><h2>Descartes por motivo</h2>' + (R.porMotivo.length ? grafico(R.porMotivo, null, ['descarte', 'descartes']) : semDescarte) + '</section>' +
      '<section class="cartao"><h2>Produtos mais descartados</h2>' +
      (R.porProduto.length
        ? grafico(R.porProduto.slice(0, 6), (x) => 'de ' + x.total, ['etiqueta descartada', 'etiquetas descartadas']) +
          '<p class="dica">Etiquetas descartadas sobre o total de etiquetas baixadas do produto.</p>'
        : semDescarte) + '</section>' +
      '</div>' +
      '<section class="bloco"><h2 class="grupo">Últimas baixas <span class="n">' + Math.min(R.baixas.length, 25) + ' de ' + R.baixas.length + '</span></h2>' +
      (R.baixas.length
        ? '<div class="rola"><table><thead><tr><th>Quando</th><th>Produto</th><th>Baixa</th><th>Motivo</th><th>Por</th></tr></thead><tbody>' +
          R.baixas.slice(0, 25).map((e) =>
            '<tr><td class="mono">' + N.fmtData(e.baixaEm) + ' ' + N.fmtHora(e.baixaEm) + '</td><td class="quebra">' + esc(e.nome) + '</td>' +
            '<td>' + (e.status === 'usada' ? TAG_USADA : TAG_DESCARTADA) + '</td><td>' + esc(e.motivo || '') + '</td><td>' + esc(e.baixaPor || '') + '</td></tr>').join('') +
          '</tbody></table></div>'
        : vazioHtml('Nenhuma baixa no período', 'As etiquetas marcadas como usadas ou descartadas aparecem aqui.')) +
      '</section>';
  }

  // ---------- Ajustes ----------
  function telaAjustes() {
    const c = D.config;
    const t = N.medidas(c.tamanho);
    const outro = !N.TAMANHOS[c.tamanho];
    const opcao = (valor, rotulo, atual) => '<option value="' + valor + '"' + (valor === atual ? ' selected' : '') + '>' + rotulo + '</option>';
    return '<section class="cartao"><h2>Estabelecimento</h2>' +
      '<label class="campo curto">Nome que sai na etiqueta<input type="text" id="cfg-casa" maxlength="40" autocomplete="off" value="' + esc(c.casa) + '"></label>' +
      '</section>' +

      '<section class="cartao"><h2>Impressora e etiqueta</h2>' +
      '<div class="campos-linha">' +
      '<label class="campo">Tamanho da etiqueta do rolo<select id="cfg-tamanho">' +
      Object.keys(N.TAMANHOS).map((k) => opcao(k, N.TAMANHOS[k].nome, outro ? '' : c.tamanho)).join('') + opcao('outro', 'Outro tamanho', outro ? 'outro' : '') + '</select></label>' +
      '<label class="campo" id="cfg-larg-campo"' + (outro ? '' : ' hidden') + '>Largura (mm)<input type="number" id="cfg-larg" min="' + N.LARGURA[0] + '" max="' + N.LARGURA[1] + '" inputmode="numeric" value="' + t.l + '"></label>' +
      '<label class="campo" id="cfg-alt-campo"' + (outro ? '' : ' hidden') + '>Altura (mm)<input type="number" id="cfg-alt" min="' + N.ALTURA[0] + '" max="' + N.ALTURA[1] + '" inputmode="numeric" value="' + t.a + '"></label>' +
      '</div>' +
      '<p class="erro" id="cfg-tam-erro" role="alert" hidden>A largura vai de ' + N.LARGURA[0] + ' a ' + N.LARGURA[1] + ' mm e a altura de ' + N.ALTURA[0] + ' a ' + N.ALTURA[1] + ' mm. O tamanho anterior foi mantido.</p>' +
      (PREVIA ? '' : '<div class="barra"><button type="button" class="bt bt-prim" data-acao="etiqueta-teste">' + ICO_IMPRIMIR + 'Imprimir etiqueta de teste</button></div>') +
      '<details id="ajuda-impressora"><summary>Como configurar e escolher a impressora (Zebra GC420)</summary><ol class="passos">' +
      '<li><strong>Instale o driver da Zebra no Windows.</strong> Ele está na página de suporte da GC420 no site da Zebra. Depois disso a impressora aparece em Configurações → Bluetooth e dispositivos → Impressoras e scanners.</li>' +
      '<li><strong>Diga ao driver o tamanho da etiqueta.</strong> Clique na Zebra → Preferências de impressão e informe a largura e a altura da etiqueta do rolo, em milímetros. No mesmo lugar fica o tipo de papel: térmico direto, ou transferência térmica se a sua usa fita (ribbon).</li>' +
      '<li><strong>Calibre o papel.</strong> Com o rolo colocado e a tampa fechada, faça a calibração de mídia como está no manual da impressora, para ela achar o começo de cada etiqueta.</li>' +
      '<li><strong>Escolha aqui o mesmo tamanho</strong> e toque em “Imprimir etiqueta de teste”.</li>' +
      '<li><strong>Na janela de impressão do navegador:</strong> em Destino, escolha a Zebra. Em Mais definições: tamanho do papel igual ao da etiqueta, Margens “Nenhuma”, Escala 100 e “Cabeçalhos e rodapés” desmarcado. O navegador lembra dessa escolha nas próximas vezes.</li>' +
      '<li><strong>Confira com o leitor.</strong> Abra a aba Leitor e leia o código de barras da etiqueta de teste. Aparecendo “Etiqueta de teste lida”, impressora e leitor estão certos.</li>' +
      '</ol><p class="dica">As barras foram dimensionadas para os 203 dpi da GC420 (8 pontos por milímetro). Se saírem claras, aumente a tonalidade (darkness) nas preferências do driver; se a etiqueta sair deslocada, repita a calibração.</p></details>' +
      '</section>' +

      '<section class="cartao"><h2>Leitor e tela</h2>' +
      '<label class="campo curto">Tamanho das letras<select id="cfg-letra">' + opcao('normal', 'Normal', c.letra) + opcao('grande', 'Grande', c.letra) + opcao('maior', 'Muito grande', c.letra) + '</select></label>' +
      '<label class="check"><input type="checkbox" id="cfg-som"' + (c.som ? ' checked' : '') + '>Som a cada leitura' +
      '<span class="dica">Um bipe curto quando o código foi entendido e um som grave quando não foi.</span></label>' +
      '</section>' +

      '<section class="cartao"><h2>Regras de validade</h2>' +
      '<label class="campo curto">Avisar quando faltarem até quantos dias<input type="number" id="cfg-alerta" min="1" max="15" inputmode="numeric" value="' + c.alertaDias + '"></label>' +
      '<label class="check"><input type="checkbox" id="cfg-contar"' + (c.contarDiaPreparo ? ' checked' : '') + '>O dia do preparo conta como 1º dia' +
      '<span class="dica">Ligado: validade de 3 dias feita na segunda vence na quarta. Desligado: vence na quinta. Vale para as próximas etiquetas.</span></label>' +
      '</section>' +

      '<section class="cartao"><h2>Locais e equipe</h2>' +
      '<label class="campo">Locais de armazenamento, um por linha<textarea id="cfg-locais" rows="5">' + esc(c.locais.join('\n')) + '</textarea></label>' +
      '<label class="campo">Equipe, um nome por linha<textarea id="cfg-equipe" rows="5">' + esc(c.equipe.join('\n')) + '</textarea></label>' +
      '</section>' +

      '<section class="cartao"><h2>Dados</h2>' +
      '<p class="dica">Neste esboço tudo fica guardado só neste aparelho. ' +
      (PREVIA ? 'Na prévia, a impressão e os arquivos (planilha e cópia de segurança) ficam desligados.' : 'Faça uma cópia de segurança antes de trocar de aparelho ou limpar o navegador.') + '</p>' +
      '<div class="barra">' +
      (PREVIA ? '' : '<button type="button" class="bt" data-acao="backup">Baixar cópia de segurança</button>' +
        '<button type="button" class="bt" data-acao="restaurar">Restaurar cópia</button><input type="file" id="arq" accept="application/json,.json" hidden>') +
      '<button type="button" class="bt" data-acao="exemplos">Carregar dados de exemplo</button>' +
      '<button type="button" class="bt bt-perigo" data-acao="apagar">Apagar tudo</button></div>' +
      '</section>' +
      '<p class="dica">Validade em Dia · esboço ' + VERSAO + '</p>';
  }

  function salvarAjustes() {
    const escolhido = $('#cfg-tamanho').value;
    const outro = escolhido === 'outro';
    $('#cfg-larg-campo').hidden = $('#cfg-alt-campo').hidden = !outro;
    const tamanho = N.limparTamanho(outro ? $('#cfg-larg').value + 'x' + $('#cfg-alt').value : escolhido);
    $('#cfg-tam-erro').hidden = !!tamanho;
    D.config = N.limparConfig({
      casa: $('#cfg-casa').value,
      tamanho: tamanho || D.config.tamanho,
      alertaDias: $('#cfg-alerta').value,
      contarDiaPreparo: $('#cfg-contar').checked,
      letra: $('#cfg-letra').value,
      som: $('#cfg-som').checked,
      locais: $('#cfg-locais').value,
      equipe: $('#cfg-equipe').value,
    });
    $('#cfg-alerta').value = D.config.alertaDias;
    gravar();
    cabecalho();
  }

  function baixar(nome, conteudo, tipo) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([conteudo], { type: tipo }));
    a.download = nome;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  function restaurar(campo) {
    const arq = campo.files && campo.files[0];
    campo.value = '';
    if (!arq) return;
    const leitor = new FileReader();
    leitor.onload = () => {
      const novo = N.carregar(String(leitor.result));
      if (!novo) { avisar('Esse arquivo não é uma cópia de segurança do Validade em Dia.'); return; }
      confirmar('Restaurar esta cópia?',
        'Ela tem ' + plural(novo.produtos.length, 'produto', 'produtos') + ' e ' + plural(novo.etiquetas.length, 'etiqueta', 'etiquetas') + '. Tudo o que está neste aparelho será substituído.',
        'Restaurar', () => { trocarDados(novo); avisar('Cópia restaurada.'); });
    };
    leitor.onerror = () => avisar('Não foi possível ler o arquivo. Tente de novo.');
    leitor.readAsText(arq);
  }

  function trocarDados(novo) {
    D = novo;
    UI.r = rascunho();
    UI.S = N.sessao();
    UI.retorno = null;
    UI.log = [];
    UI.sit = UI.local = UI.tipo = UI.busca = UI.grupo = UI.tipoEtq = UI.etqBusca = UI.prodBusca = '';
    gravar();
    render();
  }

  const ACOES = {
    fechar: () => dlg.close(),
    // O que já foi preenchido continua, menos o lote e a validade do fabricante, que são da embalagem do produto anterior.
    'trocar-produto': () => { lerForm(); Object.assign(UI.r, { produtoId: '', lote: '', valOrig: '', origAberto: false }); render(); },
    'novo-produto': () => dialogoProduto(''),
    'excluir-produto': (b) => {
      // Primeiro toque arma, segundo exclui.
      if (!b.dataset.armado) { b.dataset.armado = '1'; b.textContent = 'Confirmar exclusão'; return; }
      const p = D.produtos.find((x) => x.id === b.dataset.id);
      N.excluirProduto(D, b.dataset.id);
      if (UI.r.produtoId === b.dataset.id) UI.r.produtoId = '';
      gravar();
      dlg.close();
      render();
      avisar((p ? p.nome : 'Produto') + ' excluído. As etiquetas já emitidas continuam no histórico.');
    },
    exportar: () => baixar('validade-em-dia-' + N.dataIso(agora()) + '.csv', '﻿' + N.csv(D, agora()), 'text/csv;charset=utf-8'),
    backup: () => baixar('validade-em-dia-' + N.dataIso(agora()) + '.json', JSON.stringify(D), 'application/json'),
    restaurar: () => $('#arq').click(),
    exemplos: () => confirmar('Carregar os dados de exemplo?', 'O catálogo, as etiquetas e os ajustes deste aparelho serão substituídos pelo exemplo.',
      'Carregar exemplo', () => { trocarDados(N.exemplo(agora())); avisar('Dados de exemplo carregados.'); }),
    apagar: () => confirmar('Apagar tudo?', 'Produtos, etiquetas, histórico e ajustes deste aparelho serão apagados. Não dá para desfazer.',
      'Apagar tudo', () => { trocarDados(N.vazio()); avisar('Tudo apagado. Comece cadastrando os produtos.'); }, true),
    zerar: () => abrir(
      '<h2 id="dlg-titulo">Começar do zero</h2>' +
      '<p>As etiquetas, o histórico, a equipe e o nome de exemplo serão apagados.</p>' +
      '<label class="check"><input type="checkbox" name="manter" id="zerar-manter" checked>Manter o catálogo de exemplo' +
      '<span class="dica">Fica como ponto de partida: depois é só trocar os códigos, os produtos e os prazos.</span></label>' +
      '<div class="dlg-pe"><button type="button" class="bt" data-acao="fechar">Cancelar</button><button type="submit" class="bt bt-prim">Começar do zero</button></div>',
      (fd) => {
        const novo = N.vazio();
        Object.assign(novo.config, { locais: D.config.locais, tamanho: D.config.tamanho, letra: D.config.letra, som: D.config.som });
        if (fd.get('manter')) { novo.produtos = D.produtos; novo.seqProd = D.seqProd; }
        trocarDados(novo);
        avisar('Pronto. Passe nos Ajustes para colocar o nome da casa e a equipe.');
      }),

    // Impressora
    'etiqueta-teste': () => {
      const t = agora();
      imprimir([{
        cod: 0, tipo: 'pp', nome: 'Etiqueta de teste', modo: 'resfriado', feitoEm: t, venceEm: N.fimDoDia(N.somarDias(t, 3)), porHora: false,
        responsavel: '', local: 'Leia este código na aba Leitor', qtd: '', loteOrigem: '', origens: [],
      }]);
    },

    // Leitor
    'abrir-cartela': () => { UI.cartela = true; render(); window.scrollTo(0, 0); },
    'fechar-cartela': () => { UI.cartela = false; render(); },
    'imprimir-cartela': () => imprimirHtml(cartelaHtml(), 'size: A4; margin: 10mm'),
    'imprimir-cartela-etq': () => {
      const c = cartelaEmEtiquetas();
      if (c.fora) avisar(plural(c.fora, 'código não coube', 'códigos não couberam') + ' na largura desta etiqueta e ' + (c.fora === 1 ? 'ficou' : 'ficaram') + ' de fora.');
      imprimirHtml(c.html, 'size: ' + c.t.l + 'mm ' + c.t.a + 'mm; margin: 0');
    },
    'desfazer-leitor': () => {
      const e = N.desfazerBaixa(D, UI.retorno.baixa);
      if (e) { gravar(); UI.retorno = { ok: true, msg: e.nome + ': baixa desfeita.', baixa: '' }; }
      render();
    },
    'desfazer-aberta': () => {
      const e = N.desfazerBaixa(D, UI.S.etiquetaId);
      if (e) { gravar(); UI.retorno = { ok: true, msg: e.nome + ': baixa desfeita.', baixa: '' }; }
      render();
    },
    'sem-motivo': () => { UI.S = Object.assign({}, UI.S, { pedindoMotivo: false }); UI.retorno = null; render(); },
    // O código lido não existe no catálogo: cadastra com ele já preenchido e segue para a etiqueta.
    'cadastrar-lido': () => {
      const codigo = UI.S.desconhecido;
      dialogoProduto('', { codigo }, (p) => { if (p.codigo) bipar(p.codigo); });
    },
  };

  // ---------- janela, aviso e navegação ----------
  let aoEnviar = null;
  function abrir(html, fn) {
    frm.innerHTML = html;
    aoEnviar = fn;
    if (!dlg.open) dlg.showModal();
  }
  frm.addEventListener('submit', (ev) => {
    ev.preventDefault();
    if (aoEnviar && aoEnviar(new FormData(frm)) === false) return;
    if (dlg.open) dlg.close();
  });
  dlg.addEventListener('close', () => { if (UI.aba === 'leitor') focoLeitor(); });

  function confirmar(titulo, txt, rotulo, fn, perigo) {
    abrir('<h2 id="dlg-titulo">' + esc(titulo) + '</h2><p>' + esc(txt) + '</p>' +
      '<div class="dlg-pe"><button type="button" class="bt" data-acao="fechar">Cancelar</button>' +
      '<button type="submit" class="bt ' + (perigo ? 'bt-perigo' : 'bt-prim') + '">' + esc(rotulo) + '</button></div>', fn);
  }

  let relogioAviso = 0;
  function avisar(msg, acao) {
    clearTimeout(relogioAviso);
    aviso.innerHTML = '<span>' + esc(msg) + '</span>' + (acao ? '<button type="button" id="aviso-acao">' + esc(acao.rotulo) + '</button>' : '');
    aviso.hidden = false;
    if (acao) $('#aviso-acao').onclick = () => { aviso.hidden = true; acao.fn(); };
    relogioAviso = setTimeout(() => { aviso.hidden = true; }, acao ? 8000 : 4500);
  }

  function cabecalho() {
    const t = agora();
    $('#hoje').textContent = (D.config.casa ? D.config.casa + ' · ' : '') + N.diaSemana(t) + ', ' + N.fmtData(t);
    document.documentElement.dataset.letra = D.config.letra;
  }

  const TELAS = { validades: telaValidades, leitor: telaLeitor, etiquetar: telaEtiquetar, produtos: telaProdutos, perdas: telaPerdas, ajustes: telaAjustes };

  function render(foco) {
    document.querySelectorAll('.abas button').forEach((b) => {
      const on = b.dataset.aba === UI.aba;
      b.classList.toggle('on', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    cabecalho();
    app.innerHTML = TELAS[UI.aba]();
    if (UI.aba === 'etiquetar') atualizarPrevia();
    const alvo = foco && $(foco);
    if (alvo) alvo.focus();
    else if (UI.aba === 'leitor') focoLeitor();
  }

  function ir(aba) {
    UI.aba = ABAS.indexOf(aba) >= 0 ? aba : 'validades';
    UI.cartela = false;
    if (location.hash.slice(1) !== UI.aba) { try { location.replace('#' + UI.aba); } catch (e) { /* segue sem endereço */ } }
    render();
    window.scrollTo(0, 0);
  }

  document.addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (!b) {
      // Clique fora de qualquer controle na aba Leitor: devolve o cursor ao campo de leitura.
      if (UI.aba === 'leitor' && !ev.target.closest('input, select, textarea, label, a, summary')) focoLeitor();
      return;
    }
    const d = b.dataset;
    if (d.aba) ir(d.aba);
    else if (d.bip) bipar(d.bip);
    else if (d.sit) { UI.sit = UI.sit === d.sit ? '' : d.sit; render('[data-sit="' + d.sit + '"]'); }
    else if (d.usar) usar(d.usar);
    else if (d.descartar) dialogoDescarte(d.descartar);
    else if (d.reimprimir) imprimir(D.etiquetas.filter((e) => e.id === d.reimprimir));
    else if (d.produto) { UI.r.produtoId = d.produto; UI.r.modo = ''; render(); window.scrollTo(0, 0); }
    else if (d.tipoEtq != null) { UI.tipoEtq = d.tipoEtq; render('.filtro-tipos .on'); }
    else if (d.grupo != null) { UI.grupo = d.grupo; render('.filtro-grupos .on'); }
    else if (d.editar) dialogoProduto(d.editar);
    else if (d.etiquetar) { UI.r = rascunho(UI.r); UI.r.produtoId = d.etiquetar; ir('etiquetar'); }
    else if (d.tiraOrigem) { UI.S = Object.assign({}, UI.S, { origens: UI.S.origens.filter((c) => c !== +d.tiraOrigem) }); render(); }
    else if (d.passo) {
      const campo = $('#etq-copias');
      campo.value = Math.max(1, Math.min(N.MAX_COPIAS, (Math.round(+campo.value) || 1) + +d.passo));
      atualizarPrevia();
    }
    else if (d.acao && ACOES[d.acao]) ACOES[d.acao](b);
  });

  document.addEventListener('input', (ev) => {
    const t = ev.target;
    if (t.id === 'busca') { UI.busca = t.value; $('#lista').innerHTML = listaValidades(N.painel(D, agora())); }
    else if (t.id === 'etq-busca') { UI.etqBusca = t.value; $('#lista').innerHTML = gradeProdutos(); }
    else if (t.id === 'prod-busca') { UI.prodBusca = t.value; $('#lista').innerHTML = listaProdutos(); }
    else if (t.dataset.campo && UI.S.modo === 'nova') { UI.S = Object.assign({}, UI.S, { [t.dataset.campo]: t.value }); atualizarLeitor(); }
    else if (t.closest('#form-etq')) atualizarPrevia();
  });

  document.addEventListener('change', (ev) => {
    const t = ev.target;
    if (t.id === 'filtro-local') { UI.local = t.value; render('#filtro-local'); }
    else if (t.id === 'filtro-tipo') { UI.tipo = t.value; render('#filtro-tipo'); }
    else if (t.name === 'periodo') { UI.periodo = +t.value; render('#periodo-' + UI.periodo); }
    else if (t.id === 'leitor-operador') { UI.S = Object.assign({}, UI.S, { operador: t.value }); render(); }
    else if (t.id === 'arq') restaurar(t);
    else if (t.id.indexOf('cfg-') === 0) salvarAjustes();
    else if (t.closest('#form-etq')) atualizarPrevia();
  });

  document.addEventListener('submit', (ev) => {
    if (ev.target.id === 'form-etq') { ev.preventDefault(); emitirEtiquetas(); }
    else if (ev.target.id === 'form-leitor') {
      ev.preventDefault();
      const campo = $('#leitor-campo');
      const codigo = campo.value;
      campo.value = '';
      bipar(codigo);
    }
  });

  // "toggle" não sobe na árvore: escuta na descida para lembrar se o bloco da embalagem original está aberto.
  document.addEventListener('toggle', (ev) => { if (ev.target.id === 'etq-orig') UI.r.origAberto = ev.target.open; }, true);

  /*
   * O leitor de código de barras é um teclado muito rápido que termina com Enter. As teclas que
   * chegam em rajada (menos de 0,2 s entre uma e outra) são juntadas, e o Enter decide:
   *   - Fora de qualquer campo, em qualquer aba: a rajada vira leitura (e o Enter não aperta o
   *     botão que estiver em foco).
   *   - Num campo opcional do Leitor (quantidade, lote): se a rajada é um código que o app conhece,
   *     vale como leitura e sai do campo; se não é, fica como texto e o cursor volta ao campo de leitura.
   *   - No campo de leitura, o próprio formulário cuida.
   */
  let rajada = '';
  let ultimaTecla = 0;
  document.addEventListener('keydown', (ev) => {
    if (dlg.open || ev.ctrlKey || ev.altKey || ev.metaKey) return;
    const el = ev.target;
    if (ev.key !== 'Enter') {
      if (ev.key.length !== 1) return;
      if (ev.timeStamp - ultimaTecla > 200) rajada = '';
      rajada += ev.key;
      ultimaTecla = ev.timeStamp;
      return;
    }
    const codigo = ev.timeStamp - ultimaTecla < 200 && rajada.length >= 3 ? rajada : '';
    rajada = '';
    if (el.dataset && el.dataset.campo) {
      ev.preventDefault();
      const lido = codigo ? N.interpretar(D, codigo).tipo : 'vazio';
      if (el.type !== 'text' || lido === 'desconhecido' || lido === 'vazio') { focoLeitor(); return; }
      const semCodigo = el.value.slice(-codigo.length) === codigo ? el.value.slice(0, -codigo.length) : el.value;
      UI.S = Object.assign({}, UI.S, { [el.dataset.campo]: semCodigo });
      bipar(codigo);
      return;
    }
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
    if (codigo) { ev.preventDefault(); bipar(codigo); }
  });

  window.addEventListener('afterprint', () => { if (UI.aba === 'leitor') focoLeitor(); });

  window.addEventListener('hashchange', () => {
    const aba = location.hash.slice(1);
    if (ABAS.indexOf(aba) >= 0 && aba !== UI.aba) { UI.aba = aba; UI.cartela = false; render(); }
  });

  // O painel acompanha o relógio: o que vence vai mudando de grupo sem ninguém tocar na tela.
  function acompanharRelogio() {
    if (document.hidden || dlg.open) return;
    cabecalho();
    const el = document.activeElement;
    const digitando = el && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName);
    if (UI.aba === 'validades' && !digitando) render();
  }
  setInterval(acompanharRelogio, 30000);
  document.addEventListener('visibilitychange', acompanharRelogio);

  // ---------- início ----------
  // O exemplo da primeira versão (sem códigos nem tipos) é trocado pelo novo; dados de verdade são só atualizados.
  function abrirGuardado() {
    const json = lerGuardado();
    const d = N.carregar(json);
    if (!d) return N.exemplo(agora());
    let versao = 1;
    try { versao = +JSON.parse(json).versao || 1; } catch (e) { /* já passou pelo carregar */ }
    return d.exemplo && versao < N.VERSAO ? N.exemplo(agora()) : d;
  }
  D = abrirGuardado();
  const inicial = location.hash.slice(1);
  if (ABAS.indexOf(inicial) >= 0) UI.aba = inicial;
  render();

  if (!PREVIA && 'serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
  }
})();
