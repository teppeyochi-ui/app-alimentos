// Histórico de alterações de uma OP: transforma os registros do banco
// (tabela ops_historico) em frases para a tela. Funções puras.

import { META_PARAMETRO, MOTIVOS_RETRABALHO, PARAMETROS } from './constantes';
import type { ChaveParametro } from './tipos';

export interface Mudanca { de: unknown; para: unknown }

export interface RegistroHistorico {
  id: number;
  op_id: string;
  /** Primeira e última alteração juntadas no registro (ISO). */
  em: string;
  ate: string;
  /** Quem alterou; null = alteração feita direto no banco. */
  por: string | null;
  /** O registro começa com a criação da OP. */
  criou: boolean;
  mudancas: Record<string, Mudanca>;
}

export interface RegistroDescrito {
  id: number;
  em: string;
  ate: string;
  por: string | null;
  /** "Criou a OP", "Encerrou a OP", "Alterou"… */
  acao: string;
  /** Uma frase por campo alterado. */
  linhas: string[];
  /** Alteração feita com a OP já encerrada (correção). */
  correcao: boolean;
}

const CAMPOS: Record<string, string> = {
  data: 'Data',
  produto_codigo: 'SKU',
  produto_descricao: 'Produto',
  op: 'Nº da OP',
  molde: 'Molde',
  peso_nominal_kg: 'Peso nominal (kg)',
  embalagens_por_caixa: 'Embalagens por caixa',
  lote_mp: 'Lote da matéria-prima',
  temp_produto_c: 'Temp. do produto (°C)',
  filme_fundo: 'Filme de fundo',
  filme_tampa: 'Filme de tampa',
  lote_filme: 'Lote do filme',
  hora_inicio: 'Hora de início',
  hora_fim: 'Hora de fim',
  passo_inicio: 'Passo no início',
  passo_fim: 'Passo no fim',
  caixas: 'Caixas',
  embalagens_avulsas: 'Embalagens avulsas',
  peso_final_kg: 'Peso final (kg)',
  aparencia: 'Aparência',
  observacoes: 'Observações',
  parametros_origem: 'Origem dos parâmetros',
  ...Object.fromEntries(PARAMETROS.map((p) => [p.chave, `${p.nome} (${p.unidade})`])),
};

const STATUS: Record<string, string> = { aberta: 'aberta', fechada: 'encerrada', cancelada: 'cancelada' };
const ORIGEM_PARAMETROS: Record<string, string> = { digitado: 'digitado', lido_da_foto: 'lido da foto', padrao: 'receita padrão' };

function valor(chave: string, v: unknown): string {
  if (v == null || v === '') return 'vazio';
  if (typeof v === 'number') {
    const casas = chave in META_PARAMETRO ? META_PARAMETRO[chave as ChaveParametro].casas : undefined;
    return (casas != null ? v.toFixed(casas) : String(v)).replace('.', ',');
  }
  if (typeof v === 'boolean') return v ? 'sim' : 'não';
  if (typeof v !== 'string') return JSON.stringify(v);
  if (chave === 'hora_inicio' || chave === 'hora_fim') return v.slice(0, 5);
  if (chave === 'data' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return `${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)}`;
  if (chave === 'parametros_origem') return ORIGEM_PARAMETROS[v] ?? v;
  return v;
}

function linha(chave: string, m: Mudanca): string {
  if (chave.startsWith('retrabalho.')) {
    const motivo = chave.slice('retrabalho.'.length);
    const nome = MOTIVOS_RETRABALHO.find((x) => x.chave === motivo)?.nome ?? motivo;
    return `Retrabalho, ${nome.toLowerCase()}: ${valor(chave, m.de ?? 0)} → ${valor(chave, m.para ?? 0)}`;
  }
  if (chave.startsWith('parada.')) {
    if (m.de == null) return `Parada incluída: ${String(m.para)}`;
    if (m.para == null) return `Parada removida: ${String(m.de)}`;
    return `Parada: ${String(m.de)} → ${String(m.para)}`;
  }
  if (chave.startsWith('foto.')) {
    const tipo = (t: unknown) => (t === 'tela' ? 'da tela' : 'do produto');
    return m.de == null ? `Foto ${tipo(m.para)} incluída` : `Foto ${tipo(m.de)} removida`;
  }
  if (chave === 'analise_ia') {
    const nota = (a: unknown): string => {
      const n = (a as { nota?: unknown } | null)?.nota;
      return a == null ? 'sem avaliação' : typeof n === 'number' ? `nota ${String(n).replace('.', ',')}` : 'sem nota';
    };
    return `Avaliação da foto por IA: ${nota(m.de)} → ${nota(m.para)}`;
  }
  return `${CAMPOS[chave] ?? chave}: ${valor(chave, m.de)} → ${valor(chave, m.para)}`;
}

function acao(r: RegistroHistorico): string {
  const s = r.mudancas.status;
  const para = typeof s?.para === 'string' ? s.para : null;
  const de = typeof s?.de === 'string' ? s.de : null;
  if (r.criou) return para === 'fechada' ? 'Criou e encerrou a OP' : para === 'cancelada' ? 'Criou e cancelou a OP' : 'Criou a OP';
  if (para === 'fechada' && de === 'aberta') return 'Encerrou a OP';
  if (para === 'cancelada') return 'Cancelou a OP';
  if (de === 'cancelada') return `Restaurou a OP (${STATUS[para ?? ''] ?? para})`;
  if (para === 'aberta') return 'Reabriu a OP';
  return 'Alterou';
}

/** Ordem dos campos nas frases: a dos campos do lançamento; o resto no fim. */
const ORDEM = Object.keys(CAMPOS);
const posicao = (chave: string): number => {
  const i = ORDEM.indexOf(chave);
  if (i >= 0) return i;
  return chave.startsWith('retrabalho.') ? 500 : chave.startsWith('parada.') ? 600 : chave.startsWith('foto.') ? 700 : 800;
};

/**
 * Registros em frases. `statusAntes` acompanha o status da OP para marcar como
 * correção o que foi alterado depois de encerrada.
 */
export function descreverHistorico(registros: RegistroHistorico[]): RegistroDescrito[] {
  let status: string | null = null;
  return [...registros]
    .sort((a, b) => a.id - b.id)
    .map((r) => {
      const s = r.mudancas.status;
      const antes = typeof s?.de === 'string' ? s.de : r.criou ? 'aberta' : status;
      const depois = typeof s?.para === 'string' ? s.para : antes;
      const linhas = Object.keys(r.mudancas)
        .filter((k) => k !== 'status')
        .sort((a, b) => posicao(a) - posicao(b) || a.localeCompare(b))
        .map((k) => linha(k, r.mudancas[k]));
      const descrito: RegistroDescrito = {
        id: r.id, em: r.em, ate: r.ate, por: r.por, acao: acao(r), linhas,
        // Sem saber o status (histórico começou depois da OP), não marca.
        correcao: !r.criou && antes === 'fechada' && depois === 'fechada',
      };
      status = depois;
      return descrito;
    });
}
