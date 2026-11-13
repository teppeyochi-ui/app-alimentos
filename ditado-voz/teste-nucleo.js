#!/usr/bin/env node
// Testes do núcleo do Dita:  node teste-nucleo.js
'use strict';
const assert = require('assert');
const N = require('./core.js');

let n = 0;
function teste(nome, fn) { fn(); n++; console.log('ok  ' + nome); }

teste('limpeza local: vícios, repetição, maiúscula e ponto final', () => {
  assert.strictEqual(N.limparLocal('ééé eu eu queria tipo assim marcar a reunião né'), 'Eu queria marcar a reunião.');
  assert.strictEqual(N.limparLocal('hum   bom dia   pessoal'), 'Bom dia pessoal.');
  assert.strictEqual(N.limparLocal(''), '');
});

teste('limpeza local: comandos falados de pontuação', () => {
  assert.strictEqual(N.limparLocal('oi joão vírgula tudo bem ponto de interrogação'), 'Oi joão, tudo bem?');
  assert.strictEqual(N.limparLocal('primeira linha nova linha segunda linha'), 'Primeira linha\nSegunda linha.');
  assert.strictEqual(N.limparLocal('um novo parágrafo dois'), 'Um\n\nDois.');
});

teste('limpeza local: não mexe em palavras legítimas', () => {
  assert.strictEqual(N.limparLocal('ele é o tipo de pessoa que ajuda'), 'Ele é o tipo de pessoa que ajuda.');
  assert.strictEqual(N.limparLocal('a meta é 10 por cento'), 'A meta é 10 por cento.');
});

teste('requisição: cabeçalhos de navegador, streaming e modelo padrão', () => {
  const r = N.montarRequisicao({ chave: 'sk-teste', texto: 'oi', estilo: 'email', dicionario: 'Frescatto, SIF' });
  const corpo = JSON.parse(r.init.body);
  assert.strictEqual(r.url, 'https://api.anthropic.com/v1/messages');
  assert.strictEqual(r.init.headers['x-api-key'], 'sk-teste');
  assert.strictEqual(r.init.headers['anthropic-dangerous-direct-browser-access'], 'true');
  assert.strictEqual(corpo.model, 'claude-opus-5-5');
  assert.strictEqual(corpo.stream, true);
  assert.strictEqual(corpo.output_config.effort, 'low');
  assert.ok(!('temperature' in corpo) && !('thinking' in corpo));
  assert.ok(corpo.system.includes('Frescatto; SIF'));
  assert.ok(corpo.system.includes('email body'));
  assert.strictEqual(corpo.messages[0].content, '<transcricao>\noi\n</transcricao>');
});

teste('requisição: fallback só onde o modelo aceita, e pode ser desligado', () => {
  const opus = N.montarRequisicao({ chave: 'k', texto: 'oi' });
  assert.strictEqual(JSON.parse(opus.init.body).fallbacks, 'default');
  assert.ok(opus.init.headers['anthropic-beta']);
  const semFb = N.montarRequisicao({ chave: 'k', texto: 'oi', semFallback: true });
  assert.ok(!('fallbacks' in JSON.parse(semFb.init.body)) && !semFb.init.headers['anthropic-beta']);
  const haiku = N.montarRequisicao({ chave: 'k', texto: 'oi', modelo: 'claude-haiku-5-5' });
  assert.ok(!('fallbacks' in JSON.parse(haiku.init.body)));
});

teste('requisição: ajuste por voz envia texto e instrução', () => {
  const corpo = JSON.parse(N.montarRequisicao({ chave: 'k', texto: 'Olá.', instrucao: 'deixa mais formal' }).init.body);
  assert.ok(corpo.messages[0].content.includes('<instrucao_falada>\ndeixa mais formal'));
  assert.ok(corpo.system.includes('spoken instruction'));
});

teste('SSE: eventos partidos entre pedaços e montagem do texto', () => {
  const leitor = N.criarLeitorSSE();
  const estado = { texto: '', motivo: null };
  const fluxo = [
    'event: message_start\ndata: {"type":"message_start"}\n\nevent: content_block_delta\ndata: {"type":"content_block_del',
    'ta","delta":{"type":"thinking_delta","thinking":"x"}}\n\nevent: ping\ndata: {"type":"ping"}\n\n',
    'event: content_block_delta\r\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Olá, "}}\r\n\r\n',
    'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"mundo."}}\n\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n',
  ];
  for (const p of fluxo) for (const ev of leitor.alimentar(p)) N.aplicarEvento(estado, ev);
  assert.deepStrictEqual(estado, { texto: 'Olá, mundo.', motivo: 'end_turn' });
});

teste('SSE: evento de erro vira exceção', () => {
  assert.throws(() => N.aplicarEvento({ texto: '' }, { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }), /Overloaded/);
});

teste('mensagens de erro em português', () => {
  assert.ok(N.mensagemErro(401).includes('Chave'));
  assert.ok(N.mensagemErro(429).includes('Limite'));
  assert.ok(N.mensagemErro(529).includes('sobrecarregado'));
});

console.log('\n' + n + ' testes passaram.');
