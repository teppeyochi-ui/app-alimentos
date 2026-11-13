/*
 * app.js — Interface do Dita: grava a fala (reconhecimento de voz do navegador),
 * manda a transcrição para o Claude limpar e mostra o texto pronto.
 */
(function () {
  'use strict';
  const N = window.Nucleo;
  const $ = (id) => document.getElementById(id);

  const CHAVE_CFG = 'dita.config';
  const CHAVE_HIST = 'dita.historico';
  const MAX_HIST = 50;

  // ---- Armazenamento local (pode falhar em aba anônima: o app segue sem ele) ----
  function ler(chave, padrao) {
    try { const v = JSON.parse(localStorage.getItem(chave)); return v == null ? padrao : v; } catch (e) { return padrao; }
  }
  function gravar(chave, valor) {
    try { localStorage.setItem(chave, JSON.stringify(valor)); } catch (e) { /* sem armazenamento */ }
  }

  const cfg = Object.assign(
    { chave: '', modelo: N.MODELOS[0].id, idioma: N.IDIOMAS[0].id, dicionario: '', copiar: true, estilo: 'padrao' },
    ler(CHAVE_CFG, {})
  );
  let historico = ler(CHAVE_HIST, []);

  const el = {
    texto: $('texto'), aoVivo: $('ao-vivo'), estado: $('estado'), mic: $('btn-mic'), aviso: $('aviso'),
    contagem: $('contagem'), selo: $('selo'), original: $('original'), originalTexto: $('original-texto'),
    desfazer: $('btn-desfazer'), toast: $('toast'),
  };

  let estado = 'ocioso';        // ocioso | gravando | processando
  let modoGravacao = 'ditado';  // ditado | ajuste
  let textoAnterior = null;     // para Desfazer
  let cancelarIA = null;        // AbortController da chamada em andamento
  let semFallback = false;      // a API recusou o parâmetro de fallback nesta sessão

  // ---- Utilidades de tela ----
  let timerToast;
  function toast(msg, erro) {
    el.toast.textContent = msg;
    el.toast.classList.toggle('erro', !!erro);
    el.toast.hidden = false;
    clearTimeout(timerToast);
    timerToast = setTimeout(() => { el.toast.hidden = true; }, erro ? 6000 : 2500);
  }

  function definirEstado(novo, rotulo) {
    estado = novo;
    document.body.dataset.estado = novo;
    el.estado.textContent = rotulo || (novo === 'ocioso' ? 'Toque para falar' : '');
    el.mic.setAttribute('aria-pressed', String(novo === 'gravando'));
    el.mic.setAttribute('aria-label', novo === 'gravando' ? 'Parar' : novo === 'processando' ? 'Cancelar' : 'Começar a ditar');
    for (const id of ['btn-ajustar', 'btn-polir', 'btn-novo']) $(id).disabled = novo !== 'ocioso';
    el.texto.readOnly = novo === 'processando';
  }

  function atualizarContagem() {
    const n = (el.texto.value.trim().match(/\S+/g) || []).length;
    el.contagem.textContent = n + (n === 1 ? ' palavra' : ' palavras');
  }

  function definirTexto(valor) {
    el.texto.value = valor;
    el.texto.scrollTop = el.texto.scrollHeight;
    atualizarContagem();
  }

  function mostrarAoVivo(t) {
    el.aoVivo.textContent = t;
    el.aoVivo.hidden = !t;
    el.aoVivo.scrollTop = el.aoVivo.scrollHeight;
  }

  // ---- Reconhecimento de voz ----
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null;
  let base = '';      // trechos já fechados em sessões anteriores do reconhecedor
  let sessao = '';    // trechos finais da sessão atual
  let parcial = '';   // trecho ainda sendo reconhecido
  let descartar = false;

  function juntar(a, b) { return (a + ' ' + b).replace(/\s+/g, ' ').trim(); }

  function iniciarGravacao(modo) {
    if (!SR) { toast('Este navegador não tem reconhecimento de voz. Use o Chrome ou o Edge.', true); return; }
    if (estado !== 'ocioso') return;
    if (modo === 'ajuste') {
      if (!el.texto.value.trim()) { toast('Não há texto para ajustar.'); return; }
      if (!cfg.chave) { toast('O ajuste por voz precisa da chave de API (Ajustes).', true); return; }
    }
    modoGravacao = modo;
    base = ''; sessao = ''; parcial = ''; descartar = false;
    definirEstado('gravando', modo === 'ajuste' ? 'Diga o que mudar…' : 'Ouvindo…');
    abrirReconhecedor();
  }

  function abrirReconhecedor() {
    rec = new SR();
    rec.lang = cfg.idioma;
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (ev) => {
      // Reconstrói a sessão inteira a cada evento: evita trechos duplicados no Android.
      let finais = '';
      parcial = '';
      for (let i = 0; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) finais = juntar(finais, r[0].transcript); else parcial = juntar(parcial, r[0].transcript);
      }
      sessao = finais;
      mostrarAoVivo(juntar(juntar(base, sessao), parcial));
    };
    rec.onerror = (ev) => {
      if (ev.error === 'no-speech' || ev.error === 'aborted') return;
      descartar = true;
      const msgs = {
        'not-allowed': 'Permita o uso do microfone para ditar.',
        'service-not-allowed': 'O reconhecimento de voz está bloqueado neste navegador.',
        'audio-capture': 'Nenhum microfone encontrado.',
        'network': 'O reconhecimento de voz precisa de internet.',
        'language-not-supported': 'Idioma não suportado pelo reconhecimento de voz.',
      };
      toast(msgs[ev.error] || 'Falha no reconhecimento de voz (' + ev.error + ').', true);
      if (estado === 'gravando') definirEstado('ocioso');
    };
    rec.onend = () => {
      base = juntar(base, sessao); sessao = '';
      // O navegador encerra sozinho após silêncio: se ainda estamos gravando, reabre.
      if (estado === 'gravando') { try { abrirReconhecedor(); return; } catch (e) { /* cai para finalizar */ } }
      rec = null;
      const bruto = juntar(base, parcial);
      mostrarAoVivo('');
      if (descartar) { if (estado !== 'processando') definirEstado('ocioso'); return; }
      if (!bruto) { definirEstado('ocioso'); toast('Não ouvi nada.'); return; }
      processar(bruto, modoGravacao);
    };
    rec.start();
  }

  function pararGravacao(cancelar) {
    if (estado !== 'gravando') return;
    descartar = !!cancelar;
    definirEstado('processando', cancelar ? '' : 'Finalizando…');
    if (rec) { try { rec.stop(); } catch (e) { rec.onend(); } } else definirEstado('ocioso');
  }

  // ---- Chamada à IA (streaming) ----
  async function chamarIA(op, aoParcial, sinal) {
    let req = N.montarRequisicao(Object.assign({ semFallback }, op));
    let resp;
    try {
      resp = await fetch(req.url, Object.assign({ signal: sinal }, req.init));
      if (resp.status === 400 && req.usaFallback) {
        // Chave ou conta sem o recurso de fallback: repete sem ele.
        semFallback = true;
        req = N.montarRequisicao(Object.assign({}, op, { semFallback: true }));
        resp = await fetch(req.url, Object.assign({ signal: sinal }, req.init));
      }
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      throw new Error('Sem conexão com a IA. Verifique a internet.');
    }
    if (!resp.ok) {
      let tipo = '';
      try { tipo = (await resp.json()).error.type; } catch (e) { /* corpo sem JSON */ }
      throw new Error(N.mensagemErro(resp.status, tipo));
    }
    const leitor = N.criarLeitorSSE();
    const fluxo = resp.body.getReader();
    const dec = new TextDecoder();
    const acum = { texto: '', motivo: null };
    for (;;) {
      const { done, value } = await fluxo.read();
      if (done) break;
      for (const ev of leitor.alimentar(dec.decode(value, { stream: true }))) {
        N.aplicarEvento(acum, ev);
        aoParcial(acum.texto);
      }
    }
    if (acum.motivo === 'refusal') throw new Error('A IA se recusou a processar este texto.');
    return acum;
  }

  /**
   * modo: 'ditado' (acrescenta ao texto), 'polir' (limpa o texto da tela)
   * ou 'ajuste' (aplica a instrução falada ao texto da tela).
   */
  async function processar(bruto, modo) {
    const antes = el.texto.value;
    const prefixo = modo === 'ditado' && antes.trim() ? antes.trimEnd() + '\n\n' : '';
    let limpo = '';
    let comIA = false;
    let falha = '';

    if (cfg.chave) {
      definirEstado('processando', modo === 'ajuste' ? 'Ajustando…' : 'Limpando o texto…');
      cancelarIA = new AbortController();
      const op = { chave: cfg.chave, modelo: cfg.modelo, estilo: cfg.estilo, dicionario: cfg.dicionario };
      if (modo === 'ajuste') Object.assign(op, { texto: antes, instrucao: bruto });
      else op.texto = bruto;
      try {
        const r = await chamarIA(op, (t) => definirTexto(prefixo + t), cancelarIA.signal);
        limpo = r.texto.trim();
        comIA = true;
        if (r.motivo === 'max_tokens') falha = 'O texto ficou longo demais e foi cortado.';
      } catch (e) {
        if (e.name === 'AbortError') { definirTexto(antes); definirEstado('ocioso'); toast('Cancelado.'); return; }
        falha = e.message;
      } finally {
        cancelarIA = null;
      }
    }

    if (!comIA) {
      if (modo === 'ajuste') { definirTexto(antes); definirEstado('ocioso'); toast(falha, true); return; }
      limpo = N.limparLocal(bruto);
      if (falha) falha += ' Usei a limpeza simples.';
    }

    definirEstado('ocioso');
    if (!limpo) { definirTexto(antes); toast(falha || 'Não entendi o que foi dito.', !!falha); return; }

    definirTexto(prefixo + limpo);
    textoAnterior = antes;
    el.desfazer.hidden = false;
    el.selo.textContent = comIA ? 'limpo com IA' : 'limpeza simples';
    el.selo.hidden = false;
    el.originalTexto.textContent = modo === 'ajuste' ? 'Instrução: ' + bruto : bruto;
    el.original.hidden = false;

    historico.unshift({ quando: Date.now(), bruto: modo === 'ajuste' ? antes : bruto, limpo: prefixo + limpo });
    historico = historico.slice(0, MAX_HIST);
    gravar(CHAVE_HIST, historico);

    if (falha) toast(falha, true);
    else if (cfg.copiar && await copiar(el.texto.value, true)) toast('Texto copiado.');
  }

  async function copiar(texto, silencioso) {
    if (!texto.trim()) { if (!silencioso) toast('Nada para copiar.'); return false; }
    try {
      await navigator.clipboard.writeText(texto);
      return true;
    } catch (e) {
      // Sem permissão de área de transferência (ex.: página sem foco): tenta o método antigo.
      el.texto.select();
      const ok = document.execCommand && document.execCommand('copy');
      if (!ok && !silencioso) toast('Não consegui copiar. Selecione e copie manualmente.', true);
      return !!ok;
    }
  }

  // ---- Estilos ----
  function montarEstilos() {
    const caixa = $('estilos');
    caixa.textContent = '';
    for (const e of N.ESTILOS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(e.id === cfg.estilo));
      b.textContent = e.nome;
      b.addEventListener('click', () => { cfg.estilo = e.id; gravar(CHAVE_CFG, cfg); montarEstilos(); });
      caixa.appendChild(b);
    }
  }

  // ---- Ajustes ----
  function preencherSelect(sel, itens, atual, rotulo) {
    sel.textContent = '';
    for (const it of itens) {
      const o = document.createElement('option');
      o.value = it.id;
      o.textContent = rotulo(it);
      o.selected = it.id === atual;
      sel.appendChild(o);
    }
  }

  function abrirAjustes() {
    $('cfg-chave').value = cfg.chave;
    preencherSelect($('cfg-modelo'), N.MODELOS, cfg.modelo, (m) => m.nome + ' — ' + m.nota);
    preencherSelect($('cfg-idioma'), N.IDIOMAS, cfg.idioma, (i) => i.nome);
    $('cfg-dicionario').value = cfg.dicionario;
    $('cfg-copiar').checked = cfg.copiar;
    $('dlg-ajustes').showModal();
  }

  function salvarAjustes() {
    cfg.chave = $('cfg-chave').value.trim();
    cfg.modelo = $('cfg-modelo').value;
    cfg.idioma = $('cfg-idioma').value;
    cfg.dicionario = $('cfg-dicionario').value.trim();
    cfg.copiar = $('cfg-copiar').checked;
    gravar(CHAVE_CFG, cfg);
    atualizarAviso();
    toast('Ajustes salvos.');
  }

  function atualizarAviso() {
    const msgs = [];
    if (!SR) msgs.push('Este navegador não tem reconhecimento de voz: use o Chrome ou o Edge para ditar. Ainda dá para colar um texto e tocar em Polir.');
    if (!cfg.chave) msgs.push('Sem chave de API, a limpeza é só a simples. Informe a chave em Ajustes para a limpeza com IA.');
    el.aviso.textContent = msgs.join(' ');
    el.aviso.hidden = !msgs.length;
  }

  // ---- Histórico ----
  function abrirHistorico() {
    const lista = $('lista-historico');
    lista.textContent = '';
    if (!historico.length) {
      const li = document.createElement('li');
      li.className = 'vazio';
      li.textContent = 'Nenhum ditado ainda.';
      lista.appendChild(li);
    }
    for (const item of historico) {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      const quando = document.createElement('time');
      quando.textContent = new Date(item.quando).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
      const trecho = document.createElement('span');
      trecho.textContent = item.limpo;
      b.append(quando, trecho);
      b.addEventListener('click', () => {
        textoAnterior = el.texto.value;
        el.desfazer.hidden = false;
        definirTexto(item.limpo);
        $('dlg-historico').close();
      });
      li.appendChild(b);
      lista.appendChild(li);
    }
    $('dlg-historico').showModal();
  }

  // ---- Eventos ----
  el.mic.addEventListener('click', () => {
    if (estado === 'ocioso') iniciarGravacao('ditado');
    else if (estado === 'gravando') pararGravacao(false);
    else if (cancelarIA) cancelarIA.abort();
  });
  $('btn-ajustar').addEventListener('click', () => iniciarGravacao('ajuste'));
  $('btn-polir').addEventListener('click', () => {
    const t = el.texto.value.trim();
    if (!t) { toast('Cole ou digite um texto para polir.'); return; }
    processar(t, 'polir');
  });
  $('btn-copiar').addEventListener('click', async () => { if (await copiar(el.texto.value)) toast('Texto copiado.'); });
  $('btn-novo').addEventListener('click', () => {
    if (!el.texto.value) return;
    textoAnterior = el.texto.value;
    el.desfazer.hidden = false;
    definirTexto('');
    el.selo.hidden = true;
    el.original.hidden = true;
  });
  el.desfazer.addEventListener('click', () => {
    if (textoAnterior == null) return;
    definirTexto(textoAnterior);
    textoAnterior = null;
    el.desfazer.hidden = true;
  });
  el.texto.addEventListener('input', atualizarContagem);

  if (navigator.share) {
    $('btn-compartilhar').hidden = false;
    $('btn-compartilhar').addEventListener('click', () => {
      if (el.texto.value.trim()) navigator.share({ text: el.texto.value }).catch(() => {});
    });
  }

  $('btn-ajustes').addEventListener('click', abrirAjustes);
  $('cfg-cancelar').addEventListener('click', () => $('dlg-ajustes').close());
  $('dlg-ajustes').querySelector('form').addEventListener('submit', salvarAjustes);
  $('btn-historico').addEventListener('click', abrirHistorico);
  $('hist-fechar').addEventListener('click', () => $('dlg-historico').close());
  $('hist-apagar').addEventListener('click', () => {
    historico = [];
    gravar(CHAVE_HIST, historico);
    $('dlg-historico').close();
    toast('Histórico apagado.');
  });

  document.addEventListener('keydown', (ev) => {
    if (document.querySelector('dialog[open]')) return;
    const digitando = /^(TEXTAREA|INPUT|SELECT)$/.test(ev.target.tagName);
    if (ev.code === 'Space' && !digitando && !ev.repeat && ev.target.tagName !== 'BUTTON') {
      ev.preventDefault();
      el.mic.click();
    } else if (ev.key === 'Escape') {
      if (estado === 'gravando') { pararGravacao(true); toast('Cancelado.'); }
      else if (cancelarIA) cancelarIA.abort();
    }
  });

  montarEstilos();
  atualizarAviso();
  atualizarContagem();
  definirEstado('ocioso');

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
