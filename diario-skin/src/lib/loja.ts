// Loja de dados do aplicativo: estado em memória, espelhado no IndexedDB.
// Toda alteração entra aqui primeiro (funciona sem internet) e marca a OP
// como "suja"; a sincronização (sincronizacao.ts) envia depois.

import { useSyncExternalStore } from 'react';
import { bancoLocal, type FotoGuardada } from './banco-local';
import { MOLDES_FABRICA, parametrosDaReceita, receitaVigente } from './calc';
import {
  CICLO_TEORICO_FABRICA_S, FILMES_FUNDO, PARAMETROS_VAZIOS, RECEITA_FABRICA, RETRABALHO_ZERADO, filmeTampaSugerido,
} from './constantes';
import { hojeISO, uuid } from './formato';
import { historicoDoCsv, produtosDoCsv } from './semente';
import type { Servidor } from './servidor';
import type {
  AnaliseIa, Foto, MoldeInfo, MotivoRetrabalho, Op, OpLocal, Perfil, Produto, ReceitaPadrao,
} from './tipos';

export interface EstadoSync {
  /** 'local' = sem servidor configurado: os dados ficam só neste aparelho. */
  modo: 'local' | 'servidor';
  situacao: 'parado' | 'sincronizando' | 'sem_conexao' | 'sem_sessao' | 'erro';
  mensagem: string | null;
  /** Hora da última sincronização completa. */
  ultimo: string | null;
}

export interface Aviso {
  id: number;
  texto: string;
  tipo: 'info' | 'ok' | 'erro';
}

export interface Estado {
  pronto: boolean;
  perfil: Perfil | null;
  ops: OpLocal[];
  /** OP nova que ainda não recebeu nenhum dado: só vira OP de verdade na primeira alteração. */
  rascunho: OpLocal | null;
  produtos: Produto[];
  moldes: MoldeInfo[];
  receitas: ReceitaPadrao[];
  perfis: Perfil[];
  /** Fotos guardadas no aparelho que ainda não chegaram ao servidor. */
  fotosPendentes: string[];
  /** OPs alteradas em memória que ainda não foram gravadas no aparelho. */
  gravando: string[];
  /** OPs que o servidor recusou, com o motivo. */
  errosOp: Record<string, string>;
  sync: EstadoSync;
  avisos: Aviso[];
}

export const PERFIL_LOCAL: Perfil = { id: 'local', nome: 'Este aparelho', papel: 'admin', ativo: true };

let estado: Estado = {
  pronto: false,
  perfil: null,
  ops: [],
  rascunho: null,
  produtos: [],
  moldes: MOLDES_FABRICA,
  receitas: [],
  perfis: [],
  fotosPendentes: [],
  gravando: [],
  errosOp: {},
  sync: { modo: 'local', situacao: 'parado', mensagem: null, ultimo: null },
  avisos: [],
};

const ouvintes = new Set<() => void>();
let servidor: Servidor | null = null;
/** Conta as alterações de cada OP nesta sessão (para saber se mudou durante um envio). */
const revisoes = new Map<string, number>();
let aoAlterar: () => void = () => {};

export function assinar(f: () => void): () => void {
  ouvintes.add(f);
  return () => ouvintes.delete(f);
}
export const lerEstado = (): Estado => estado;
export const lerServidor = (): Servidor | null => servidor;
export const revisaoDe = (id: string): number => revisoes.get(id) ?? 0;

export function definir(parcial: Partial<Estado>): void {
  estado = { ...estado, ...parcial };
  ouvintes.forEach((f) => f());
}
export function definirSync(parcial: Partial<EstadoSync>): void {
  definir({ sync: { ...estado.sync, ...parcial } });
}
export function useLoja(): Estado {
  return useSyncExternalStore(assinar, lerEstado);
}
/** A sincronização se registra aqui para ser chamada a cada alteração gravada. */
export function registrarAoAlterar(f: () => void): void {
  aoAlterar = f;
}

// ------------------------------------------------------------------ avisos (mensagens rápidas)

