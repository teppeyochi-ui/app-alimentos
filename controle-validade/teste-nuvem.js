#!/usr/bin/env node
// Testes da ligação com a nuvem (sem navegador), contra um Supabase de mentira:  node teste-nuvem.js
'use strict';
const assert = require('assert');
const N = require('./core.js');
const Nuvem = require('./nuvem.js');
const { criarServidorFalso } = require('./supabase/teste/servidor-falso.js');

let n = 0;
async function teste(nome, fn) { await fn(); n++; console.log('ok  ' + nome); }
const AGORA = new Date(2026, 10, 16, 12).getTime();
const recusa = async (promessa, tipo) => {
  try { await promessa; } catch (e) { assert.strictEqual(e.tipo, tipo, e.message); return e; }
  assert.fail('devia ter recusado com erro do tipo ' + tipo);
};

(async () => {
  const srv = await criarServidorFalso();
  srv.criarConta('casa@exemplo.com', 'segredo');
  srv.criarConta('outra@exemplo.com', 'outra');

  // Um aparelho: o cliente (com a sessão guardada numa "gaveta"), os dados e a rodada de sincronização.
  function aparelho(nome, opcoes) {
    const A = { nome, gaveta: null, relogio: null, gravacoes: 0 };
    A.cliente = Nuvem.criar(Object.assign({
      url: srv.url, chave: srv.chave, buscar: fetch,
      ler: () => A.gaveta, gravar: (s) => { A.gaveta = s; },
      agora: () => (A.relogio == null ? Date.now() : A.relogio),
    }, opcoes));
    A.ligar = async (email, senha, D) => {
      const usuario = await A.cliente.entrar(email || 'casa@exemplo.com', senha || 'segredo');
      A.D = N.nuvemLigar(D || N.vazio(), { casa: usuario.id, email: usuario.email, aparelho: nome });
      A.retrato = D ? N.retratoVazio() : N.nuvemRetrato(A.D);
      return A;
    };
    A.guardar = () => { A.gravacoes++; };
    A.rodada = () => Nuvem.rodada(N, A, A.cliente);
    return A;
  }
  const produto = (D) => N.salvarProduto(D, { codigo: 'MP1', tipo: 'mp', nome: 'Camarão', validades: { resfriado: { n: 2, un: 'd' }, congelado: { n: 90, un: 'd' } } }).produto;

  await teste('entrar: confere e-mail, senha e chave, e guarda a sessão', async () => {
    const A = aparelho('A');
    let e = await recusa(A.cliente.entrar('casa@exemplo.com', 'errada'), 'credenciais');
    assert.strictEqual(e.message, 'E-mail ou senha não conferem.');
    assert.strictEqual(e.original, 'Invalid login credentials');
    assert.strictEqual(A.cliente.usuario(), null);
    await recusa(aparelho('X', { chave: 'sb_publishable_errada' }).cliente.entrar('casa@exemplo.com', 'segredo'), 'config');
    await recusa(aparelho('X', { url: 'http://127.0.0.1:9' }).cliente.entrar('casa@exemplo.com', 'segredo'), 'rede');
    srv.pedidos.length = 0;
    const usuario = await A.cliente.entrar('  casa@exemplo.com ', 'segredo');
    assert.strictEqual(usuario.email, 'casa@exemplo.com');
    assert.deepStrictEqual(A.cliente.usuario(), usuario);
    assert.ok(A.gaveta.access_token && A.gaveta.refresh_token && A.gaveta.expira > Date.now(), 'sessão guardada');
    // O pedido de login como o Supabase espera: chave no apikey, nada de Bearer, e-mail e senha no corpo.
    const p = srv.pedidos[0];
    assert.strictEqual(p.caminho, '/auth/v1/token?grant_type=password');
    assert.deepStrictEqual(p.corpo, { email: 'casa@exemplo.com', password: 'segredo' });
    assert.strictEqual(p.cabecalhos.apikey, srv.chave);
    assert.strictEqual(p.cabecalhos.authorization, undefined, 'a chave pública nunca vai como Bearer');
    // Fechar e abrir o app: a sessão guardada continua valendo.
    const reaberto = Nuvem.criar({ url: srv.url, chave: srv.chave, buscar: fetch, ler: () => A.gaveta, gravar: () => {} });
    assert.deepStrictEqual(reaberto.usuario(), usuario);
    assert.strictEqual(await reaberto.reservar('contagem', 1), 1);
  });

  await teste('pedidos ao banco: endereço, cabeçalhos e nomes dos parâmetros', async () => {
    const A = await aparelho('A').ligar();
    srv.pedidos.length = 0;
    assert.strictEqual(await A.cliente.reservar('etiqueta', 10, 5), 5);
    await A.cliente.enviar([{ tipo: 'etiqueta', id: 'e5', campos: { cod: 5 } }]);
    const r = await A.cliente.receber(null, 10);
    assert.deepStrictEqual(srv.pedidos.map((p) => [p.caminho, Object.keys(p.corpo)]),
      [['/rest/v1/rpc/vd_reservar', ['contador', 'quantos', 'minimo']], ['/rest/v1/rpc/vd_enviar', ['mudancas']], ['/rest/v1/rpc/vd_receber', ['desde', 'limite']]]);
    assert.ok(srv.pedidos.every((p) => p.cabecalhos.apikey === srv.chave && p.cabecalhos.authorization === 'Bearer ' + A.gaveta.access_token));
    assert.deepStrictEqual(r.linhas.map((l) => [l.tipo, l.id, l.dados, l.apagado]), [['etiqueta', 'e5', { cod: 5 }, false]]);
    assert.ok(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/.test(r.linhas[0].atualizado_em));
    assert.strictEqual(Nuvem.comFolga('2026-11-16T15:00:40.123456Z'), '2026-11-16T15:00:10.123Z');
    assert.strictEqual(Nuvem.comFolga(''), null);
    // Sem entrar, nenhum pedido sai.
    await recusa(aparelho('X').cliente.enviar([]), 'sessao');
    // Outra casa não vê nada disso.
    const O = await aparelho('O').ligar('outra@exemplo.com', 'outra');
    assert.deepStrictEqual((await O.cliente.receber()).linhas, []);
    assert.strictEqual(await O.cliente.reservar('etiqueta', 10), 1);
  });

  // Daqui em diante, uma casa nova para as contas baterem.
  srv.criarConta('cozinha@exemplo.com', 'panela');
  const A = await aparelho('A').ligar('cozinha@exemplo.com', 'panela');
  const B = await aparelho('B').ligar('cozinha@exemplo.com', 'panela');

  await teste('rodada: reserva números, envia o que mudou e recebe o dos outros', async () => {
    let r = await A.rodada();
    assert.deepStrictEqual(r, { mudou: false, enviadas: 0, recebidas: 0 });
    assert.deepStrictEqual(A.D.nuvem.reservas.etiqueta, [[1, 1000]]);
    A.D.config.casa = 'Cozinha da Vó';
    produto(A.D);
    N.abrirRecebimento(A.D, { fornecedor: 'Pescados Sul', nota: '77' }, AGORA);
    N.emitir(A.D, { produtoId: 'p1', modo: 'resfriado', copias: 3, tempChegada: '3,5' }, AGORA);
    r = await A.rodada();
    assert.deepStrictEqual([r.enviadas, r.mudou], [6, false], 'o eco das próprias mudanças não conta como novidade');
    assert.strictEqual(A.D.nuvem.fila.length, 0);
    assert.ok(A.gravacoes >= 3, 'cada passo fica guardado no aparelho');
    r = await B.rodada();
    assert.deepStrictEqual([r.mudou, r.recebidas], [true, 6]);
    assert.deepStrictEqual([B.D.config.casa, B.D.produtos.length, B.D.etiquetas.map((e) => e.cod), B.D.recebimentos[0].fornecedor], ['Cozinha da Vó', 1, [1, 2, 3], 'Pescados Sul']);
    assert.deepStrictEqual(B.D.nuvem.reservas.etiqueta, [[1001, 2000]]);
    assert.strictEqual(B.D.nuvem.cursor, A.D.nuvem.cursor, 'os dois pararam no mesmo ponto');
    // B dá baixa; A recebe.
    N.darBaixa(B.D, 'e2', { tipo: 'descartada', motivo: 'Vencido', por: 'Ana' }, AGORA);
    assert.deepStrictEqual((await B.rodada()).enviadas, 1);
    assert.strictEqual((await A.rodada()).mudou, true);
    assert.deepStrictEqual([A.D.etiquetas[1].status, A.D.etiquetas[1].motivo], ['descartada', 'Vencido']);
    assert.deepStrictEqual(await A.rodada(), { mudou: false, enviadas: 0, recebidas: 1 }, 'a folga de 30 s repete a última linha, sem efeito');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(srv.linhas('cozinha@exemplo.com')['etiqueta|e2'].dados)), JSON.parse(JSON.stringify(A.D.etiquetas[1])));
  });

  await teste('sessão vencida: renova sozinha e continua', async () => {
    srv.vencerSessoes();
    const antes = A.gaveta.access_token;
    srv.pedidos.length = 0;
    A.D.etiquetas[0].local = 'Freezer';
    const r = await A.rodada();
    assert.strictEqual(r.enviadas, 1);
    assert.notStrictEqual(A.gaveta.access_token, antes, 'sessão nova guardada');
    assert.deepStrictEqual(srv.pedidos.map((p) => p.caminho).slice(0, 3), ['/rest/v1/rpc/vd_enviar', '/auth/v1/token?grant_type=refresh_token', '/rest/v1/rpc/vd_enviar']);
    // Pelo relógio do aparelho a sessão está no fim: renova antes de pedir.
    srv.pedidos.length = 0;
    B.relogio = B.gaveta.expira - 30000;
    await B.rodada();
    assert.strictEqual(srv.pedidos[0].caminho, '/auth/v1/token?grant_type=refresh_token');
    assert.strictEqual(B.D.etiquetas[0].local, 'Freezer');
    B.relogio = null;
  });

  await teste('sem internet: nada se perde, e vai tudo quando a conexão volta', async () => {
    srv.fora = true;
    N.emitir(A.D, { produtoId: 'p1', modo: 'congelado', copias: 2 }, AGORA);
    N.darBaixa(A.D, 'e1', { tipo: 'usada', por: 'José' }, AGORA);
    const e = await recusa(A.rodada(), 'rede');
    assert.ok(/fica guardado no aparelho/.test(e.message));
    assert.strictEqual(A.D.nuvem.fila.length, 3, 'duas etiquetas novas e uma baixa esperando na fila');
    assert.ok(A.cliente.usuario(), 'continua com a sessão');
    assert.deepStrictEqual(A.D.etiquetas.map((x) => x.cod), [1, 2, 3, 4, 5], 'e segue etiquetando com os números reservados');
    srv.fora = false;
    assert.strictEqual((await A.rodada()).enviadas, 3);
    await B.rodada();
    assert.deepStrictEqual([B.D.etiquetas.length, B.D.etiquetas[0].status, B.D.etiquetas[4].modo], [5, 'usada', 'congelado']);
  });

  await teste('mudança feita enquanto a rodada espera a rede vai na mesma rodada', async () => {
    const enviar = A.cliente.enviar;
    let vezes = 0;
    A.cliente.enviar = async (m) => {
      if (++vezes === 1) { A.D.etiquetas[2].qtd = '2 kg'; N.nuvemAnotar(A.D, A.retrato); }   // a pessoa mexe na tela no meio do envio
      return enviar(m);
    };
    A.D.etiquetas[2].local = 'Câmara fria';
    const r = await A.rodada();
    A.cliente.enviar = enviar;
    assert.deepStrictEqual([r.enviadas, vezes, A.D.nuvem.fila.length], [2, 2, 0]);
    await B.rodada();
    assert.deepStrictEqual([B.D.etiquetas[2].local, B.D.etiquetas[2].qtd], ['Câmara fria', '2 kg']);
  });

  await teste('muitas linhas: o aparelho novo recebe tudo', async () => {
    // Etiqueta até a faixa acabar, sincroniza (reserva mais) e repete, até passar de 2000 etiquetas.
    let voltas = 0;
    while (A.D.etiquetas.length < 2300 && voltas++ < 20) {
      while (N.disponiveis(A.D, 'etiqueta') >= 50) N.emitir(A.D, { produtoId: 'p1', modo: 'congelado', copias: 50 }, AGORA);
      await A.rodada();
    }
    assert.ok(A.D.etiquetas.length >= 2300, A.D.etiquetas.length + ' etiquetas');
    assert.strictEqual(new Set(A.D.etiquetas.map((e) => e.cod)).size, A.D.etiquetas.length, 'nenhum número repetido');
    const C = await aparelho('C').ligar('cozinha@exemplo.com', 'panela');
    srv.pedidos.length = 0;
    const r = await C.rodada();
    assert.strictEqual(C.D.etiquetas.length, A.D.etiquetas.length);
    assert.ok(srv.pedidos.filter((p) => p.caminho === '/rest/v1/rpc/vd_receber').length >= 3, 'veio em mais de uma página');
    assert.strictEqual(r.recebidas, Object.keys(srv.linhas('cozinha@exemplo.com')).length);
    assert.deepStrictEqual(C.D.etiquetas[C.D.etiquetas.length - 1], A.D.etiquetas[A.D.etiquetas.length - 1]);
    assert.strictEqual(C.D.nuvem.fila.length, 0, 'receber não gera nada para enviar');
    // E os três aparelhos nunca dão o mesmo número.
    await B.rodada();
    const novos = [A, B, C].map((x) => N.emitir(x.D, { produtoId: 'p1', modo: 'congelado' }, AGORA).etiquetas[0].cod);
    assert.strictEqual(new Set(novos).size, 3, novos.join(', '));
  });

  await teste('ligação desfeita no meio da rodada: ela para sem mexer em nada', async () => {
    const enviar = B.cliente.enviar;
    B.D.etiquetas[0].qtd = '9 kg';
    B.cliente.enviar = async (m) => { const r = await enviar(m); N.nuvemDesligar(B.D); return r; };
    assert.strictEqual(await B.rodada(), null);
    B.cliente.enviar = enviar;
    assert.strictEqual(B.D.nuvem, undefined);
    assert.strictEqual(await B.rodada(), null, 'sem nuvem, a rodada não faz nada');
  });

  await teste('banco não instalado e sessão derrubada: erros que dizem o que fazer', async () => {
    srv.semBanco = true;
    A.D.etiquetas[0].qtd = '7 kg';
    N.nuvemAnotar(A.D, A.retrato);   // o que o app faz a cada mudança
    let e = await recusa(A.rodada(), 'config');
    assert.ok(/se o banco foi instalado/.test(e.message));
    assert.strictEqual(A.D.nuvem.fila.length, 2, 'as mudanças continuam na fila (esta e a etiqueta emitida no teste anterior)');
    srv.semBanco = false;
    srv.derrubarSessoes();
    e = await recusa(A.rodada(), 'sessao');
    assert.strictEqual(e.message, 'A sessão na nuvem terminou. Entre de novo com a conta da casa.');
    assert.strictEqual(A.cliente.usuario(), null);
    assert.strictEqual(A.gaveta, null, 'a sessão guardada é apagada');
    assert.strictEqual(A.D.nuvem.fila.length, 2, 'e os dados continuam no aparelho, esperando');
    // Entrando de novo, segue de onde parou.
    await A.cliente.entrar('cozinha@exemplo.com', 'panela');
    assert.strictEqual((await A.rodada()).enviadas, 2);
    assert.strictEqual(srv.linhas('cozinha@exemplo.com')['etiqueta|e1'].dados.qtd, '7 kg');
  });

  await teste('sair: avisa o servidor e esquece a sessão', async () => {
    srv.pedidos.length = 0;
    await A.cliente.sair();
    assert.strictEqual(srv.pedidos[0].caminho, '/auth/v1/logout?scope=local');
    assert.strictEqual(A.cliente.usuario(), null);
    await recusa(A.rodada(), 'sessao');
    // Sem conexão, sair também funciona (o que importa é esquecer a sessão no aparelho).
    const D2 = await aparelho('D').ligar('cozinha@exemplo.com', 'panela');
    srv.fora = true;
    await D2.cliente.sair();
    srv.fora = false;
    assert.strictEqual(D2.cliente.usuario(), null);
  });

  await srv.fechar();
  console.log(`\n${n} testes passaram.`);
})().catch((e) => { console.error(e); process.exit(1); });
