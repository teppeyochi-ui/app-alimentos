/*
 * app.js — Telas do Validade em Dia. As regras (validade, situação, relatório)
 * ficam em core.js; aqui só se desenha a tela e se guarda o que foi feito.
 *
 * Abas: Validades (painel do que está ativo) · Etiquetar (emite e imprime) ·
 * Produtos (catálogo com as validades) · Perdas (relatório) · Ajustes.
 */
(function () {
  'use strict';
  const N = window.Nucleo;
  // Ligado só na prévia publicada como página: lá o navegador não deixa imprimir nem baixar arquivo.
  const PREVIA = !!window.MODO_PREVIA;
  const VERSAO = '0.1';
  const ABAS = ['validades', 'etiquetar', 'produtos', 'perdas', 'ajustes'];

  const $ = (s, el) => (el || document).querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const agora = () => Date.now();
  const plural = (n, um, varios) => n + ' ' + (n === 1 ? um : varios);

  const app = $('#app');
  const dlg = $('#dlg');
  const frm = $('#frm');
  const aviso = $('#aviso');

  let D;
  const UI = { aba: 'validades', sit: '', local: '', busca: '', grupo: '', etqBusca: '', prodBusca: '', periodo: 30, r: rascunho() };

  // O que está sendo preenchido na aba Etiquetar. Local e responsável ficam para a próxima etiqueta.
  function rascunho(antes) {
    return {
      produtoId: '', modo: '', local: antes ? antes.local : '', responsavel: antes ? antes.responsavel : '',
      qtd: '', copias: 1, quando: 'agora', feito: '', lote: '', valOrig: '', origAberto: false,
    };
  }

  // ---------- guardar ----------
  function ler() { try { return localStorage.getItem(N.CHAVE); } catch (e) { return null; } }
  function gravar() { try { localStorage.setItem(N.CHAVE, JSON.stringify(D)); } catch (e) { /* sem espaço ou sem permissão: segue só na memória */ } }

  // ---------- ícones ----------
  const ICO = {
    vencido: '<svg class="ico ico-vencido" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="9" fill="currentColor"/><path d="M6.7 6.7l6.6 6.6M13.3 6.7l-6.6 6.6" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>',
    hoje: '<svg class="ico ico-hoje" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2.2 18.6 17H1.4Z" fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M10 7.6v4.4" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/><circle cx="10" cy="14.8" r="1.1" fill="#fff"/></svg>',
    breve: '<svg class="ico ico-breve" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="9" fill="currentColor"/><path d="M10 5.2V10l3 2" fill="none" stroke="#0b0b0b" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    ok: '<svg class="ico ico-ok" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="9" fill="currentColor"/><path d="M5.8 10.4l2.8 2.8 5.6-6" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };
  const ICO_IMPRIMIR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 9V4h10v5M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2"/><path d="M7 14h10v6H7z"/></svg>';

  const nomeSit = (s) => (s.id === 'breve' ? 'Vencem em até ' + plural(D.config.alertaDias, 'dia', 'dias') : s.nome);
  const vazioHtml = (titulo, txt) => '<div class="vazio"><strong>' + esc(titulo) + '</strong>' + esc(txt) + '</div>';

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
      '<input type="search" id="busca" placeholder="Buscar produto, local ou número" aria-label="Buscar nas etiquetas ativas" value="' + esc(UI.busca) + '">' +
      '<select id="filtro-local" aria-label="Filtrar por local"><option value="">Todos os locais</option>' +
      locais.map((l) => '<option' + (l === UI.local ? ' selected' : '') + '>' + esc(l) + '</option>').join('') + '</select>' +
      '</div>' +
      '<div id="lista">' + listaValidades(P) + '</div>';
  }

  function listaValidades(P) {
    if (!P.itens.length) return vazioHtml('Nenhuma etiqueta ativa', 'Emita a primeira na aba Etiquetar.');
    const termo = UI.busca.trim().toLowerCase();
    const itens = P.itens.filter((x) =>
      (!UI.sit || x.sit === UI.sit) && (!UI.local || x.e.local === UI.local) &&
      (!termo || (x.e.nome + ' ' + x.e.local + ' ' + N.fmtCodigo(x.e.cod) + ' ' + x.e.responsavel).toLowerCase().indexOf(termo) >= 0));
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
    const meta = [N.MODO[e.modo].nome, e.local, e.qtd].filter(Boolean).join(' · ');
    const datas = 'Nº ' + N.fmtCodigo(e.cod) +
      ' · feito ' + N.diaSemana(e.feitoEm) + ' ' + N.fmtData(e.feitoEm) + ' ' + N.fmtHora(e.feitoEm) +
      ' · vence ' + N.diaSemana(e.venceEm) + ' ' + N.fmtData(e.venceEm) + (e.porHora ? ' ' + N.fmtHora(e.venceEm) : '') +
      (e.limitada ? ' (validade do fabricante)' : '') +
      (e.responsavel ? ' · ' + e.responsavel : '');
    return '<li class="item"><div class="item-info">' +
      '<div class="item-nome"><span>' + esc(e.nome) + '</span><span class="pill p-' + x.sit + '">' + ICO[x.sit] + esc(x.resta) + '</span></div>' +
      '<div class="item-meta">' + esc(meta) + '</div>' +
      '<div class="item-datas mono">' + esc(datas) + '</div></div>' +
      '<div class="item-acoes">' +
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

  // ---------- Etiquetar ----------
  function telaEtiquetar() {
    const p = UI.r.produtoId && D.produtos.find((x) => x.id === UI.r.produtoId);
    if (!p) { UI.r.produtoId = ''; return seletorProdutos(); }
    return formularioEtiqueta(p);
  }

  function seletorProdutos() {
    if (!D.produtos.length) {
      return vazioHtml('Nenhum produto cadastrado', 'Cadastre na aba Produtos o que a cozinha etiqueta, cada item com a sua validade.') +
        '<div><button type="button" class="bt bt-prim" data-aba="produtos">Abrir Produtos</button></div>';
    }
    const gs = N.grupos(D);
    if (UI.grupo && gs.indexOf(UI.grupo) < 0) UI.grupo = '';
    const botao = (g, rotulo) => '<button type="button" data-grupo="' + esc(g) + '" class="' + (UI.grupo === g ? 'on' : '') + '" aria-pressed="' + (UI.grupo === g) + '">' + esc(rotulo) + '</button>';
    return '<h2>Qual produto vai ser etiquetado?</h2>' +
      '<div class="barra"><input type="search" id="etq-busca" placeholder="Buscar produto" aria-label="Buscar produto" value="' + esc(UI.etqBusca) + '"></div>' +
      '<div class="filtro-grupos" role="group" aria-label="Grupo">' + botao('', 'Todos') + gs.map((g) => botao(g, g)).join('') + '</div>' +
      '<div id="lista">' + gradeProdutos() + '</div>';
  }

  const porNome = (a, b) => a.nome.localeCompare(b.nome, 'pt-BR');
  const validadesTexto = (p) => N.modosDoProduto(p).map((m) => m.nome + ' ' + N.fmtValidade(p.validades[m.id]));

  function gradeProdutos() {
    const termo = UI.etqBusca.trim().toLowerCase();
    const ps = D.produtos.filter((p) => (!UI.grupo || p.grupo === UI.grupo) && (!termo || p.nome.toLowerCase().indexOf(termo) >= 0)).sort(porNome);
    if (!ps.length) return vazioHtml('Nada encontrado', 'Nenhum produto com esse nome neste grupo.');
    return '<div class="grade">' + ps.map((p) =>
      '<button type="button" class="prod" data-produto="' + p.id + '"><strong>' + esc(p.nome) + '</strong><span>' + esc(validadesTexto(p).join(' · ')) + '</span></button>').join('') + '</div>';
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
      '<div class="form-topo"><div><strong>' + esc(p.nome) + '</strong><span>' + esc(p.grupo) + '</span></div>' +
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
      '<label class="campo">Preparo<select id="etq-quando"><option value="agora"' + (r.quando === 'agora' ? ' selected' : '') + '>Agora</option>' +
      '<option value="outra"' + (r.quando === 'outra' ? ' selected' : '') + '>Outra data e hora</option></select></label>' +
      '<label class="campo" id="etq-feito-campo"' + (r.quando === 'outra' ? '' : ' hidden') + '>Data e hora do preparo<input type="datetime-local" id="etq-feito" value="' + esc(r.feito) + '"></label>' +
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

  function etiquetaHtml(e) {
    const t = N.TAMANHOS[D.config.tamanho];
    const pe = [e.responsavel && 'Resp. ' + e.responsavel, e.local, e.qtd, e.loteOrigem && 'Lote ' + e.loteOrigem].filter(Boolean).join(' · ');
    const validade = e.porHora
      ? N.fmtDataAno(e.venceEm) + ' ' + N.fmtHora(e.venceEm)
      : N.diaSemana(e.venceEm).toUpperCase() + ' ' + N.fmtDataAno(e.venceEm);
    return '<div class="etq" style="--l:' + t.l + ';--a:' + t.a + '"><div class="etq-dentro">' +
      '<div class="etq-topo"><span class="etq-modo">' + N.MODO[e.modo].nome.toUpperCase() + '</span><span>Nº ' + N.fmtCodigo(e.cod) + '</span></div>' +
      '<div class="etq-nome' + (e.nome.length > 22 ? ' longo' : '') + '">' + esc(e.nome) + '</div>' +
      '<div class="etq-linha"><span>PREPARO</span><b>' + N.fmtDataAno(e.feitoEm) + ' ' + N.fmtHora(e.feitoEm) + '</b></div>' +
      '<div class="etq-linha etq-val"><span>VALIDADE</span><b>' + validade + '</b></div>' +
      '<div class="etq-pe">' + esc(pe) + '</div>' +
      '<div class="etq-casa">' + esc(D.config.casa) + '</div>' +
      '</div></div>';
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
      if (isNaN(t)) return { erro: 'Informe a data e a hora do preparo.' };
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

  // Cada etiqueta sai numa página do tamanho do rolo; a impressora térmica é escolhida na janela do sistema.
  function imprimir(lista) {
    if (PREVIA || !lista.length) return;
    const t = N.TAMANHOS[D.config.tamanho];
    $('#pagina').textContent = '@page { size: ' + t.l + 'mm ' + t.a + 'mm; margin: 0 }';
    $('#impressao').innerHTML = lista.map(etiquetaHtml).join('');
    window.print();
  }

  // ---------- Produtos ----------
  function telaProdutos() {
    return '<div class="barra">' +
      '<input type="search" id="prod-busca" placeholder="Buscar produto ou grupo" aria-label="Buscar produto ou grupo" value="' + esc(UI.prodBusca) + '">' +
      '<button type="button" class="bt bt-prim" data-acao="novo-produto">Novo produto</button></div>' +
      (D.exemplo ? '<p class="dica">Os prazos deste catálogo são exemplos. Defina cada um com o responsável técnico e as regras da vigilância sanitária da sua cidade.</p>' : '') +
      '<div id="lista">' + listaProdutos() + '</div>';
  }

  function listaProdutos() {
    if (!D.produtos.length) return vazioHtml('Nenhum produto cadastrado', 'Cadastre o que a cozinha etiqueta, cada item com a sua validade por modo de conservação.');
    const termo = UI.prodBusca.trim().toLowerCase();
    const ps = D.produtos.filter((p) => !termo || (p.nome + ' ' + p.grupo).toLowerCase().indexOf(termo) >= 0);
    if (!ps.length) return vazioHtml('Nada encontrado', 'Nenhum produto ou grupo com esse nome.');
    return N.grupos(D).map((g) => {
      const doGrupo = ps.filter((p) => p.grupo === g).sort(porNome);
      if (!doGrupo.length) return '';
      return '<section class="bloco"><h2 class="grupo">' + esc(g) + ' <span class="n">' + doGrupo.length + '</span></h2><ul class="itens">' +
        doGrupo.map((p) =>
          '<li class="item"><div class="item-info"><div class="item-nome"><span>' + esc(p.nome) + '</span></div>' +
          '<div class="chips">' + validadesTexto(p).map((t) => '<span class="chip">' + esc(t) + '</span>').join('') + '</div></div>' +
          '<div class="item-acoes"><button type="button" class="bt" data-etiquetar="' + p.id + '">Etiquetar</button>' +
          '<button type="button" class="bt" data-editar="' + p.id + '">Editar</button></div></li>').join('') +
        '</ul></section>';
    }).join('');
  }

  function dialogoProduto(id) {
    const p = id ? D.produtos.find((x) => x.id === id) : null;
    abrir(
      '<h2 id="dlg-titulo">' + (p ? 'Editar produto' : 'Novo produto') + '</h2>' +
      '<label class="campo">Nome<input type="text" id="p-nome" name="nome" maxlength="60" autocomplete="off" value="' + esc(p ? p.nome : '') + '"></label>' +
      '<label class="campo">Grupo<input type="text" id="p-grupo" name="grupo" maxlength="30" list="p-grupos" autocomplete="off" placeholder="ex.: Molhos e bases" value="' + esc(p ? p.grupo : '') + '">' +
      '<datalist id="p-grupos">' + N.grupos(D).map((g) => '<option value="' + esc(g) + '">').join('') + '</datalist></label>' +
      '<fieldset><legend>Validade depois de preparado ou aberto</legend>' +
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
        const r = N.salvarProduto(D, { id: p ? p.id : '', nome: fd.get('nome'), grupo: fd.get('grupo'), validades });
        if (r.erro) {
          const erro = $('#dlg-erro');
          erro.textContent = r.erro;
          erro.hidden = false;
          return false;
        }
        gravar();
        render();
        avisar(r.produto.nome + ' salvo no catálogo.');
      });
  }

  // ---------- Perdas ----------
  function telaPerdas() {
    const R = N.relatorio(D, agora(), UI.periodo);
    const tile = (valor, rotulo, sub) => '<div class="tile"><span class="tile-n">' + valor + '</span><span class="tile-r">' + rotulo + '</span>' + (sub ? '<span class="tile-s">' + sub + '</span>' : '') + '</div>';
    const barras = (lista, extra, nomeDoQue) => {
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
      '<section class="cartao"><h2>Descartes por motivo</h2>' + (R.porMotivo.length ? barras(R.porMotivo, null, ['descarte', 'descartes']) : semDescarte) + '</section>' +
      '<section class="cartao"><h2>Produtos mais descartados</h2>' +
      (R.porProduto.length
        ? barras(R.porProduto.slice(0, 6), (x) => 'de ' + x.total, ['etiqueta descartada', 'etiquetas descartadas']) +
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
    return '<section class="cartao"><h2>Estabelecimento</h2>' +
      '<label class="campo curto">Nome que sai na etiqueta<input type="text" id="cfg-casa" maxlength="40" autocomplete="off" value="' + esc(c.casa) + '"></label>' +
      '<label class="campo curto">Tamanho da etiqueta<select id="cfg-tamanho">' +
      Object.keys(N.TAMANHOS).map((k) => '<option value="' + k + '"' + (k === c.tamanho ? ' selected' : '') + '>' + N.TAMANHOS[k].nome + '</option>').join('') + '</select></label>' +
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
    D.config = N.limparConfig({
      casa: $('#cfg-casa').value,
      tamanho: $('#cfg-tamanho').value,
      alertaDias: $('#cfg-alerta').value,
      contarDiaPreparo: $('#cfg-contar').checked,
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
    UI.sit = UI.local = UI.busca = UI.grupo = UI.etqBusca = UI.prodBusca = '';
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
      '<span class="dica">Fica como ponto de partida: depois é só acertar os prazos e trocar os produtos.</span></label>' +
      '<div class="dlg-pe"><button type="button" class="bt" data-acao="fechar">Cancelar</button><button type="submit" class="bt bt-prim">Começar do zero</button></div>',
      (fd) => {
        const novo = N.vazio();
        novo.config.locais = D.config.locais;
        novo.config.tamanho = D.config.tamanho;
        if (fd.get('manter')) { novo.produtos = D.produtos; novo.seqProd = D.seqProd; }
        trocarDados(novo);
        avisar('Pronto. Passe nos Ajustes para colocar o nome da casa e a equipe.');
      }),
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
  }

  const TELAS = { validades: telaValidades, etiquetar: telaEtiquetar, produtos: telaProdutos, perdas: telaPerdas, ajustes: telaAjustes };

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
  }

  function ir(aba) {
    UI.aba = ABAS.indexOf(aba) >= 0 ? aba : 'validades';
    if (location.hash.slice(1) !== UI.aba) { try { location.replace('#' + UI.aba); } catch (e) { /* segue sem endereço */ } }
    render();
    window.scrollTo(0, 0);
  }

  document.addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    const d = b.dataset;
    if (d.aba) ir(d.aba);
    else if (d.sit) { UI.sit = UI.sit === d.sit ? '' : d.sit; render('[data-sit="' + d.sit + '"]'); }
    else if (d.usar) usar(d.usar);
    else if (d.descartar) dialogoDescarte(d.descartar);
    else if (d.reimprimir) imprimir(D.etiquetas.filter((e) => e.id === d.reimprimir));
    else if (d.produto) { UI.r.produtoId = d.produto; UI.r.modo = ''; render(); window.scrollTo(0, 0); }
    else if (d.grupo != null) { UI.grupo = d.grupo; render('.filtro-grupos .on'); }
    else if (d.editar) dialogoProduto(d.editar);
    else if (d.etiquetar) { UI.r = rascunho(UI.r); UI.r.produtoId = d.etiquetar; ir('etiquetar'); }
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
    else if (t.closest('#form-etq')) atualizarPrevia();
  });

  document.addEventListener('change', (ev) => {
    const t = ev.target;
    if (t.id === 'filtro-local') { UI.local = t.value; render('#filtro-local'); }
    else if (t.name === 'periodo') { UI.periodo = +t.value; render('#periodo-' + UI.periodo); }
    else if (t.id === 'arq') restaurar(t);
    else if (t.id.indexOf('cfg-') === 0) salvarAjustes();
    else if (t.closest('#form-etq')) atualizarPrevia();
  });

  document.addEventListener('submit', (ev) => {
    if (ev.target.id !== 'form-etq') return;
    ev.preventDefault();
    emitirEtiquetas();
  });

  // "toggle" não sobe na árvore: escuta na descida para lembrar se o bloco da embalagem original está aberto.
  document.addEventListener('toggle', (ev) => { if (ev.target.id === 'etq-orig') UI.r.origAberto = ev.target.open; }, true);

  window.addEventListener('hashchange', () => {
    const aba = location.hash.slice(1);
    if (ABAS.indexOf(aba) >= 0 && aba !== UI.aba) { UI.aba = aba; render(); }
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
  D = N.carregar(ler()) || N.exemplo(agora());
  const inicial = location.hash.slice(1);
  if (ABAS.indexOf(inicial) >= 0) UI.aba = inicial;
  render();

  if (!PREVIA && 'serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
  }
})();
