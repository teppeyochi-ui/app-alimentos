// Sincronização com o servidor: envia as OPs e fotos pendentes, depois baixa
// o que mudou. Pode ser interrompida e repetida à vontade: os identificadores
// nascem no aparelho e o servidor grava por identificador, então reenviar não duplica.

import { bancoLocal } from './banco-local';
import {
  avisar, definirSync, descarregar, lerEstado, lerServidor, marcarEnviada, marcarErroOp, marcarFotoEnviada,
  receberCadastros, receberOps, registrarAoAlterar, revisaoDe, definirPerfil,
} from './loja';
import { classificar, type ErroServidor, type Servidor } from './servidor';
import type { OpLocal } from './tipos';

/** O servidor pode ter gravações que terminaram um pouco fora de ordem: relê os últimos 2 minutos. */
const MARGEM_MS = 2 * 60 * 1000;
const INTERVALO_CADASTROS_MS = 5 * 60 * 1000;
const INTERVALO_MS = 60 * 1000;

let emCurso: Promise<void> | null = null;
let pedidoDurante = false;
let relogio: ReturnType<typeof setTimeout> | undefined;
let tentativas = 0;
let ultimoCadastros = 0;
let temSessao: () => Promise<boolean> = async () => true;

export function definirVerificadorDeSessao(f: () => Promise<boolean>): void {
  temSessao = f;
}

/** Agenda uma sincronização (as alterações esperam ~2 s para ir juntas). */
export function agendarSincronizacao(ms = 2000): void {
  if (!lerServidor()) return;
  clearTimeout(relogio);
  relogio = setTimeout(() => void sincronizar(), ms);
}

const rotulo = (op: OpLocal): string => `${op.produto_descricao || 'OP sem produto'}${op.op ? ' · OP ' + op.op : ''}`;

async function enviarOps(servidor: Servidor): Promise<void> {
  const pendentes = lerEstado().ops.filter((o) => o._sujo);
  for (const op of pendentes) {
    const revisao = revisaoDe(op.id);
    let resultado;
    try {
      resultado = await servidor.salvarOp(op);
    } catch (e) {
      const erro = classificar(e);
      if (erro.tipo === 'rede' || erro.tipo === 'sessao') throw erro;
      if (erro.tipo === 'permissao') {
        await resolverRecusa(servidor, op, revisao);
      } else {
        // Dado que o servidor não aceita: não trava a fila; fica marcado para o usuário ver.
        marcarErroOp(op.id, erro.message);
      }
      continue;
    }

    if (resultado === 'ignorada') {
      // O servidor tem uma edição mais nova desta OP: fica valendo a de lá.
      const doServidor = await servidor.baixarOp(op.id);
      if (doServidor && revisaoDe(op.id) === revisao) {
        await receberOps([doServidor], true);
        avisar(`${rotulo(op)}: havia uma edição mais recente no servidor; ficou valendo a de lá.`);
      }
      continue;
    }

    marcarErroOp(op.id, null);
    await marcarEnviada(op, revisao);
    if (op._fotos_removidas.length) {
      // Melhor esforço: o registro já saiu; se o arquivo ficar, só ocupa espaço.
      servidor.apagarFotos(op._fotos_removidas.map((f) => `${op.id}/${f}.jpg`)).catch(() => {});
    }
  }
}

/** O servidor recusou a gravação por permissão (ex.: operador alterando OP já encerrada). */
async function resolverRecusa(servidor: Servidor, op: OpLocal, revisao: number): Promise<void> {
  const doServidor = await servidor.baixarOp(op.id);
  if (doServidor && revisaoDe(op.id) === revisao) {
    const mudou = await receberOps([doServidor], true);
    marcarErroOp(op.id, null);
    if (mudou) avisar(`${rotulo(op)}: não pôde ser alterada (já encerrada ou sem permissão). Ficou valendo a versão do servidor.`, 'erro');
    return;
  }
  marcarErroOp(op.id, 'Seu usuário não tem permissão para gravar esta OP. Fale com o administrador.');
}

async function enviarFotos(servidor: Servidor): Promise<void> {
  const fotos = (await bancoLocal.todasFotos()).filter((f) => !f.enviada);
  for (const f of fotos) {
    const op = lerEstado().ops.find((o) => o.id === f.op_id);
    if (!op || !op.fotos.some((x) => x.id === f.id)) {
      // Foto removida (ou de OP que não existe mais neste aparelho): não envia.
      await bancoLocal.apagarFoto(f.id);
      continue;
    }
    try {
      await servidor.enviarFoto(f.caminho, new Blob([f.dados], { type: 'image/jpeg' }));
    } catch (e) {
      const erro = classificar(e);
      if (erro.tipo === 'rede' || erro.tipo === 'sessao') throw erro;
      marcarErroOp(op.id, 'Uma foto não foi aceita pelo servidor: ' + erro.message);
      continue;
    }
    await marcarFotoEnviada(f);
  }
}

