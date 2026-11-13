// Tudo o que o aplicativo pede ao servidor passa por aqui. A interface
// Servidor é o contrato; a implementação usa o Supabase. Os testes trocam
// por um servidor de mentira.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { BUCKET_FOTOS, CHAVES_PARAMETROS, MOTIVOS_RETRABALHO } from './constantes';
import { SUPABASE_CHAVE, SUPABASE_URL } from './config';
import type {
  ChaveParametro, Foto, MoldeInfo, Op, OpLocal, Papel, Parada, Parametros, Perfil, Produto, ReceitaPadrao, Retrabalho,
} from './tipos';

export type TipoErro = 'rede' | 'permissao' | 'sessao' | 'outro';

export class ErroServidor extends Error {
  tipo: TipoErro;
  constructor(tipo: TipoErro, mensagem: string) {
    super(mensagem);
    this.name = 'ErroServidor';
    this.tipo = tipo;
  }
}

export type ResultadoSalvar = 'gravada' | 'igual' | 'ignorada';

export interface Cadastros {
  produtos: Produto[];
  moldes: MoldeInfo[];
  receitas: ReceitaPadrao[];
  perfis: Perfil[];
}

export interface OpDoServidor {
  op: Op;
  sincronizado_em: string;
}

export interface LeituraTelas {
  telas: number[];
  valores: Partial<Parametros>;
  duvidas: string;
}

export interface Servidor {
  salvarOp(op: OpLocal): Promise<ResultadoSalvar>;
  /** OPs gravadas no servidor depois de `desde` (ou todas). */
  baixarOps(desde: string | null): Promise<OpDoServidor[]>;
  baixarOp(id: string): Promise<Op | null>;
  baixarCadastros(): Promise<Cadastros>;
  enviarFoto(caminho: string, blob: Blob): Promise<void>;
  apagarFotos(caminhos: string[]): Promise<void>;
  urlFoto(caminho: string): Promise<string | null>;
  lerTelas(fotos: Blob[]): Promise<LeituraTelas>;
  // administração
  salvarProdutos(produtos: Produto[]): Promise<void>;
  salvarMolde(molde: MoldeInfo): Promise<void>;
  incluirReceita(receita: Omit<ReceitaPadrao, 'id'>): Promise<void>;
  salvarPerfil(perfil: Perfil): Promise<void>;
}

// ------------------------------------------------------------------ conversões

const texto = (v: unknown): string | null => (v == null || v === '' ? null : String(v));
const numero = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
/** '08:00:00' → '08:00' */
const hora = (v: unknown): string | null => (typeof v === 'string' && v.length >= 5 ? v.slice(0, 5) : null);

type Linha = Record<string, unknown>;

/** Linha da tabela ops (com retrabalho, paradas e fotos embutidos) → Op do aplicativo. */
export function opDaLinha(l: Linha): Op {
  const linhasRetr = (l.op_retrabalho as Linha[] | undefined) ?? [];
  let retrabalho: Retrabalho | null = null;
  if (linhasRetr.length) {
    retrabalho = Object.fromEntries(MOTIVOS_RETRABALHO.map((m) => [m.chave, 0])) as Retrabalho;
    for (const r of linhasRetr) {
      const k = r.motivo as keyof Retrabalho;
      if (k in retrabalho) retrabalho[k] = Number(r.quantidade) || 0;
    }
  }
  const paradas: Parada[] = ((l.op_paradas as Linha[] | undefined) ?? []).map((p) => ({
    id: String(p.id), motivo: String(p.motivo), minutos: Number(p.minutos) || 0,
  }));
  const fotos: Foto[] = ((l.op_fotos as Linha[] | undefined) ?? [])
    .map((f) => ({
      id: String(f.id),
      tipo: f.tipo === 'produto' ? ('produto' as const) : ('tela' as const),
      caminho: String(f.caminho),
      tela_numero: numero(f.tela_numero),
      criado_em: String(f.criado_em ?? ''),
    }))
    .sort((a, b) => a.criado_em.localeCompare(b.criado_em));

  const params = {} as Parametros;
  for (const k of CHAVES_PARAMETROS) params[k] = numero(l[k]);

  return {
    ...params,
    id: String(l.id),
    origem: l.origem === 'planilha' ? 'planilha' : 'diario',
    status: l.status === 'fechada' || l.status === 'cancelada' ? l.status : 'aberta',
    data: texto(l.data),
    produto_codigo: texto(l.produto_codigo),
    produto_descricao: String(l.produto_descricao ?? ''),
    op: texto(l.op),
    molde: l.molde === '3x1' ? '3x1' : '2x1',
    peso_nominal_kg: numero(l.peso_nominal_kg),
    embalagens_por_caixa: numero(l.embalagens_por_caixa),
    lote_mp: texto(l.lote_mp),
    temp_produto_c: numero(l.temp_produto_c),
    filme_fundo: texto(l.filme_fundo),
    filme_tampa: texto(l.filme_tampa),
    lote_filme: texto(l.lote_filme),
    hora_inicio: hora(l.hora_inicio),
    hora_fim: hora(l.hora_fim),
    passo_inicio: numero(l.passo_inicio),
    passo_fim: numero(l.passo_fim),
    caixas: numero(l.caixas),
    embalagens_avulsas: numero(l.embalagens_avulsas),
    peso_final_kg: numero(l.peso_final_kg),
    aparencia: l.aparencia === 'boa' || l.aparencia === 'regular' || l.aparencia === 'ruim' ? l.aparencia : null,
    observacoes: texto(l.observacoes),
    parametros_origem:
      l.parametros_origem === 'digitado' || l.parametros_origem === 'lido_da_foto' || l.parametros_origem === 'padrao'
        ? l.parametros_origem
        : null,
    criado_por: texto(l.criado_por),
    criado_em: texto(l.criado_em),
    alterado_por: texto(l.alterado_por),
    alterado_em: texto(l.alterado_em),
    fechada_em: texto(l.fechada_em),
    retrabalho,
    paradas,
    fotos,
  };
}

