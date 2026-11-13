// Servidor de teste: um PostgreSQL temporário com as migrações de verdade e,
// na frente dele, uma API HTTP que imita só os endereços do Supabase que o
// aplicativo usa (login, tabelas, salvar_op e fotos). Assim o teste de
// navegador exercita as políticas de acesso e a função salvar_op reais.
'use strict';

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const RAIZ = path.resolve(__dirname, '..', '..');
const SENHA = 'teste1234';
const USUARIOS = [
  { id: '11111111-1111-4111-8111-111111111111', email: 'admin@teste.com', nome: 'Ana Admin', papel: 'admin', ativo: true },
  { id: '22222222-2222-4222-8222-222222222222', email: 'pd@teste.com', nome: 'Paulo P&D', papel: 'pd', ativo: true },
  { id: '33333333-3333-4333-8333-333333333333', email: 'operador@teste.com', nome: 'Olga Operadora', papel: 'operador', ativo: true },
  { id: '44444444-4444-4444-8444-444444444444', email: 'novo@teste.com', nome: 'Nino Novo', papel: 'operador', ativo: false },
  { id: '55555555-5555-4555-8555-555555555555', email: 'gestor@teste.com', nome: 'Gil Gestor', papel: 'gestor', ativo: true },
];

function acharBinarios() {
  const noPath = spawnSync('sh', ['-c', 'command -v initdb']).stdout.toString().trim();
  if (noPath) return path.dirname(noPath);
  const base = '/usr/lib/postgresql';
  const versoes = fs.existsSync(base) ? fs.readdirSync(base).sort((a, b) => Number(a) - Number(b)) : [];
  if (!versoes.length) throw new Error('PostgreSQL não encontrado (initdb).');
  return path.join(base, versoes[versoes.length - 1], 'bin');
}

/** Sobe um PostgreSQL temporário com as migrações, a carga inicial e os usuários de teste. */
function subirBanco() {
  const bin = acharBinarios();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'diario-skin-'));
  const porta = 20000 + Math.floor(Math.random() * 20000);
  const raiz = process.getuid && process.getuid() === 0;
  if (raiz) execFileSync('chown', ['postgres', dir]);
  const como = (cmd, args) => (raiz ? execFileSync('runuser', ['-u', 'postgres', '--', cmd, ...args]) : execFileSync(cmd, args));
  como(path.join(bin, 'initdb'), ['-D', path.join(dir, 'dados'), '-U', 'postgres', '--auth=trust', '-E', 'UTF8', '--locale=C']);
  como(path.join(bin, 'pg_ctl'), ['-D', path.join(dir, 'dados'), '-o', `-p ${porta} -k ${dir} -c listen_addresses=''`, '-l', path.join(dir, 'log'), '-w', 'start']);

  const base = ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-h', dir, '-p', String(porta), '-U', 'postgres', '-d', 'postgres'];
  const psql = path.join(bin, 'psql');
  const arquivo = (f) => execFileSync(psql, [...base, '-f', f]);
  /** Roda SQL como superusuário (para preparar e conferir). */
  const sql = (comando) => execFileSync(psql, [...base, '-c', comando]).toString().trim();
  /** Roda SQL como o usuário logado, com as políticas de acesso valendo. Devolve { saida } ou { erro: { code, message } }. */
  const sqlComo = (uid, comando) => {
    const texto = `begin; set local role authenticated; do $x$ begin perform set_config('request.jwt.claim.sub', '${uid}', true); end $x$; ${comando}; commit;`;
    const r = spawnSync(psql, [...base, '-c', texto]);
    if (r.status === 0) return { saida: r.stdout.toString().trim() };
    const m = /ERROR:\s+([0-9A-Z]{5}):\s+(.*)/.exec(r.stderr.toString());
    return { erro: { code: m ? m[1] : 'XX000', message: m ? m[2] : r.stderr.toString() } };
  };

  arquivo(path.join(RAIZ, 'testes/sql/supabase-local.sql'));
  arquivo(path.join(RAIZ, 'supabase/instalar.sql'));
  sql('alter table storage.objects add constraint objeto_unico unique (bucket_id, name)');
  for (const u of USUARIOS) {
    sql(`insert into auth.users (id, email, raw_user_meta_data) values ('${u.id}', '${u.email}', '${JSON.stringify({ nome: u.nome })}')`);
    sql(`update public.perfis set papel = '${u.papel}', ativo = ${u.ativo} where id = '${u.id}'`);
  }

  const parar = () => {
    try { como(path.join(bin, 'pg_ctl'), ['-D', path.join(dir, 'dados'), '-m', 'immediate', 'stop']); } catch { /* já parado */ }
    fs.rmSync(dir, { recursive: true, force: true });
  };
  return { sql, sqlComo, parar };
}

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = (u) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: u.id, email: u.email, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.assinatura`;
const usuarioDoToken = (cabecalho) => {
  try {
    const sub = JSON.parse(Buffer.from((cabecalho || '').replace(/^Bearer /, '').split('.')[1], 'base64url').toString()).sub;
    return USUARIOS.find((u) => u.id === sub) || null;
  } catch { return null; }
};
const usuarioAuth = (u) => ({
  id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, app_metadata: {}, user_metadata: { nome: u.nome },
  created_at: '2026-11-01T00:00:00Z', email_confirmed_at: '2026-11-01T00:00:00Z',
});
const sessao = (u) => ({
  access_token: token(u), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
  refresh_token: 'renovar-' + u.id, user: usuarioAuth(u),
});

const lit = (v) => `'${String(v).replace(/'/g, "''")}'`;
const SELECAO_OPS = `select o.*,
  (select coalesce(json_agg(json_build_object('motivo', r.motivo, 'quantidade', r.quantidade)), '[]'::json) from public.op_retrabalho r where r.op_id = o.id) as op_retrabalho,
  (select coalesce(json_agg(json_build_object('id', p.id, 'motivo', p.motivo, 'minutos', p.minutos)), '[]'::json) from public.op_paradas p where p.op_id = o.id) as op_paradas,
  (select coalesce(json_agg(json_build_object('id', f.id, 'tipo', f.tipo, 'caminho', f.caminho, 'tela_numero', f.tela_numero, 'criado_em', f.criado_em)), '[]'::json) from public.op_fotos f where f.op_id = o.id) as op_fotos
  from public.ops o`;