let proximoAviso = 1;
export function avisar(texto: string, tipo: Aviso['tipo'] = 'info'): void {
  const aviso = { id: proximoAviso++, texto, tipo };
  definir({ avisos: [...estado.avisos.slice(-2), aviso] });
  setTimeout(() => definir({ avisos: estado.avisos.filter((a) => a.id !== aviso.id) }), tipo === 'erro' ? 6000 : 3200);
}

// ------------------------------------------------------------------ início

const RECEITA_LOCAL: ReceitaPadrao = {
  ...RECEITA_FABRICA, id: 1, vigente_desde: '2026-01-01T03:00:00.000Z', ciclo_teorico_s: CICLO_TEORICO_FABRICA_S,
};

const local = (op: Op, sujo: boolean): OpLocal => ({ ...op, _sujo: sujo, _paradas_removidas: [], _fotos_removidas: [] });

/**
 * Versão do catálogo embutido (modo local). Ao mudar o CSV, some 1: os aparelhos
 * que já tinham o catálogo antigo recebem os produtos e campos novos ao abrir.
 */
export const VERSAO_SEMENTE = 2;

/**
 * Junta o catálogo embutido com o que já estava no aparelho: produto novo entra;
 * no que já existia, valem os dados da planilha, mas ficam o "ativo" e o que o
 * aparelho já tinha preenchido e a planilha não traz (molde, embalagens por caixa).
 */
export function mesclarCatalogo(noAparelho: Produto[], daSemente: Produto[]): Produto[] {
  const porCodigo = new Map(noAparelho.map((p) => [p.codigo, p]));
  for (const novo of daSemente) {
    const atual = porCodigo.get(novo.codigo);
    porCodigo.set(novo.codigo, atual
      ? {
          ...novo,
          molde: novo.molde ?? atual.molde ?? null,
          embalagens_por_caixa: atual.embalagens_por_caixa ?? novo.embalagens_por_caixa,
          ativo: atual.ativo,
        }
      : novo);
  }
  return [...porCodigo.values()].sort((a, b) => a.codigo.localeCompare(b.codigo));
}

/** Produtos e OPs gravados por versões anteriores não têm os campos novos. */
const produtoCompleto = (p: Produto): Produto => ({ ...p, derivacao: p.derivacao ?? null, peso_caixa_kg: p.peso_caixa_kg ?? null, especie: p.especie ?? null });
const opCompleta = (o: OpLocal): OpLocal => (o.analise_ia === undefined ? { ...o, analise_ia: null } : o);

/**
 * Catálogo e histórico da especificação, para a primeira abertura em modo local.
 * No build com servidor configurado esta parte é descartada: os dados de
 * produção não vão dentro do aplicativo publicado, só vêm do banco, depois do login.
 */
const carregarSemente =
  import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY
    ? null
    : () => Promise.all([import('../../dados/catalogo.csv?raw'), import('../../dados/historico.csv?raw')]);

