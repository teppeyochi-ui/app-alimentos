/*
 * nuvem.js — Conversa com a nuvem (Supabase), sem biblioteca: o login da casa e as três funções do
 * banco (supabase/instalar.sql). As regras de o que enviar e como juntar o que chega ficam em core.js;
 * aqui só se fala com o servidor. Funciona no navegador (window.Nuvem) e no Node (testes).
 *
 * Endereços usados (os mesmos da biblioteca oficial do Supabase):
 *   POST {url}/auth/v1/token?grant_type=password        entrar com e-mail e senha
 *   POST {url}/auth/v1/token?grant_type=refresh_token   renovar a sessão
 *   POST {url}/auth/v1/logout?scope=local               sair
 *   POST {url}/rest/v1/rpc/vd_enviar | vd_receber | vd_reservar
 * Todo pedido leva a chave pública no cabeçalho "apikey"; os do banco levam também a sessão em
 * "Authorization: Bearer". A chave pública nunca vai como Bearer.
 */
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.Nuvem = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /*
   * tipo diz o que fazer com o erro:
   *   'rede'         sem conexão ou servidor fora do ar: os dados ficam no aparelho e tenta-se de novo depois
   *   'sessao'       a sessão terminou: é preciso entrar de novo
   *   'credenciais'  e-mail ou senha errados
   *   'config'       endereço ou chave errados, ou o banco ainda não foi instalado
   *   'servidor'     o servidor recusou o pedido (a mensagem diz por quê)
   */
  class ErroNuvem extends Error {
    constructor(tipo, mensagem, extra) {
      super(mensagem);
      this.name = 'ErroNuvem';
      this.tipo = tipo;
      Object.assign(this, extra);
    }
  }

  function classificar(status, codigo, msg, caminho) {
    const login = caminho.indexOf('grant_type=password') >= 0;
    const renovacao = caminho.indexOf('grant_type=refresh_token') >= 0;
    if (status >= 500 || status === 408 || status === 429) return 'rede';
    if (/invalid api key|no api key/i.test(msg)) return 'config';
    if (login) return 'credenciais';
    if (renovacao) return 'sessao';
    if (status === 404 || codigo === 'PGRST202' || codigo === '42883') return 'config';   // função não existe: banco não instalado
    if (status === 401 || status === 403 || /^PGRST30\d$/.test(codigo) || codigo === '28000' || /jwt/i.test(msg)) return 'sessao';
    return 'servidor';
  }

  const MENSAGEM = {
    rede: 'Sem conexão com a nuvem. O que foi feito fica guardado no aparelho e é enviado quando a conexão voltar.',
    sessao: 'A sessão na nuvem terminou. Entre de novo com a conta da casa.',
    credenciais: 'E-mail ou senha não conferem.',
    config: 'A nuvem não respondeu como esperado: confira o endereço e a chave, e se o banco foi instalado (supabase/instalar.sql).',
  };

  /*
   * o: {
   *   url, chave   endereço do projeto e chave pública
   *   buscar       fetch
   *   ler(), gravar(sessao | null)   onde a sessão fica guardada entre uma abertura e outra
   *   agora()      relógio, em ms
   * }
   */
  function criar(o) {
    const base = String(o.url || '').trim().replace(/\/+$/, '');
    const agora = o.agora || (() => Date.now());
    let sessao = (o.ler && o.ler()) || null;   // { access_token, refresh_token, expira (ms), usuario: { id, email } }
    let renovando = null;

    async function pedir(caminho, corpo, token) {
      let resp;
      try {
        resp = await o.buscar(base + caminho, {
          method: 'POST',
          headers: Object.assign({ 'Content-Type': 'application/json', apikey: o.chave }, token ? { Authorization: 'Bearer ' + token } : {}),
          body: JSON.stringify(corpo == null ? {} : corpo),
        });
      } catch (e) {
        throw new ErroNuvem('rede', MENSAGEM.rede);
      }
      let dados = null;
      try { const txt = await resp.text(); dados = txt ? JSON.parse(txt) : null; } catch (e) { dados = null; }
      if (resp.ok) return dados;
      const original = String((dados && (dados.msg || dados.message || dados.error_description || dados.error)) || 'Erro ' + resp.status);
      const codigo = String((dados && (dados.error_code || dados.code)) || '');
      const tipo = classificar(resp.status, codigo, original, caminho);
      throw new ErroNuvem(tipo, MENSAGEM[tipo] || original, { status: resp.status, codigo, original });
    }

    function guardar(d) {
      sessao = d
        ? {
          access_token: d.access_token, refresh_token: d.refresh_token,
          expira: agora() + (d.expires_in > 0 ? d.expires_in : 3600) * 1000,
          usuario: d.user && d.user.id ? { id: d.user.id, email: d.user.email || '' } : sessao && sessao.usuario,
        }
        : null;
      if (o.gravar) o.gravar(sessao);
    }

    async function entrar(email, senha) {
      const d = await pedir('/auth/v1/token?grant_type=password', { email: String(email || '').trim(), password: String(senha || '') });
      if (!d || !d.access_token || !d.refresh_token || !d.user || !d.user.id) throw new ErroNuvem('config', MENSAGEM.config);
      guardar(d);
      return sessao.usuario;
    }

    // Renova a sessão. Vários pedidos ao mesmo tempo esperam a mesma renovação.
    function renovar() {
      if (!sessao) return Promise.reject(new ErroNuvem('sessao', MENSAGEM.sessao));
      if (!renovando) {
        renovando = (async () => {
          try {
            const d = await pedir('/auth/v1/token?grant_type=refresh_token', { refresh_token: sessao.refresh_token });
            if (!d || !d.access_token || !d.refresh_token) throw new ErroNuvem('sessao', MENSAGEM.sessao);
            guardar(d);
          } catch (e) {
            if (e.tipo !== 'rede') guardar(null);   // sem conexão a sessão continua: tenta de novo depois
            throw e;
          } finally {
            renovando = null;
          }
        })();
      }
      return renovando;
    }

    async function rpc(nome, args) {
      if (!sessao) throw new ErroNuvem('sessao', MENSAGEM.sessao);
      if (sessao.expira - agora() < 60000) await renovar();
      try {
        return await pedir('/rest/v1/rpc/' + nome, args, sessao.access_token);
      } catch (e) {
        // O servidor achou a sessão vencida antes do relógio daqui: renova uma vez e repete.
        if (e.tipo !== 'sessao' || !sessao) throw e;
        await renovar();
        return pedir('/rest/v1/rpc/' + nome, args, sessao.access_token);
      }
    }

    async function sair() {
      const token = sessao && sessao.access_token;
      guardar(null);
      if (token) { try { await pedir('/auth/v1/logout?scope=local', {}, token); } catch (e) { /* já saiu deste aparelho, que é o que importa */ } }
    }

    return {
      entrar,
      sair,
      usuario: () => (sessao ? sessao.usuario : null),
      enviar: (mudancas) => rpc('vd_enviar', { mudancas }),
      receber: (desde, limite) => rpc('vd_receber', { desde: desde || null, limite: limite || 1000 }),
      reservar: (contador, quantos, minimo) => rpc('vd_reservar', { contador, quantos, minimo: minimo || 1 }),
    };
  }

  // De onde pedir as novidades: 30 segundos antes do último carimbo visto. Uma mudança gravada no servidor
  // ao mesmo tempo que a anterior pode ter carimbo um pouco menor; repetir esse pedaço não custa nada.
  function comFolga(cursor) {
    const t = Date.parse(cursor || '');
    return isNaN(t) ? null : new Date(t - 30000).toISOString();
  }

  const PAGINA = 1000;

  /*
   * Uma rodada de sincronização: reserva números se estiverem acabando, envia a fila, recebe as novidades.
   *   N         o núcleo (core.js)
   *   estado    { D, retrato, guardar() } — D é lido de novo a cada passo: a tela pode mexer nos dados
   *             enquanto se espera a rede (e pode até desligar a nuvem ou trocar D por outro)
   *   cliente   o que criar() devolve
   * Devolve { mudou, enviadas, recebidas } ou null se a ligação foi desfeita no meio do caminho.
   */
  async function rodada(N, estado, cliente) {
    const D0 = estado.D;
    const valendo = () => estado.D === D0 && !!D0.nuvem;
    if (!valendo()) return null;

    const pedidos = N.nuvemAReservar(D0);
    for (let i = 0; i < pedidos.length; i++) {
      const r = pedidos[i];
      const primeiro = await cliente.reservar(r.contador, r.quantos, r.minimo);
      if (!valendo()) return null;
      if (!N.nuvemReservado(D0, r.contador, primeiro, r.quantos)) throw new ErroNuvem('config', MENSAGEM.config);
      estado.guardar();
    }

    N.nuvemAnotar(D0, estado.retrato);
    let enviadas = 0;
    while (D0.nuvem.fila.length) {
      const lote = N.nuvemLote(D0, 500);
      await cliente.enviar(lote.mudancas);
      if (!valendo()) return null;
      N.nuvemEnviado(D0, lote.n);
      enviadas += lote.n;
      estado.guardar();
    }

    let desde = comFolga(D0.nuvem.cursor);
    let mudou = false;
    let recebidas = 0;
    for (;;) {
      const r = await cliente.receber(desde, PAGINA);
      if (!valendo()) return null;
      const linhas = (r && Array.isArray(r.linhas)) ? r.linhas : [];
      recebidas += linhas.length;
      if (N.nuvemReceber(D0, estado.retrato, linhas)) mudou = true;
      if (linhas.length < PAGINA) break;
      desde = linhas[linhas.length - 1].atualizado_em;
    }
    estado.guardar();
    return { mudou, enviadas, recebidas };
  }

  return { ErroNuvem, MENSAGEM, criar, rodada, comFolga };
});
