/*
 * ia.js — A IA do app (sem DOM): o pedido de plano de treino para o Claude,
 * a chamada à API, a leitura da resposta em streaming e as mensagens de erro.
 * Funciona no navegador (window.IA) e no Node (testes).
 *
 * O app não tem servidor: a chamada sai direto do navegador com a chave da
 * própria pessoa, guardada só no aparelho (como no Dita, do mesmo repositório).
 */
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.IA = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const API_URL = 'https://api.anthropic.com/v1/messages';
  const VERSAO_API = '2026-10-21';
  const BETA_FALLBACK = 'server-side-fallback-2026-07-01';

  // fallback: o modelo aceita o redirecionamento automático do servidor
  // quando um filtro de segurança recusa o pedido.
  const MODELOS = [
    { id: 'claude-opus-5-5', nome: 'Claude Opus 5.5', nota: 'melhor qualidade', fallback: true },
    { id: 'claude-sonnet-5-5', nome: 'Claude Sonnet 5.5', nota: 'mais rápido', fallback: true },
    { id: 'claude-haiku-5-5', nome: 'Claude Haiku 5.5', nota: 'mais barato', fallback: false },
  ];
  function modeloPorId(id) { return MODELOS.find((m) => m.id === id) || MODELOS[0]; }

  const NOME_DIA = { seg: 'segunda', ter: 'terça', qua: 'quarta', qui: 'quinta', sex: 'sexta', sab: 'sábado', dom: 'domingo' };
  const EXPERIENCIA = {
    iniciante: 'está começando agora (ou voltando depois de muito tempo parado)',
    menos1: 'corre há menos de 1 ano',
    '1a3': 'corre há 1 a 3 anos',
    mais3: 'corre há mais de 3 anos',
  };

  // Formato da resposta: a API garante que o texto devolvido é um JSON neste esquema.
  const ESQUEMA_PLANO = {
    type: 'object',
    properties: {
      semanas: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            foco: { type: 'string' },
            treinos: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  dia: { type: 'string', enum: ['seg', 'ter', 'qua', 'qui', 'sex', 'sab', 'dom'] },
                  treino: { type: 'string' },
                  km: { type: 'number' },
                  leve: { type: 'boolean' },
                  hidratacao: { type: 'string', enum: ['A', 'B', 'C', 'D'] },
                },
                required: ['dia', 'treino', 'km', 'leve', 'hidratacao'],
                additionalProperties: false,
              },
            },
          },
          required: ['foco', 'treinos'],
          additionalProperties: false,
        },
      },
      orientacoes: { type: 'string' },
    },
    required: ['semanas', 'orientacoes'],
    additionalProperties: false,
  };

  function promptSistema() {
    return [
      'You are an experienced running coach. You are building a personalised training plan inside a training-log app: the runner filled in a profile and a goal, the app shows your plan week by week, the runner logs each session against it, and a dashboard compares planned and done. The runner follows the plan as written, with no coach reviewing it, so it has to be safe and realistic for this particular person and complete from the first week to the event.',
      '',
      'Coaching approach: start from what the runner does today (current weekly volume and longest recent run), not from what the goal would ideally require. Build gradually, include lighter weeks at regular intervals, and reduce the load before the event. Keep most of the running easy, and add faster work only when the runner has the base and the history for it. Treat injuries, pain and limitations conservatively. Use only the weekdays the runner has available, with at most one session per day, and put the longest run on the preferred long-run day. If the time until the event is too short to prepare safely for this goal, still write the safest sensible plan and say so plainly at the start of the guidance.',
      '',
      'What the app needs from you:',
      '- One entry per calendar week listed in the request, in the same order, holding only the running sessions of that week (rest days are simply absent).',
      '- The goal event itself is the last session of the last week, on the event date, with the event distance.',
      '- "treino": a short description in Brazilian Portuguese (aim for under 60 characters) in the notation the runner already knows: distances in km, intensity as zones Z1 to Z5 (Z1 very easy, Z2 easy and conversational, Z3 moderate/tempo, Z4 hard/threshold, Z5 very hard) and "RP" for goal race pace. Every session names its zone(s) or RP. Examples: "6 km Z2", "8 km Z2 + 4 acel.", "2 Z1 + 5×1 km Z4 (rec 2 min) + 1 Z1", "16 km: 11 Z2 + 5 RP", "12 km Z2 (alívio)".',
      '- "km": the total distance of the session, warm-up and cool-down included.',
      '- "leve": true when the whole session is easy aerobic running (Z1-Z2 only; a few strides are fine); false when it has any faster block, is a test, or is the event. The dashboard uses it to follow easy-run pace and heart rate over the weeks.',
      '- "hidratacao": A = water is enough, B = belt, sports drink in the heat, C = vest plus carbohydrate during the run, D = race-day fuelling protocol (rehearsed or used).',
      '- "foco": two or three words naming the week (for example "base", "alívio", "pico", "polimento").',
      '- "orientacoes": guidance for the runner in Brazilian Portuguese, as plain text in a few short paragraphs: how this person can find each zone (by feel, and by heart rate or pace when the profile gives enough to estimate them), what RP means for their goal, and what to do after a missed session or when something hurts. This is general training guidance, not medical advice; where the profile suggests a health concern, recommend seeing a doctor before starting.',
    ].join('\n');
  }

  const dito = (x, sufixo) => (x === '' || x == null ? 'não informado' : String(x).trim() + (sufixo || ''));
  const dois = (n) => String(n).padStart(2, '0');
  const iso = (d) => d.getFullYear() + '-' + dois(d.getMonth() + 1) + '-' + dois(d.getDate());

  /*
   * O pedido: perfil (sem o nome), objetivo e as semanas do calendário.
   * op: { perfil, objetivo, calendario (de Nucleo.calendario), idade, hoje (Date) }
   */
  function pedidoPlano(op) {
    const p = op.perfil, o = op.objetivo, cal = op.calendario;
    const dias = (p.dias || []).map((d) => NOME_DIA[d]).filter(Boolean);
    const linhas = [
      '<perfil>',
      'Idade: ' + (op.idade ? op.idade + ' anos' : 'não informada'),
      'Sexo: ' + dito(p.sexo),
      'Peso: ' + dito(p.peso, ' kg') + ' · Altura: ' + dito(p.altura, ' cm'),
      'Experiência: ' + (EXPERIENCIA[p.experiencia] || 'não informada'),
      'Volume atual: ' + dito(p.kmSemana, ' km por semana'),
      'Maior corrida nas últimas semanas: ' + dito(p.maiorCorrida, ' km'),
      'Ritmo confortável: ' + dito(p.ritmoLeve, ' min/km'),
      'Prova ou teste recente: ' + dito(p.provaRecente),
      'FC máxima: ' + dito(p.fcMax, ' bpm') + ' · FC de repouso: ' + dito(p.fcRepouso, ' bpm'),
      'Dias disponíveis para correr: ' + (dias.length ? dias.join(', ') : 'não informados'),
      'Dia preferido para o longão: ' + (NOME_DIA[p.diaLongo] || 'não informado'),
      'Lesões, dores ou limitações: ' + dito(p.lesoes),
      'Outras atividades e observações: ' + dito(p.obs),
      '</perfil>',
      '',
      '<objetivo>',
      'Prova: ' + dito(o.prova),
      'Distância: ' + dito(o.distancia, ' km'),
      'Data: ' + iso(cal.prova) + ' (' + NOME_DIA[cal.diaProva] + ')',
      'Meta: ' + dito(o.meta),
      'Tempo-alvo: ' + dito(o.tempoAlvo),
      '</objetivo>',
      '',
      '<calendario>',
      'Hoje: ' + iso(op.hoje) + '.',
      'O plano tem ' + cal.n + ' semanas, de segunda a domingo:',
    ];
    cal.semanas.forEach((s) => {
      linhas.push('S' + s.w + ': ' + iso(s.ini) + ' a ' + iso(s.fim) +
        (s.w === cal.n ? ' (prova: ' + NOME_DIA[cal.diaProva] + ', ' + iso(cal.prova) + ')' : ''));
    });
    linhas.push('</calendario>', '', 'Monte o plano completo para este corredor, com exatamente ' + cal.n + ' semanas.');
    return linhas.join('\n');
  }

  // Para quem não tem chave: o mesmo pedido em um texto só, para colar no chat do Claude.
  function textoParaChat(op) {
    return promptSistema() + '\n\n' + pedidoPlano(op) +
      '\n\nResponda só com um objeto JSON (sem texto antes ou depois, sem cercas de código) que siga este esquema:\n' +
      JSON.stringify(ESQUEMA_PLANO);
  }

  /*
   * Monta a chamada HTTP à Messages API.
   * op: { chave, modelo, sistema, usuario, esquema, semFallback? }
   */
  function montarRequisicao(op) {
    const modelo = modeloPorId(op.modelo);
    const corpo = {
      model: modelo.id,
      max_tokens: 64000,
      stream: true, // um plano inteiro demora: o streaming evita o estouro de tempo e mostra o andamento
      // Montar um plano seguro pede raciocínio cuidadoso; o esquema garante um JSON que o app sabe ler.
      output_config: { effort: 'high', format: { type: 'json_schema', schema: op.esquema } },
      system: op.sistema,
      messages: [{ role: 'user', content: op.usuario }],
    };
    const cabecalhos = {
      'content-type': 'application/json',
      'x-api-key': op.chave,
      'anthropic-version': VERSAO_API,
      // O app não tem servidor: a chave fica só neste aparelho e a chamada sai direto do navegador.
      'anthropic-dangerous-direct-browser-access': 'true',
    };
    const usaFallback = modelo.fallback && !op.semFallback;
    if (usaFallback) {
      corpo.fallbacks = 'default';
      cabecalhos['anthropic-beta'] = BETA_FALLBACK;
    }
    return { url: API_URL, usaFallback, init: { method: 'POST', headers: cabecalhos, body: JSON.stringify(corpo) } };
  }

  /** Leitor incremental de Server-Sent Events: alimentar(pedaço) → eventos JSON completos. */
  function criarLeitorSSE() {
    let resto = '';
    return {
      alimentar(pedaco) {
        resto += pedaco;
        const eventos = [];
        let fim;
        while ((fim = resto.search(/\r?\n\r?\n/)) !== -1) {
          const bloco = resto.slice(0, fim);
          resto = resto.slice(fim).replace(/^\r?\n\r?\n/, '');
          const dados = bloco.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
          if (!dados) continue;
          try { eventos.push(JSON.parse(dados)); } catch (e) { /* linha incompleta ou keep-alive */ }
        }
        return eventos;
      },
    };
  }

  function novoEstado() { return { texto: '', corte: 0, motivo: null, modelo: '' }; }

  /** Aplica um evento do streaming ao estado. Lança em evento de erro. */
  function aplicarEvento(estado, ev) {
    if (ev.type === 'message_start' && ev.message) {
      estado.modelo = ev.message.model || '';
    } else if (ev.type === 'content_block_start' && ev.content_block && ev.content_block.type === 'fallback') {
      // Outro modelo assumiu no meio da resposta: guarda onde, caso o trecho anterior tenha ficado pela metade.
      estado.corte = estado.texto.length;
    } else if (ev.type === 'content_block_delta' && ev.delta && ev.delta.type === 'text_delta') {
      estado.texto += ev.delta.text;
    } else if (ev.type === 'message_delta' && ev.delta && ev.delta.stop_reason) {
      estado.motivo = ev.delta.stop_reason;
    } else if (ev.type === 'error') {
      const erro = new Error(mensagemErro(0, ev.error && ev.error.type, ev.error && ev.error.message));
      erro.tipo = ev.error && ev.error.type;
      throw erro;
    }
    return estado;
  }

  // Quantas semanas do plano já chegaram (para mostrar o andamento enquanto a resposta é escrita).
  function semanasRecebidas(texto) { return (String(texto).match(/"treinos"\s*:/g) || []).length; }

  /** JSON de um texto que pode vir com cercas de código ou frases em volta (resposta colada do chat). */
  function lerJson(texto) {
    const t = String(texto || '');
    const a = t.indexOf('{'), b = t.lastIndexOf('}');
    if (a < 0 || b <= a) throw new Error('Não encontrei um plano nesse texto.');
    try { return JSON.parse(t.slice(a, b + 1)); } catch (e) { throw new Error('O texto colado está incompleto ou não é um plano.'); }
  }

  /** Resposta final de um streaming terminado. Lança com a explicação se não houver um JSON inteiro. */
  function resultado(estado) {
    if (estado.motivo === 'refusal') throw new Error('A IA não pôde atender este pedido. Revise o perfil e tente de novo.');
    if (estado.motivo === 'max_tokens') throw new Error('A resposta ficou incompleta. Tente de novo.');
    try { return JSON.parse(estado.texto); } catch (e) { /* tenta só o trecho depois da troca de modelo */ }
    if (estado.corte > 0) {
      try { return JSON.parse(estado.texto.slice(estado.corte)); } catch (e) { /* cai no erro abaixo */ }
    }
    throw new Error('A resposta da IA veio incompleta. Tente de novo.');
  }

  /** Mensagem em português para um erro da API. */
  function mensagemErro(status, tipo, detalhe) {
    if (status === 401) return 'Chave de API inválida. Confira a chave em Ajustes.';
    if (status === 403) return 'A chave não tem permissão para este modelo.';
    if (status === 404) return 'Modelo não encontrado para esta chave. Escolha outro em Ajustes.';
    if (status === 413) return 'Pedido grande demais para uma única chamada.';
    if (status === 429) return 'Limite de uso atingido. Aguarde um instante e tente de novo.';
    if (status === 529 || tipo === 'overloaded_error') return 'O serviço está sobrecarregado. Tente de novo em instantes.';
    if (status >= 500) return 'O serviço da IA falhou (' + status + '). Tente de novo.';
    if (status === 400) return 'A API recusou o pedido (400)' + (detalhe ? ': ' + detalhe : '.');
    return 'Falha ao falar com a IA' + (status ? ' (' + status + ')' : '') + (detalhe ? ': ' + detalhe : '.');
  }

  /*
   * Faz a chamada e devolve o JSON da resposta.
   * op: { chave, modelo, sistema, usuario, esquema, sinal (AbortSignal), aoProgresso(estado) }
   */
  async function chamar(op) {
    const enviar = (semFallback) => {
      const req = montarRequisicao(Object.assign({}, op, { semFallback }));
      return fetch(req.url, Object.assign({ signal: op.sinal }, req.init)).then((resp) => ({ req, resp }));
    };
    let envio;
    try {
      envio = await enviar(false);
      // Se a API recusar o pedido com o redirecionamento automático ligado, tenta uma vez sem ele.
      if (envio.resp.status === 400 && envio.req.usaFallback) envio = await enviar(true);
    } catch (e) {
      if (e && e.name === 'AbortError') throw e;
      throw new Error('Não consegui falar com a IA. Confira a internet e tente de novo.');
    }
    const resp = envio.resp;
    if (!resp.ok) {
      let tipo = '', detalhe = '';
      try { const j = await resp.json(); tipo = j.error.type; detalhe = j.error.message; } catch (e) { /* corpo sem JSON */ }
      const erro = new Error(mensagemErro(resp.status, tipo, detalhe));
      erro.status = resp.status;
      throw erro;
    }
    const leitor = criarLeitorSSE(), estado = novoEstado(), dec = new TextDecoder();
    const rd = resp.body.getReader();
    for (;;) {
      const parte = await rd.read();
      if (parte.done) break;
      for (const ev of leitor.alimentar(dec.decode(parte.value, { stream: true }))) aplicarEvento(estado, ev);
      if (op.aoProgresso) op.aoProgresso(estado);
    }
    return resultado(estado);
  }

  return {
    API_URL, VERSAO_API, MODELOS, ESQUEMA_PLANO, EXPERIENCIA, NOME_DIA,
    modeloPorId, promptSistema, pedidoPlano, textoParaChat, montarRequisicao,
    criarLeitorSSE, novoEstado, aplicarEvento, semanasRecebidas, lerJson, resultado, mensagemErro, chamar,
  };
});