async function baixarOps(servidor: Servidor): Promise<void> {
  const marca = await bancoLocal.ler<string>('marca_servidor');
  const desde = marca ? new Date(Date.parse(marca) - MARGEM_MS).toISOString() : null;
  const linhas = await servidor.baixarOps(desde);
  await receberOps(linhas.map((l) => l.op));
  const maior = linhas.reduce((m, l) => (l.sincronizado_em > m ? l.sincronizado_em : m), marca ?? '');
  if (maior && maior !== marca) await bancoLocal.gravar('marca_servidor', maior);
}

async function baixarCadastros(servidor: Servidor, forcar: boolean): Promise<void> {
  if (!forcar && Date.now() - ultimoCadastros < INTERVALO_CADASTROS_MS) return;
  const c = await servidor.baixarCadastros();
  const eu = lerEstado().perfil;
  const meu = eu ? c.perfis.find((p) => p.id === eu.id) : undefined;
  if (meu && (meu.papel !== eu!.papel || meu.ativo !== eu!.ativo || meu.nome !== eu!.nome)) await definirPerfil(meu);
  // Usuário desativado só enxerga o próprio perfil: não apaga o que está em cache.
  if (meu && !meu.ativo) return;
  if (!c.produtos.length && !c.moldes.length) return;
  await receberCadastros(c);
  ultimoCadastros = Date.now();
}

export interface OpcoesSync {
  /** Baixa catálogo, moldes, receita e usuários mesmo que tenha baixado há pouco. */
  cadastros?: boolean;
}

/** Roda uma sincronização completa. Chamadas simultâneas se juntam. */
export function sincronizar(opcoes: OpcoesSync = {}): Promise<void> {
  const servidor = lerServidor();
  if (!servidor) return Promise.resolve();
  if (emCurso) {
    pedidoDurante = true;
    return emCurso;
  }
  clearTimeout(relogio);
  emCurso = (async () => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      definirSync({ situacao: 'sem_conexao', mensagem: null });
      return;
    }
    definirSync({ situacao: 'sincronizando', mensagem: null });
    try {
      await descarregar();
      if (!(await temSessao())) {
        definirSync({ situacao: 'sem_sessao', mensagem: 'Entre de novo para enviar os dados deste aparelho.' });
        return;
      }
      await enviarOps(servidor);
      await enviarFotos(servidor);
      await baixarOps(servidor);
      await baixarCadastros(servidor, opcoes.cadastros === true);
      const agora = new Date().toISOString();
      await bancoLocal.gravar('ultimo_sync', agora);
      tentativas = 0;
      const comErro = Object.keys(lerEstado().errosOp).length;
      definirSync({
        situacao: comErro ? 'erro' : 'parado',
        mensagem: comErro ? 'Há OP que o servidor não aceitou. Abra a OP para ver o motivo.' : null,
        ultimo: agora,
      });
    } catch (e) {
      const erro: ErroServidor = classificar(e);
      if (erro.tipo === 'rede') {
        definirSync({ situacao: 'sem_conexao', mensagem: null });
        tentativas++;
        agendarSincronizacao(Math.min(60000, 5000 * 2 ** Math.min(tentativas, 4)));
      } else if (erro.tipo === 'sessao') {
        definirSync({ situacao: 'sem_sessao', mensagem: 'Sua sessão expirou. Entre de novo para enviar os dados.' });
      } else {
        definirSync({ situacao: 'erro', mensagem: erro.message });
      }
    }
  })().finally(() => {
    emCurso = null;
    if (pedidoDurante) {
      pedidoDurante = false;
      agendarSincronizacao(300);
    }
  });
  return emCurso;
}

let ligada = false;

/** Liga a sincronização automática: a cada alteração, ao voltar a conexão, ao reabrir o app e a cada minuto. */
export function ligarSincronizacaoAutomatica(): void {
  registrarAoAlterar(() => agendarSincronizacao());
  if (ligada || typeof window === 'undefined') return;
  ligada = true;
  window.addEventListener('online', () => void sincronizar());
  window.addEventListener('offline', () => {
    if (lerServidor()) definirSync({ situacao: 'sem_conexao', mensagem: null });
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void sincronizar();
    else void descarregar();
  });
  window.addEventListener('pagehide', () => void descarregar());
  setInterval(() => {
    if (document.visibilityState === 'visible' && navigator.onLine !== false) void sincronizar();
  }, INTERVALO_MS);
}

/** Só para os testes. */
export function reiniciarSincronizacao(): void {
  clearTimeout(relogio);
  emCurso = null;
  pedidoDurante = false;
  tentativas = 0;
  ultimoCadastros = 0;
}
