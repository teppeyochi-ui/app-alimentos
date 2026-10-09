/*
 * app.js — Interface do Classificador de Camarão.
 * Toda regra de negócio vem de core.js (window.Core); aqui ficam só tela,
 * eventos, rascunho/histórico em localStorage, compartilhamento e PWA.
 * Sem alert(), confirm() ou prompt(): toda confirmação é na própria tela.
 */
(function () {
  'use strict';

  var C = window.Core;
  var CHAVES = {
    rascunho: 'cc.rascunho.v1',
    historico: 'cc.historico.v1',
    tema: 'cc.tema',
    instalarFechado: 'cc.instalarFechado',
  };
  var TEMPO_TOQUE_DUPLO = 2500; // ms para o segundo toque que remove uma unidade

  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function hojeISO() { var d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }

  // ---------------------------------------------------------------------------
  // Armazenamento local (try/catch: modo privado ou armazenamento cheio)
  // ---------------------------------------------------------------------------

  function ler(chave, padrao) {
    try {
      var v = localStorage.getItem(chave);
      return v ? JSON.parse(v) : padrao;
    } catch (e) { return padrao; }
  }
  var avisouFalhaGravar = false;
  function gravar(chave, valor) {
    try {
      localStorage.setItem(chave, JSON.stringify(valor));
      return true;
    } catch (e) {
      if (!avisouFalhaGravar) toast('Não foi possível gravar no aparelho (armazenamento cheio ou bloqueado).', 'critico');
      avisouFalhaGravar = true;
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Estado
  // ---------------------------------------------------------------------------

  function estadoInicial(anterior) {
    return {
      cfg: { especie: 'rosa', apresentacao: 'inteiro', condicao: 'fresco', glaciamento: 10, embalagem: 'compensada', pesoDeclarado: 1000 },
      // Técnico e local se mantêm de uma avaliação para a próxima.
      ident: { codigo: '', data: hojeISO(), lote: '', tecnico: anterior ? anterior.ident.tecnico : '', local: anterior ? anterior.ident.local : '' },
      pesos: [],
      salvoId: null,
      tela: 'produto',
    };
  }

  var E = (function () {
    var base = estadoInicial();
    var r = ler(CHAVES.rascunho, null);
    if (r && typeof r === 'object') {
      Object.assign(base.cfg, r.cfg || {});
      Object.assign(base.ident, r.ident || {});
      if (Array.isArray(r.pesos)) base.pesos = r.pesos.filter(function (p) { return typeof p === 'number' && p > 0 && p < C.PESO_MAX; });
      base.salvoId = r.salvoId || null;
      if (r.tela) base.tela = r.tela;
    }
    return base;
  })();

  // Estado só de interface (não persiste).
  var ui = {
    entrada: '',
    erro: '',
    visualizar: null, // id da avaliação do histórico aberta em modo leitura
    confirmarNova: false,
    confirmarExcluir: false,
    armado: null, // índice da unidade aguardando o segundo toque
    timerArmado: null,
  };

  var historico = ler(CHAVES.historico, []);
  if (!Array.isArray(historico)) historico = [];

  // Rascunho salvo a cada alteração.
  function salvarRascunho() { gravar(CHAVES.rascunho, E); }

  // ---------------------------------------------------------------------------
  // Toast
  // ---------------------------------------------------------------------------

  var timerToast = null;
  function toast(msg, tipo) {
    var t = $('#toast');
    t.textContent = msg;
    t.className = 'toast' + (tipo ? ' t-' + tipo : '');
    t.hidden = false;
    clearTimeout(timerToast);
    timerToast = setTimeout(function () { t.hidden = true; }, 3200);
  }

  // ---------------------------------------------------------------------------
  // Navegação
  // ---------------------------------------------------------------------------

  var TELAS = ['produto', 'pesagem', 'resultado', 'historico'];

  function irPara(tela, opcoes) {
    opcoes = opcoes || {};
    if (tela === 'pesagem') {
      var erros = C.validarConfig(E.cfg);
      if (erros.length) {
        toast(erros[0], 'critico');
        tela = 'produto';
      }
    }
    if (tela !== 'resultado') { ui.visualizar = null; }
    ui.confirmarNova = false;
    ui.confirmarExcluir = false;
    E.tela = tela;
    salvarRascunho();
    TELAS.forEach(function (t) { $('#tela-' + t).hidden = t !== tela; });
    $$('.nav-inferior [data-ir]').forEach(function (b) {
      if (b.dataset.ir === tela) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    renderTela(tela);
    if (!opcoes.manterRolagem) window.scrollTo(0, 0);
  }

  function renderTela(tela) {
    if (tela === 'produto') renderProduto();
    else if (tela === 'pesagem') renderPesagem();
    else if (tela === 'resultado') renderResultado();
    else if (tela === 'historico') renderHistorico();
    renderNav();
  }

  function renderNav() {
    var n = $('#nav-contador');
    n.textContent = E.pesos.length;
    n.hidden = !E.pesos.length;
  }

  // ---------------------------------------------------------------------------
  // 1. Produto
  // ---------------------------------------------------------------------------

  function montarProduto() {
    // Atalhos de peso declarado.
    $('#atalhos-peso').innerHTML = C.ATALHOS_EMBALAGEM.map(function (g) {
      return '<button type="button" data-peso="' + g + '">' + esc(C.fmtEmbalagem(g)) + '</button>';
    }).join('');

    // Grupos de opção (espécie, apresentação, condição, embalagem).
    $$('[data-grupo]').forEach(function (grupo) {
      grupo.addEventListener('click', function (ev) {
        var b = ev.target.closest('button[data-valor]');
        if (!b) return;
        E.cfg[grupo.dataset.grupo] = b.dataset.valor;
        aoMudarProduto();
      });
    });

    // Glaciamento: − e + de 0,5 em 0,5.
    function passo(delta) {
      var g = Math.round(((Number(E.cfg.glaciamento) || 0) + delta) / C.PASSO_GLACIAMENTO) * C.PASSO_GLACIAMENTO;
      E.cfg.glaciamento = Math.max(0, Math.min(50, g));
      aoMudarProduto();
    }
    $('#glac-menos').addEventListener('click', function () { passo(-C.PASSO_GLACIAMENTO); });
    $('#glac-mais').addEventListener('click', function () { passo(C.PASSO_GLACIAMENTO); });

    // Peso declarado: atalhos ou campo livre.
    $('#atalhos-peso').addEventListener('click', function (ev) {
      var b = ev.target.closest('button[data-peso]');
      if (!b) return;
      E.cfg.pesoDeclarado = Number(b.dataset.peso);
      $('#peso-outro').value = '';
      aoMudarProduto();
    });
    $('#peso-outro').addEventListener('input', function () {
      var v = C.lerNumero(this.value);
      E.cfg.pesoDeclarado = isFinite(v) && v > 0 ? v : null;
      aoMudarProduto();
    });

    // Identificação.
    $$('[data-ident]').forEach(function (inp) {
      inp.addEventListener('input', function () {
        E.ident[inp.dataset.ident] = inp.value;
        salvarRascunho();
      });
    });

    $('#btn-iniciar').addEventListener('click', function () { irPara('pesagem'); });
  }

  function aoMudarProduto() {
    salvarRascunho();
    renderProduto();
    renderNav();
  }

  function renderProduto() {
    var cfg = E.cfg;
    $$('[data-grupo]').forEach(function (grupo) {
      $$('button[data-valor]', grupo).forEach(function (b) {
        b.setAttribute('aria-pressed', String(cfg[grupo.dataset.grupo] === b.dataset.valor));
      });
    });
    $('#bloco-glaciado').hidden = cfg.condicao !== 'glaciado';
    $('#glac-valor').textContent = C.fmt(Number(cfg.glaciamento) || 0, 1) + '%';
    $('#glac-valor').classList.toggle('acima', Number(cfg.glaciamento) > C.LIMITE_GLACIAMENTO);

    var atalho = C.ATALHOS_EMBALAGEM.indexOf(Number(cfg.pesoDeclarado)) >= 0;
    $$('#atalhos-peso button').forEach(function (b) {
      b.setAttribute('aria-pressed', String(atalho && Number(b.dataset.peso) === Number(cfg.pesoDeclarado)));
    });
    var outro = $('#peso-outro');
    if (!atalho && cfg.pesoDeclarado && document.activeElement !== outro) outro.value = C.fmtCurto(cfg.pesoDeclarado, 1);

    $$('[data-ident]').forEach(function (inp) {
      if (document.activeElement !== inp) inp.value = E.ident[inp.dataset.ident] || '';
    });

    var avisos = C.avisosContexto(cfg);
    C.validarConfig(cfg).forEach(function (t) { avisos.push({ status: 'critico', texto: t }); });
    $('#avisos').innerHTML = avisos.map(function (a) {
      return '<li class="s-' + a.status + '"><span>' + esc(a.texto) + '</span></li>';
    }).join('');

    renderInstalar();
  }

  // ---------------------------------------------------------------------------
  // 2. Pesagem
  // ---------------------------------------------------------------------------

  function montarPesagem() {
    $('.teclado').addEventListener('click', function (ev) {
      var b = ev.target.closest('button[data-tecla]');
      if (b) digitar(b.dataset.tecla);
    });
    $('#btn-adicionar').addEventListener('click', adicionar);
    $('#btn-desfazer').addEventListener('click', desfazer);
    $('#lista-unidades').addEventListener('click', function (ev) {
      var li = ev.target.closest('li[data-i]');
      if (li) tocarUnidade(Number(li.dataset.i));
    });

    // Teclado físico: números, vírgula/ponto, Backspace e Enter.
    document.addEventListener('keydown', function (ev) {
      if (E.tela !== 'pesagem' || ev.ctrlKey || ev.metaKey || ev.altKey) return;
      var alvo = ev.target;
      if (alvo && (alvo.tagName === 'INPUT' || alvo.tagName === 'TEXTAREA')) return;
      var k = ev.key;
      if (/^[0-9]$/.test(k)) digitar(k);
      else if (k === ',' || k === '.' || k === 'Decimal') digitar(',');
      else if (k === 'Backspace') digitar('apagar');
      else if (k === 'Delete' || k === 'Escape') { ui.entrada = ''; ui.erro = ''; renderVisor(); }
      else if (k === 'Enter') adicionar();
      else return;
      ev.preventDefault();
    });
  }

  function digitar(t) {
    var s = ui.entrada;
    ui.erro = '';
    if (t === 'apagar') s = s.slice(0, -1);
    else if (t === ',') { if (s.indexOf(',') < 0) s = (s || '0') + ','; }
    else {
      var partes = s.split(',');
      if (partes.length > 1 && partes[1].length >= 2) { renderVisor(); return; } // até 2 casas decimais
      if (partes.length === 1 && partes[0].length >= 4) { renderVisor(); return; } // até 4 dígitos inteiros
      s = s === '0' ? t : s + t;
    }
    ui.entrada = s;
    renderVisor();
  }

  function adicionar() {
    var v = C.validarPeso(ui.entrada);
    if (!v.ok) {
      ui.erro = ui.entrada ? v.erro : 'Digite o peso da unidade antes de adicionar.';
      renderVisor(true);
      return;
    }
    E.pesos.push(Math.round(v.valor * 100) / 100);
    ui.entrada = '';
    ui.erro = '';
    desarmar();
    if (navigator.vibrate) { try { navigator.vibrate(30); } catch (e) { /* sem vibração */ } }
    salvarRascunho();
    renderPesagem();
    renderNav();
  }

  function desfazer() {
    if (!E.pesos.length) return;
    var p = E.pesos.pop();
    desarmar();
    salvarRascunho();
    renderPesagem();
    renderNav();
    toast('Unidade ' + (E.pesos.length + 1) + ' (' + C.fmtCurto(p, 2) + ' g) removida.');
  }

  // Toque duplo remove: o primeiro toque arma (destaque vermelho), o segundo confirma.
  function tocarUnidade(i) {
    if (ui.armado === i) {
      var p = E.pesos.splice(i, 1)[0];
      desarmar();
      salvarRascunho();
      renderPesagem();
      renderNav();
      toast('Unidade ' + (i + 1) + ' (' + C.fmtCurto(p, 2) + ' g) removida.');
      return;
    }
    desarmar();
    ui.armado = i;
    ui.timerArmado = setTimeout(function () { desarmar(); renderLista(); }, TEMPO_TOQUE_DUPLO);
    renderLista();
  }

  function desarmar() {
    clearTimeout(ui.timerArmado);
    ui.armado = null;
  }

  function renderVisor(comErro) {
    var visor = $('#visor');
    $('#visor-num').textContent = ui.entrada || '0';
    visor.classList.toggle('vazio', !ui.entrada);
    visor.classList.remove('erro');
    if (comErro) { void visor.offsetWidth; visor.classList.add('erro'); }
    $('#visor-erro').textContent = ui.erro;
  }

  function renderPesagem() {
    renderVisor();
    var r = C.avaliar(E.cfg, E.pesos);
    var fv = $('#faixa-viva');
    var emb = r.embalagem;
    if (!r.n) {
      fv.className = 'faixa-viva';
      fv.innerHTML =
        '<div><small>Classe</small><b>—</b></div>' +
        '<div><small>Peso/pç</small><b>—</b></div>' +
        '<div><small>Peças</small><b>—</b><span>' + esc(C.fmtEmbalagem(emb.liquido)) + '</span></div>' +
        '<div class="fv-meta">' + esc(C.descreverTabela(r.tabela)) + ' · aguardando a 1ª unidade</div>';
    } else {
      fv.className = 'faixa-viva' + (r.lote.situacao === 'fora' ? ' fora' : '');
      var classe = r.lote.situacao === 'fora'
        ? 'Fora <span>' + esc(r.lote.posicao + ' de ' + r.classeLote.rotulo) + '</span>'
        : esc(r.classeLote.rotulo) + (r.tabela.unidade ? '<span>' + esc(r.tabela.unidade) + (r.lote.situacao === 'tolerancia' ? ' · tolerância' : '') + '</span>' : '');
      fv.innerHTML =
        '<div><small>Classe</small><b>' + classe + '</b></div>' +
        '<div><small>Peso/pç</small><b>' + esc(C.fmtFaixaPeso(r.tabela, r.faixaPeso)) + '</b></div>' +
        '<div><small>Peças</small><b>' + esc(C.fmtFaixaPecas(r.faixaPecas)) + '</b><span>em ' + esc(C.fmtEmbalagem(emb.liquido)) + (r.faixaPecas.proporcional ? ' (prop.)' : '') + '</span></div>' +
        '<div class="fv-meta">' + r.n + (r.n === 1 ? ' unidade' : ' unidades') + ' · média ' + C.fmt(r.estatistica.media, 2) + ' g líq. · ' + C.fmt(r.pctNaClasse, 0) + '% na classe</div>';
    }
    $('#btn-desfazer').disabled = !E.pesos.length;
    $('#contador').textContent = E.pesos.length;
    renderLista(r);
  }

  function renderLista(r) {
    r = r || C.avaliar(E.cfg, E.pesos);
    var ol = $('#lista-unidades');
    if (!r.n) {
      ol.innerHTML = '<li class="vazio-msg">Nenhuma unidade pesada ainda.</li>';
      return;
    }
    var glaciado = E.cfg.condicao === 'glaciado';
    var html = [];
    for (var i = r.unidades.length - 1; i >= 0; i--) {
      var u = r.unidades[i];
      var cls = u.situacao === 'fora' ? 'c-fora' : u.situacao === 'tolerancia' ? 'c-tol' : (r.lote.situacao !== 'fora' && u.indice === r.lote.indice ? 'c-lote' : 'c-outra');
      var rot = u.situacao === 'fora' ? 'Fora (' + (u.posicao === 'acima' ? '>' : '<') + ' ' + u.classe + ')' : u.classe;
      html.push(
        '<li data-i="' + i + '"' + (ui.armado === i ? ' class="armado"' : '') + '><button type="button" aria-label="Unidade ' + u.n + ', ' + C.fmtCurto(u.pesado, 2) + ' gramas, classe ' + esc(rot) + '. Toque duas vezes para remover.">' +
        '<span class="u-n">#' + u.n + '</span>' +
        '<span class="u-peso">' + C.fmtCurto(u.pesado, 2) + ' g' + (glaciado ? '<small>' + C.fmt(u.liquido, 2) + ' g líquido</small>' : '') + '</span>' +
        '<span class="chip ' + cls + '">' + esc(rot) + '</span>' +
        '</button></li>'
      );
    }
    ol.innerHTML = html.join('');
  }

  // ---------------------------------------------------------------------------
  // 3. Resultado
  // ---------------------------------------------------------------------------

  function registroAtual() {
    if (ui.visualizar) {
      var reg = historico.find(function (h) { return h.id === ui.visualizar; });
      if (reg) return { reg: reg, leitura: true };
      ui.visualizar = null;
    }
    return { reg: { id: E.salvoId, ident: E.ident, cfg: E.cfg, pesos: E.pesos }, leitura: false };
  }

  function renderResultado() {
    var alvo = $('#resultado');
    var ra = registroAtual();
    var reg = ra.reg;
    var r = C.avaliar(reg.cfg, reg.pesos);

    if (!r.n) {
      alvo.innerHTML =
        '<div class="card"><p>Nenhuma unidade pesada ainda. Pese as unidades para ver a classificação do lote.</p>' +
        '<button type="button" class="btn btn-primario btn-grande" data-acao="ir-pesagem">Ir para a pesagem</button></div>';
      return;
    }

    var h = [];
    if (ra.leitura) {
      h.push('<div class="aviso-leitura">Avaliação salva em <b>' + esc(C.fmtDataHora(reg.salvoEm)) + '</b> — modo leitura.</div>');
    }

    // Três destaques: (a) classificação, (b) faixa de peso, (c) faixa de peças.
    var dCls = r.lote.situacao === 'fora' ? ' d-fora' : r.lote.situacao === 'tolerancia' ? ' d-tol' : '';
    var fp = r.faixaPecas;
    h.push('<div class="destaques">');
    h.push('<div class="destaque d-classe' + dCls + '" id="destaque-classe"><small>(a) Classificação</small><b>' + esc(C.textoClasse(r)) + '</b><span>' +
      esc(r.lote.situacao === 'tolerancia' ? 'Pela tolerância de arredondamento · ' : '') + esc(C.descreverTabela(r.tabela)) + '</span></div>');
    h.push('<div class="destaques-2">');
    h.push('<div class="destaque" id="destaque-peso"><small>(b) Faixa de peso</small><b>' + esc(C.fmtFaixaPeso(r.tabela, r.faixaPeso)) + '</b><span>por peça · média ' + C.fmt(r.estatistica.media, 2) + ' g</span></div>');
    h.push('<div class="destaque" id="destaque-pecas"><small>(c) Peças na embalagem</small><b>' + esc(C.fmtFaixaPecas(fp)) + '</b><span>em ' + esc(C.fmtEmbalagem(r.embalagem.liquido)) +
      (r.embalagem.compensada ? '' : ' líquidos reais') + (fp.proporcional ? ' · proporcional à coluna de ' + esc(C.fmtEmbalagem(fp.coluna)) : '') + '</span></div>');
    h.push('</div></div>');

    // Identificação e produto.
    var id = reg.ident || {};
    var partes = [];
    if (id.codigo) partes.push('<b>' + esc(id.codigo) + '</b>');
    if (id.data) partes.push(esc(C.fmtData(id.data)));
    if (id.lote) partes.push('Lote ' + esc(id.lote));
    if (id.tecnico) partes.push(esc(id.tecnico));
    if (id.local) partes.push(esc(id.local));
    h.push('<p class="ident">' + (partes.length ? partes.join(' · ') + '<br>' : '') + esc(C.descreverProduto(reg.cfg)) + ' · ' + esc(C.fmtEmbalagem(r.embalagem.declarado)) + ' declarado' +
      (r.embalagem.glaciado && r.embalagem.compensada ? ' · envasar ' + esc(C.fmtEmbalagem(r.embalagem.brutoEnvasar)) + ' brutos' : '') + '</p>');

    // Análise.
    h.push('<section class="secao"><h2>Análise</h2><ul class="lista-status" id="analise">' + r.analise.map(function (a) {
      return '<li class="s-' + a.status + '"><span>' + esc(a.texto) + '</span></li>';
    }).join('') + '</ul></section>');

    // Estatística.
    var e = r.estatistica;
    h.push('<section class="secao"><h2>Estatística · peso líquido · n = ' + e.n + '</h2><div class="estat">' +
      '<div class="largo"><small>Média ± desvio padrão</small><b>' + C.fmt(e.media, 2) + ' ± ' + C.fmt(e.desvio, 2) + ' g</b></div>' +
      '<div><small>Mínimo</small><b>' + C.fmt(e.min, 2) + ' g</b></div>' +
      '<div><small>Máximo</small><b>' + C.fmt(e.max, 2) + ' g</b></div>' +
      '<div><small>Coef. de variação</small><b>' + C.fmt(e.cv, 1) + '%</b></div>' +
      '<div><small>Uniformidade</small><b>' + C.fmt(e.uniformidade, 2) + '</b></div>' +
      '<div><small>pç/kg</small><b>' + C.fmt(e.pcKg, 1) + '</b></div>' +
      '<div><small>pç/lb</small><b>' + C.fmt(e.pcLb, 1) + '</b></div>' +
      '<div class="largo"><small>Unidades dentro da classe do lote</small><b>' + C.fmt(r.pctNaClasse, 0) + '% (' + r.naClasse + ' de ' + r.n + ')</b></div>' +
      '</div></section>');

    // Tabela de enquadramento.
    var maxPct = Math.max.apply(null, r.distribuicao.map(function (d) { return d.pct; }).concat([r.fora.pct, 1]));
    h.push('<section class="secao"><h2>Enquadramento · ' + esc(C.descreverTabela(r.tabela)) + '</h2><div class="enquadra" id="enquadramento">');
    r.distribuicao.forEach(function (d) {
      h.push('<div class="enq-linha' + (d.doLote ? ' do-lote' : '') + (d.qtd ? '' : ' zero') + '">' +
        '<div class="e-classe"><b>' + esc(d.classe) + '</b>' + (d.doLote ? ' ◀ lote' : '') + '<small>' + esc(C.fmtFaixaPeso(r.tabela, d.faixaPeso)) + '</small></div>' +
        '<div class="e-pecas">' + esc(C.fmtFaixaPecas(d.faixaPecas)) + '<small>' + esc(C.fmtEmbalagem(r.embalagem.liquido)) + '</small></div>' +
        '<div class="e-qtd">' + d.qtd + ' un.<small>' + C.fmt(d.pct, 0) + '%</small></div>' +
        '<div class="barra"><i style="width:' + (d.pct / maxPct * 100).toFixed(1) + '%"></i></div></div>');
    });
    if (r.fora.qtd) {
      h.push('<div class="enq-linha e-fora"><div class="e-classe"><b>Fora da tabela</b><small>sem classe</small></div><div class="e-pecas">—</div>' +
        '<div class="e-qtd">' + r.fora.qtd + ' un.<small>' + C.fmt(r.fora.pct, 0) + '%</small></div>' +
        '<div class="barra"><i style="width:' + (r.fora.pct / maxPct * 100).toFixed(1) + '%"></i></div></div>');
    }
    h.push('</div></section>');

    // Ações.
    h.push('<section class="secao"><h2>Ações</h2><div class="acoes-resultado">');
    if (ra.leitura) {
      h.push('<button type="button" class="btn btn-primario" data-acao="compartilhar">Compartilhar resumo</button>');
      h.push('<button type="button" class="btn btn-secundario" data-acao="csv">Exportar CSV</button>');
      if (ui.confirmarExcluir) {
        h.push('<div class="confirmar"><p>Excluir esta avaliação do histórico? Não dá para desfazer.</p><div class="linha-botoes">' +
          '<button type="button" class="btn btn-perigo" data-acao="excluir-sim">Excluir</button>' +
          '<button type="button" class="btn btn-secundario" data-acao="excluir-nao">Cancelar</button></div></div>');
      } else {
        h.push('<button type="button" class="btn btn-secundario" data-acao="excluir">Excluir</button>');
      }
      h.push('<button type="button" class="btn btn-secundario" data-acao="voltar-historico">Voltar ao histórico</button>');
    } else {
      h.push('<button type="button" class="btn btn-primario btn-grande" data-acao="salvar">' + (E.salvoId ? 'Atualizar avaliação salva' : 'Salvar avaliação') + '</button>');
      h.push('<button type="button" class="btn btn-secundario" data-acao="compartilhar">Compartilhar resumo</button>');
      h.push('<button type="button" class="btn btn-secundario" data-acao="csv">Exportar CSV</button>');
      if (ui.confirmarNova) {
        var naoSalvo = !E.salvoId;
        h.push('<div class="confirmar"><p>' + (naoSalvo ? 'As ' + r.n + ' unidades ainda não foram salvas e serão descartadas. ' : '') + 'Começar uma nova avaliação?</p><div class="linha-botoes">' +
          '<button type="button" class="btn btn-perigo" data-acao="nova-sim">Sim, nova avaliação</button>' +
          '<button type="button" class="btn btn-secundario" data-acao="nova-nao">Cancelar</button></div></div>');
      } else {
        h.push('<button type="button" class="btn btn-secundario btn-grande" data-acao="nova">Nova avaliação</button>');
      }
    }
    h.push('</div></section>');
    alvo.innerHTML = h.join('');
  }

  function acaoResultado(acao) {
    var ra = registroAtual();
    var reg = ra.reg;
    switch (acao) {
      case 'ir-pesagem': irPara('pesagem'); break;
      case 'salvar': salvarAvaliacao(); break;
      case 'compartilhar': compartilharResumo(reg); break;
      case 'csv': exportarCsv([reg], nomeArquivo(reg)); break;
      case 'nova': ui.confirmarNova = true; renderResultado(); rolarParaConfirmar(); break;
      case 'nova-nao': ui.confirmarNova = false; renderResultado(); break;
      case 'nova-sim': novaAvaliacao(); break;
      case 'excluir': ui.confirmarExcluir = true; renderResultado(); rolarParaConfirmar(); break;
      case 'excluir-nao': ui.confirmarExcluir = false; renderResultado(); break;
      case 'excluir-sim': excluirAvaliacao(reg.id); break;
      case 'voltar-historico': irPara('historico'); break;
    }
  }

  function rolarParaConfirmar() {
    var c = $('.confirmar');
    if (c && c.scrollIntoView) c.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  function gerarId() {
    return 'av-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  }

  function salvarAvaliacao() {
    if (!E.pesos.length) return;
    var id = E.salvoId || gerarId();
    var reg = {
      id: id,
      salvoEm: Date.now(),
      ident: Object.assign({}, E.ident),
      cfg: Object.assign({}, E.cfg),
      pesos: E.pesos.slice(),
    };
    var i = historico.findIndex(function (h) { return h.id === id; });
    var novoHist = historico.slice();
    if (i >= 0) novoHist[i] = reg; else novoHist.unshift(reg);
    if (!gravar(CHAVES.historico, novoHist)) return;
    historico = novoHist;
    var atualizado = !!E.salvoId;
    E.salvoId = id;
    salvarRascunho();
    renderResultado();
    toast(atualizado ? 'Avaliação atualizada no histórico.' : 'Avaliação salva no histórico.', 'ok');
  }

  function novaAvaliacao() {
    var novo = estadoInicial(E);
    // Mantém produto e embalagem: o técnico costuma avaliar vários lotes iguais seguidos.
    novo.cfg = Object.assign({}, E.cfg);
    E = novo;
    ui.entrada = '';
    ui.erro = '';
    desarmar();
    salvarRascunho();
    irPara('produto');
    toast('Nova avaliação iniciada.');
  }

  function excluirAvaliacao(id) {
    var novoHist = historico.filter(function (h) { return h.id !== id; });
    if (!gravar(CHAVES.historico, novoHist)) return;
    historico = novoHist;
    if (E.salvoId === id) { E.salvoId = null; salvarRascunho(); }
    irPara('historico');
    toast('Avaliação excluída.');
  }

  // ---------------------------------------------------------------------------
  // Compartilhar e exportar
  // ---------------------------------------------------------------------------

  function compartilharResumo(reg) {
    var r = C.avaliar(reg.cfg, reg.pesos);
    var texto = C.resumoTexto(r, reg.ident);
    var titulo = 'Classificação de camarão' + (reg.ident && reg.ident.codigo ? ' — ' + reg.ident.codigo : '');
    if (navigator.share) {
      navigator.share({ title: titulo, text: texto }).catch(function (e) {
        if (e && e.name === 'AbortError') return; // usuário cancelou
        copiar(texto);
      });
    } else {
      copiar(texto);
    }
  }

  function copiar(texto) {
    function alternativa() {
      var ta = document.createElement('textarea');
      ta.value = texto;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      toast(ok ? 'Resumo copiado. Cole no WhatsApp, e-mail ou Teams.' : 'Não foi possível copiar o resumo neste aparelho.', ok ? 'ok' : 'critico');
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(texto).then(function () {
        toast('Resumo copiado. Cole no WhatsApp, e-mail ou Teams.', 'ok');
      }, alternativa);
    } else {
      alternativa();
    }
  }

  function nomeArquivo(reg) {
    var base = 'classificacao_' + ((reg.ident && reg.ident.codigo) || 'avaliacao') + '_' + ((reg.ident && reg.ident.data) || hojeISO());
    return base.replace(/[^\w.-]+/g, '_') + '.csv';
  }

  // CSV: compartilha o arquivo quando o aparelho permite; senão, baixa.
  function exportarCsv(itens, nome) {
    var conteudo = C.gerarCsv(itens);
    var tipo = 'text/csv;charset=utf-8';
    var arquivo = null;
    try { arquivo = new File([conteudo], nome, { type: tipo }); } catch (e) { arquivo = null; }
    if (arquivo && navigator.canShare && navigator.canShare({ files: [arquivo] })) {
      navigator.share({ files: [arquivo], title: nome }).catch(function (e) {
        if (!e || e.name !== 'AbortError') baixar(conteudo, nome, tipo);
      });
      return;
    }
    baixar(conteudo, nome, tipo);
  }

  function baixar(conteudo, nome, tipo) {
    var url = URL.createObjectURL(new Blob([conteudo], { type: tipo }));
    var a = document.createElement('a');
    a.href = url;
    a.download = nome;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    toast('CSV gerado: ' + nome, 'ok');
  }

  // ---------------------------------------------------------------------------
  // 4. Histórico
  // ---------------------------------------------------------------------------

  function renderHistorico() {
    var alvo = $('#historico');
    if (!historico.length) {
      alvo.innerHTML = '<div class="card"><p>Nenhuma avaliação salva ainda.</p><p>Depois de pesar um lote, toque em <b>Salvar avaliação</b> na tela Resultado.</p></div>';
      return;
    }
    var h = ['<ul class="hist-lista" id="lista-historico">'];
    historico.forEach(function (reg) {
      var r = C.avaliar(reg.cfg, reg.pesos);
      var cls = !r.n ? '' : r.lote.situacao === 'fora' ? ' h-fora' : r.lote.situacao === 'tolerancia' ? ' h-tol' : '';
      var classe = !r.n ? '—' : r.lote.situacao === 'fora' ? 'Fora' : r.classeLote.rotulo;
      var id = reg.ident || {};
      h.push('<li><button type="button" data-abrir="' + esc(reg.id) + '">' +
        '<span class="hist-classe' + cls + '">' + esc(classe) + '</span>' +
        '<span class="hist-l1">' + esc(id.codigo || '(sem código)') + ' · ' + esc(C.ESPECIES[reg.cfg.especie].nome) + ', ' + esc(C.APRESENTACOES[reg.cfg.apresentacao].toLowerCase()) + '</span>' +
        '<span class="hist-l2">' + esc(C.fmtDataHora(reg.salvoEm)) + (id.lote ? ' · Lote ' + esc(id.lote) : '') + (id.tecnico ? ' · ' + esc(id.tecnico) : '') + '</span>' +
        '<span class="hist-l3">' + r.n + ' un.' + (r.n ? ' · ' + esc(C.fmtFaixaPecas(r.faixaPecas)) + ' em ' + esc(C.fmtEmbalagem(r.embalagem.liquido)) : '') + '</span>' +
        '</button></li>');
    });
    h.push('</ul>');
    h.push('<button type="button" class="btn btn-secundario btn-grande" data-acao-hist="exportar-todas">Exportar todas (CSV)</button>');
    alvo.innerHTML = h.join('');
  }

  // ---------------------------------------------------------------------------
  // Instalação (PWA)
  // ---------------------------------------------------------------------------

  var promptInstalacao = null;

  function instalado() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
  }

  function renderInstalar() {
    var card = $('#card-instalar');
    card.hidden = instalado() || ler(CHAVES.instalarFechado, false) === true;
    $('#btn-instalar').hidden = !promptInstalacao;
  }

  window.addEventListener('beforeinstallprompt', function (ev) {
    ev.preventDefault();
    promptInstalacao = ev;
    renderInstalar();
  });
  window.addEventListener('appinstalled', function () {
    promptInstalacao = null;
    renderInstalar();
    toast('App instalado.', 'ok');
  });

  // ---------------------------------------------------------------------------
  // Tema claro/escuro: Auto → Claro → Escuro
  // ---------------------------------------------------------------------------

  var TEMAS = ['auto', 'light', 'dark'];
  var NOMES_TEMA = { auto: 'Auto', light: 'Claro', dark: 'Escuro' };

  function aplicarTema(tema) {
    var raiz = document.documentElement;
    if (tema === 'auto') raiz.removeAttribute('data-theme');
    else raiz.setAttribute('data-theme', tema);
    $('#tema-rotulo').textContent = NOMES_TEMA[tema];
    var escuro = tema === 'dark' || (tema === 'auto' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    $('meta[name="theme-color"]').setAttribute('content', escuro ? '#151b23' : '#0b4f8a');
  }

  // ---------------------------------------------------------------------------
  // Início
  // ---------------------------------------------------------------------------

  function iniciar() {
    montarProduto();
    montarPesagem();

    $$('.nav-inferior [data-ir]').forEach(function (b) {
      b.addEventListener('click', function () { irPara(b.dataset.ir); });
    });
    $('#resultado').addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-acao]');
      if (b) acaoResultado(b.dataset.acao);
    });
    $('#historico').addEventListener('click', function (ev) {
      var abrir = ev.target.closest('[data-abrir]');
      if (abrir) {
        irPara('resultado');
        ui.visualizar = abrir.dataset.abrir;
        renderResultado();
        return;
      }
      var b = ev.target.closest('[data-acao-hist]');
      if (b && b.dataset.acaoHist === 'exportar-todas') exportarCsv(historico, 'classificacoes_' + hojeISO() + '.csv');
    });

    $('#btn-instalar').addEventListener('click', function () {
      if (!promptInstalacao) return;
      promptInstalacao.prompt();
      promptInstalacao.userChoice.then(function () { promptInstalacao = null; renderInstalar(); }, function () {});
    });
    $('#btn-instalar-fechar').addEventListener('click', function () {
      gravar(CHAVES.instalarFechado, true);
      renderInstalar();
    });

    var tema = ler(CHAVES.tema, 'auto');
    if (TEMAS.indexOf(tema) < 0) tema = 'auto';
    aplicarTema(tema);
    $('#btn-tema').addEventListener('click', function () {
      tema = TEMAS[(TEMAS.indexOf(tema) + 1) % TEMAS.length];
      gravar(CHAVES.tema, tema);
      aplicarTema(tema);
    });
    if (window.matchMedia) {
      var mq = window.matchMedia('(prefers-color-scheme: dark)');
      var aoMudar = function () { if (tema === 'auto') aplicarTema('auto'); };
      if (mq.addEventListener) mq.addEventListener('change', aoMudar); else if (mq.addListener) mq.addListener(aoMudar);
    }

    renderProduto();
    irPara(TELAS.indexOf(E.tela) >= 0 ? E.tela : 'produto');

    // Service worker: cache do app shell para uso offline.
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
      var tinhaControle = !!navigator.serviceWorker.controller;
      navigator.serviceWorker.register('sw.js').catch(function () { /* segue sem offline */ });
      navigator.serviceWorker.addEventListener('controllerchange', function () {
        if (tinhaControle) toast('App atualizado para a versão mais recente.', 'ok');
      });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