export async function iniciarLoja(opcoes: { servidor: Servidor | null }): Promise<void> {
  servidor = opcoes.servidor;
  revisoes.clear();
  const [opsGravadas, fotos, produtosGravados, moldes, receitas, perfis, perfil, ultimo, versaoSemente] = await Promise.all([
    bancoLocal.todasOps(),
    bancoLocal.todasFotos(),
    bancoLocal.ler<Produto[]>('produtos'),
    bancoLocal.ler<MoldeInfo[]>('moldes'),
    bancoLocal.ler<ReceitaPadrao[]>('receitas'),
    bancoLocal.ler<Perfil[]>('perfis'),
    bancoLocal.ler<Perfil>('perfil'),
    bancoLocal.ler<string>('ultimo_sync'),
    bancoLocal.ler<number>('versao_semente'),
  ]);
  const ops = opsGravadas.map(opCompleta);
  const produtos = produtosGravados?.map(produtoCompleto);

  const base: Partial<Estado> = {
    pronto: true,
    ops,
    rascunho: null,
    produtos: produtos ?? [],
    moldes: moldes?.length ? moldes : MOLDES_FABRICA,
    receitas: receitas ?? [],
    perfis: perfis ?? [],
    perfil: servidor ? perfil ?? null : PERFIL_LOCAL,
    fotosPendentes: fotos.filter((f) => !f.enviada).map((f) => f.id),
    gravando: [],
    errosOp: {},
    sync: { modo: servidor ? 'servidor' : 'local', situacao: 'parado', mensagem: null, ultimo: ultimo ?? null },
  };

  // Modo local, primeira vez: carrega o catálogo e o histórico da especificação.
  if (!servidor && !produtos && carregarSemente) {
    const [catalogoCsv, historicoCsv] = await carregarSemente();
    const semente = produtosDoCsv(catalogoCsv.default).produtos;
    const historico = historicoDoCsv(historicoCsv.default).map((o) => local(o, false));
    const idsExistentes = new Set(ops.map((o) => o.id));
    const novas = historico.filter((o) => !idsExistentes.has(o.id));
    await Promise.all([
      bancoLocal.gravar('produtos', semente),
      bancoLocal.gravar('moldes', MOLDES_FABRICA),
      bancoLocal.gravar('receitas', [RECEITA_LOCAL]),
      bancoLocal.gravar('versao_semente', VERSAO_SEMENTE),
      bancoLocal.gravarOps(novas),
    ]);
    base.produtos = semente;
    base.moldes = MOLDES_FABRICA;
    base.receitas = [RECEITA_LOCAL];
    base.ops = [...ops, ...novas];
  } else if (!servidor && produtos && carregarSemente && (versaoSemente ?? 1) < VERSAO_SEMENTE) {
    // Modo local, aparelho que já tinha um catálogo mais antigo: recebe o novo sem perder nada.
    const [catalogoCsv] = await carregarSemente();
    const mesclado = mesclarCatalogo(produtos, produtosDoCsv(catalogoCsv.default).produtos);
    await Promise.all([bancoLocal.gravar('produtos', mesclado), bancoLocal.gravar('versao_semente', VERSAO_SEMENTE)]);
    base.produtos = mesclado;
  }

  definir(base);
  void limparFotosAntigas(fotos, base.ops ?? []);
}

/** Apaga do aparelho as fotos já enviadas de OPs encerradas há mais de 3 dias (continuam no servidor). */
async function limparFotosAntigas(fotos: FotoGuardada[], ops: OpLocal[]): Promise<void> {
  const limite = Date.now() - 3 * 24 * 3600 * 1000;
  const porId = new Map(ops.map((o) => [o.id, o]));
  for (const f of fotos) {
    const op = porId.get(f.op_id);
    if (f.enviada && (!op || op.status !== 'aberta') && Date.parse(f.criado_em) < limite) {
      await bancoLocal.apagarFoto(f.id);
    }
  }
}

// ------------------------------------------------------------------ gravação no aparelho

const paraGravar = new Set<string>();
let relogioGravar: ReturnType<typeof setTimeout> | undefined;
let gravacaoEmCurso: Promise<void> = Promise.resolve();

function agendarGravacao(id: string): void {
  paraGravar.add(id);
  if (!estado.gravando.includes(id)) definir({ gravando: [...estado.gravando, id] });
  clearTimeout(relogioGravar);
  relogioGravar = setTimeout(() => void descarregar(), 400);
}

/** Grava no aparelho, agora, tudo o que está só em memória. */
export function descarregar(): Promise<void> {
  clearTimeout(relogioGravar);
  gravacaoEmCurso = gravacaoEmCurso.then(async () => {
    if (!paraGravar.size) return;
    const ids = [...paraGravar];
    paraGravar.clear();
    const ops = estado.ops.filter((o) => ids.includes(o.id));
    try {
      await bancoLocal.gravarOps(ops);
      definir({ gravando: estado.gravando.filter((id) => !ids.includes(id) || paraGravar.has(id)) });
      aoAlterar();
    } catch (e) {
      ids.forEach((id) => paraGravar.add(id));
      avisar('Não foi possível gravar no aparelho. Verifique o espaço livre.', 'erro');
      console.error(e);
    }
  });
  return gravacaoEmCurso;
}

// ------------------------------------------------------------------ permissões (espelho das políticas do banco)

