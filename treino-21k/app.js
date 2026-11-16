/*
 * app.js — Interface do app de treino: plano, registro dos treinos, painel de
 * evolução, perfil e objetivo com criação do treino pela IA, exportação para o
 * Claude, ajustes e instalação como aplicativo.
 * Os cálculos ficam em core.js, a IA em ia.js e o desenho dos gráficos em graficos.js.
 */
(function () {
  'use strict';
  const N = window.Nucleo, G = window.Graficos, IA = window.IA;
  const VERSAO = '1.1.0';
  const CHAVE_UI = 'r21k_ui'; // preferências de tela (ficam fora do backup)
  const CHAVE_IA = 'r21k_ia'; // chave da API e modelo (ficam fora do backup)
  const CHAVE_ANTERIOR = 'r21k_anterior'; // dados de antes da última troca de plano
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = (x) => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const v = (x) => (x == null ? '' : esc(x));
  const agora = () => new Date();

  // Números no formato brasileiro (vírgula decimal).
  const km = (x) => (Math.round(x * 10) / 10).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
  const dec = (x, n) => x.toLocaleString('pt-BR', { minimumFractionDigits: n, maximumFractionDigits: n });
  const dataCheia = (d) => N.fd(d) + '/' + d.getFullYear();

  function ler(chave) { try { return localStorage.getItem(chave); } catch (e) { return null; } }
  function lerJson(chave) { try { return JSON.parse(ler(chave)) || {}; } catch (e) { return {}; } }
  function gravar(chave, valor) { try { localStorage.setItem(chave, valor); return true; } catch (e) { return false; } }
  function remover(chave) { try { localStorage.removeItem(chave); } catch (e) { /* nada a remover */ } }

  let D = N.carregar(ler(N.CHAVE));
  const UI = Object.assign({ periodo: 'tudo', semFaixa: false, inicioPlano: '' }, lerJson(CHAVE_UI));
  const CFG = Object.assign({ chave: '', modelo: IA.MODELOS[0].id }, lerJson(CHAVE_IA));
  let aba = 'plano';
  let pedidoInstalar = null; // evento do navegador que permite mostrar o botão "Instalar"
  let pediuPersistencia = false;
  let redesenhar = null; // redesenha os gráficos quando a largura muda
  let rascunho = null; // plano criado pela IA, esperando a pessoa aprovar
  let gerando = null; // { cancelar, inicio, texto } enquanto a IA trabalha
  let erroIa = '';

  function salvar() {
    if (!gravar(N.CHAVE, JSON.stringify(D))) { alert('Não consegui salvar neste navegador.'); return; }
    // Pede ao navegador para não apagar os dados quando faltar espaço no aparelho.
    if (!pediuPersistencia && navigator.storage && navigator.storage.persist) {
      pediuPersistencia = true;
      navigator.storage.persist().catch(() => {});
    }
  }
  function salvarUi() { gravar(CHAVE_UI, JSON.stringify(UI)); }

  let relogioAviso = 0;
  function aviso(msg) {
    const el = $('#aviso');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(relogioAviso);
    relogioAviso = setTimeout(() => { el.hidden = true; }, 2800);
  }

  function copiarTexto(texto, campo) {
    const reserva = () => { if (campo) { campo.select(); document.execCommand('copy'); aviso('Copiado!'); } else aviso('Não consegui copiar.'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(texto).then(() => aviso('Copiado!'), reserva);
    else reserva();
  }

  const instalado = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const ehIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  // ---------- moldura ----------

  function cabecalho() {
    const a = agora(), dias = N.diasParaProva(D, a);
    const mesmoDia = a.toDateString() === N.dataProva(D).toDateString();
    const falta = dias > 1 ? `Faltam ${dias} dias` : dias === 1 ? 'Falta 1 dia' : mesmoDia ? 'A prova é hoje' : 'Prova realizada';
    const meta = N.alvo(D).meta;
    $('#titulo').textContent = N.titulo(D);
    $('#hdr').textContent = `${falta} · ${N.fechadas(D)}/${N.nSemanas(D)} semanas fechadas${meta ? ' · meta: ' + meta : ''}`;
  }

  const TELAS = { plano: telaPlano, evolucao: telaEvolucao, perfil: telaPerfil, exportar: telaExportar, ajustes: telaAjustes };

  function render() {
    redesenhar = null;
    cabecalho();
    TELAS[aba]();
  }

  // Redesenha a tela sem tirar a pessoa do ponto em que estava, nem apagar o que ela digitava em Ajustes.
  function renderNoLugar() {
    const y = window.scrollY;
    const digitado = ['#pr', '#bk'].map((s) => ($(s) ? $(s).value : null));
    render();
    ['#pr', '#bk'].forEach((s, i) => { if ($(s) && digitado[i] != null) $(s).value = digitado[i]; });
    window.scrollTo(0, y);
  }

  function irPara(nova) {
    aba = nova;
    document.querySelectorAll('.abas button').forEach((b) => {
      const on = b.dataset.aba === aba;
      b.classList.toggle('on', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    render();
    if (aba === 'plano') mostrarSemanaAtual(); else window.scrollTo(0, 0);
  }

  // Leva a tela até a semana atual (ou até o convite para instalar, que fica logo acima dela).
  // Na semana 1 não rola: o começo da página já mostra tudo.
  function mostrarSemanaAtual() {
    const cw = N.semanaAtual(D, agora());
    const el = $('#app .faixa') || $('#w' + cw);
    if (cw > 1 && el) requestAnimationFrame(() => el.scrollIntoView());
    else window.scrollTo(0, 0);
  }

  // ---------- plano ----------

  const ICONE = {
    pendente: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/></svg>',
    feito: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.8 2.8L16 9.5"/></svg>',
    parcial: '<svg viewBox="0 0 24 24"><path class="meio" d="M12 3a9 9 0 0 0 0 18z"/><circle cx="12" cy="12" r="9"/></svg>',
    nao: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/></svg>',
  };
  const NOME_STATUS = { pendente: 'Sem registro', feito: 'Feito', parcial: 'Parcial', nao: 'Não fiz' };

  function faixaInstalar() {
    if (instalado() || UI.semFaixa) return '';
    if (pedidoInstalar) {
      return '<div class="faixa"><p>Instale o app na tela inicial do celular.</p><button type="button" class="b" data-acao="instalar">Instalar</button><button type="button" class="fechar" data-acao="fechar-faixa" aria-label="Dispensar">×</button></div>';
    }
    if (ehIOS()) {
      return '<div class="faixa"><p>Para instalar: toque em <b>Compartilhar</b> no Safari e depois em <b>Adicionar à Tela de Início</b>.</p><button type="button" class="fechar" data-acao="fechar-faixa" aria-label="Dispensar">×</button></div>';
    }
    return '';
  }

  const LEGENDA_CODIGOS = '<span><i class="tag tag-A">A</i>água</span><span><i class="tag tag-B">B</i>cinto, isotônico no calor</span>' +
    '<span><i class="tag tag-C">C</i>colete + carbo</span><span><i class="tag tag-D">D</i>protocolo de prova</span>';

  function telaPlano() {
    const a = agora(), P = N.plano(D), cw = N.semanaAtual(D, a), fase = N.fase(D, a);
    const hoje = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
    let h = '<div class="card"><small>Toque no treino para registrar.</small><div class="chips">' + LEGENDA_CODIGOS +
      (P.embutido ? '<span>N = Novablast 5 · E = Evo SL</span>' : '') + '</div>' +
      (P.orientacoes ? `<details class="orienta"><summary>Orientações do plano</summary><p>${esc(P.orientacoes)}</p></details>` : '') + '</div>';
    for (let w = 1; w <= P.semanas.length; w++) {
      const ss = N.sessoes(D, w), wk = D.weeks[w] || {};
      const selo = w !== cw ? '' : fase === 'antes' ? ` <span class="selo">começa ${N.fd(P.inicio)}</span>` : fase === 'durante' ? ' <span class="selo">esta semana</span>' : '';
      if (w === cw) h += faixaInstalar();
      h += `<section class="card wk${w === cw && fase === 'durante' ? ' atual' : ''}" id="w${w}"><div class="wk-topo"><h3>S${w} · ${N.fd(N.inicioSemana(D, w))}–${N.fd(N.fimSemana(D, w))}${P.focos[w - 1] ? ` <span class="foco">${esc(P.focos[w - 1])}</span>` : ''}${selo}</h3><span class="km">${km(N.kmFeitos(D, w))}/${km(N.kmPlanejados(D, w))} km</span></div>`;
      if (!ss.length) h += '<p class="vazio">Semana sem corrida no plano.</p>';
      ss.forEach((s) => {
        const l = D.logs[s.k], dia = N.dataSessao(D, w, s.d);
        const st = !l ? 'pendente' : l.status === 'parcial' || l.status === 'nao' ? l.status : 'feito';
        const feito = l && l.status !== 'nao' ? ` · ${km(+l.km || 0)} km em ${v(l.tempo || '–')} (${N.fmtRitmo(N.ritmo(l))}/km)` : '';
        h += `<button type="button" class="ses" data-acao="treino" data-k="${s.k}"><span class="tag tag-${s.c}">${s.c}</span><span class="tx">${esc(s.t)}${s.s ? ' · ' + s.s : ''}<small>${dia.getTime() === hoje ? '<span class="hoje">Hoje</span> · ' : ''}${N.DIA[s.d]} ${N.fd(dia)}${feito}</small></span><span class="st st-${st}" role="img" aria-label="${NOME_STATUS[st]}">${ICONE[st]}</span></button>`;
      });
      h += '<div class="wk-pe">' + (wk.closed
        ? `<small>Semana fechada ${wk.sent ? 'e enviada ao Claude' : '· ainda não enviada'} · <a href="#" data-acao="semana" data-w="${w}">editar</a></small>`
        : `<button type="button" class="b l" data-acao="semana" data-w="${w}">Fechar semana</button>`) + '</div></section>';
    }
    $('#app').innerHTML = h;
  }

  function opcoes(vals, rotulos, sel) {
    return vals.map((x, i) => `<option value="${esc(x)}"${x == sel ? ' selected' : ''}>${esc(rotulos ? rotulos[i] : x)}</option>`).join('');
  }

  // Tênis sugerido para o treino: o indicado pelo plano original ou o primeiro do perfil.
  function tenisSugerido(s, nomes) {
    const indicado = s.s === 'E' ? 'Evo SL' : s.s ? 'Novablast 5' : '';
    return nomes.indexOf(indicado) >= 0 ? indicado : nomes[0] || 'Outro';
  }

  function abrirTreino(k) {
    const [ws, d] = k.split('-'), w = +ws, s = N.sessoes(D, w).find((x) => x.k === k);
    const nomes = N.tenis(D).map((t) => t.nome);
    const l = D.logs[k] || { status: 'feito', km: s.km, tenis: tenisSugerido(s, nomes) };
    // O tênis já registrado continua na lista mesmo que tenha saído do perfil.
    const listaTenis = nomes.concat(l.tenis && l.tenis !== 'Outro' && nomes.indexOf(l.tenis) < 0 ? [l.tenis] : [], ['Outro']);
    const temSuor = /suor/i.test(s.t) || l.pa || l.pd || l.liq;
    const f = $('#frm'), dlg = $('#dlg');
    f.innerHTML = `<h3>S${w} · ${N.DIA[d]} ${N.fd(N.dataSessao(D, w, d))}</h3><p class="sub">${esc(s.t)} · código ${s.c}${s.s ? ' · tênis ' + s.s : ''}</p>
<label>Status<select name="status">${opcoes(['feito', 'parcial', 'nao'], ['Feito', 'Parcial', 'Não fiz'], l.status)}</select></label>
<div class="row"><label>Km<input name="km" type="number" step="0.01" min="0" inputmode="decimal" value="${v(l.km)}"></label><label>Tempo (mm:ss ou h:mm:ss)<input name="tempo" inputmode="text" autocomplete="off" value="${v(l.tempo)}" placeholder="45:30"></label></div>
<div class="row"><label>FC média<input name="fc" type="number" min="0" inputmode="numeric" value="${v(l.fc)}"></label><label>Esforço (0–10)<input name="esf" type="number" min="0" max="10" inputmode="numeric" value="${v(l.esf)}"></label></div>
<label>Tênis<select name="tenis">${opcoes(listaTenis, null, l.tenis)}</select></label>
<label>Hidratação/carbo usados<input name="hid" value="${v(l.hid)}" placeholder="ex.: 500 mL de isotônico + 1 gel"></label>
<div class="row"><label>Dor (0–10)<input name="dor" type="number" min="0" max="10" inputmode="numeric" value="${v(l.dor)}"></label><label>Onde<input name="dorLocal" value="${v(l.dorLocal)}"></label></div>
<label>Observações<input name="obs" value="${v(l.obs)}"></label>
<details${temSuor ? ' open' : ''}><summary>Teste de suor (peso antes e depois)</summary>
<div class="row"><label>Peso antes (kg)<input name="pa" type="number" step="0.1" min="0" inputmode="decimal" value="${v(l.pa)}"></label><label>Peso depois<input name="pd" type="number" step="0.1" min="0" inputmode="decimal" value="${v(l.pd)}"></label><label>Bebido (mL)<input name="liq" type="number" min="0" inputmode="numeric" value="${v(l.liq)}"></label></div></details>
<details${D.ov[k] ? ' open' : ''}><summary>Ajustar o planejado (quando o Claude mudar o plano ou houver prova)</summary><label>Treino planejado<input name="pt" value="${esc(s.t)}"></label><label>Km planejado<input name="pk" type="number" step="0.1" min="0" inputmode="decimal" value="${v(s.km)}"></label></details>
<div class="botoes"><button type="button" class="b l" data-fechar>Cancelar</button>${D.logs[k] ? '<button type="button" class="b l" data-apagar>Apagar</button>' : ''}<button class="b" value="ok">Salvar</button></div>`;
    // Só "Salvar" envia o formulário: a tecla Enter do teclado do celular salva em vez de descartar.
    $('[data-fechar]', f).onclick = () => dlg.close();
    const apagar = $('[data-apagar]', f);
    if (apagar) apagar.onclick = () => {
      if (!confirm('Apagar este registro?')) return;
      delete D.logs[k];
      salvar();
      dlg.close();
      render();
    };
    const tempo = f.elements.tempo;
    // Qualquer mudança no formulário limpa o erro do tempo (ex.: trocar o status para "Não fiz").
    f.oninput = f.onchange = () => tempo.setCustomValidity('');
    f.onsubmit = (e) => {
      const o = Object.fromEntries(new FormData(f));
      if (o.status !== 'nao' && o.tempo && !N.seg(o.tempo)) {
        e.preventDefault();
        tempo.setCustomValidity('Tempo inválido. Use mm:ss ou h:mm:ss.');
        tempo.reportValidity();
        return;
      }
      const { pt, pk, ...log } = o;
      D.logs[k] = log;
      const base = N.basePlano(D, w, d);
      const kmPlan = pk === '' ? base.km : +pk;
      if (pt !== base.t || kmPlan !== base.km) D.ov[k] = { t: pt, km: kmPlan }; else delete D.ov[k];
      salvar();
      render();
    };
    dlg.showModal();
  }

  function abrirSemana(w) {
    const x = D.weeks[w] || {};
    const f = $('#frm'), dlg = $('#dlg');
    f.oninput = f.onchange = null;
    f.innerHTML = `<h3>Fechar semana ${w}</h3><p class="sub">${km(N.kmFeitos(D, w))} de ${km(N.kmPlanejados(D, w))} km registrados.</p>
<label>Sono/cansaço na semana<select name="sono">${opcoes(['bom', 'médio', 'ruim'], null, x.sono || 'bom')}</select></label>
<label>Calor ou algo fora do normal<input name="calor" value="${v(x.calor)}"></label><label>Observações da semana<input name="obs" value="${v(x.obs)}"></label>
<div class="botoes"><button type="button" class="b l" data-fechar>Cancelar</button><button class="b" value="ok">Fechar semana</button></div>`;
    $('[data-fechar]', f).onclick = () => dlg.close();
    f.onsubmit = () => {
      D.weeks[w] = Object.assign(Object.fromEntries(new FormData(f)), { closed: true, sent: false });
      salvar();
      render();
    };
    dlg.showModal();
  }

  // ---------- painel de evolução ----------

  const chave = (tipo, classe, rotulo) => `<span><i class="g-chave g-chave-${tipo} ${classe}"></i>${rotulo}</span>`;

  function tabela(colunas, linhas) {
    return '<details class="tabela"><summary>Ver números</summary><div class="rolagem"><table><thead><tr>' +
      colunas.map((c) => `<th scope="col">${c}</th>`).join('') + '</tr></thead><tbody>' +
      linhas.map((l) => `<tr${l.atual ? ' class="atual"' : ''}>${l.celulas.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('') +
      '</tbody></table></div></details>';
  }

  function delta(texto, bom) { return `<em${bom ? ' class="melhora"' : ''}>${texto}</em>`; }

  function telaEvolucao() {
    const a = agora();
    const P = N.painel(D, a);
    const embutido = N.plano(D).embutido;
    const temRegistro = P.treinosFeitos > 0;

    // Recorte dos gráficos: o plano inteiro ou só até a semana atual (mínimo de 6 semanas).
    const nSem = UI.periodo === 'hoje' ? Math.max(Math.min(6, P.n), P.semana) : P.n;
    const S = P.semanas.slice(0, nSem);
    const sem = (x) => `S${x.w}`;
    const periodo = (x) => `${N.fd(x.ini)}–${N.fd(x.fim)}`;
    const ou = (x, f) => (x == null ? '–' : f(x));

    // Indicadores do topo.
    const pct = P.treinosPrevistos ? Math.round(P.treinosFeitos / P.treinosPrevistos * 100) : null;
    const rz = P.ritmoZ2, fz = P.fcZ2;
    let dRitmo = '<em>registre uma rodagem Z2 com tempo</em>';
    if (rz.atual != null) {
      dRitmo = '<em>média das 3 últimas rodagens</em>';
      if (rz.inicio != null) {
        const dif = Math.round(rz.atual - rz.inicio);
        dRitmo = dif === 0 ? '<em>igual ao início</em>' : `<em>${dif < 0 ? '▼' : '▲'} ${N.fmtRitmo(Math.abs(dif))} ${dif < 0 ? 'mais rápido' : 'mais lento'} que no início</em>`;
      }
    }
    let dFc = '<em>registre a FC média nas rodagens</em>';
    if (fz.atual != null) {
      dFc = '<em>média das 3 últimas rodagens</em>';
      if (fz.inicio != null) {
        const dif = Math.round(fz.atual - fz.inicio);
        dFc = dif === 0 ? '<em>igual ao início</em>' : `<em>${dif < 0 ? '▼' : '▲'} ${Math.abs(dif)} bpm ${dif < 0 ? 'abaixo' : 'acima'} do início</em>`;
      }
    }
    // Metros por batimento junta ritmo e FC: é o único dos três em que "subir" é sempre bom.
    const ef = P.semanas.filter((x) => x.mpb != null);
    let efTxt = '–', dEf = '<em>precisa de tempo e FC nas rodagens</em>';
    if (ef.length) {
      const ult = ef[ef.length - 1], pri = ef[0];
      efTxt = dec(ult.mpb, 2) + ' <small>m</small>';
      dEf = `<em>rodagens Z2 da S${ult.w}</em>`;
      if (ef.length > 1) {
        const p = Math.round((ult.mpb / pri.mpb - 1) * 100);
        dEf = p === 0 ? `<em>igual à S${pri.w}</em>` : delta(`${p > 0 ? '▲' : '▼'} ${Math.abs(p)}% desde a S${pri.w}`, p > 0);
      }
    }

    let h = `<div class="card heroi">
<div class="heroi-num">${P.dias}</div>
<div class="heroi-txt"><b>${P.dias === 1 ? 'dia para a prova' : 'dias para a prova'}</b><span>${N.DIA[N.diaDaSemana(P.prova)]}, ${dataCheia(P.prova)} · ${km(P.kmProva)} km</span></div>
<div class="medidor" role="img" aria-label="Semana ${P.semana} de ${P.n} do plano"><i style="width:${P.progresso.toFixed(1)}%"></i></div>
<div class="medidor-pe"><span>${P.fase === 'antes' ? `Começa em ${dataCheia(P.inicio)}` : `Semana ${P.semana} de ${P.n}`}</span><span>${P.fechadas} ${P.fechadas === 1 ? 'fechada' : 'fechadas'}</span></div>
</div>`;

    if (!temRegistro) h += '<div class="faixa"><p>Ainda não há treinos registrados. Os gráficos já mostram o plano e vão se preenchendo conforme você registra na aba Plano.</p></div>';

    h += `<div class="kpi">
<div><span>Km registrados</span><b>${km(P.kmTotal)} <small>km</small></b><em>${P.kmPrevisto ? `de ${km(P.kmPrevisto)} km previstos até hoje` : 'nenhum treino previsto ainda'}</em></div>
<div><span>Treinos feitos</span><b>${P.treinosFeitos}${P.treinosPrevistos ? ` <small>de ${P.treinosPrevistos}</small>` : ''}</b><em>${pct == null ? 'nenhum treino previsto ainda' : `${pct}% dos previstos${P.parciais ? ` · ${P.parciais} ${P.parciais === 1 ? 'parcial' : 'parciais'}` : ''}`}</em></div>
<div><span>Maior corrida</span><b>${ou(P.maiorCorrida, (x) => km(x) + ' <small>km</small>')}</b><em>prova: ${km(P.kmProva)} km</em></div>
<div><span>Ritmo em Z2</span><b>${rz.atual == null ? '–' : N.fmtRitmo(rz.atual) + ' <small>/km</small>'}</b>${dRitmo}</div>
<div><span>FC média em Z2</span><b>${fz.atual == null ? '–' : Math.round(fz.atual) + ' <small>bpm</small>'}</b>${dFc}</div>
<div><span>Metros por batimento</span><b>${efTxt}</b>${dEf}</div>
</div>`;

    if (P.dorRecente.length) {
      h += `<div class="card alerta-dor" role="alert"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4l9 16H3z"/><path d="M12 10v4.5M12 17.5v.01"/></svg><p><b>Sinal vermelho: dor de 4/10 ou mais</b>Registrada em ${P.dorRecente.map((x) => `S${x.w} ${N.DIA[x.d]} (${x.dor}/10${x.local ? ', ' + esc(x.local) : ''})`).join(', ')}. Faça uma semana de alívio e, se persistir, procure médico ou fisioterapeuta.</p></div>`;
    }

    h += `<div class="filtro"><h2>Semana a semana</h2><div class="seg" role="group" aria-label="Período dos gráficos">
<button type="button" data-acao="periodo" data-p="tudo" aria-pressed="${UI.periodo !== 'hoje'}">Plano inteiro</button>
<button type="button" data-acao="periodo" data-p="hoje" aria-pressed="${UI.periodo === 'hoje'}">Até hoje</button></div></div>`;

    h += `<figure class="card"><div class="graf-topo"><h3>Km por semana</h3><div class="legenda">${chave('caixa', 'c-trilho', 'Planejado')}${chave('caixa', 'c-feito', 'Feito')}</div></div>
<div class="g" id="g-km"></div>${tabela(['Semana', 'Período', 'Planejado', 'Feito'], S.map((x) => ({ atual: x.w === P.semana, celulas: [sem(x), periodo(x), km(x.plan) + ' km', ou(x.feito, (q) => km(q) + ' km')] })))}</figure>`;

    h += `<figure class="card"><div class="graf-topo"><h3>Maior corrida da semana</h3><div class="legenda">${chave('caixa', 'c-plano', 'Planejado')}${chave('linha', 'c-feito', 'Feito')}</div><p>O longão crescendo até a distância da prova.</p></div>
<div class="g" id="g-longo"></div>${tabela(['Semana', 'Planejado', 'Feito'], S.map((x) => ({ atual: x.w === P.semana, celulas: [sem(x), km(x.longoPlan) + ' km', ou(x.longoFeito, (q) => km(q) + ' km')] })))}</figure>`;

    const comZ2 = S.filter((x) => x.ritmo != null);
    h += '<figure class="card"><div class="graf-topo"><h3>Rodagens leves (Z2)</h3><p>Média dos treinos leves de cada semana. Correr mais metros a cada batimento é sinal de condicionamento melhorando.</p></div>';
    if (comZ2.length) {
      h += '<div class="mini"><h4>Ritmo <small>· min/km · mais alto = mais rápido</small></h4><div class="g" id="g-ritmo"></div></div>' +
        (comZ2.some((x) => x.fc != null)
          ? '<div class="mini"><h4>FC média <small>· bpm</small></h4><div class="g" id="g-fc"></div></div><div class="mini"><h4>Metros por batimento <small>· subindo = melhor</small></h4><div class="g" id="g-mpb"></div></div>'
          : '<p class="vazio">Registre a FC média nas rodagens para ver a FC e os metros por batimento.</p>') +
        tabela(['Semana', 'Ritmo', 'FC média', 'm/batimento'], comZ2.map((x) => ({ atual: x.w === P.semana, celulas: [sem(x), N.fmtRitmo(x.ritmo) + '/km', ou(x.fc, (q) => Math.round(q) + ' bpm'), ou(x.mpb, (q) => dec(q, 2))] })));
    } else h += '<p class="vazio">Aparece depois da primeira rodagem Z2 registrada com km e tempo.</p>';
    h += '</figure>';

    const comCorpo = S.filter((x) => x.esforco != null || x.dor != null || x.sono != null);
    h += '<figure class="card"><div class="graf-topo"><h3>Como o corpo respondeu</h3><p>Esforço e dor vêm dos treinos; o sono, do fechamento de cada semana.</p></div>';
    if (comCorpo.length) {
      h += `<div class="mini"><h4>Esforço médio <small>· 0 a 10</small></h4><div class="g" id="g-esf"></div></div>
<div class="mini"><h4>Dor mais forte da semana <small>· 0 a 10</small></h4><div class="legenda">${chave('caixa', 'c-neutro', 'até 3')}${chave('caixa', 'c-critico', '4 ou mais: sinal vermelho')}</div><div class="g" id="g-dor"></div></div>
<div class="mini"><h4>Sono e cansaço</h4><div class="g" id="g-sono"></div></div>` +
        tabela(['Semana', 'Esforço', 'Dor', 'Sono'], comCorpo.map((x) => ({ atual: x.w === P.semana, celulas: [sem(x), ou(x.esforco, (q) => dec(q, 1)), ou(x.dor, (q) => q + '/10' + (x.dorLocal ? ' · ' + esc(x.dorLocal) : '')), x.sono ? esc(x.sono) : '–'] })));
    } else h += '<p class="vazio">Aparece conforme você registra esforço e dor nos treinos e fecha as semanas.</p>';
    h += '</figure>';

    h += '<div class="card"><h3>Testes de suor</h3>' + (P.suor.length
      ? P.suor.map((x) => `<div class="lista-linha"><span>S${x.w} · ${N.DIA[x.d]}</span><span><b>${dec(x.taxa, 2)} L/h</b> · perda de ${dec(x.perda, 1)}% do peso${x.perda > 2 ? '<span class="sinal">acima de 2%</span>' : ''}</span></div>`).join('')
      : `<p class="vazio">Registre peso antes, peso depois e quanto bebeu num treino longo${embutido ? ' (S5 e S10)' : ''}.</p>`) + '</div>';

    h += '<div class="card"><h3>Tênis</h3>' + (P.tenis.length ? P.tenis.map((t) => {
      if (!t.vida) return `<div class="tenis"><div class="tenis-topo"><span>${esc(t.nome)}</span><b>${km(t.km)} km</b></div></div>`;
      const uso = t.km / t.vida;
      return `<div class="tenis"><div class="tenis-topo"><span>${esc(t.nome)}</span><b>${km(t.km)} de ~${km(t.vida)} km</b></div>
<div class="medidor${uso >= 1 ? ' passou' : uso >= 0.8 ? ' atencao' : ''}" role="img" aria-label="${esc(t.nome)}: ${Math.round(uso * 100)}% da vida útil estimada"><i style="width:${Math.min(100, uso * 100).toFixed(1)}%"></i></div>
<div class="medidor-pe"><span>${uso >= 1 ? 'Passou da vida útil estimada' : uso >= 0.8 ? 'Perto do fim da vida útil' : `${Math.round(uso * 100)}% da vida útil estimada`}</span><span>${uso < 1 ? `restam ~${km(t.vida - t.km)} km` : ''}</span></div></div>`;
    }).join('') : '<p class="vazio">Cadastre seus tênis na aba Perfil para acompanhar os km de cada um.</p>') + '</div>';

    $('#app').innerHTML = h;

    redesenhar = () => desenhar(P, S);
    redesenhar();
  }

  function desenhar(P, S) {
    const rotulos = S.map((x) => 'S' + x.w);
    const atual = P.fase === 'durante' && P.semana - 1 < S.length ? P.semana - 1 : -1;
    const titulo = (i) => `S${S[i].w} · ${N.fd(S[i].ini)}–${N.fd(S[i].fim)}`;
    const col = (f) => S.map(f);
    const maximo = (a) => Math.max.apply(null, a.filter((x) => x != null).concat([0]));
    const minimo = (a) => Math.min.apply(null, a.filter((x) => x != null));
    const comum = { rotulos, atual };
    const txt = (x, f) => (x == null ? '–' : f(x));
    const emAberto = (x) => P.fase === 'durante' && x.w === P.semana && x.longoPendente;

    G.porSemana($('#g-km'), Object.assign({}, comum, {
      altura: 190,
      y: Object.assign(G.escala(0, Math.max(10, maximo(col((x) => x.plan)), maximo(col((x) => x.feito))), null, 4), { fmt: String }),
      camadas: [
        { tipo: 'trilho', valores: col((x) => x.plan), classe: 'c-trilho' },
        { tipo: 'coluna', valores: col((x) => x.feito), classe: 'c-feito', entalhe: col((x) => x.plan) },
      ],
      dica: (i) => ({ titulo: titulo(i), linhas: [
        { chave: 'caixa', classe: 'c-trilho', rotulo: 'Planejado', valor: km(S[i].plan) + ' km' },
        { chave: 'caixa', classe: 'c-feito', rotulo: 'Feito', valor: txt(S[i].feito, (q) => km(q) + ' km') },
      ] }),
      descricao: 'Km planejados e feitos em cada semana. Use as setas para ler os valores.',
    }));

    G.porSemana($('#g-longo'), Object.assign({}, comum, {
      altura: 190,
      y: Object.assign(G.escala(0, Math.max(P.kmProva, maximo(col((x) => x.longoPlan)), maximo(col((x) => x.longoFeito))), null, 5), { fmt: String }),
      camadas: [
        { tipo: 'area', valores: col((x) => x.longoPlan), classe: 'c-plano' },
        // Na semana em andamento, o ponto só entra depois do longão: antes disso a linha "cairia" à toa.
        { tipo: 'linha', valores: col((x) => (emAberto(x) ? null : x.longoFeito)), classe: 'c-feito', rotuloFinal: (q) => km(q) + ' km' },
      ],
      refs: [{ y: P.kmProva, rotulo: `Prova · ${km(P.kmProva)} km` }],
      dica: (i) => ({ titulo: titulo(i), linhas: [
        { chave: 'caixa', classe: 'c-plano', rotulo: 'Planejado', valor: km(S[i].longoPlan) + ' km' },
        { chave: 'linha', classe: 'c-feito', rotulo: emAberto(S[i]) ? 'Feito até agora' : 'Feito', valor: txt(S[i].longoFeito, (q) => km(q) + ' km') },
      ] }),
      descricao: 'Maior corrida planejada e feita em cada semana. Use as setas para ler os valores.',
    }));

    // Pequenos múltiplos: cada medida no seu gráfico (nunca dois eixos no mesmo), com o foco sincronizado.
    function grupo(itens, dica) {
      const feitos = [];
      itens.forEach((it) => {
        const caixa = $(it.id);
        if (!caixa) return;
        const g = G.porSemana(caixa, Object.assign({}, comum, { altura: it.altura || 118, dica, aoFocar: (i) => feitos.forEach((o) => { if (o !== g) o.realcar(i); }) }, it.opcoes));
        feitos.push(g);
      });
    }

    const ritmos = col((x) => x.ritmo), fcs = col((x) => x.fc), mpbs = col((x) => x.mpb);
    if (ritmos.some((x) => x != null)) {
      const temFc = fcs.some((x) => x != null);
      grupo([
        { id: '#g-ritmo', opcoes: {
          y: Object.assign(G.escala(minimo(ritmos), maximo(ritmos), [5, 10, 15, 30, 60, 120, 300], 3, 30), { fmt: N.fmtRitmo, invertido: true }),
          camadas: [{ tipo: 'linha', valores: ritmos, classe: 'c-feito', rotuloFinal: N.fmtRitmo }],
          descricao: 'Ritmo médio das rodagens Z2 por semana.',
        } },
        { id: '#g-fc', opcoes: {
          y: Object.assign(temFc ? G.escala(minimo(fcs), maximo(fcs), [2, 5, 10, 20, 50], 3, 10) : {}, { fmt: String }),
          camadas: [{ tipo: 'linha', valores: fcs, classe: 'c-feito', rotuloFinal: (q) => String(Math.round(q)) }],
          descricao: 'FC média das rodagens Z2 por semana.',
        } },
        { id: '#g-mpb', opcoes: {
          y: Object.assign(temFc ? G.escala(minimo(mpbs), maximo(mpbs), null, 3, 0.1) : {}, { fmt: (q) => dec(q, 2) }),
          camadas: [{ tipo: 'linha', valores: mpbs, classe: 'c-feito', rotuloFinal: (q) => dec(q, 2) }],
          descricao: 'Metros percorridos por batimento nas rodagens Z2, por semana.',
        } },
      ], (i) => ({ titulo: titulo(i), linhas: [
        { chave: 'linha', classe: 'c-feito', rotulo: 'Ritmo', valor: txt(S[i].ritmo, (q) => N.fmtRitmo(q) + '/km') },
        { rotulo: 'FC média', valor: txt(S[i].fc, (q) => Math.round(q) + ' bpm') },
        { rotulo: 'Metros por batimento', valor: txt(S[i].mpb, (q) => dec(q, 2)) },
      ] }));
    }

    const NIVEL = { ruim: 0, 'médio': 1, bom: 2 }, NOME_NIVEL = ['ruim', 'médio', 'bom'];
    grupo([
      { id: '#g-esf', altura: 104, opcoes: {
        y: { min: 0, max: 10, marcas: [0, 5, 10], fmt: String },
        camadas: [{ tipo: 'linha', valores: col((x) => x.esforco), classe: 'c-feito', rotuloFinal: (q) => dec(q, 1) }],
        descricao: 'Esforço médio dos treinos por semana, de 0 a 10.',
      } },
      { id: '#g-dor', altura: 104, opcoes: {
        y: { min: 0, max: 10, marcas: [0, 4, 10], fmt: String },
        camadas: [{ tipo: 'coluna', valores: col((x) => x.dor), classeDe: (q) => (q >= 4 ? 'c-critico' : 'c-neutro') }],
        refs: [{ y: 4 }],
        descricao: 'Dor mais forte registrada em cada semana, de 0 a 10.',
      } },
      { id: '#g-sono', altura: 96, opcoes: {
        y: { min: -0.5, max: 2.5, marcas: [0, 1, 2], fmt: (q) => NOME_NIVEL[q] },
        camadas: [{ tipo: 'pontos', valores: col((x) => (x.sono in NIVEL ? NIVEL[x.sono] : null)), classe: 'c-feito' }],
        descricao: 'Sono e cansaço informados no fechamento de cada semana.',
      } },
    ], (i) => ({ titulo: titulo(i), linhas: [
      { rotulo: 'Esforço médio', valor: txt(S[i].esforco, (q) => dec(q, 1)) },
      { rotulo: 'Dor mais forte', valor: txt(S[i].dor, (q) => q + '/10' + (S[i].dorLocal ? ' · ' + S[i].dorLocal : '')) },
      { rotulo: 'Sono/cansaço', valor: S[i].sono || '–' },
    ] }));
  }

  // ---------- perfil, objetivo e criação do treino ----------

  const ROTULO_EXPERIENCIA = { iniciante: 'Estou começando (ou voltando)', menos1: 'Corro há menos de 1 ano', '1a3': 'Corro há 1 a 3 anos', mais3: 'Corro há mais de 3 anos' };
  const DIA_CURTO = { seg: 'Seg', ter: 'Ter', qua: 'Qua', qui: 'Qui', sex: 'Sex', sab: 'Sáb', dom: 'Dom' };

  function inicioEscolhido() {
    const ops = N.opcoesInicio(agora());
    return ops.some((x) => x.iso === UI.inicioPlano) ? UI.inicioPlano : ops[0].iso;
  }

  // O que dá para pedir agora: o que falta no perfil e as semanas do plano novo.
  function estadoCriar() {
    const p = N.perfil(D), o = N.objetivo(D);
    const falta = N.faltaParaPlano(p, o);
    let cal = null, erroCal = '';
    if (N.dataIso(o.data)) { try { cal = N.calendario(inicioEscolhido(), o.data); } catch (e) { erroCal = e.message; } }
    return { p, o, falta, cal, erroCal, pronto: !falta.length && !!cal };
  }

  function pedidoAtual(e) { return { perfil: e.p, objetivo: e.o, calendario: e.cal, idade: N.idade(D, agora()), hoje: agora() }; }

  function linhaTenis(t) {
    return `<div class="row tenis-linha" data-nome="${v(t.nome)}"><label>Nome<input data-t="nome" value="${v(t.nome)}" placeholder="ex.: Novablast 5"></label><label>Km já rodados<input data-t="km" type="number" min="0" inputmode="decimal" value="${v(t.kmInicial || '')}"></label><label>Vida útil (km)<input data-t="vida" type="number" min="0" inputmode="numeric" value="${v(t.vida || '')}" placeholder="opcional"></label></div>`;
  }

  function htmlPrevia() {
    const r = N.resumoPlano(rascunho.semanas);
    const ini = N.dataIso(rascunho.inicio);
    let h = `<div class="card previa" id="previa"><h3>Plano criado: confira antes de usar</h3>
<p class="sub">${r.n} semanas · ${r.treinos} treinos · ${km(r.total)} km no total · maior semana ${km(r.pico)} km · maior corrida ${km(r.longao)} km</p>
<div class="g" id="g-previa"></div><div class="rolagem previa-lista">`;
    rascunho.semanas.forEach((s, i) => {
      const a = N.somarDias(ini, 7 * i), b = N.somarDias(a, 6);
      h += `<div class="previa-sem"><b>S${i + 1} · ${N.fd(a)}–${N.fd(b)}${rascunho.focos[i] ? ' · ' + esc(rascunho.focos[i]) : ''}</b><span>${km(r.porSemana[i])} km</span>` +
        s.map((x) => `<p><i class="tag tag-${x.c}">${x.c}</i>${DIA_CURTO[x.d]} · ${esc(x.t)}</p>`).join('') + '</div>';
    });
    h += '</div>' + (rascunho.orientacoes ? `<details class="orienta" open><summary>Orientações</summary><p>${esc(rascunho.orientacoes)}</p></details>` : '') +
      '<div class="acoes"><button type="button" class="b" data-acao="usar-plano">Usar este plano</button><button type="button" class="b l" data-acao="descartar-plano">Descartar</button></div></div>';
    return h;
  }

  function telaPerfil() {
    const p = N.perfil(D), o = N.objetivo(D), P = N.plano(D), al = P.alvo;
    const anoAtual = agora().getFullYear();
    const ops = N.opcoesInicio(agora());
    const tenisLista = p.tenis.length ? p.tenis : [{ nome: '', kmInicial: '', vida: '' }];
    const emUso = `${esc(al.prova || 'Plano')} · ${P.semanas.length} semanas, de ${dataCheia(P.inicio)} a ${dataCheia(N.dataProva(D))} · ` +
      (P.embutido ? 'plano original' : `criado pela IA${N.dataIso(P.criadoEm) ? ' em ' + dataCheia(N.dataIso(P.criadoEm)) : ''}`);

    let h = `<form id="fperfil" autocomplete="off">
<div class="card"><h3>Quem corre</h3>
<label>Nome<input name="nome" value="${v(p.nome)}" autocomplete="name"></label>
<div class="row"><label>Ano de nascimento<input name="nascimento" type="number" min="1920" max="${anoAtual}" inputmode="numeric" value="${v(p.nascimento)}" placeholder="ex.: 1988"></label><label>Sexo<select name="sexo">${opcoes(['', 'feminino', 'masculino', 'outro'], ['—', 'Feminino', 'Masculino', 'Outro'], p.sexo)}</select></label></div>
<div class="row"><label>Peso (kg)<input name="peso" type="number" step="0.1" min="0" inputmode="decimal" value="${v(p.peso)}"></label><label>Altura (cm)<input name="altura" type="number" min="0" inputmode="numeric" value="${v(p.altura)}"></label></div>
</div>

<div class="card"><h3>Estado físico na corrida</h3><small>Quanto mais completo, mais o treino sai na sua medida.</small>
<label>Há quanto tempo corre<select name="experiencia">${opcoes(['', 'iniciante', 'menos1', '1a3', 'mais3'], ['—'].concat(['iniciante', 'menos1', '1a3', 'mais3'].map((k) => ROTULO_EXPERIENCIA[k])), p.experiencia)}</select></label>
<div class="row"><label>Km por semana hoje<input name="kmSemana" type="number" step="0.1" min="0" inputmode="decimal" value="${v(p.kmSemana)}"></label><label>Maior corrida recente (km)<input name="maiorCorrida" type="number" step="0.1" min="0" inputmode="decimal" value="${v(p.maiorCorrida)}"></label></div>
<div class="row"><label>Ritmo confortável (min/km)<input name="ritmoLeve" value="${v(p.ritmoLeve)}" placeholder="ex.: 6:45"></label><label>Prova ou teste recente<input name="provaRecente" value="${v(p.provaRecente)}" placeholder="ex.: 5 km em 28:30"></label></div>
<div class="row"><label>FC máxima (opcional)<input name="fcMax" type="number" min="0" inputmode="numeric" value="${v(p.fcMax)}"></label><label>FC de repouso (opcional)<input name="fcRepouso" type="number" min="0" inputmode="numeric" value="${v(p.fcRepouso)}"></label></div>
<fieldset class="dias"><legend>Dias em que pode correr</legend>${N.DIAS.map((d) => `<label><input type="checkbox" name="dia-${d}"${p.dias.indexOf(d) >= 0 ? ' checked' : ''}><span>${DIA_CURTO[d]}</span></label>`).join('')}</fieldset>
<label>Dia do treino longo<select name="diaLongo">${opcoes([''].concat(N.DIAS), ['Tanto faz'].concat(N.DIAS.map((d) => N.DIA[d])), p.diaLongo)}</select></label>
<label>Lesões, dores ou limitações<input name="lesoes" value="${v(p.lesoes)}" placeholder="ex.: joelho direito sensível em descidas"></label>
<label>Outras atividades e observações<input name="obs" value="${v(p.obs)}" placeholder="ex.: musculação 2x por semana"></label>
</div>

<div class="card"><h3>Tênis</h3><small>Aparecem no registro do treino e no painel. Para tirar um, apague o nome.</small>
<div id="tenis-lista">${tenisLista.map(linhaTenis).join('')}</div>
<div class="acoes"><button type="button" class="b l" data-acao="mais-tenis">Adicionar tênis</button></div>
</div>

<div class="card"><h3>Objetivo</h3>
<label>Prova ou objetivo<input name="prova" value="${v(o.prova)}" placeholder="ex.: Meia do Rio 2027"></label>
<div class="row"><label>Distância (km)<input name="distancia" type="number" step="0.1" min="0" inputmode="decimal" value="${v(o.distancia)}"></label><label>Data da prova<input name="data" type="date" value="${v(o.data)}"></label></div>
<div class="chips atalhos">${[5, 10, 21.1, 42.2].map((x) => `<button type="button" data-acao="distancia" data-km="${x}">${km(x)} km</button>`).join('')}</div>
<div class="row"><label>Meta<input name="meta" value="${v(o.meta)}" placeholder="ex.: completar bem"></label><label>Tempo-alvo (opcional)<input name="tempoAlvo" value="${v(o.tempoAlvo)}" placeholder="ex.: 1:59:00"></label></div>
<p class="nota" id="p-nota" hidden></p>
</div>

<div class="card" id="criar"><h3>Criar treino com IA</h3>
<p class="sub">A IA monta o plano semana a semana a partir do seu perfil e do objetivo. Você confere e decide se usa.</p>
<label>Começar<select name="inicio">${opcoes(ops.map((x) => x.iso), ops.map((x) => x.rotulo), inicioEscolhido())}</select></label>
<p class="nota" id="p-cal"></p>
<p class="nota falta" id="p-falta" hidden></p>
<div class="acoes" id="p-botoes"></div>
<p class="nota" id="p-prog" role="status" aria-live="polite"${gerando ? '' : ' hidden'}></p>
<p class="nota erro" id="p-erro" role="alert"${erroIa ? '' : ' hidden'}>${esc(erroIa)}</p>
<details><summary>Sem chave de API: usar o chat do Claude</summary>
<ol class="passos"><li>Toque em <b>Copiar pedido</b> e cole numa conversa em claude.ai.</li><li>Copie a resposta inteira e cole no campo abaixo.</li><li>Toque em <b>Ler resposta</b> para ver a prévia do plano.</li></ol>
<div class="acoes"><button type="button" class="b l" data-acao="copiar-pedido">Copiar pedido</button></div>
<textarea id="colado" aria-label="Resposta do chat" placeholder="Cole aqui a resposta do Claude."></textarea>
<div class="acoes"><button type="button" class="b l" data-acao="ler-resposta">Ler resposta</button></div></details>
<small class="rodape-card">Orientação geral de treino, não substitui avaliação médica. Ao criar o treino, o perfil (sem o nome) e o objetivo são enviados à Anthropic.</small>
</div>
</form>`;

    if (rascunho) h += htmlPrevia();

    h += `<div class="card"><h3>Plano em uso</h3><p class="sub">${emUso}</p>` +
      (ler(CHAVE_ANTERIOR) ? '<div class="acoes"><button type="button" class="b l" data-acao="voltar-plano">Voltar ao plano anterior</button></div>' : '') + '</div>';

    $('#app').innerHTML = h;
    $('#fperfil').onchange = guardarPerfil;
    $('#fperfil').onsubmit = (ev) => ev.preventDefault();
    atualizarCriar();

    if (rascunho) {
      const r = N.resumoPlano(rascunho.semanas);
      redesenhar = () => G.porSemana($('#g-previa'), {
        rotulos: r.porSemana.map((_, i) => 'S' + (i + 1)), atual: -1, altura: 150,
        y: Object.assign(G.escala(0, Math.max(10, r.pico), null, 4), { fmt: String }),
        camadas: [{ tipo: 'coluna', valores: r.porSemana, classe: 'c-feito' }],
        dica: (i) => ({ titulo: `S${i + 1}${rascunho.focos[i] ? ' · ' + rascunho.focos[i] : ''}`, linhas: [{ chave: 'caixa', classe: 'c-feito', rotulo: 'Planejado', valor: km(r.porSemana[i]) + ' km' }] }),
        descricao: 'Km planejados em cada semana do plano criado.',
      });
      redesenhar();
    }
  }

  // Lê o formulário do perfil e guarda (chamado a cada campo alterado).
  function guardarPerfil() {
    const f = $('#fperfil');
    if (!f) return;
    const g = (n) => (f.elements[n] ? String(f.elements[n].value).trim() : '');
    const tenis = [];
    f.querySelectorAll('.tenis-linha').forEach((linha) => {
      const nome = $('[data-t="nome"]', linha).value.trim();
      const antes = linha.dataset.nome || '';
      if (!nome) return;
      // Renomear um tênis leva junto os treinos já registrados com ele.
      if (antes && antes !== nome) Object.values(D.logs).forEach((l) => { if (l && l.tenis === antes) l.tenis = nome; });
      linha.dataset.nome = nome;
      tenis.push({ nome, kmInicial: +$('[data-t="km"]', linha).value || 0, vida: +$('[data-t="vida"]', linha).value || 0 });
    });
    D.perfil = {
      nome: g('nome'), nascimento: g('nascimento'), sexo: g('sexo'), peso: g('peso'), altura: g('altura'),
      experiencia: g('experiencia'), kmSemana: g('kmSemana'), maiorCorrida: g('maiorCorrida'), ritmoLeve: g('ritmoLeve'),
      provaRecente: g('provaRecente'), fcMax: g('fcMax'), fcRepouso: g('fcRepouso'),
      dias: N.DIAS.filter((d) => f.elements['dia-' + d].checked), diaLongo: g('diaLongo'), lesoes: g('lesoes'), obs: g('obs'), tenis,
    };
    D.objetivo = { prova: g('prova'), distancia: g('distancia') === '' ? '' : +g('distancia'), data: g('data'), meta: g('meta'), tempoAlvo: g('tempoAlvo') };
    UI.inicioPlano = g('inicio');
    salvarUi();
    salvar();
    cabecalho();
    atualizarCriar();
  }

  // Atualiza os avisos e botões da criação do treino sem redesenhar o formulário.
  function atualizarCriar() {
    if (!$('#criar')) return;
    const e = estadoCriar(), al = N.alvo(D);
    const cal = $('#p-cal'), falta = $('#p-falta'), nota = $('#p-nota');
    if (e.cal) {
      const encurtado = N.iso(e.cal.inicio) !== inicioEscolhido();
      cal.textContent = `O plano terá ${e.cal.n} semanas${encurtado ? ' (o máximo)' : ''}: de ${dataCheia(e.cal.inicio)} até a prova, em ${dataCheia(e.cal.prova)}.`;
    } else cal.textContent = e.erroCal;
    cal.hidden = !cal.textContent;
    falta.hidden = !e.falta.length;
    falta.textContent = e.falta.length ? 'Falta preencher: ' + e.falta.join('; ') + '.' : '';
    // O objetivo do formulário só passa a valer quando um plano novo é criado.
    const mudou = String(e.o.data) !== String(al.data) || +e.o.distancia !== +al.distancia;
    nota.hidden = !mudou;
    nota.textContent = mudou ? `O plano em uso é para ${al.prova || 'a prova'} em ${dataCheia(N.dataProva(D))}. Crie um treino novo para valer este objetivo.` : '';

    const botoes = $('#p-botoes');
    if (gerando) botoes.innerHTML = '<button type="button" class="b l" data-acao="cancelar-ia">Cancelar</button>';
    else if (!CFG.chave) botoes.innerHTML = '<button type="button" class="b" disabled>Criar treino com IA</button><button type="button" class="b l" data-acao="ir-ajustes">Informar chave da IA</button>';
    else botoes.innerHTML = `<button type="button" class="b" data-acao="criar-ia"${e.pronto ? '' : ' disabled'}>${rascunho ? 'Criar outro treino' : 'Criar treino com IA'}</button>`;
    mostrarProgresso();
  }

  function mostrarProgresso() {
    const el = $('#p-prog');
    if (!el) return;
    el.hidden = !gerando;
    if (!gerando) return;
    const s = Math.floor((Date.now() - gerando.inicio) / 1000);
    el.textContent = `${gerando.texto} (${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')})`;
  }

  async function criarComIa() {
    guardarPerfil();
    const e = estadoCriar();
    if (gerando || !e.pronto) return;
    if (!CFG.chave) { aviso('Informe a chave da IA em Ajustes.'); return; }
    const controle = new AbortController();
    gerando = { cancelar: () => controle.abort(), inicio: Date.now(), texto: 'Enviando o pedido…' };
    erroIa = '';
    const relogio = setInterval(mostrarProgresso, 1000);
    if ($('#p-erro')) $('#p-erro').hidden = true;
    atualizarCriar();
    try {
      const resposta = await IA.chamar({
        chave: CFG.chave, modelo: CFG.modelo, sistema: IA.promptSistema(), usuario: IA.pedidoPlano(pedidoAtual(e)),
        esquema: IA.ESQUEMA_PLANO, sinal: controle.signal,
        aoProgresso: (st) => {
          const n = IA.semanasRecebidas(st.texto);
          gerando.texto = n ? `Escrevendo o plano: semana ${Math.min(n, e.cal.n)} de ${e.cal.n}…` : 'A IA está pensando no plano…';
          mostrarProgresso();
        },
      });
      rascunho = N.montarPlano(resposta, e.cal, e.o, agora());
    } catch (err) {
      erroIa = err && err.name === 'AbortError' ? '' : (err && err.message) || 'Não consegui criar o treino.';
      if (err && err.name === 'AbortError') aviso('Criação cancelada.');
    }
    clearInterval(relogio);
    gerando = null;
    if (aba !== 'perfil') { aviso(rascunho && !erroIa ? 'Plano pronto: veja na aba Perfil.' : erroIa || 'Criação encerrada.'); return; }
    render();
    const alvo = $(erroIa ? '#criar' : '#previa');
    if (alvo) alvo.scrollIntoView();
  }

  function lerRespostaColada() {
    guardarPerfil();
    const e = estadoCriar();
    if (!e.pronto) { aviso('Preencha o objetivo e o perfil antes.'); return; }
    try { rascunho = N.montarPlano(IA.lerJson($('#colado').value), e.cal, e.o, agora()); }
    catch (err) { aviso(err.message); return; }
    erroIa = '';
    render();
    $('#previa').scrollIntoView();
  }

  function usarPlano() {
    if (!rascunho) return;
    const temRegistros = Object.keys(D.logs).length || Object.keys(D.weeks).length;
    if (temRegistros && !confirm('Trocar de plano tira da tela os treinos e as semanas registrados no plano atual. Dá para desfazer em Perfil → "Voltar ao plano anterior". Continuar?')) return;
    gravar(CHAVE_ANTERIOR, JSON.stringify(D));
    D = Object.assign({}, D, { plano: rascunho, logs: {}, weeks: {}, ov: {} });
    rascunho = null;
    salvar();
    irPara('plano');
    aviso('Plano novo em uso.');
  }

  function voltarPlano() {
    let anterior;
    try { anterior = N.importar(ler(CHAVE_ANTERIOR)); } catch (e) { aviso('Não consegui recuperar o plano anterior.'); return; }
    if (!confirm('Voltar ao plano anterior? O plano atual e os treinos registrados nele serão descartados.')) return;
    // Volta o plano e os registros; o perfil e o objetivo ficam como estão agora.
    D = Object.assign({}, D, { logs: anterior.logs, weeks: anterior.weeks, ov: anterior.ov });
    if (anterior.plano) D.plano = anterior.plano; else delete D.plano;
    remover(CHAVE_ANTERIOR);
    salvar();
    render();
    aviso('Plano anterior de volta.');
  }

  // ---------- exportar ----------

  function telaExportar() {
    const pend = N.pendentes(D);
    $('#app').innerHTML = `<div class="card"><h3>Relatório para o Claude</h3>
<p style="margin-top:4px">Junta o prompt atual com os relatórios das semanas fechadas ainda não enviadas. Copie e cole na conversa com o Claude.</p>
<p style="margin-top:6px"><small>${pend.length ? 'Pendentes de envio: ' + pend.map((w) => 'S' + w).join(', ') + '.' : 'Nenhuma semana fechada pendente de envio.'}</small></p>
<div class="acoes"><button type="button" class="b" data-acao="copiar">Copiar</button>${navigator.share ? '<button type="button" class="b l" data-acao="compartilhar">Compartilhar</button>' : ''}<button type="button" class="b l" data-acao="gerar">Gerar de novo</button></div>
<textarea id="out" aria-label="Texto para enviar ao Claude" style="min-height:320px;margin-top:10px"></textarea>
<div class="acoes"><button type="button" class="b l" data-acao="enviadas">Marcar semanas como enviadas</button></div></div>`;
    gerar();
  }

  function gerar() { $('#out').value = N.textoExportacao(D, agora()); }

  function marcarEnviadas() {
    const p = N.pendentes(D);
    if (!p.length) { aviso('Nenhuma semana pendente.'); return; }
    p.forEach((w) => { D.weeks[w].sent = true; });
    salvar();
    render();
    aviso('Semanas marcadas como enviadas.');
  }

  // ---------- ajustes ----------

  function cartaoInstalar() {
    let corpo;
    if (instalado()) corpo = '<p style="margin-top:4px">O app já está instalado neste aparelho.</p>';
    else if (pedidoInstalar) corpo = '<p style="margin-top:4px">Abre em tela cheia, com ícone na tela inicial, e funciona sem internet.</p><div class="acoes"><button type="button" class="b" data-acao="instalar">Instalar app</button></div>';
    else if (ehIOS()) corpo = '<ol class="passos"><li>Abra esta página no <b>Safari</b>.</li><li>Toque em <b>Compartilhar</b> (o quadrado com a seta para cima).</li><li>Escolha <b>Adicionar à Tela de Início</b>.</li></ol>';
    else corpo = '<ol class="passos"><li>No celular Android, abra esta página no <b>Chrome</b>.</li><li>Toque no menu <b>⋮</b> e em <b>Instalar app</b> (ou <b>Adicionar à tela inicial</b>).</li><li>No computador, use o ícone de instalar na barra de endereço do Chrome ou do Edge.</li></ol>';
    return `<div class="card" id="cartao-instalar"><h3>Instalar no celular</h3>${corpo}</div>`;
  }

  function telaAjustes() {
    const fim = CFG.chave ? CFG.chave.slice(-4) : '';
    $('#app').innerHTML = cartaoInstalar() + `<div class="card" id="cartao-ia"><h3>IA (Claude)</h3>
<small>Serve para criar o treino dentro do app (aba Perfil). A chave é da sua conta na Anthropic (console.anthropic.com) e o uso é cobrado nela. Fica guardada só neste aparelho, fora do backup; não use em aparelho compartilhado.</small>
<label>Chave de API<input id="ia-chave" type="password" autocomplete="off" spellcheck="false" placeholder="${fim ? 'chave guardada (termina em ' + esc(fim) + ')' : 'sk-ant-...'}"></label>
<label>Modelo<select id="ia-modelo">${opcoes(IA.MODELOS.map((m) => m.id), IA.MODELOS.map((m) => m.nome + ' — ' + m.nota), IA.modeloPorId(CFG.modelo).id)}</select></label>
<div class="acoes"><button type="button" class="b" data-acao="salvar-ia">Salvar</button>${fim ? '<button type="button" class="b l" data-acao="remover-ia">Remover chave</button>' : ''}</div></div>
<div class="card"><h3>Prompt atual</h3><small>Cole aqui a versão mais recente que o Claude devolver. A exportação usa este texto.</small>
<textarea id="pr" aria-label="Prompt atual" style="min-height:220px;margin-top:8px">${esc(D.prompt)}</textarea><div class="acoes"><button type="button" class="b" data-acao="salvar-prompt">Salvar prompt</button></div></div>
<div class="card"><h3>Backup</h3><small>Os dados ficam só neste aparelho. Faça backup de vez em quando e guarde o arquivo ou o texto. O backup inclui o perfil e o plano criado, mas não a chave da IA. O backup da página antiga também pode ser restaurado aqui.</small>
<div class="acoes"><button type="button" class="b l" data-acao="backup-baixar">Baixar arquivo</button><button type="button" class="b l" data-acao="backup-abrir">Restaurar de arquivo</button></div>
<input id="arq" type="file" accept="application/json,.json,.txt" hidden>
<div class="acoes"><button type="button" class="b l" data-acao="backup-gerar">Gerar texto</button><button type="button" class="b l" data-acao="backup-restaurar">Restaurar do texto</button></div>
<textarea id="bk" aria-label="Texto do backup" style="margin-top:8px" placeholder="O backup aparece aqui. Para restaurar, cole o texto e toque em Restaurar do texto."></textarea></div>
<div class="card"><h3>Apagar dados</h3><small>Remove deste aparelho os registros, as semanas, o prompt, o perfil, o plano criado e a chave da IA. O app volta ao plano original.</small><div class="acoes"><button type="button" class="b perigo" data-acao="apagar-tudo">Apagar tudo</button></div></div>
<p class="rodape">Versão ${VERSAO}</p>`;
    $('#arq').onchange = (e) => {
      const arq = e.target.files[0];
      if (!arq) return;
      arq.text().then(restaurar, () => aviso('Não consegui ler o arquivo.'));
    };
  }

  function salvarIa() {
    const nova = $('#ia-chave').value.trim();
    if (nova) CFG.chave = nova;
    CFG.modelo = $('#ia-modelo').value;
    if (!gravar(CHAVE_IA, JSON.stringify(CFG))) { aviso('Não consegui guardar a chave neste navegador.'); return; }
    renderNoLugar();
    aviso(CFG.chave ? 'Chave guardada neste aparelho.' : 'Modelo salvo. Falta informar a chave.');
  }

  function removerIa() {
    CFG.chave = '';
    gravar(CHAVE_IA, JSON.stringify({ modelo: CFG.modelo }));
    renderNoLugar();
    aviso('Chave removida deste aparelho.');
  }

  function restaurar(texto) {
    let novo;
    try { novo = N.importar(texto); } catch (e) { aviso('Backup inválido.'); return; }
    const temDados = Object.keys(D.logs).length || Object.keys(D.weeks).length;
    if (temDados && !confirm('Restaurar substitui os dados atuais deste aparelho. Continuar?')) return;
    D = novo;
    rascunho = null;
    salvar();
    render();
    aviso('Backup restaurado!');
  }

  function baixarBackup() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(D)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `backup-21k-${N.iso(agora())}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function apagarTudo() {
    if (!confirm('Apagar TODOS os dados?')) return;
    if (gerando) gerando.cancelar();
    D = N.vazio();
    rascunho = null;
    erroIa = '';
    CFG.chave = '';
    remover(CHAVE_IA);
    remover(CHAVE_ANTERIOR);
    salvar();
    render();
    aviso('Dados apagados.');
  }

  // ---------- ações ----------

  const ACOES = {
    treino: (el) => abrirTreino(el.dataset.k),
    semana: (el) => abrirSemana(+el.dataset.w),
    periodo: (el) => { UI.periodo = el.dataset.p; salvarUi(); renderNoLugar(); },
    gerar,
    copiar: () => copiarTexto($('#out').value, $('#out')),
    compartilhar: () => navigator.share({ text: $('#out').value }).catch(() => {}),
    enviadas: marcarEnviadas,
    'mais-tenis': () => $('#tenis-lista').insertAdjacentHTML('beforeend', linhaTenis({ nome: '', kmInicial: '', vida: '' })),
    distancia: (el) => { $('#fperfil').elements.distancia.value = el.dataset.km; guardarPerfil(); },
    'criar-ia': criarComIa,
    'cancelar-ia': () => { if (gerando) gerando.cancelar(); },
    'ir-ajustes': () => irPara('ajustes'),
    'copiar-pedido': () => {
      guardarPerfil();
      const e = estadoCriar();
      if (!e.pronto) { aviso('Preencha o objetivo e o perfil antes.'); return; }
      copiarTexto(IA.textoParaChat(pedidoAtual(e)));
    },
    'ler-resposta': lerRespostaColada,
    'usar-plano': usarPlano,
    'descartar-plano': () => { rascunho = null; renderNoLugar(); },
    'voltar-plano': voltarPlano,
    'salvar-ia': salvarIa,
    'remover-ia': removerIa,
    'salvar-prompt': () => { D.prompt = $('#pr').value; salvar(); aviso('Prompt salvo!'); },
    'backup-gerar': () => { $('#bk').value = JSON.stringify(D); },
    'backup-restaurar': () => restaurar($('#bk').value),
    'backup-baixar': baixarBackup,
    'backup-abrir': () => $('#arq').click(),
    'apagar-tudo': apagarTudo,
    instalar: () => {
      if (!pedidoInstalar) return;
      const p = pedidoInstalar;
      pedidoInstalar = null;
      p.prompt();
      p.userChoice.then(render, render);
    },
    'fechar-faixa': () => { UI.semFaixa = true; salvarUi(); render(); },
  };

  document.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-acao]');
    if (!el) return;
    if (el.tagName === 'A') ev.preventDefault();
    const f = ACOES[el.dataset.acao];
    if (f) f(el);
  });

  document.querySelectorAll('.abas button').forEach((b) => { b.onclick = () => irPara(b.dataset.aba); });

  // Toque fora de um gráfico fecha a dica aberta.
  document.addEventListener('pointerdown', (ev) => { if (!ev.target.closest('.g')) G.limpar(); });

  // Toque no fundo escuro fecha a janela.
  $('#dlg').addEventListener('click', (ev) => { if (ev.target === ev.currentTarget) ev.currentTarget.close(); });

  // Gráficos acompanham a largura da tela (girar o celular, redimensionar a janela).
  let larguraAnterior = 0, quadro = 0;
  if (window.ResizeObserver) {
    new ResizeObserver((entradas) => {
      const w = Math.round(entradas[0].contentRect.width);
      if (w === larguraAnterior) return;
      larguraAnterior = w;
      cancelAnimationFrame(quadro);
      quadro = requestAnimationFrame(() => { if (redesenhar) redesenhar(); });
    }).observe($('#app'));
  }

  // ---------- instalação ----------

  window.addEventListener('beforeinstallprompt', (ev) => {
    ev.preventDefault();
    pedidoInstalar = ev;
    if (aba === 'plano' || aba === 'ajustes') renderNoLugar();
  });
  window.addEventListener('appinstalled', () => { pedidoInstalar = null; if (aba !== 'perfil') render(); aviso('App instalado!'); });

  const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || local)) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  // O número de dias e a semana atual mudam com o calendário: atualiza ao voltar para o app.
  let diaMostrado = agora().toDateString();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || $('#dlg').open) return;
    const hoje = agora().toDateString();
    if (hoje === diaMostrado) return;
    diaMostrado = hoje;
    // No Perfil só o cabeçalho muda: redesenhar apagaria o que a pessoa está digitando.
    if (aba === 'perfil') cabecalho(); else render();
  });

  render();
  mostrarSemanaAtual();
})();
