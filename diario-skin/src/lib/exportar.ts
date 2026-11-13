// Exportação das OPs em CSV e XLSX (uma linha por OP, com os indicadores da seção 7).

import { calcular, parametrosAlterados, parametrosDaReceita, receitaVigente } from './calc';
import { MOTIVOS_RETRABALHO, PARAMETROS } from './constantes';
import { gerarCsv, type Celula } from './csv';
import { hojeISO } from './formato';
import type { MoldeInfo, Op, Perfil, Produto, ReceitaPadrao } from './tipos';
import type { Planilha } from './xlsx';

export interface DadosExportacao {
  ops: Op[];
  moldes: MoldeInfo[];
  receitas: ReceitaPadrao[];
  perfis: Perfil[];
  /** Catálogo, para trazer a derivação e a espécie de cada SKU. */
  produtos?: Produto[];
}

/** Arredonda para tirar o ruído de ponto flutuante (0,8250000001). */
const arr = (v: number | null, casas = 4): number | null => {
  if (v == null || !Number.isFinite(v)) return null;
  const f = 10 ** casas;
  return Math.round(v * f) / f;
};
const pc = (v: number | null): number | null => (v == null ? null : arr(v * 100, 2));

export function tabelaOps(d: DadosExportacao): Planilha {
  const nome = (id: string | null) => (id ? d.perfis.find((p) => p.id === id)?.nome ?? '' : '');
  const produto = (codigo: string | null) => (codigo ? d.produtos?.find((p) => p.codigo === codigo) : undefined);
  const cabecalho = [
    'Data', 'Código', 'Produto', 'Derivação', 'Espécie', 'OP', 'Origem', 'Status', 'Molde', 'Peso nominal (kg)', 'Embalagens por caixa',
    'Lote da matéria-prima', 'Temp. do produto (°C)', 'Filme de fundo', 'Filme de tampa', 'Lote do filme',
    'Hora de início', 'Hora de fim', 'Passo no início', 'Passo no fim', 'Caixas', 'Embalagens avulsas',
    'Peso final (kg)', 'Aparência', 'Nota de aparência (IA)', 'Diagnóstico (IA)',
    ...PARAMETROS.map((p) => `${p.nome} (${p.unidade})`),
    'Origem dos parâmetros', 'Parâmetros alterados',
    'Bandejas formadas', 'Embalagens boas', 'Aproveitamento (%)', 'Retrabalho', 'Retrabalho (%)', 'Vazias', 'Vazias (%)',
    'Perda não classificada',
    ...MOTIVOS_RETRABALHO.map((m) => `Retrabalho: ${m.nome.toLowerCase()}`),
    'Minutos parados', 'Horas', 'Produtividade (kg/h)', 'Ciclos por minuto',
    'Filme perdido (kg)', 'Filme de fundo perdido (kg)', 'Filme de tampa perdido (kg)', 'Filme total (kg)',
    'Filme por kg de produto (g/kg)', 'Filme mínimo possível (g/kg)', 'Peso médio (kg)', 'Sobrepeso (%)',
    'Fotos', 'Observações', 'Registrado por', 'Alterado por', 'Criado em', 'Alterado em', 'Encerrada em', 'Id',
  ];
  const linhas = d.ops.map((o): Celula[] => {
    const c = calcular(o, d.moldes);
    const padrao = parametrosDaReceita(receitaVigente(d.receitas, o.data));
    const alterados = parametrosAlterados(o, padrao)
      .map((k) => PARAMETROS.find((p) => p.chave === k)?.nome ?? k)
      .join(', ');
    return [
      o.data, o.produto_codigo, o.produto_descricao, produto(o.produto_codigo)?.derivacao, produto(o.produto_codigo)?.especie,
      o.op, o.origem, o.status, o.molde, o.peso_nominal_kg, o.embalagens_por_caixa,
      o.lote_mp, o.temp_produto_c, o.filme_fundo, o.filme_tampa, o.lote_filme,
      o.hora_inicio, o.hora_fim, o.passo_inicio, o.passo_fim, o.caixas, o.embalagens_avulsas,
      o.peso_final_kg, o.aparencia, o.analise_ia?.nota_aparencia, o.analise_ia?.diagnostico,
      ...PARAMETROS.map((p) => o[p.chave]),
      o.parametros_origem, alterados,
      c.bandejas_formadas, c.embalagens_boas, pc(c.aproveitamento), c.retrabalho, pc(c.retrabalho_pct), c.vazias, pc(c.vazias_pct),
      c.perda_nao_classificada,
      ...MOTIVOS_RETRABALHO.map((m) => (o.retrabalho ? o.retrabalho[m.chave] : null)),
      c.minutos_parados, arr(c.horas), arr(c.produtividade_kg_h, 1), arr(c.ciclos_por_minuto, 2),
      arr(c.filme_perdido_kg, 3), arr(c.filme_fundo_perdido_kg, 3), arr(c.filme_tampa_perdido_kg, 3), arr(c.filme_total_kg, 3),
      arr(c.filme_g_por_kg, 1), arr(c.filme_minimo_g_por_kg, 1), arr(c.peso_medio_kg), pc(c.sobrepeso),
      o.fotos.length, o.observacoes, nome(o.criado_por), nome(o.alterado_por), o.criado_em, o.alterado_em, o.fechada_em, o.id,
    ];
  });
  return { nome: 'OPs', cabecalho, linhas };
}

export function tabelaParadas(d: DadosExportacao): Planilha {
  const linhas: Celula[][] = [];
  for (const o of d.ops) {
    for (const p of o.paradas) linhas.push([o.data, o.produto_descricao, o.op, p.motivo, p.minutos, o.id]);
  }
  return { nome: 'Paradas', cabecalho: ['Data', 'Produto', 'OP', 'Motivo', 'Minutos', 'Id da OP'], linhas };
}

function baixar(nome: string, conteudo: BlobPart, tipo: string): void {
  const url = URL.createObjectURL(new Blob([conteudo], { type: tipo }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export function exportarCsv(d: DadosExportacao): void {
  const t = tabelaOps(d);
  baixar(`diario-skin-ops-${hojeISO()}.csv`, gerarCsv(t.cabecalho, t.linhas), 'text/csv;charset=utf-8');
}

export async function exportarXlsx(d: DadosExportacao): Promise<void> {
  // Carregado só na hora de exportar.
  const { gerarXlsx } = await import('./xlsx');
  const bytes = gerarXlsx([tabelaOps(d), tabelaParadas(d)]);
  baixar(
    `diario-skin-ops-${hojeISO()}.xlsx`,
    bytes as unknown as BlobPart,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
}