const ORDEM = { produtos: 'codigo', moldes: 'molde', receitas_padrao: 'vigente_desde', perfis: 'nome' };

/** API que imita o Supabase na frente do banco. Devolve o servidor HTTP e contadores de chamadas. */
function subirApi(banco, porta) {
  const chamadas = { salvar_op: 0, fotos: 0, baixar_ops: 0, ler_telas: 0, analisar_op: 0, ultimaAnalise: null };
  // Com a rede "cortada", toda conexão é derrubada sem resposta (como sinal que cai).
  let cortada = false;
  const ler = (req) => new Promise((ok) => { const partes = []; req.on('data', (d) => partes.push(d)); req.on('end', () => ok(Buffer.concat(partes))); });

  const servidor = http.createServer(async (req, res) => {
    if (cortada) { req.socket.destroy(); return; }
    const url = new URL(req.url, 'http://x');
    const caminho = decodeURIComponent(url.pathname);
    const q = url.searchParams;
    const responder = (status, corpo) => {
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*',
        'Access-Control-Expose-Headers': '*',
      });
      res.end(corpo === undefined ? '' : typeof corpo === 'string' ? corpo : JSON.stringify(corpo));
    };
    if (req.method === 'OPTIONS') return responder(204);
    const corpo = await ler(req);
    const texto = () => corpo.toString('utf8');

    // ---------------------------------------------------------------- login
    if (caminho === '/auth/v1/token') {
      const dados = JSON.parse(texto() || '{}');
      const u = q.get('grant_type') === 'password'
        ? USUARIOS.find((x) => x.email === dados.email && dados.password === SENHA)
        : USUARIOS.find((x) => 'renovar-' + x.id === dados.refresh_token);
      return u ? responder(200, sessao(u)) : responder(400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
    }
    if (caminho === '/auth/v1/logout') return responder(204);

    // Endereço assinado de foto: abre sem login, como no Supabase (o token vai no próprio endereço).
    if (req.method === 'GET' && /^\/storage\/v1\/object\/sign\/fotos-op\//.test(caminho) && q.get('token')) {
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Access-Control-Allow-Origin': '*' });
      return res.end(Buffer.from('foto-de-teste'));
    }

    const u = usuarioDoToken(req.headers.authorization);
    if (caminho === '/auth/v1/user') return u ? responder(200, usuarioAuth(u)) : responder(401, { msg: 'sem sessão' });
    if (!u) return responder(401, { code: 'PGRST301', message: 'JWT ausente' });

    const comoUsuario = (comando) => {
      const r = banco.sqlComo(u.id, comando);
      if (r.erro) { responder(r.erro.code === '42501' ? 403 : 400, r.erro); return null; }
      return r.saida;
    };

    // ---------------------------------------------------------------- tabelas e funções
    const tabela = /^\/rest\/v1\/(produtos|moldes|receitas_padrao|perfis)$/.exec(caminho);
    if (tabela && req.method === 'GET') {
      const filtro = q.get('id') ? ` where id = ${lit(q.get('id').replace(/^eq\./, ''))}` : '';
      const saida = comoUsuario(`select coalesce(json_agg(t order by ${ORDEM[tabela[1]]}), '[]'::json) from (select * from public.${tabela[1]}${filtro}) t`);
      return saida === null ? undefined : responder(200, saida);
    }
    if (caminho === '/rest/v1/ops' && req.method === 'GET') {
      chamadas.baixar_ops++;
      const filtros = [];
      if (q.get('id')) filtros.push(`o.id = ${lit(q.get('id').replace(/^eq\./, ''))}`);
      if (q.get('sincronizado_em')) filtros.push(`o.sincronizado_em > ${lit(q.get('sincronizado_em').replace(/^gt\./, ''))}`);
      const saida = comoUsuario(
        `select coalesce(json_agg(x), '[]'::json) from (${SELECAO_OPS}${filtros.length ? ' where ' + filtros.join(' and ') : ''}
         order by o.sincronizado_em, o.id offset ${Number(q.get('offset') || 0)} limit ${Number(q.get('limit') || 1000)}) x`,
      );
      return saida === null ? undefined : responder(200, saida);
    }
    if (caminho === '/rest/v1/ops_historico' && req.method === 'GET') {
      const saida = comoUsuario(
        `select coalesce(json_agg(h order by h.id), '[]'::json) from (
           select id, op_id, em, ate, por, criou, mudancas from public.ops_historico
           where op_id = ${lit((q.get('op_id') || '').replace(/^eq\./, ''))}) h`,
      );
      return saida === null ? undefined : responder(200, saida);
    }
    if (caminho === '/rest/v1/rpc/salvar_op') {
      chamadas.salvar_op++;
      const saida = comoUsuario(`select public.salvar_op($corpo$${JSON.stringify(JSON.parse(texto()).p)}$corpo$::jsonb)`);
      return saida === null ? undefined : responder(200, saida);
    }
    if (caminho === '/rest/v1/rpc/usuario_ativo') {
      const saida = comoUsuario('select public.usuario_ativo()');
      return saida === null ? undefined : responder(200, saida === 't' ? 'true' : 'false');
    }
    if (caminho === '/rest/v1/perfis' && req.method === 'PATCH') {
      const d = JSON.parse(texto());
      const saida = comoUsuario(`update public.perfis set nome = ${lit(d.nome)}, papel = ${lit(d.papel)}, ativo = ${d.ativo === true} where id = ${lit(q.get('id').replace(/^eq\./, ''))}`);
      return saida === null ? undefined : responder(204);
    }

    // ---------------------------------------------------------------- funções de IA (respostas fixas, sem modelo)
    if (caminho === '/functions/v1/ler-telas' && req.method === 'POST') {
      chamadas.ler_telas++;
      const fotos = JSON.parse(texto()).fotos ?? [];
      return responder(200, { telas: fotos.map(() => 417), valores: { t_dome: 225, t_pre: 110, sp: 40 }, duvidas: '' });
    }
    if (caminho === '/functions/v1/analisar-op' && req.method === 'POST') {
      chamadas.analisar_op++;
      chamadas.ultimaAnalise = JSON.parse(texto());
      return responder(200, {
        nota_aparencia: 7.5,
        defeitos: [{ tipo: 'ruga', gravidade: 'leve', descricao: 'ruga pequena no canto inferior' }],
        diagnostico: 'Filme bem aderido ao produto, com uma ruga leve num canto.',
        sugestoes: [{ parametro: 't2', acao: 'aumentar', valor_sugerido: 1.2, motivo: 'mais tempo de aquecimento ajuda o filme a moldar o canto' }],
        confianca: 'media',
        limitacoes: '',
      });
    }

    // ---------------------------------------------------------------- fotos
    const objeto = /^\/storage\/v1\/object\/fotos-op\/(.+)$/.exec(caminho);
    if (objeto && req.method === 'POST') {
      chamadas.fotos++;
      const r = banco.sqlComo(u.id, `insert into storage.objects (bucket_id, name) values ('fotos-op', ${lit(objeto[1])})`);
      if (r.erro && r.erro.code === '23505') return responder(400, { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' });
      if (r.erro) return responder(400, { statusCode: '403', error: 'Unauthorized', message: r.erro.message });
      return responder(200, { Key: 'fotos-op/' + objeto[1], Id: objeto[1] });
    }
    if (/^\/storage\/v1\/object\/sign\/fotos-op\//.test(caminho)) return responder(200, { signedURL: caminho.replace('/storage/v1', '') + '?token=teste' });
    if (caminho === '/storage/v1/object/fotos-op' && req.method === 'DELETE') return responder(200, []);

    responder(404, { message: 'Endereço não imitado: ' + req.method + ' ' + caminho });
  });
  const cortarRede = (sim) => { cortada = sim; };
  return new Promise((ok) => servidor.listen(porta, '127.0.0.1', () => ok({ servidor, chamadas, cortarRede })));
}

module.exports = { subirBanco, subirApi, USUARIOS, SENHA };
