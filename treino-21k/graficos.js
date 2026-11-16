/*
 * graficos.js — Gráficos do painel de evolução, desenhados em SVG no tamanho real
 * da tela (as letras não encolhem no celular). Todos têm uma posição por semana
 * do plano, então ficam alinhados entre si.
 *
 * Camadas: 'trilho' (coluna clara do planejado), 'coluna' (feito), 'area'
 * (silhueta do planejado), 'linha' e 'pontos'. Tocar, passar o mouse ou usar as
 * setas do teclado mostra os valores da semana.
 */
(function (raiz) {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const ML = 40, MT = 14, MB = 22; // margens: eixo Y, respiro do topo, faixa do eixo X
  let aberto = null; // gráfico com a dica aberta

  function svg(nome, attrs, pai) {
    const e = document.createElementNS(NS, nome);
    if (attrs) for (const k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
    if (pai) pai.appendChild(e);
    return e;
  }
  function tag(nome, classe, texto, pai) {
    const e = document.createElement(nome);
    if (classe) e.className = classe;
    if (texto != null) e.textContent = texto;
    if (pai) pai.appendChild(e);
    return e;
  }
  const n1 = (x) => Math.round(x * 10) / 10;

  // Coluna com a ponta arredondada e a base reta.
  function caminhoColuna(x, y, w, h) {
    const r = Math.min(4, w / 2, h);
    return `M${n1(x)},${n1(y + h)}V${n1(y + r)}Q${n1(x)},${n1(y)} ${n1(x + r)},${n1(y)}H${n1(x + w - r)}Q${n1(x + w)},${n1(y)} ${n1(x + w)},${n1(y + r)}V${n1(y + h)}Z`;
  }

  // Escala com marcas "redondas". passos: lista de passos aceitos (ex.: segundos); sem ela, usa 1/2/2,5/5 × 10ⁿ.
  // faixaMinima: amplitude mínima do eixo, para uma oscilação pequena não parecer um salto.
  function escala(vmin, vmax, passos, alvo, faixaMinima) {
    if (faixaMinima && vmax - vmin < faixaMinima) {
      const meio = (vmin + vmax) / 2;
      vmin = meio - faixaMinima / 2;
      vmax = meio + faixaMinima / 2;
    }
    if (vmin === vmax) { vmin -= 1; vmax += 1; }
    const bruto = (vmax - vmin) / (alvo || 3);
    let passo;
    if (passos) passo = passos.find((p) => p >= bruto) || passos[passos.length - 1];
    else {
      const pot = Math.pow(10, Math.floor(Math.log10(bruto)));
      const f = bruto / pot;
      passo = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * pot;
    }
    const min = Math.floor(vmin / passo + 1e-9) * passo;
    const max = Math.ceil(vmax / passo - 1e-9) * passo;
    const marcas = [];
    for (let v = min; v <= max + passo / 1e6; v += passo) marcas.push(+v.toFixed(6));
    return { min, max, marcas };
  }

  /*
   * porSemana(caixa, o) — desenha um gráfico dentro de `caixa`.
   *   o.rotulos   texto do eixo X para cada posição (ex.: 'S1')
   *   o.atual     posição da semana atual (-1 se fora do recorte)
   *   o.altura    altura total em px (inclui a faixa do eixo X)
   *   o.y         { min, max, marcas, fmt(v), invertido }
   *   o.camadas   [{ tipo, valores[], classe, classeDe(v), entalhe[], rotuloFinal(v), pontos }]
   *   o.refs      [{ y, rotulo }] linhas de referência
   *   o.dica(i)   { titulo, linhas: [{ chave: 'caixa'|'linha'|'ponto', classe, rotulo, valor }] } ou null
   *   o.aoFocar(i) avisa a posição em foco (para realçar gráficos irmãos)
   *   o.descricao texto alternativo
   */
  function porSemana(caixa, o) {
    const n = o.rotulos.length;
    const W = Math.max(240, Math.floor(caixa.clientWidth || 320));
    const H = o.altura || 180;
    const MR = 12;
    const pw = W - ML - MR, ph = H - MT - MB;
    const bw = pw / n;
    const y0 = MT + ph; // linha de base
    const cx = (i) => ML + bw * (i + 0.5);
    const py = (v) => {
      const f = (v - o.y.min) / (o.y.max - o.y.min);
      return o.y.invertido ? MT + f * ph : MT + (1 - f) * ph;
    };

    caixa.textContent = '';
    const s = svg('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', tabindex: 0, 'aria-label': o.descricao || '' }, caixa);

    // Grade e eixo Y.
    o.y.marcas.forEach((v) => {
      const y = n1(py(v));
      const base = Math.abs(y - y0) < 0.6;
      svg('line', { class: base ? 'g-base' : 'g-grade', x1: ML, x2: W - MR, y1: y, y2: y }, s);
      svg('text', { class: 'g-eixo', x: ML - 6, y, dy: '.32em', 'text-anchor': 'end' }, s).textContent = o.y.fmt(v);
    });
    if (!o.y.marcas.some((v) => Math.abs(py(v) - y0) < 0.6)) svg('line', { class: 'g-base', x1: ML, x2: W - MR, y1: y0, y2: y0 }, s);

    // Eixo X: rótulos espaçados para não encostar; a semana atual sempre aparece.
    const largRot = 26;
    let cada = Math.max(1, Math.ceil(largRot / bw));
    if (cada === 3) cada = 4; else if (cada > 4) cada = Math.ceil(cada / 4) * 4;
    o.rotulos.forEach((r, i) => {
      const ehAtual = i === o.atual;
      const marcado = (i + 1) % cada === 0 || (i === 0 && cada !== 2);
      const pertoDoAtual = o.atual >= 0 && !ehAtual && Math.abs(i - o.atual) * bw < largRot;
      if (!ehAtual && (!marcado || pertoDoAtual)) return;
      svg('text', { class: ehAtual ? 'g-eixo g-eixo-atual' : 'g-eixo', x: n1(cx(i)), y: H - 6, 'text-anchor': 'middle' }, s).textContent = r;
    });

    // Camadas de dados.
    const larg = Math.max(3, Math.min(24, bw - Math.max(2, bw * 0.3)));
    o.camadas.forEach((c) => {
      const g = svg('g', null, s);
      if (c.tipo === 'trilho' || c.tipo === 'coluna') {
        c.valores.forEach((v, i) => {
          if (v == null || !(v > o.y.min)) return;
          const y = py(Math.min(v, o.y.max));
          svg('path', { class: (c.classeDe ? c.classeDe(v) : c.classe), d: caminhoColuna(cx(i) - larg / 2, y, larg, y0 - y) }, g);
          // Feito acima do planejado: um corte na cor do fundo marca onde ficava o planejado.
          const alvo = c.entalhe && c.entalhe[i];
          if (alvo != null && alvo > o.y.min && v > alvo + 0.05) {
            const ya = n1(py(alvo));
            svg('line', { class: 'g-entalhe', x1: n1(cx(i) - larg / 2), x2: n1(cx(i) + larg / 2), y1: ya, y2: ya }, g);
          }
        });
      } else if (c.tipo === 'area') {
        const pts = [];
        c.valores.forEach((v, i) => { if (v != null) pts.push([cx(i), py(v)]); });
        if (pts.length) {
          const d = `M${n1(pts[0][0] - bw / 2)},${y0}L${n1(pts[0][0] - bw / 2)},${n1(pts[0][1])}` +
            pts.map((p) => `L${n1(p[0])},${n1(p[1])}`).join('') +
            `L${n1(pts[pts.length - 1][0] + bw / 2)},${n1(pts[pts.length - 1][1])}L${n1(pts[pts.length - 1][0] + bw / 2)},${y0}Z`;
          svg('path', { class: c.classe, d }, g);
        }
      } else if (c.tipo === 'linha' || c.tipo === 'pontos') {
        const pts = [];
        c.valores.forEach((v, i) => { if (v != null) pts.push([cx(i), py(v), v]); });
        if (c.tipo === 'linha' && pts.length > 1) {
          svg('path', { class: 'g-linha ' + c.classe, d: 'M' + pts.map((p) => n1(p[0]) + ',' + n1(p[1])).join('L') }, g);
        }
        // Pontos: todos quando há espaço (ou na camada só de pontos); senão, só o último.
        const todos = c.tipo === 'pontos' || bw >= 14;
        pts.forEach((p, j) => {
          const ultimo = j === pts.length - 1;
          if (c.tipo === 'pontos') svg('circle', { class: 'g-ponto ' + c.classe, cx: n1(p[0]), cy: n1(p[1]), r: Math.min(4, Math.max(3, bw / 2 - 1)) }, g);
          else if (ultimo) svg('circle', { class: 'g-ponto g-ponto-fim ' + c.classe, cx: n1(p[0]), cy: n1(p[1]), r: 4 }, g);
          else if (todos) svg('circle', { class: 'g-ponto ' + c.classe, cx: n1(p[0]), cy: n1(p[1]), r: 2.5 }, g);
        });
        // Valor escrito só no último ponto.
        if (c.rotuloFinal && pts.length) {
          const p = pts[pts.length - 1];
          const txt = c.rotuloFinal(p[2]);
          const cabeADireita = W - p[0] > txt.length * 6.6 + 12;
          const emBaixo = !cabeADireita && p[1] - MT < 16;
          svg('text', {
            class: 'g-valor',
            x: n1(cabeADireita ? p[0] + 8 : Math.min(p[0], W - 4)),
            y: n1(cabeADireita ? p[1] : emBaixo ? p[1] + 17 : p[1] - 9),
            dy: cabeADireita ? '.32em' : null,
            'text-anchor': cabeADireita ? 'start' : 'end',
          }, g).textContent = txt;
        }
      }
    });

    // Semana atual: véu discreto por cima das marcas (aparece igual sobre área, coluna ou fundo).
    if (o.atual >= 0 && o.atual < n) svg('rect', { class: 'g-hoje', x: n1(ML + bw * o.atual), y: MT, width: n1(bw), height: ph }, s);

    // Linhas de referência com o rótulo escrito em cima.
    (o.refs || []).forEach((r) => {
      const y = n1(py(r.y));
      svg('line', { class: 'g-ref', x1: ML, x2: W - MR, y1: y, y2: y }, s);
      if (r.rotulo) svg('text', { class: 'g-ref-rotulo', x: ML + 4, y: y - 5 }, s).textContent = r.rotulo;
    });

    // Realce da posição em foco e área sensível (a faixa inteira da semana, não só a marca).
    const foco = svg('rect', { class: 'g-foco', y: MT, width: n1(bw), height: ph, visibility: 'hidden' }, s);
    const alvo = svg('rect', { class: 'g-alvo', x: ML, y: 0, width: pw, height: H }, s);
    const dica = tag('div', 'g-dica', null, caixa);
    dica.hidden = true;
    let pos = null;

    function realcar(i) {
      if (i == null) { foco.setAttribute('visibility', 'hidden'); return; }
      foco.setAttribute('x', n1(ML + bw * i));
      foco.setAttribute('visibility', 'visible');
    }

    function focar(i) {
      if (i === pos) return;
      // Fecha primeiro a dica de outro gráfico: ele pode ser irmão deste e apagaria o realce.
      if (i != null && aberto && aberto !== api) aberto.limpar();
      pos = i;
      realcar(i);
      if (o.aoFocar) o.aoFocar(i);
      if (i == null) { dica.hidden = true; if (aberto === api) aberto = null; return; }
      aberto = api;
      const d = o.dica ? o.dica(i) : null;
      if (!d) { dica.hidden = true; return; }
      dica.textContent = '';
      tag('div', 'g-dica-titulo', d.titulo, dica);
      d.linhas.forEach((l) => {
        const linha = tag('div', 'g-dica-linha', null, dica);
        if (l.chave) tag('i', 'g-chave g-chave-' + l.chave + ' ' + (l.classe || ''), null, linha);
        tag('span', null, l.rotulo, linha);
        tag('b', null, l.valor, linha);
      });
      dica.hidden = false;
      const tw = dica.offsetWidth;
      dica.style.left = Math.round(Math.max(0, Math.min(W - tw, cx(i) - tw / 2))) + 'px';
      dica.style.bottom = (H - MT + 6) + 'px';
    }

    const indice = (ev) => {
      const r = s.getBoundingClientRect();
      return Math.max(0, Math.min(n - 1, Math.floor((ev.clientX - r.left - ML) / bw)));
    };
    alvo.addEventListener('pointermove', (ev) => focar(indice(ev)));
    alvo.addEventListener('pointerdown', (ev) => focar(indice(ev)));
    alvo.addEventListener('pointerleave', (ev) => { if (ev.pointerType === 'mouse') focar(null); });
    s.addEventListener('keydown', (ev) => {
      const inicio = pos == null ? (o.atual >= 0 && o.atual < n ? o.atual : n - 1) : pos;
      if (ev.key === 'ArrowRight') { focar(pos == null ? inicio : Math.min(n - 1, pos + 1)); ev.preventDefault(); }
      else if (ev.key === 'ArrowLeft') { focar(pos == null ? inicio : Math.max(0, pos - 1)); ev.preventDefault(); }
      else if (ev.key === 'Home') { focar(0); ev.preventDefault(); }
      else if (ev.key === 'End') { focar(n - 1); ev.preventDefault(); }
      else if (ev.key === 'Escape') focar(null);
    });
    s.addEventListener('blur', () => focar(null));

    const api = {
      realcar,
      limpar() { focar(null); },
    };
    return api;
  }

  // Fecha a dica aberta (toque fora do gráfico).
  function limpar() { if (aberto) aberto.limpar(); }

  raiz.Graficos = { porSemana, escala, limpar };
})(typeof self !== 'undefined' ? self : this);