export function podeEditar(op: Pick<Op, 'status'>, perfil: Perfil | null): boolean {
  if (!perfil?.ativo) return false;
  if (perfil.papel === 'admin') return true;
  if (perfil.papel === 'pd') return op.status !== 'cancelada';
  return op.status === 'aberta';
}

// ------------------------------------------------------------------ alterações de OP

let ultimoCarimbo = 0;
/** Hora da edição, sempre crescente (duas edições no mesmo milissegundo não empatam). */
function carimbo(): string {
  ultimoCarimbo = Math.max(Date.now(), ultimoCarimbo + 1);
  return new Date(ultimoCarimbo).toISOString();
}

const idPerfil = (): string | null => (estado.perfil && estado.perfil.id !== 'local' ? estado.perfil.id : null);

export function opPorId(id: string | null | undefined): OpLocal | null {
  if (!id) return null;
  if (estado.rascunho?.id === id) return estado.rascunho;
  return estado.ops.find((o) => o.id === id) ?? null;
}

/** Aplica uma alteração à OP, marca para envio e agenda a gravação. */
function mudarOp(id: string, muda: (op: OpLocal) => OpLocal, exigirPermissao = true): OpLocal | null {
  const atual = opPorId(id);
  if (!atual) return null;
  if (exigirPermissao && !podeEditar(atual, estado.perfil)) return null;
  const nova: OpLocal = { ...muda(atual), _sujo: true, alterado_em: carimbo(), alterado_por: idPerfil() };
  revisoes.set(id, revisaoDe(id) + 1);
  if (estado.rascunho?.id === id) {
    definir({ rascunho: null, ops: [...estado.ops, nova] });
  } else {
    definir({ ops: estado.ops.map((o) => (o.id === id ? nova : o)) });
  }
  if (estado.errosOp[id]) {
    const { [id]: _, ...resto } = estado.errosOp;
    void _;
    definir({ errosOp: resto });
  }
  agendarGravacao(id);
  return nova;
}

/** Abre uma OP nova como rascunho (só é gravada quando receber o primeiro dado). */
export function novaOp(): OpLocal {
  const receita = receitaVigente(estado.receitas, hojeISO());
  const agora = carimbo();
  const op: OpLocal = {
    ...PARAMETROS_VAZIOS,
    ...parametrosDaReceita(receita),
    id: uuid(),
    origem: 'diario',
    status: 'aberta',
    data: hojeISO(),
    produto_codigo: null,
    produto_descricao: '',
    op: null,
    molde: '2x1',
    peso_nominal_kg: null,
    embalagens_por_caixa: null,
    lote_mp: null,
    temp_produto_c: null,
    filme_fundo: FILMES_FUNDO[0],
    filme_tampa: filmeTampaSugerido('2x1'),
    lote_filme: null,
    hora_inicio: null,
    hora_fim: null,
    passo_inicio: 0,
    passo_fim: null,
    caixas: null,
    embalagens_avulsas: 0,
    peso_final_kg: null,
    aparencia: null,
    observacoes: null,
    parametros_origem: 'padrao',
    criado_por: idPerfil(),
    criado_em: agora,
    alterado_por: idPerfil(),
    alterado_em: agora,
    fechada_em: null,
    analise_ia: null,
    retrabalho: { ...RETRABALHO_ZERADO },
    paradas: [],
    fotos: [],
    _sujo: false,
    _paradas_removidas: [],
    _fotos_removidas: [],
  };
  definir({ rascunho: op });
  return op;
}

export function descartarRascunho(): void {
  if (estado.rascunho) definir({ rascunho: null });
}

export function alterarOp(id: string, mudancas: Partial<Op>): void {
  mudarOp(id, (op) => ({ ...op, ...mudancas }));
}

/** Embalagens por caixa "aprendido": do catálogo ou da última OP do mesmo código. */
export function embalagensPorCaixaConhecido(produto: Produto): number | null {
  if (produto.embalagens_por_caixa) return produto.embalagens_por_caixa;
  const anteriores = estado.ops
    .filter((o) => o.produto_codigo === produto.codigo && o.embalagens_por_caixa && o.status !== 'cancelada')
    .sort((a, b) => (b.data ?? '').localeCompare(a.data ?? '') || (b.criado_em ?? '').localeCompare(a.criado_em ?? ''));
  return anteriores[0]?.embalagens_por_caixa ?? null;
}