/** OP do aparelho → corpo da função salvar_op. Quem criou/alterou é o servidor que carimba. */
export function corpoSalvarOp(op: OpLocal): Record<string, unknown> {
  const { _sujo, _paradas_removidas, _fotos_removidas, criado_por, alterado_por, ...resto } = op;
  void _sujo; void criado_por; void alterado_por;
  return {
    ...resto,
    paradas_removidas: _paradas_removidas,
    fotos_removidas: _fotos_removidas,
  };
}

function produtoDaLinha(l: Linha): Produto {
  return {
    codigo: String(l.codigo),
    descricao: String(l.descricao),
    molde: l.molde === '3x1' ? '3x1' : '2x1',
    peso_nominal_kg: numero(l.peso_nominal_kg),
    embalagens_por_caixa: numero(l.embalagens_por_caixa),
    ativo: l.ativo !== false,
  };
}

function receitaDaLinha(l: Linha): ReceitaPadrao {
  const params = {} as Record<ChaveParametro, number | null>;
  for (const k of CHAVES_PARAMETROS) params[k] = numero(l[k]);
  return { ...params, id: Number(l.id), vigente_desde: String(l.vigente_desde), ciclo_teorico_s: numero(l.ciclo_teorico_s) };
}

const PAPEIS: Papel[] = ['operador', 'pd', 'admin'];
export function perfilDaLinha(l: Linha): Perfil {
  const papel = PAPEIS.includes(l.papel as Papel) ? (l.papel as Papel) : 'operador';
  return { id: String(l.id), nome: String(l.nome ?? ''), papel, ativo: l.ativo === true };
}

// ------------------------------------------------------------------ Supabase

let cliente: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (!cliente) {
    cliente = createClient(SUPABASE_URL, SUPABASE_CHAVE, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  }
  return cliente;
}

const SEM_REDE = /failed to fetch|networkerror|load failed|network request failed|fetch failed|err_internet|timeout/i;

interface ErroBruto { message?: string; code?: string; status?: number; statusCode?: string; name?: string }

/** Classifica o erro para a sincronização decidir: tentar de novo, pedir login ou desistir. */
export function classificar(erro: unknown, statusHttp?: number): ErroServidor {
  if (erro instanceof ErroServidor) return erro;
  const e = (erro ?? {}) as ErroBruto;
  const msg = e.message || String(erro);
  const status = statusHttp ?? e.status ?? (Number(e.statusCode) || undefined);
  const semConexao = typeof navigator !== 'undefined' && navigator.onLine === false;
  if (semConexao || SEM_REDE.test(msg) || status === 0 || (status != null && status >= 500) || status === 408 || status === 429) {
    return new ErroServidor('rede', msg);
  }
  if (status === 401 || e.code === 'PGRST301' || e.code === 'PGRST302' || /jwt/i.test(msg)) {
    return new ErroServidor('sessao', msg);
  }
  if (status === 403 || e.code === '42501') return new ErroServidor('permissao', msg);
  return new ErroServidor('outro', msg);
}

const SELECAO_OP = '*, op_retrabalho(motivo,quantidade), op_paradas(id,motivo,minutos), op_fotos(id,tipo,caminho,tela_numero,criado_em)';
const PAGINA = 500;

function blobParaBase64(blob: Blob): Promise<string> {
  return new Promise((ok, falha) => {
    const leitor = new FileReader();
    leitor.onload = () => ok(String(leitor.result).split(',')[1] ?? '');
    leitor.onerror = () => falha(leitor.error);
    leitor.readAsDataURL(blob);
  });
}

