// Resumo para acompanhamento da produção: soma os indicadores de um período,
// compara com o período anterior e monta a série por dia. Funções puras.

import { calcular, type Indicadores } from './calc';
import { MOTIVOS_RETRABALHO } from './constantes';
import { hojeISO } from './formato';
import type { MoldeInfo, Op } from './tipos';

export interface LinhaResumo<T extends Op = Op> { o: T; c: Indicadores }

export type Periodo = 'hoje' | '7d' | '30d' | 'tudo';

/** `antes` e `deAntes` nomeiam o período anterior nas frases de comparação. */
export const PERIODOS: { chave: Periodo; nome: string; dias: number | null; antes: string; deAntes: string }[] = [
  { chave: 'hoje', nome: 'Hoje', dias: 1, antes: 'ontem', deAntes: 'de ontem' },
  { chave: '7d', nome: '7 dias', dias: 7, antes: 'nos 7 dias anteriores', deAntes: 'dos 7 dias anteriores' },
  { chave: '30d', nome: '30 dias', dias: 30, antes: 'nos 30 dias anteriores', deAntes: 'dos 30 dias anteriores' },
  { chave: 'tudo', nome: 'Tudo', dias: null, antes: '', deAntes: '' },
];

/** AAAA-MM-DD de `dias` dias antes (ou depois, se negativo) de uma data AAAA-MM-DD. */
export function diasAntes(data: string, dias: number): string {
  const [a, m, d] = data.split('-').map(Number);
  return hojeISO(new Date(a, m - 1, d - dias, 12));
}

/** Primeiro e último dia do período que termina em `hoje`. `voltas` = 1 dá o período anterior. */
export function intervalo(periodo: Periodo, hoje: string, voltas = 0): { de: string; ate: string } | null {
  const dias = PERIODOS.find((p) => p.chave === periodo)!.dias;
  if (dias == null) return null;
  const ate = diasAntes(hoje, dias * voltas);
  return { de: diasAntes(ate, dias - 1), ate };
}

/** OPs do período, sem as canceladas. Em "tudo" entram também as sem data (histórico). */
export function doPeriodo<T extends Op>(ops: T[], periodo: Periodo, hoje: string, voltas = 0): T[] {
  const i = intervalo(periodo, hoje, voltas);
  return ops.filter((o) => o.status !== 'cancelada' && (!i || (o.data != null && o.data >= i.de && o.data <= i.ate)));
}

export const calcularLinhas = <T extends Op>(ops: T[], moldes: MoldeInfo[]): LinhaResumo<T>[] =>
  ops.map((o) => ({ o, c: calcular(o, moldes) }));

export interface Totais {
  ops: number;
  encerradas: number;
  em_andamento: number;
  bandejas_formadas: number;
  embalagens_boas: number;
  /** Só das OPs com retrabalho registrado (o histórico da planilha não tem). */
  retrabalho: number;
  vazias: number;
  perda_nao_classificada: number;
  /** Boas ÷ formadas, ponderado pelas bandejas; null = nenhuma OP com resultado. */
  aproveitamento: number | null;
  retrabalho_pct: number | null;
  vazias_pct: number | null;
  peso_final_kg: number;
  produtividade_kg_h: number | null;
  filme_perdido_kg: number;
  minutos_parados: number;
}

const soma = (linhas: LinhaResumo[], f: (l: LinhaResumo) => number | null | undefined): number =>
  linhas.reduce((s, l) => s + (f(l) || 0), 0);

export function totais(linhas: LinhaResumo[]): Totais {
  const comDestino = linhas.filter((l) => l.c.bandejas_formadas && l.c.embalagens_boas != null);
  const classificadas = comDestino.filter((l) => l.c.retrabalho != null);
  const formadas = soma(comDestino, (l) => l.c.bandejas_formadas);
  const formadasClass = soma(classificadas, (l) => l.c.bandejas_formadas);
  const boas = soma(comDestino, (l) => l.c.embalagens_boas);
  const retrabalho = soma(classificadas, (l) => l.c.retrabalho);
  const vazias = soma(classificadas, (l) => l.c.vazias);
  const comTempo = linhas.filter((l) => l.c.horas && l.o.peso_final_kg);
  const horas = soma(comTempo, (l) => l.c.horas);
  return {
    ops: linhas.length,
    encerradas: linhas.filter((l) => l.o.status === 'fechada').length,
    em_andamento: linhas.filter((l) => l.o.status === 'aberta').length,
    bandejas_formadas: formadas,
    embalagens_boas: boas,
    retrabalho,
    vazias,
    perda_nao_classificada: soma(comDestino, (l) => l.c.perda_nao_classificada),
    aproveitamento: formadas ? boas / formadas : null,
    retrabalho_pct: formadasClass ? retrabalho / formadasClass : null,
    vazias_pct: formadasClass ? vazias / formadasClass : null,
    peso_final_kg: soma(linhas, (l) => l.o.peso_final_kg),
    produtividade_kg_h: horas ? soma(comTempo, (l) => l.o.peso_final_kg) / horas : null,
    filme_perdido_kg: soma(linhas, (l) => l.c.filme_perdido_kg),
    minutos_parados: soma(linhas, (l) => l.c.minutos_parados),
  };
}

export interface PontoDia {
  data: string;
  ops: number;
  bandejas_formadas: number;
  embalagens_boas: number;
  aproveitamento: number;
}

/** Aproveitamento de cada dia (ponderado pelas bandejas), em ordem de data. */
export function porDia(linhas: LinhaResumo[]): PontoDia[] {
  const dias = new Map<string, LinhaResumo[]>();
  for (const l of linhas) {
    if (!l.o.data || !l.c.bandejas_formadas || l.c.embalagens_boas == null) continue;
    dias.set(l.o.data, [...(dias.get(l.o.data) ?? []), l]);
  }
  return [...dias.entries()]
    .map(([data, ls]) => {
      const formadas = soma(ls, (l) => l.c.bandejas_formadas);
      const boas = soma(ls, (l) => l.c.embalagens_boas);
      return { data, ops: ls.length, bandejas_formadas: formadas, embalagens_boas: boas, aproveitamento: boas / formadas };
    })
    .sort((a, b) => a.data.localeCompare(b.data));
}

/** Motivos de retrabalho do período, do mais frequente para o menos. */
export function motivosDoPeriodo(linhas: LinhaResumo[]): [string, number][] {
  return MOTIVOS_RETRABALHO
    .map((m): [string, number] => [m.nome, soma(linhas, (l) => l.o.retrabalho?.[m.chave])])
    .filter((p) => p[1] > 0)
    .sort((a, b) => b[1] - a[1]);
}