/**
 * Escolher o produto preenche molde, peso nominal, filme de tampa e embalagens
 * por caixa. No produto de peso variável (PDV) sem valor conhecido, embalagens
 * por caixa fica vazio para o operador informar.
 */
export function escolherProduto(id: string, produto: Produto): void {
  mudarOp(id, (op) => {
    const molde = produto.molde ?? op.molde;
    return {
      ...op,
      produto_codigo: produto.codigo,
      produto_descricao: produto.descricao,
      molde,
      peso_nominal_kg: produto.peso_nominal_kg,
      filme_tampa: filmeTampaSugerido(molde),
      embalagens_por_caixa: embalagensPorCaixaConhecido(produto),
    };
  });
}

/** Guarda na OP a avaliação da foto do produto feita pela IA. */
export function gravarAnaliseIa(id: string, analise: AnaliseIa): void {
  mudarOp(id, (op) => ({ ...op, analise_ia: analise }));
}

export function escolherProdutoOutro(id: string, nome: string): void {
  mudarOp(id, (op) => ({ ...op, produto_codigo: null, produto_descricao: nome }));
}

export function contarRetrabalho(id: string, motivo: MotivoRetrabalho, delta: number): void {
  mudarOp(id, (op) => {
    const atual = op.retrabalho ?? { ...RETRABALHO_ZERADO };
    return { ...op, retrabalho: { ...atual, [motivo]: Math.max(0, (atual[motivo] || 0) + delta) } };
  });
}

export function adicionarParada(id: string, motivo: string, minutos: number): void {
  if (!(minutos > 0)) return;
  mudarOp(id, (op) => ({ ...op, paradas: [...op.paradas, { id: uuid(), motivo, minutos: Math.round(minutos) }] }));
}

export function removerParada(id: string, paradaId: string): void {
  mudarOp(id, (op) => ({
    ...op,
    paradas: op.paradas.filter((p) => p.id !== paradaId),
    _paradas_removidas: [...op._paradas_removidas, paradaId],
  }));
}

export async function adicionarFoto(id: string, tipo: Foto['tipo'], blob: Blob): Promise<boolean> {
  const op = opPorId(id);
  if (!op || !podeEditar(op, estado.perfil)) return false;
  const foto: Foto = { id: uuid(), tipo, caminho: '', tela_numero: null, criado_em: new Date().toISOString() };
  foto.caminho = `${id}/${foto.id}.jpg`;
  try {
    await bancoLocal.gravarFoto({
      id: foto.id, op_id: id, caminho: foto.caminho, dados: await blob.arrayBuffer(), enviada: false, criado_em: foto.criado_em,
    });
  } catch (e) {
    console.error(e);
    avisar('Não foi possível guardar a foto no aparelho. Verifique o espaço livre.', 'erro');
    return false;
  }
  definir({ fotosPendentes: [...estado.fotosPendentes, foto.id] });
  mudarOp(id, (o) => ({ ...o, fotos: [...o.fotos, foto] }));
  return true;
}

export async function removerFoto(id: string, fotoId: string): Promise<void> {
  const alterada = mudarOp(id, (op) => ({
    ...op,
    fotos: op.fotos.filter((f) => f.id !== fotoId),
    _fotos_removidas: [...op._fotos_removidas, fotoId],
  }));
  if (!alterada) return;
  await bancoLocal.apagarFoto(fotoId);
  definir({ fotosPendentes: estado.fotosPendentes.filter((x) => x !== fotoId) });
}

export function encerrarOp(id: string): void {
  mudarOp(id, (op) => ({ ...op, status: 'fechada', fechada_em: new Date().toISOString() }));
}

/** Só o administrador (a política do banco confere de novo). */
export function cancelarOp(id: string): void {
  if (estado.perfil?.papel !== 'admin') return;
  mudarOp(id, (op) => ({ ...op, status: 'cancelada' }));
}

export function restaurarOp(id: string): void {
  if (estado.perfil?.papel !== 'admin') return;
  mudarOp(id, (op) => ({ ...op, status: op.fechada_em ? 'fechada' : 'aberta' }));
}

