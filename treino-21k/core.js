/*
 * core.js — Núcleo do app 21K Rio 2027 (sem DOM): plano de 28 semanas, datas,
 * cálculos (ritmo, suor, tênis), relatório para o Claude e os números do painel
 * de evolução. Funciona no navegador (window.Nucleo) e no Node (testes).
 *
 * Os dados usam a mesma chave e o mesmo formato da página original
 * (localStorage "r21k_v1"), então um backup feito lá pode ser restaurado aqui.
 */
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.Nucleo = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Cada treino: [dia, descrição, km, código de hidratação (A–D), tênis (N = Novablast 5, E = Evo SL)]
  const PLANO = [
    [1, [['qua', '5 km Z2 (Pampulha, ida e volta)', 5, 'A', 'N'], ['sex', '4 km Z2', 4, 'A', 'N'], ['dom', '6 km Z2', 6, 'A', 'N']]],
    [2, [['qua', '6 km Z2 + 4 acel.', 6, 'A', 'N'], ['dom', '8 km Z2', 8, 'A', 'N']]],
    [3, [['qua', '6 km Z2 + 4 acel.', 6, 'A', 'N'], ['sex', '4 km Z1', 4, 'A', 'N'], ['dom', '9 km Z2', 9, 'A', 'N']]],
    [4, [['qua', '5 km Z2', 5, 'A', 'N'], ['dom', '7 km Z2 (alívio)', 7, 'A', 'N']]],
    [5, [['qua', '7 km: 4 Z2 + 3 RP', 7, 'A', 'E'], ['sex', '5 km Z1', 5, 'A', 'N'], ['dom', '10 km Z2 + teste de suor', 10, 'B', 'N']]],
    [6, [['qua', '7 km Z2 + 6 acel.', 7, 'A', 'N'], ['dom', '11 km Z2', 11, 'B', 'N']]],
    [7, [['qua', '2Z1 + 2×8 min Z3 (rec 3 min) + Z1', 8, 'B', 'E'], ['sex', '5 km Z1 (opcional)', 5, 'A', 'N'], ['dom', '12 km Z2, 1º longão com carbo (30 g/h)', 12, 'C', 'N']]],
    [8, [['qua', 'Teste 5K na pista (2 aquec. + 5 forte + 1)', 8, 'B', 'E'], ['dom', '9 km Z2 (alívio)', 9, 'A', 'N']]],
    [9, [['qua', '2Z1 + 5×1 km Z4 (rec 2 min) + 1 Z1', 8, 'B', 'E'], ['sex', '5 km Z2', 5, 'A', 'N'], ['dom', '13 km Z2', 13, 'C', 'N']]],
    [10, [['qua', '2Z1 + 2×10 min Z3 (rec 3 min) + Z1', 9, 'B', 'E'], ['dom', '14 km Z2 + teste de suor', 14, 'C', 'N']]],
    [11, [['qua', '2Z1 + 6×1 km Z4 (rec 2 min) + 1 Z1', 9, 'B', 'E'], ['sex', '6 km Z2', 6, 'A', 'N'], ['dom', '15 km Z2', 15, 'C', 'N']]],
    [12, [['qua', '7 km Z2 + 6 acel.', 7, 'A', 'N'], ['dom', '11 km Z2 (alívio)', 11, 'B', 'N']]],
    [13, [['qua', '2Z1 + 20 min Z3 + Z1', 9, 'B', 'E'], ['sex', '6 km Z2', 6, 'A', 'N'], ['dom', '15 km: 12 Z2 + 3 RP', 15, 'C', 'N']]],
    [14, [['qua', '2Z1 + 3×2 km Z3 (rec 3 min) + Z1', 10, 'B', 'E'], ['dom', '16 km Z2', 16, 'C', 'N']]],
    [15, [['qua', '2Z1 + 6×1 km Z4 (rec 2 min) + 2 Z1', 10, 'B', 'E'], ['sex', '6 km Z2', 6, 'A', 'N'], ['dom', '16 km: 11 Z2 + 5 RP (45 g/h)', 16, 'C', 'E']]],
    [16, [['qua', '7 km Z2 + 6 acel.', 7, 'A', 'N'], ['dom', '12 km Z2 (alívio)', 12, 'C', 'N']]],
    [17, [['qua', '2Z1 + 25 min Z3 + Z1', 10, 'B', 'E'], ['sex', '6 km Z2', 6, 'A', 'N'], ['dom', '17 km Z2', 17, 'C', 'N']]],
    [18, [['qua', '2Z1 + 6 km RP + 2 Z1', 10, 'B', 'E'], ['dom', '18 km Z2 (volta da Pampulha?)', 18, 'C', 'N']]],
    [19, [['qua', '2Z1 + 3×2 km Z3 (rec 3 min) + 2 Z1', 10, 'B', 'E'], ['sex', '6 km Z2', 6, 'A', 'N'], ['dom', '16 km: 10 Z2 + 6 RP', 16, 'C', 'E']]],
    [20, [['qua', 'Teste 5K (recalibrar zonas e meta)', 9, 'B', 'E'], ['dom', '12 km Z2 (alívio)', 12, 'C', 'N']]],
    [21, [['qua', '2Z1 + 7×1 km Z4 (rec 2 min) + 1 Z1', 10, 'B', 'E'], ['sex', '6 km Z2', 6, 'A', 'N'], ['dom', '19 km Z2 (45–60 g/h)', 19, 'D', 'N']]],
    [22, [['qua', '2Z1 + 7 km RP + 2 Z1', 11, 'B', 'E'], ['dom', 'Ensaio 1: 16 km (8 Z2 + 8 RP)', 16, 'D', 'E/N']]],
    [23, [['qua', '2Z1 + 2×15 min Z3 (rec 3 min) + Z1', 10, 'B', 'E'], ['sex', '6 km Z2', 6, 'A', 'N'], ['dom', '20 km Z2 (maior longão)', 20, 'D', 'N']]],
    [24, [['qua', '8 km Z2 + 6 acel.', 8, 'A', 'N'], ['dom', '13 km Z2 (alívio)', 13, 'C', 'N']]],
    [25, [['qua', '2Z1 + 6×1 km Z4 (rec 2 min) + 2 Z1', 10, 'B', 'E'], ['sex', '6 km Z2', 6, 'A', 'N'], ['dom', 'Ensaio 2: 18 km (10 Z2 + 8 RP)', 18, 'D', 'E/N']]],
    [26, [['qua', '2Z1 + 6 km RP + 2 Z1', 10, 'B', 'E'], ['dom', '14 km Z2', 14, 'C', 'N']]],
    [27, [['qua', '2Z1 + 4 km RP + 2 Z1', 8, 'B', 'E'], ['sex', '5 km Z1', 5, 'A', 'N'], ['dom', '10 km Z2, 2 últimos em RP', 10, 'B', 'N']]],
    [28, [['qua', '3 Z2 + 2 RP + 1 Z1', 6, 'A', 'E'], ['sex', 'Descanso ou 20 min Z1', 0, 'A', 'N'], ['sab', '21K: A PROVA', 21.1, 'D', 'E/N']]],
  ];

  const SEMANAS = PLANO.length;
  const DESLOC = { qua: 2, sex: 4, sab: 5, dom: 6 };
  const DIA = { qua: 'Quarta', sex: 'Sexta', sab: 'Sábado', dom: 'Domingo' };
  const INICIO = new Date(2026, 10, 16); // segunda-feira da semana 1
  const PROVA = new Date(2027, 4, 29);
  const KM_PROVA = 21.1;
  const CHAVE = 'r21k_v1';
  const VIDA_EVO = 720; // km de vida útil estimada do Evo SL
  const DIA_MS = 864e5;

  // ---------- dados ----------

  function vazio() { return { logs: {}, weeks: {}, ov: {}, prompt: '', evoBase: 50 }; }

  function completar(o) {
    const d = Object.assign(vazio(), o);
    for (const k of ['logs', 'weeks', 'ov']) {
      if (!d[k] || typeof d[k] !== 'object' || Array.isArray(d[k])) d[k] = {};
    }
    d.prompt = d.prompt == null ? '' : String(d.prompt);
    return d;
  }

  // Lê o que está guardado no aparelho; se estiver vazio ou corrompido, começa do zero.
  function carregar(texto) {
    try {
      const o = JSON.parse(texto);
      if (o && typeof o === 'object' && !Array.isArray(o)) return completar(o);
    } catch (e) { /* começa vazio */ }
    return vazio();
  }

  // Restaura um backup colado pelo usuário; recusa o que não for um backup do app.
  function importar(texto) {
    const o = JSON.parse(texto);
    if (!o || typeof o !== 'object' || Array.isArray(o) || !o.logs || typeof o.logs !== 'object') {
      throw new Error('Backup inválido');
    }
    return completar(o);
  }

  // ---------- datas ----------

  function meiaNoite(x) { return new Date(x.getFullYear(), x.getMonth(), x.getDate()); }

  function inicioSemana(w) { const x = new Date(INICIO); x.setDate(x.getDate() + 7 * (w - 1)); return x; }
  function fimSemana(w) { const x = inicioSemana(w); x.setDate(x.getDate() + 6); return x; }
  function dataSessao(w, d) { const x = inicioSemana(w); x.setDate(x.getDate() + DESLOC[d]); return x; }

  function fd(x) { return String(x.getDate()).padStart(2, '0') + '/' + String(x.getMonth() + 1).padStart(2, '0'); }

  function semanaAtual(agora) {
    const dias = Math.round((meiaNoite(agora) - INICIO) / DIA_MS);
    return Math.min(SEMANAS, Math.max(1, Math.floor(dias / 7) + 1));
  }

  function diasParaProva(agora) { return Math.max(0, Math.ceil((PROVA - agora) / DIA_MS)); }

  // ---------- plano e registros ----------

  function sessoes(D, w) {
    return PLANO[w - 1][1].map((s) => {
      const k = w + '-' + s[0];
      const o = D.ov[k] || {};
      return { k, w, d: s[0], t: o.t || s[1], km: o.km != null ? o.km : s[2], c: s[3], s: s[4] };
    });
  }

  function basePlano(w, d) { return PLANO[w - 1][1].find((x) => x[0] === d); }

  function seg(t) {
    if (!t) return 0;
    const p = String(t).trim().split(':').map(Number);
    if (p.some(isNaN)) return 0;
    return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p.length === 2 ? p[0] * 60 + p[1] : p[0] * 60;
  }

  // Ritmo em segundos por km (0 quando falta km ou tempo).
  function ritmo(l) { const s = seg(l.tempo); return +l.km > 0 && s ? s / +l.km : 0; }

  function fmtRitmo(s) {
    if (!s) return '–';
    const t = Math.round(s);
    return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
  }

  // Rodagem leve: tem Z1/Z2 e nenhum trecho forte (RP, Z3+, teste de 5K, ensaio ou prova).
  function leve(t) {
    t = String(t);
    return /Z[12]/.test(t) && !/\bRP\b|Z[345]/.test(t) && !/teste 5k|ensaio|prova/i.test(t);
  }

  function kmPlanejados(D, w) { return sessoes(D, w).reduce((a, s) => a + (+s.km || 0), 0); }

  function kmFeitos(D, w) {
    return sessoes(D, w).reduce((a, s) => {
      const l = D.logs[s.k];
      return a + (l && l.status !== 'nao' ? (+l.km || 0) : 0);
    }, 0);
  }

  function fechadas(D) { return Object.values(D.weeks).filter((x) => x && x.closed).length; }

  // Treinos registrados como feitos ou parciais, na ordem do plano.
  function registros(D) {
    const r = [];
    for (let w = 1; w <= SEMANAS; w++) {
      for (const s of sessoes(D, w)) {
        const l = D.logs[s.k];
        if (l && l.status !== 'nao') r.push(Object.assign({}, s, { l }));
      }
    }
    return r;
  }

  function kmTenis(R, nome) { return R.filter((x) => x.l.tenis === nome).reduce((a, x) => a + (+x.l.km || 0), 0); }

  // Teste de suor: taxa em L/h e perda de peso em %.
  function suor(l) {
    const s = seg(l.tempo);
    if (!(+l.pa && +l.pd && s)) return null;
    return {
      taxa: (l.pa - l.pd + (+l.liq || 0) / 1000) / (s / 3600),
      perda: (l.pa - l.pd) / l.pa * 100,
    };
  }

  function media(a) { return a.length ? a.reduce((p, c) => p + c, 0) / a.length : 0; }
  function km1(x) { return Math.round(x * 10) / 10; }

  // ---------- relatório para o Claude ----------

  function pendentes(D) {
    return Object.keys(D.weeks).map(Number).filter((w) => D.weeks[w] && D.weeks[w].closed && !D.weeks[w].sent).sort((a, b) => a - b);
  }

  function relatorio(D, agora) {
    const ws = pendentes(D);
    let r = '';
    if (!ws.length) r += '\nNenhuma semana fechada pendente de envio.\n';
    ws.forEach((w) => {
      const x = D.weeks[w];
      r += `\nSEMANA ${w} – Relatório\n`;
      sessoes(D, w).forEach((s) => {
        const l = D.logs[s.k];
        r += `${DIA[s.d]} ${fd(dataSessao(w, s.d))} | planejado: ${s.t} (${s.km} km, ${s.c}, ${s.s}) → `;
        if (!l || l.status === 'nao') {
          r += 'não fiz';
          if (l && +l.dor) r += ` | dor ${l.dor}${l.dorLocal ? ' (' + l.dorLocal + ')' : ''}`;
          r += (l && l.obs ? ' | obs: ' + l.obs : '') + '\n';
          return;
        }
        r += `${l.status === 'parcial' ? 'PARCIAL: ' : ''}${l.km || '?'} km | tempo ${l.tempo || '?'} | ritmo ${fmtRitmo(ritmo(l))}/km | FC média ${l.fc || '?'} | esforço ${l.esf || '?'} | tênis ${l.tenis} | hidratação: ${l.hid || 'nada'} | dor ${l.dor || 0}${l.dorLocal ? ' (' + l.dorLocal + ')' : ''}${l.obs ? ' | obs: ' + l.obs : ''}\n`;
        const su = suor(l);
        if (su) r += `  Teste de suor: ${l.pa} → ${l.pd} kg, bebeu ${l.liq || 0} mL → ${su.taxa.toFixed(2)} L/h, perda de ${su.perda.toFixed(1)}%\n`;
      });
      r += `Sono/cansaço: ${x.sono} | Calor/fora do normal: ${x.calor || 'nada'} | Obs. da semana: ${x.obs || '–'}\n`;
    });
    const ov = Object.keys(D.ov);
    if (ov.length) r += `\nAjustes no planejado registrados no app: ${ov.map((k) => 'S' + k.replace('-', ' ') + ': ' + D.ov[k].t + ' (' + D.ov[k].km + ' km)').join('; ')}\n`;
    const R = registros(D);
    const ez = R.filter((x) => leve(x.t) && ritmo(x.l));
    r += `\nRESUMO DO APP: ${fechadas(D)}/${SEMANAS} semanas fechadas · ${km1(R.reduce((a, x) => a + (+x.l.km || 0), 0))} km registrados · Evo SL ${km1((+D.evoBase || 0) + kmTenis(R, 'Evo SL'))} km · Novablast 5 ${km1(kmTenis(R, 'Novablast 5'))} km · ritmo Z2: 3 primeiras rodagens ${fmtRitmo(media(ez.slice(0, 3).map((x) => ritmo(x.l))))}/km, 3 últimas ${fmtRitmo(media(ez.slice(-3).map((x) => ritmo(x.l))))}/km · faltam ${diasParaProva(agora)} dias.\n`;
    return r;
  }

  function textoExportacao(D, agora) {
    return (D.prompt.trim() || '[ATENÇÃO: cole o prompt atual na aba Ajustes]') +
      `\n\n---\n# RELATÓRIO GERADO PELO APP (${fd(agora)}/${agora.getFullYear()})\n` + relatorio(D, agora);
  }

  // ---------- painel de evolução ----------

  // Um número por semana para cada gráfico (null = sem dado), mais os indicadores do topo.
  function painel(D, agora) {
    const cw = semanaAtual(agora);
    const fimHoje = meiaNoite(agora).getTime() + DIA_MS - 1;
    const semanas = [];
    let kmPrevisto = 0, treinosPrevistos = 0, treinosFeitos = 0, parciais = 0;

    for (let w = 1; w <= SEMANAS; w++) {
      const ss = sessoes(D, w);
      const feitas = [];
      const comRegistro = [];
      ss.forEach((s) => {
        const l = D.logs[s.k];
        if (l) comRegistro.push({ s, l });
        const feito = !!l && l.status !== 'nao';
        if (feito) { feitas.push({ s, l }); treinosFeitos++; if (l.status === 'parcial') parciais++; }
        // Conta como previsto o que já venceu (ou já foi feito); descanso de 0 km só se registrado.
        if (feito || (+s.km > 0 && dataSessao(w, s.d).getTime() <= fimHoje)) {
          treinosPrevistos++;
          kmPrevisto += +s.km || 0;
        }
      });

      const leves = feitas.filter((x) => leve(x.s.t) && ritmo(x.l));
      const levesFc = leves.filter((x) => +x.l.fc > 0);
      const esforcos = feitas.filter((x) => x.l.esf !== '' && x.l.esf != null && !isNaN(+x.l.esf)).map((x) => +x.l.esf);
      const comDor = comRegistro.filter((x) => +x.l.dor > 0).sort((a, b) => b.l.dor - a.l.dor);
      const kmLeves = leves.reduce((a, x) => a + +x.l.km, 0);
      const longao = ss.reduce((a, s) => (+s.km > +a.km ? s : a), ss[0]);
      const wk = D.weeks[w] || {};

      semanas.push({
        w,
        ini: inicioSemana(w),
        fim: fimSemana(w),
        plan: kmPlanejados(D, w),
        feito: feitas.length ? kmFeitos(D, w) : null,
        longoPlan: Math.max.apply(null, ss.map((s) => +s.km || 0)),
        longoFeito: feitas.length ? Math.max.apply(null, feitas.map((x) => +x.l.km || 0)) : null,
        longoPendente: !D.logs[longao.k], // o longão da semana ainda não foi registrado
        ritmo: kmLeves ? leves.reduce((a, x) => a + seg(x.l.tempo), 0) / kmLeves : null,
        fc: levesFc.length ? media(levesFc.map((x) => +x.l.fc)) : null,
        // Metros percorridos por batimento: (m/min) ÷ (batimentos/min).
        mpb: levesFc.length ? media(levesFc.map((x) => 60000 / (ritmo(x.l) * +x.l.fc))) : null,
        esforco: esforcos.length ? media(esforcos) : null,
        dor: comDor.length ? +comDor[0].l.dor : null,
        dorLocal: comDor.length ? (comDor[0].l.dorLocal || '') : '',
        sono: wk.closed && wk.sono ? wk.sono : null,
        fechada: !!wk.closed,
        treinos: feitas.length,
      });
    }

    const R = registros(D);
    const ez = R.filter((x) => leve(x.t) && ritmo(x.l));
    const ezFc = ez.filter((x) => +x.l.fc > 0);
    const janela = (lista, f) => ({
      n: lista.length,
      atual: lista.length ? media(lista.slice(-3).map(f)) : null,
      // Só compara com o início quando já existe pelo menos uma rodagem fora da janela inicial.
      inicio: lista.length >= 4 ? media(lista.slice(0, 3).map(f)) : null,
    });

    const dorRecente = [];
    for (let w = Math.max(1, cw - 1); w <= cw; w++) {
      sessoes(D, w).forEach((s) => {
        const l = D.logs[s.k];
        if (l && +l.dor >= 4) dorRecente.push({ w, d: s.d, dor: +l.dor, local: l.dorLocal || '' });
      });
    }

    return {
      semana: cw,
      dias: diasParaProva(agora),
      fechadas: fechadas(D),
      kmTotal: R.reduce((a, x) => a + (+x.l.km || 0), 0),
      kmPrevisto,
      treinosFeitos,
      treinosPrevistos,
      parciais,
      maiorCorrida: R.length ? Math.max.apply(null, R.map((x) => +x.l.km || 0)) : null,
      ritmoZ2: janela(ez, (x) => ritmo(x.l)),
      fcZ2: janela(ezFc, (x) => +x.l.fc),
      semanas,
      dorRecente,
      suor: R.map((x) => { const su = suor(x.l); return su ? { w: x.w, d: x.d, taxa: su.taxa, perda: su.perda } : null; }).filter(Boolean),
      tenis: { evo: (+D.evoBase || 0) + kmTenis(R, 'Evo SL'), nova: kmTenis(R, 'Novablast 5'), vidaEvo: VIDA_EVO },
    };
  }

  return {
    PLANO, SEMANAS, DIA, INICIO, PROVA, KM_PROVA, CHAVE, VIDA_EVO,
    vazio, carregar, importar,
    inicioSemana, fimSemana, dataSessao, fd, semanaAtual, diasParaProva,
    sessoes, basePlano, seg, ritmo, fmtRitmo, leve, kmPlanejados, kmFeitos, fechadas,
    registros, kmTenis, suor, media, km1,
    pendentes, relatorio, textoExportacao, painel,
  };
});
