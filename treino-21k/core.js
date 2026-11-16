/*
 * core.js — Núcleo do app de treino (sem DOM): plano, datas, cálculos (ritmo,
 * suor, tênis), relatório para o Claude e os números do painel de evolução.
 * Funciona no navegador (window.Nucleo) e no Node (testes).
 *
 * O app nasceu com um plano fixo (21K Rio 2027, 28 semanas). Esse plano continua
 * embutido e vale enquanto ninguém criar outro; um plano criado pela IA fica
 * guardado em D.plano, junto com o perfil (D.perfil) e o objetivo (D.objetivo).
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
  const PLANO_21K = [
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

  const DIAS = ['seg', 'ter', 'qua', 'qui', 'sex', 'sab', 'dom'];
  const DESLOC = { seg: 0, ter: 1, qua: 2, qui: 3, sex: 4, sab: 5, dom: 6 };
  const DIA = { seg: 'Segunda', ter: 'Terça', qua: 'Quarta', qui: 'Quinta', sex: 'Sexta', sab: 'Sábado', dom: 'Domingo' };
  const CODIGOS = ['A', 'B', 'C', 'D'];
  const CHAVE = 'r21k_v1';
  const DIA_MS = 864e5;
  const MIN_SEMANAS = 4, MAX_SEMANAS = 40; // tamanho aceito para um plano novo

  // Plano embutido: começa na segunda 16/11/2026 e termina na prova de 29/05/2027.
  const INICIO_21K = new Date(2026, 10, 16);
  const ALVO_21K = { prova: '21K Rio 2027', distancia: 21.1, data: '2027-05-29', meta: 'completar bem', tempoAlvo: '' };
  const SEMANAS_21K = PLANO_21K.map((s) => s[1].map((x) => ({ d: x[0], t: x[1], km: x[2], c: x[3], s: x[4] })));
  const TENIS_21K = [{ nome: 'Evo SL', vida: 720 }, { nome: 'Novablast 5', vida: 0 }];

  const ALVO_VAZIO = { prova: '', distancia: '', data: '', meta: '', tempoAlvo: '' };
  const PERFIL_VAZIO = {
    nome: '', nascimento: '', sexo: '', peso: '', altura: '',
    experiencia: '', kmSemana: '', maiorCorrida: '', ritmoLeve: '', provaRecente: '', fcMax: '', fcRepouso: '',
    dias: [], diaLongo: '', lesoes: '', obs: '', tenis: [],
  };

  // ---------- dados ----------

  function vazio() { return { logs: {}, weeks: {}, ov: {}, prompt: '', evoBase: 50 }; }

  const ehObjeto = (x) => !!x && typeof x === 'object' && !Array.isArray(x);

  function completar(o) {
    const d = Object.assign(vazio(), o);
    for (const k of ['logs', 'weeks', 'ov']) if (!ehObjeto(d[k])) d[k] = {};
    for (const k of ['perfil', 'objetivo', 'plano']) if (!ehObjeto(d[k])) delete d[k];
    d.prompt = d.prompt == null ? '' : String(d.prompt);
    return d;
  }

  // Lê o que está guardado no aparelho; se estiver vazio ou corrompido, começa do zero.
  function carregar(texto) {
    try {
      const o = JSON.parse(texto);
      if (ehObjeto(o)) return completar(o);
    } catch (e) { /* começa vazio */ }
    return vazio();
  }

  // Restaura um backup colado pelo usuário; recusa o que não for um backup do app.
  function importar(texto) {
    const o = JSON.parse(texto);
    if (!ehObjeto(o) || !ehObjeto(o.logs)) throw new Error('Backup inválido');
    const d = completar(o);
    // Um plano guardado precisa estar inteiro: sem ele os registros apontariam para o plano errado.
    if (o.plano != null && !planoValido(d.plano)) throw new Error('Backup inválido');
    return d;
  }

  // ---------- datas ----------

  const dois = (n) => String(n).padStart(2, '0');
  function meiaNoite(x) { return new Date(x.getFullYear(), x.getMonth(), x.getDate()); }
  function fd(x) { return dois(x.getDate()) + '/' + dois(x.getMonth() + 1); }
  function iso(x) { return x.getFullYear() + '-' + dois(x.getMonth() + 1) + '-' + dois(x.getDate()); }

  // 'AAAA-MM-DD' → data local (null se não for uma data de verdade).
  function dataIso(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s == null ? '' : s));
    if (!m) return null;
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    return d.getMonth() === +m[2] - 1 && d.getDate() === +m[3] ? d : null;
  }

  function segunda(x) { const d = meiaNoite(x); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d; }
  function diaDaSemana(x) { return DIAS[(x.getDay() + 6) % 7]; }
  function somarDias(x, n) { const d = new Date(x); d.setDate(d.getDate() + n); return d; }
  const diasEntre = (a, b) => Math.round((meiaNoite(b) - meiaNoite(a)) / DIA_MS);

  // ---------- plano em uso, perfil e objetivo ----------

  function planoValido(p) {
    return ehObjeto(p) && !!dataIso(p.inicio) && Array.isArray(p.semanas) && p.semanas.length > 0 &&
      p.semanas.every((s) => Array.isArray(s) && s.every((x) => ehObjeto(x) && x.d in DESLOC && typeof x.t === 'string'));
  }

  // O plano que o app está usando: o criado pela pessoa (D.plano) ou, sem ele, o 21K Rio embutido.
  function plano(D) {
    const p = D.plano;
    if (planoValido(p)) {
      return {
        embutido: false, inicio: dataIso(p.inicio), semanas: p.semanas,
        alvo: Object.assign({}, ALVO_VAZIO, p.alvo), orientacoes: p.orientacoes || '',
        focos: Array.isArray(p.focos) ? p.focos : [], criadoEm: p.criadoEm || '',
      };
    }
    return { embutido: true, inicio: INICIO_21K, semanas: SEMANAS_21K, alvo: ALVO_21K, orientacoes: '', focos: [], criadoEm: '' };
  }

  function nSemanas(D) { return plano(D).semanas.length; }
  function alvo(D) { return plano(D).alvo; }

  function inicioSemana(D, w) { return somarDias(plano(D).inicio, 7 * (w - 1)); }
  function fimSemana(D, w) { return somarDias(plano(D).inicio, 7 * (w - 1) + 6); }
  function dataSessao(D, w, d) { return somarDias(plano(D).inicio, 7 * (w - 1) + DESLOC[d]); }

  // Dia da prova: a data do objetivo do plano; sem ela, o último dia do plano.
  function dataProva(D) { return dataIso(alvo(D).data) || fimSemana(D, nSemanas(D)); }

  function kmProva(D) {
    const km = +alvo(D).distancia;
    if (km > 0) return km;
    return Math.max.apply(null, plano(D).semanas.map((s) => Math.max.apply(null, s.map((x) => +x.km || 0).concat([0]))));
  }

  function semanaAtual(D, agora) {
    const dias = diasEntre(plano(D).inicio, agora);
    return Math.min(nSemanas(D), Math.max(1, Math.floor(dias / 7) + 1));
  }

  // 'antes' do começo do plano, 'durante' ou 'depois' da última semana.
  function fase(D, agora) {
    const dias = diasEntre(plano(D).inicio, agora);
    return dias < 0 ? 'antes' : dias >= 7 * nSemanas(D) ? 'depois' : 'durante';
  }

  function diasParaProva(D, agora) { return Math.max(0, Math.ceil((dataProva(D) - agora) / DIA_MS)); }

  // Perfil da pessoa. Enquanto ninguém preencheu, vale o do plano embutido.
  function perfil(D) {
    if (ehObjeto(D.perfil)) {
      const p = Object.assign({}, PERFIL_VAZIO, D.perfil);
      p.dias = Array.isArray(p.dias) ? p.dias.filter((d) => d in DESLOC) : [];
      p.tenis = Array.isArray(p.tenis) ? p.tenis.filter((t) => ehObjeto(t) && t.nome) : [];
      return p;
    }
    return Object.assign({}, PERFIL_VAZIO, {
      nome: 'Rafael Braga', dias: ['qua', 'sex', 'dom'], diaLongo: 'dom',
      tenis: TENIS_21K.map((t) => Object.assign({ kmInicial: t.nome === 'Evo SL' ? (+D.evoBase || 0) : 0 }, t)),
    });
  }

  // Objetivo preenchido na aba Perfil (o que vale para o plano em uso é alvo(D)).
  function objetivo(D) { return Object.assign({}, ALVO_VAZIO, ehObjeto(D.objetivo) ? D.objetivo : ALVO_21K); }

  function tenis(D) { return perfil(D).tenis; }

  function titulo(D) { return [perfil(D).nome, alvo(D).prova].filter(Boolean).join(' · ') || 'Plano de corrida'; }

  function idade(D, agora) {
    const ano = +perfil(D).nascimento;
    return ano > 1900 && ano <= agora.getFullYear() ? agora.getFullYear() - ano : null;
  }

  // ---------- sessões e registros ----------

  function sessoes(D, w) {
    return (plano(D).semanas[w - 1] || []).map((s) => {
      const k = w + '-' + s.d;
      const o = D.ov[k] || {};
      const r = {
        k, w, d: s.d, t: o.t || s.t, km: o.km != null ? o.km : s.km,
        c: CODIGOS.indexOf(s.c) >= 0 ? s.c : 'A', s: /^[A-Z/]{1,3}$/.test(s.s) ? s.s : '',
      };
      // A marca de "treino leve" vem do plano; se o texto foi ajustado à mão, vale o texto.
      if (typeof s.leve === 'boolean' && !o.t) r.leve = s.leve;
      return r;
    });
  }

  function basePlano(D, w, d) { return (plano(D).semanas[w - 1] || []).find((x) => x.d === d); }

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
    return Math.floor(t / 60) + ':' + dois(t % 60);
  }

  // Rodagem leve pelo texto: tem Z1/Z2 e nenhum trecho forte (RP, Z3+, teste de 5K, ensaio ou prova).
  function leve(t) {
    t = String(t);
    return /Z[12]/.test(t) && !/\bRP\b|Z[345]/.test(t) && !/teste 5k|ensaio|prova/i.test(t);
  }

  // Sessão leve: a marca que veio do plano ou, sem ela, o que o texto diz.
  function ehLeve(s) { return typeof s.leve === 'boolean' ? s.leve : leve(s.t); }

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
    for (let w = 1, n = nSemanas(D); w <= n; w++) {
      for (const s of sessoes(D, w)) {
        const l = D.logs[s.k];
        if (l && l.status !== 'nao') r.push(Object.assign({}, s, { l }));
      }
    }
    return r;
  }

  function kmTenis(R, nome) { return R.filter((x) => x.l.tenis === nome).reduce((a, x) => a + (+x.l.km || 0), 0); }

  // Km de cada tênis do perfil: o que já tinha antes do app mais o registrado.
  function usoTenis(D, R) {
    return tenis(D).map((t) => ({ nome: t.nome, km: (+t.kmInicial || 0) + kmTenis(R || registros(D), t.nome), vida: +t.vida || 0 }));
  }

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

  // ---------- plano novo ----------

  // Semanas de um plano novo: da segunda de início até a semana da prova.
  // Devolve { inicio, prova, n, diaProva, semanas: [{ w, ini, fim }] } ou lança um erro com a explicação.
  function calendario(inicioIso, provaIso) {
    const prova = dataIso(provaIso);
    if (!prova) throw new Error('Informe a data da prova.');
    let inicio = dataIso(inicioIso);
    if (!inicio) throw new Error('Escolha a semana de início.');
    inicio = segunda(inicio);
    let n = diasEntre(inicio, segunda(prova)) / 7 + 1;
    if (n > MAX_SEMANAS) { inicio = somarDias(segunda(prova), -7 * (MAX_SEMANAS - 1)); n = MAX_SEMANAS; }
    if (n < MIN_SEMANAS) throw new Error(`A prova está muito perto: é preciso pelo menos ${MIN_SEMANAS} semanas para montar um plano.`);
    const semanas = [];
    for (let w = 1; w <= n; w++) semanas.push({ w, ini: somarDias(inicio, 7 * (w - 1)), fim: somarDias(inicio, 7 * (w - 1) + 6) });
    return { inicio, prova, n, diaProva: diaDaSemana(prova), semanas };
  }

  // Semanas em que um plano novo pode começar: esta (até quarta) ou a próxima segunda.
  function opcoesInicio(agora) {
    const esta = segunda(agora), proxima = somarDias(esta, 7);
    const r = [];
    if (diasEntre(esta, agora) <= 2) r.push({ iso: iso(esta), rotulo: `Nesta semana (segunda ${fd(esta)})` });
    r.push({ iso: iso(proxima), rotulo: `Na próxima segunda (${fd(proxima)})` });
    return r;
  }

  // O que falta preencher para pedir um plano (lista vazia = pode pedir).
  function faltaParaPlano(p, o) {
    const f = [];
    if (!(+o.distancia > 0)) f.push('a distância do objetivo');
    if (!dataIso(o.data)) f.push('a data da prova');
    if ((p.dias || []).length < 2) f.push('pelo menos 2 dias disponíveis para correr');
    if (p.kmSemana === '' || p.kmSemana == null) f.push('quantos km você corre por semana hoje');
    return f;
  }

  /*
   * Confere a resposta da IA e a transforma no plano guardado em D.plano.
   * resposta: { semanas: [{ foco, treinos: [{ dia, treino, km, leve, hidratacao }] }], orientacoes }
   * A última semana sempre termina com a prova, no dia e na distância do objetivo.
   */
  function montarPlano(resposta, cal, obj, agora) {
    if (!ehObjeto(resposta) || !Array.isArray(resposta.semanas)) throw new Error('A resposta não trouxe um plano.');
    if (resposta.semanas.length !== cal.n) throw new Error(`O plano veio com ${resposta.semanas.length} semanas; eram ${cal.n}.`);
    const kmAlvo = +obj.distancia;
    const semanas = resposta.semanas.map((sem, i) => {
      const ultima = i === cal.n - 1;
      const usados = {};
      const lista = [];
      (ehObjeto(sem) && Array.isArray(sem.treinos) ? sem.treinos : []).forEach((x) => {
        if (!ehObjeto(x) || !(x.dia in DESLOC) || usados[x.dia]) return;
        const t = String(x.treino == null ? '' : x.treino).replace(/\s+/g, ' ').trim().slice(0, 140);
        const km = Math.round((+x.km || 0) * 10) / 10;
        if (!t || km < 0 || km > 200) return;
        if (ultima && DESLOC[x.dia] >= DESLOC[cal.diaProva]) return; // o dia da prova é montado abaixo
        usados[x.dia] = true;
        lista.push({ d: x.dia, t, km, c: CODIGOS.indexOf(x.hidratacao) >= 0 ? x.hidratacao : 'A', leve: x.leve === true });
      });
      if (ultima) {
        // Aproveita o texto da IA para o dia da prova só se ele descreve a prova (mesma distância).
        const daIa = (sem.treinos || []).find((x) => ehObjeto(x) && x.dia === cal.diaProva && String(x.treino || '').trim() &&
          Math.abs((+x.km || 0) - kmAlvo) <= kmAlvo * 0.05 + 0.3);
        lista.push({
          d: cal.diaProva,
          t: daIa ? String(daIa.treino).replace(/\s+/g, ' ').trim().slice(0, 140) : (obj.prova || 'Prova') + ': A PROVA',
          km: kmAlvo, c: 'D', leve: false,
        });
      }
      return lista.sort((a, b) => DESLOC[a.d] - DESLOC[b.d]);
    });
    if (semanas.reduce((a, s) => a + s.length, 0) < cal.n) throw new Error('O plano veio quase sem treinos.');
    return {
      inicio: iso(cal.inicio),
      semanas,
      focos: resposta.semanas.map((s) => String((ehObjeto(s) && s.foco) || '').trim().slice(0, 40)),
      orientacoes: String(resposta.orientacoes || '').trim(),
      alvo: { prova: String(obj.prova || ''), distancia: kmAlvo, data: iso(cal.prova), meta: String(obj.meta || ''), tempoAlvo: String(obj.tempoAlvo || '') },
      criadoEm: iso(agora || new Date()),
    };
  }

  // Números de um plano para a prévia: semanas, treinos, km total, maior semana e maior corrida.
  function resumoPlano(semanas) {
    const porSemana = semanas.map((s) => s.reduce((a, x) => a + (+x.km || 0), 0));
    return {
      n: semanas.length,
      treinos: semanas.reduce((a, s) => a + s.length, 0),
      total: km1(porSemana.reduce((a, b) => a + b, 0)),
      pico: km1(Math.max.apply(null, porSemana.concat([0]))),
      longao: Math.max.apply(null, semanas.map((s) => Math.max.apply(null, s.map((x) => +x.km || 0).concat([0]))).concat([0])),
      porSemana,
    };
  }

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
        r += `${DIA[s.d]} ${fd(dataSessao(D, w, s.d))} | planejado: ${s.t} (${s.km} km, ${s.c}${s.s ? ', ' + s.s : ''}) → `;
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
    const ez = R.filter((x) => ehLeve(x) && ritmo(x.l));
    const calcados = usoTenis(D, R).map((t) => `${t.nome} ${km1(t.km)} km`).join(' · ');
    r += `\nRESUMO DO APP: ${fechadas(D)}/${nSemanas(D)} semanas fechadas · ${km1(R.reduce((a, x) => a + (+x.l.km || 0), 0))} km registrados${calcados ? ' · ' + calcados : ''} · ritmo Z2: 3 primeiras rodagens ${fmtRitmo(media(ez.slice(0, 3).map((x) => ritmo(x.l))))}/km, 3 últimas ${fmtRitmo(media(ez.slice(-3).map((x) => ritmo(x.l))))}/km · faltam ${diasParaProva(D, agora)} dias.\n`;
    return r;
  }

  function textoExportacao(D, agora) {
    return (D.prompt.trim() || '[ATENÇÃO: cole o prompt atual na aba Ajustes]') +
      `\n\n---\n# RELATÓRIO GERADO PELO APP (${fd(agora)}/${agora.getFullYear()})\n` + relatorio(D, agora);
  }

  // ---------- painel de evolução ----------

  // Um número por semana para cada gráfico (null = sem dado), mais os indicadores do topo.
  function painel(D, agora) {
    const P = plano(D);
    const n = P.semanas.length;
    const cw = semanaAtual(D, agora);
    const fimHoje = meiaNoite(agora).getTime() + DIA_MS - 1;
    const semanas = [];
    let kmPrevisto = 0, treinosPrevistos = 0, treinosFeitos = 0, parciais = 0;

    for (let w = 1; w <= n; w++) {
      const ss = sessoes(D, w);
      const feitas = [];
      const comRegistro = [];
      ss.forEach((s) => {
        const l = D.logs[s.k];
        if (l) comRegistro.push({ s, l });
        const feito = !!l && l.status !== 'nao';
        if (feito) { feitas.push({ s, l }); treinosFeitos++; if (l.status === 'parcial') parciais++; }
        // Conta como previsto o que já venceu (ou já foi feito); descanso de 0 km só se registrado.
        if (feito || (+s.km > 0 && dataSessao(D, w, s.d).getTime() <= fimHoje)) {
          treinosPrevistos++;
          kmPrevisto += +s.km || 0;
        }
      });

      const leves = feitas.filter((x) => ehLeve(x.s) && ritmo(x.l));
      const levesFc = leves.filter((x) => +x.l.fc > 0);
      const esforcos = feitas.filter((x) => x.l.esf !== '' && x.l.esf != null && !isNaN(+x.l.esf)).map((x) => +x.l.esf);
      const comDor = comRegistro.filter((x) => +x.l.dor > 0).sort((a, b) => b.l.dor - a.l.dor);
      const kmLeves = leves.reduce((a, x) => a + +x.l.km, 0);
      const longao = ss.reduce((a, s) => (!a || +s.km > +a.km ? s : a), null);
      const wk = D.weeks[w] || {};

      semanas.push({
        w,
        ini: inicioSemana(D, w),
        fim: fimSemana(D, w),
        foco: P.focos[w - 1] || '',
        plan: kmPlanejados(D, w),
        feito: feitas.length ? kmFeitos(D, w) : null,
        longoPlan: ss.length ? Math.max.apply(null, ss.map((s) => +s.km || 0)) : 0,
        longoFeito: feitas.length ? Math.max.apply(null, feitas.map((x) => +x.l.km || 0)) : null,
        longoPendente: !!longao && !D.logs[longao.k], // o longão da semana ainda não foi registrado
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
    const ez = R.filter((x) => ehLeve(x) && ritmo(x.l));
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

    const prova = dataProva(D);
    return {
      n,
      semana: cw,
      fase: fase(D, agora),
      inicio: P.inicio,
      prova,
      kmProva: kmProva(D),
      progresso: Math.max(0, Math.min(100, (agora - P.inicio) / (prova - P.inicio) * 100)) || 0,
      dias: diasParaProva(D, agora),
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
      tenis: usoTenis(D, R),
    };
  }

  return {
    PLANO_21K, DIAS, DIA, CODIGOS, CHAVE, MIN_SEMANAS, MAX_SEMANAS, ALVO_VAZIO, PERFIL_VAZIO,
    vazio, carregar, importar,
    fd, iso, dataIso, segunda, diaDaSemana, somarDias,
    plano, planoValido, nSemanas, alvo, inicioSemana, fimSemana, dataSessao, dataProva, kmProva,
    semanaAtual, fase, diasParaProva, perfil, objetivo, tenis, titulo, idade,
    sessoes, basePlano, seg, ritmo, fmtRitmo, leve, ehLeve, kmPlanejados, kmFeitos, fechadas,
    registros, kmTenis, usoTenis, suor, media, km1,
    calendario, opcoesInicio, faltaParaPlano, montarPlano, resumoPlano,
    pendentes, relatorio, textoExportacao, painel,
  };
});
