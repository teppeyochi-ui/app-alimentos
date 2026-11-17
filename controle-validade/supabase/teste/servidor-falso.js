/*
 * Supabase de mentira, para os testes: um servidor HTTP que responde como o login e as três funções
 * do banco, com a mesma regra do supabase/instalar.sql (uma linha por registro, campos juntados,
 * carimbo crescente, faixas de números, cada casa só com as suas linhas).
 *
 * As respostas de erro copiam o formato do Supabase de verdade (GoTrue e PostgREST):
 *   login errado            400 { error_code: 'invalid_credentials', msg }
 *   sessão para renovar     400 { error_code: 'refresh_token_not_found', msg }
 *   chave pública errada    401 { message: 'Invalid API key' }
 *   sessão vencida          401 { code: 'PGRST301', message: 'JWT expired' }
 *   função que não existe   404 { code: 'PGRST202', message }
 *
 *   const srv = await criarServidorFalso();   // srv.url, srv.chave
 *   srv.criarConta('casa@exemplo.com', 'senha');
 */
'use strict';
const http = require('http');

function criarServidorFalso() {
  const chave = 'sb_publishable_teste';
  const contas = {};      // email → { id, senha }
  const sessoes = {};     // access_token → { casa, vence (ms, relógio de verdade) }
  const renovacoes = {};  // refresh_token → casa
  const casas = {};       // id → { linhas: { 'tipo|id': linha }, contadores: {} }
  let serie = 0;
  let relogio = 0;
  const srv = {
    chave,
    fora: false,          // true: derruba a conexão, como se não houvesse internet
    semBanco: false,      // true: as funções não existem (instalar.sql ainda não foi rodado)
    pedidos: [],          // { caminho, corpo, cabecalhos } de cada pedido atendido
    casas,
  };
  // Cada envio acontece um minuto depois do anterior; dentro do envio, cada linha um microssegundo depois.
  let minuto = 0;
  const carimbo = () => new Date(Date.UTC(2026, 10, 16, 15, 0, 0) + minuto * 60000).toISOString().slice(0, 19) + '.' + String(++relogio % 1e6).padStart(6, '0') + 'Z';
  // O banco de verdade guarda os campos em outra ordem (jsonb): chaves mais curtas primeiro, depois alfabética.
  const comoJsonb = (v) => {
    if (Array.isArray(v)) return v.map(comoJsonb);
    if (!v || typeof v !== 'object') return v;
    const o = {};
    Object.keys(v).sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0)).forEach((k) => { o[k] = comoJsonb(v[k]); });
    return o;
  };
  const casaDe = (id) => casas[id] || (casas[id] = { linhas: {}, contadores: {} });

  srv.criarConta = (email, senha) => {
    const id = '00000000-0000-4000-8000-' + String(Object.keys(contas).length + 1).padStart(12, '0');
    contas[email] = { id, senha };
    casaDe(id);
    return id;
  };
  // Vence todas as sessões em uso (o servidor passa a responder "JWT expired" até o aparelho renovar).
  srv.vencerSessoes = () => { Object.keys(sessoes).forEach((t) => { sessoes[t].vence = 0; }); };
  // Invalida também a renovação: o aparelho precisa entrar de novo.
  srv.derrubarSessoes = () => { srv.vencerSessoes(); Object.keys(renovacoes).forEach((t) => { delete renovacoes[t]; }); };
  srv.linhas = (email) => casaDe(contas[email].id).linhas;

  function abrirSessao(casa, email) {
    const n = ++serie;
    sessoes['acesso-' + n] = { casa, vence: Date.now() + 3600e3 };
    renovacoes['renova-' + n] = casa;
    return { access_token: 'acesso-' + n, token_type: 'bearer', expires_in: 3600, refresh_token: 'renova-' + n, user: { id: casa, email } };
  }

  const FUNCOES = {
    vd_enviar(casa, a) {
      if (!Array.isArray(a.mudancas)) return [400, { code: '22023', message: 'mudancas deve ser uma lista.' }];
      const TIPOS = ['produto', 'etiqueta', 'recebimento', 'contagem', 'config'];
      if (a.mudancas.some((m) => !m || TIPOS.indexOf(m.tipo) < 0 || !m.id || (m.campos && typeof m.campos !== 'object'))) return [400, { code: '22023', message: 'Mudança mal formada.' }];
      minuto++;
      relogio = 0;
      a.mudancas.forEach((m) => {
        const k = m.tipo + '|' + m.id;
        const l = casa.linhas[k] || (casa.linhas[k] = { tipo: m.tipo, id: String(m.id), dados: {}, apagado: false });
        Object.assign(l.dados, m.campos || {});
        if (m.apagado != null) l.apagado = !!m.apagado;
        l.atualizado_em = carimbo();
      });
      return [200, carimbo()];
    },
    vd_receber(casa, a) {
      const desde = a.desde ? new Date(a.desde).getTime() : null;
      const limite = Math.min(Math.max(a.limite || 1000, 1), 5000);
      // O carimbo tem microssegundos; a comparação é feita no texto quando o pedido vem com eles.
      const depois = (l) => desde == null || (/\.\d{6}Z$/.test(a.desde) ? l.atualizado_em > a.desde : new Date(l.atualizado_em).getTime() > desde);
      const linhas = Object.keys(casa.linhas).map((k) => casa.linhas[k]).filter(depois)
        .sort((x, y) => (x.atualizado_em < y.atualizado_em ? -1 : x.atualizado_em > y.atualizado_em ? 1 : 0)).slice(0, limite)
        .map((l) => Object.assign({}, l, { dados: comoJsonb(l.dados) }));
      return [200, { agora: carimbo(), linhas }];
    },
    vd_reservar(casa, a) {
      if (!(a.quantos >= 1 && a.quantos <= 5000) || ['etiqueta', 'produto', 'recebimento', 'contagem'].indexOf(a.contador) < 0) return [400, { code: '22023', message: 'pedido de reserva inválido' }];
      const primeiro = Math.max(casa.contadores[a.contador] || 1, a.minimo || 1);
      casa.contadores[a.contador] = primeiro + a.quantos;
      return [200, primeiro];
    },
  };

  const servidor = http.createServer((req, res) => {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'apikey, authorization, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
    if (srv.fora) { req.socket.destroy(); return; }
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
    let bruto = '';
    req.on('data', (c) => { bruto += c; });
    req.on('end', () => {
      const responder = (status, corpo) => {
        res.writeHead(status, Object.assign({ 'Content-Type': 'application/json' }, cors));
        res.end(corpo === undefined ? '' : JSON.stringify(corpo));
      };
      let corpo = {};
      try { corpo = bruto ? JSON.parse(bruto) : {}; } catch (e) { responder(400, { message: 'corpo inválido' }); return; }
      const url = new URL(req.url, 'http://x');
      srv.pedidos.push({ caminho: url.pathname + url.search, corpo, cabecalhos: req.headers });
      if (req.headers.apikey !== chave) { responder(401, { message: 'Invalid API key', hint: 'Double check your Supabase `anon` or `service_role` API key.' }); return; }

      if (url.pathname === '/auth/v1/token') {
        const tipo = url.searchParams.get('grant_type');
        if (tipo === 'password') {
          const conta = contas[corpo.email];
          if (!conta || conta.senha !== corpo.password) { responder(400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' }); return; }
          responder(200, abrirSessao(conta.id, corpo.email));
          return;
        }
        if (tipo === 'refresh_token') {
          const casa = renovacoes[corpo.refresh_token];
          if (!casa) { responder(400, { code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token: Refresh Token Not Found' }); return; }
          delete renovacoes[corpo.refresh_token];
          const email = Object.keys(contas).find((e) => contas[e].id === casa);
          responder(200, abrirSessao(casa, email));
          return;
        }
        responder(400, { code: 400, error_code: 'invalid_request', msg: 'unsupported_grant_type' });
        return;
      }
      if (url.pathname === '/auth/v1/logout') {
        const token = String(req.headers.authorization || '').replace(/^Bearer /, '');
        delete sessoes[token];
        responder(204);
        return;
      }
      const m = /^\/rest\/v1\/rpc\/(\w+)$/.exec(url.pathname);
      if (m) {
        const token = String(req.headers.authorization || '').replace(/^Bearer /, '');
        const s = sessoes[token];
        if (!s || s.vence < Date.now()) { responder(401, { code: 'PGRST301', details: null, hint: null, message: 'JWT expired' }); return; }
        if (srv.semBanco || !FUNCOES[m[1]]) { responder(404, { code: 'PGRST202', details: 'Searched for the function public.' + m[1], hint: null, message: 'Could not find the function public.' + m[1] + ' in the schema cache' }); return; }
        const r = FUNCOES[m[1]](casaDe(s.casa), corpo);
        responder(r[0], r[1]);
        return;
      }
      responder(404, { message: 'não existe' });
    });
  });

  return new Promise((ok) => {
    servidor.listen(0, '127.0.0.1', () => {
      srv.url = 'http://127.0.0.1:' + servidor.address().port;
      srv.fechar = () => new Promise((fim) => { servidor.closeAllConnections && servidor.closeAllConnections(); servidor.close(fim); });
      ok(srv);
    });
  });
}

module.exports = { criarServidorFalso };