export function servidorSupabase(): Servidor {
  const sb = supabase();
  const urls = new Map<string, { url: string; ate: number }>();

  return {
    async salvarOp(op) {
      const { data, error, status } = await sb.rpc('salvar_op', { p: corpoSalvarOp(op) });
      if (error) throw classificar(error, status);
      const r = (data as { resultado?: string } | null)?.resultado;
      return r === 'igual' || r === 'ignorada' ? r : 'gravada';
    },

    async baixarOps(desde) {
      const todas: OpDoServidor[] = [];
      for (let de = 0; ; de += PAGINA) {
        let q = sb.from('ops').select(SELECAO_OP).order('sincronizado_em', { ascending: true }).order('id', { ascending: true });
        if (desde) q = q.gt('sincronizado_em', desde);
        const { data, error, status } = await q.range(de, de + PAGINA - 1);
        if (error) throw classificar(error, status);
        for (const l of (data ?? []) as Linha[]) {
          todas.push({ op: opDaLinha(l), sincronizado_em: String(l.sincronizado_em) });
        }
        if (!data || data.length < PAGINA) break;
      }
      return todas;
    },

    async baixarOp(id) {
      const { data, error, status } = await sb.from('ops').select(SELECAO_OP).eq('id', id).maybeSingle();
      if (error) throw classificar(error, status);
      return data ? opDaLinha(data as Linha) : null;
    },

    async baixarCadastros() {
      const [p, m, r, u] = await Promise.all([
        sb.from('produtos').select('*').order('codigo'),
        sb.from('moldes').select('*').order('molde'),
        sb.from('receitas_padrao').select('*').order('vigente_desde'),
        sb.from('perfis').select('*').order('nome'),
      ]);
      for (const x of [p, m, r, u]) if (x.error) throw classificar(x.error, x.status);
      return {
        produtos: ((p.data ?? []) as Linha[]).map(produtoDaLinha),
        moldes: ((m.data ?? []) as Linha[]).map((l) => ({
          molde: l.molde === '3x1' ? ('3x1' as const) : ('2x1' as const),
          cavidades: Number(l.cavidades),
          filme_fundo_kg_bdj: Number(l.filme_fundo_kg_bdj),
          filme_tampa_kg_bdj: Number(l.filme_tampa_kg_bdj),
        })),
        receitas: ((r.data ?? []) as Linha[]).map(receitaDaLinha),
        perfis: ((u.data ?? []) as Linha[]).map(perfilDaLinha),
      };
    },

    async enviarFoto(caminho, blob) {
      const { error } = await sb.storage.from(BUCKET_FOTOS).upload(caminho, blob, {
        contentType: 'image/jpeg', upsert: false, cacheControl: '31536000',
      });
      if (!error) return;
      const e = error as ErroBruto;
      // Já está lá (reenvio depois de resposta perdida): conta como enviado.
      if (e.status === 409 || e.statusCode === '409' || /already exists|duplicate/i.test(e.message ?? '')) return;
      throw classificar(error);
    },

    async apagarFotos(caminhos) {
      if (!caminhos.length) return;
      const { error } = await sb.storage.from(BUCKET_FOTOS).remove(caminhos);
      if (error) throw classificar(error);
    },

    async urlFoto(caminho) {
      const guardada = urls.get(caminho);
      if (guardada && guardada.ate > Date.now()) return guardada.url;
      const { data, error } = await sb.storage.from(BUCKET_FOTOS).createSignedUrl(caminho, 3600);
      if (error || !data?.signedUrl) return null;
      urls.set(caminho, { url: data.signedUrl, ate: Date.now() + 50 * 60 * 1000 });
      return data.signedUrl;
    },

    async lerTelas(fotos) {
      const corpo = { fotos: await Promise.all(fotos.map(async (b) => ({ tipo: 'image/jpeg', base64: await blobParaBase64(b) }))) };
      const { data, error } = await sb.functions.invoke('ler-telas', { body: corpo });
      if (error) {
        // Quando a função respondeu, ela explica o motivo em { erro: "..." }.
        const resposta = (error as { context?: unknown }).context;
        if (resposta instanceof Response) {
          const explicacao = ((await resposta.json().catch(() => null)) as { erro?: string } | null)?.erro;
          if (explicacao) throw new ErroServidor('outro', explicacao);
          throw classificar(error, resposta.status);
        }
        throw classificar(error);
      }
      const d = (data ?? {}) as Partial<LeituraTelas>;
      return { telas: d.telas ?? [], valores: d.valores ?? {}, duvidas: d.duvidas ?? '' };
    },

    async salvarProdutos(produtos) {
      if (!produtos.length) return;
      const { error, status } = await sb.from('produtos').upsert(produtos, { onConflict: 'codigo' });
      if (error) throw classificar(error, status);
    },

    async salvarMolde(molde) {
      const { molde: chave, ...campos } = molde;
      const { error, status } = await sb.from('moldes').update(campos).eq('molde', chave);
      if (error) throw classificar(error, status);
    },

    async incluirReceita(receita) {
      const { error, status } = await sb.from('receitas_padrao').insert(receita);
      if (error) throw classificar(error, status);
    },

    async salvarPerfil(perfil) {
      const { id, ...campos } = perfil;
      const { error, status } = await sb.from('perfis').update(campos).eq('id', id);
      if (error) throw classificar(error, status);
    },
  };
}
