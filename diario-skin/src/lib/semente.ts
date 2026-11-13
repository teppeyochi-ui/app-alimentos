// Carga inicial (seção 6 da especificação): catálogo skin e histórico da
// planilha. Os mesmos CSVs geram o supabase/seed.sql (ferramentas/gerar-seed.mjs).

import { lerCsvObjetos } from './csv';
import { PARAMETROS_VAZIOS } from './constantes';
import type { Molde, Op, Produto } from './tipos';

const numero = (t: string | undefined): number | null => {
  if (t == null || t.trim() === '') return null;
  const n = Number(t.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

const texto = (t: string | undefined): string | null => (t && t.trim() ? t.trim() : null);

export function molde(t: string | undefined): Molde | null {
  const m = (t ?? '').trim().toLowerCase();
  return m === '2x1' || m === '3x1' ? m : null;
}

/** Linhas de catálogo: codigo;descricao;molde;peso_nominal_kg[;embalagens_por_caixa]. */
export function produtosDoCsv(csv: string): { produtos: Produto[]; erros: string[] } {
  const produtos: Produto[] = [];
  const erros: string[] = [];
  lerCsvObjetos(csv).forEach((l, i) => {
    const codigo = texto(l.codigo);
    const descricao = texto(l.descricao);
    const m = molde(l.molde);
    if (!codigo || !descricao || !m) {
      erros.push(`Linha ${i + 2}: precisa de código, descrição e molde (2x1 ou 3x1).`);
      return;
    }
    const epc = numero(l.embalagens_por_caixa);
    produtos.push({
      codigo,
      descricao,
      molde: m,
      peso_nominal_kg: numero(l.peso_nominal_kg),
      embalagens_por_caixa: epc != null ? Math.round(epc) : null,
      ativo: true,
    });
  });
  return { produtos, erros };
}

/** Identificador fixo das linhas do histórico: a carga pode ser repetida sem duplicar. */
export function idHistorico(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

/** Histórico da planilha: OPs fechadas, sem caixas, retrabalho, paradas, parâmetros ou fotos. */
export function historicoDoCsv(csv: string): Op[] {
  return lerCsvObjetos(csv).map((l, i) => ({
    ...PARAMETROS_VAZIOS,
    id: idHistorico(i + 1),
    origem: 'planilha',
    status: 'fechada',
    data: texto(l.data),
    produto_codigo: texto(l.codigo),
    produto_descricao: l.produto,
    op: texto(l.op),
    molde: molde(l.molde) ?? '2x1',
    peso_nominal_kg: numero(l.peso_nominal_kg),
    embalagens_por_caixa: null,
    lote_mp: null,
    temp_produto_c: null,
    filme_fundo: null,
    filme_tampa: null,
    lote_filme: null,
    hora_inicio: texto(l.hora_inicio),
    hora_fim: texto(l.hora_fim),
    passo_inicio: numero(l.passo_inicio),
    passo_fim: numero(l.passo_fim),
    caixas: null,
    embalagens_avulsas: null,
    peso_final_kg: numero(l.peso_final_kg),
    aparencia: null,
    observacoes: null,
    parametros_origem: null,
    criado_por: null,
    criado_em: null,
    alterado_por: null,
    alterado_em: null,
    fechada_em: null,
    retrabalho: null,
    paradas: [],
    fotos: [],
  }));
}