// ------------------------------------------------------------------ usado pela sincronização

/** OP confirmada pelo servidor: deixa de estar pendente, se não mudou durante o envio. */
export async function marcarEnviada(enviada: OpLocal, revisaoNoEnvio: number): Promise<void> {
  const atual = estado.ops.find((o) => o.id === enviada.id);
  if (!atual) return;
  const nova: OpLocal =
    revisaoDe(enviada.id) === revisaoNoEnvio
      ? { ...atual, _sujo: false, _paradas_removidas: [], _fotos_removidas: [] }
      : {
          // Mudou durante o envio: continua pendente, mas as remoções já aplicadas saem da lista.
          ...atual,
          _paradas_removidas: atual._paradas_removidas.filter((x) => !enviada._paradas_removidas.includes(x)),
          _fotos_removidas: atual._fotos_removidas.filter((x) => !enviada._fotos_removidas.includes(x)),
        };
  definir({ ops: estado.ops.map((o) => (o.id === nova.id ? nova : o)) });
  await bancoLocal.gravarOps([nova]);
}

function mesmaOp(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object).filter((k) => !k.startsWith('_'));
  const kb = Object.keys(b as object).filter((k) => !k.startsWith('_'));
  if (ka.length !== kb.length) return false;
  return ka.every((k) => mesmaOp((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/**
 * Recebe OPs do servidor. A do servidor substitui a do aparelho, a não ser que
 * a do aparelho tenha alteração pendente (essa será enviada e o servidor decide).
 * Com `forcar`, substitui mesmo assim (o servidor já decidiu).
 */
export async function receberOps(recebidas: Op[], forcar = false): Promise<number> {
  if (!recebidas.length) return 0;
  const porId = new Map(estado.ops.map((o) => [o.id, o]));
  const mudaram: OpLocal[] = [];
  for (const srv of recebidas) {
    const atual = porId.get(srv.id);
    if (atual && atual._sujo && !forcar) continue;
    if (atual && !atual._sujo && mesmaOp(atual, srv)) continue;
    const nova = local(srv, false);
    porId.set(srv.id, nova);
    mudaram.push(nova);
  }
  if (!mudaram.length) return 0;
  await bancoLocal.gravarOps(mudaram);
  definir({ ops: [...porId.values()] });
  return mudaram.length;
}

export function marcarErroOp(id: string, motivo: string | null): void {
  const { [id]: _, ...resto } = estado.errosOp;
  void _;
  definir({ errosOp: motivo ? { ...resto, [id]: motivo } : resto });
}

export async function marcarFotoEnviada(foto: FotoGuardada): Promise<void> {
  await bancoLocal.gravarFoto({ ...foto, enviada: true });
  definir({ fotosPendentes: estado.fotosPendentes.filter((x) => x !== foto.id) });
}

export async function receberCadastros(c: {
  produtos: Produto[]; moldes: MoldeInfo[]; receitas: ReceitaPadrao[]; perfis: Perfil[];
}): Promise<void> {
  await Promise.all([
    bancoLocal.gravar('produtos', c.produtos),
    bancoLocal.gravar('moldes', c.moldes),
    bancoLocal.gravar('receitas', c.receitas),
    bancoLocal.gravar('perfis', c.perfis),
  ]);
  definir({
    produtos: c.produtos.map(produtoCompleto),
    moldes: c.moldes.length ? c.moldes : MOLDES_FABRICA,
    receitas: c.receitas,
    perfis: c.perfis,
  });
}

export async function definirPerfil(perfil: Perfil | null): Promise<void> {
  if (perfil) await bancoLocal.gravar('perfil', perfil);
  else await bancoLocal.apagar('perfil');
  definir({ perfil });
}

/** Nome de quem registrou, a partir da lista de perfis em cache. */
export function nomeDoPerfil(id: string | null): string | null {
  if (!id) return null;
  return estado.perfis.find((p) => p.id === id)?.nome ?? (estado.perfil?.id === id ? estado.perfil.nome : null);
}

export function quantasPendentes(e: Estado = estado): number {
  return e.ops.filter((o) => o._sujo).length;
}
