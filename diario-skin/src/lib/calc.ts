// Cálculos por OP (seção 7 da especificação). Funções puras, usadas no
// lançamento (resultado ao vivo), no painel e na exportação. A view
// ops_indicadores do banco repete as mesmas fórmulas em SQL.

import { CHAVES_PARAMETROS, CICLO_TEORICO_FABRICA_S, RECEITA_FABRICA } from './constantes';
import { hojeISO } from './formato';
import type { ChaveParametro, Molde, MoldeInfo, Op, Parametros, ReceitaPadrao } from './tipos';

export interface Indicadores {
  cavidades: number;
  passos: number | null;
  bandejas_formadas: number | null;
  embalagens_boas: number | null;
  /** De onde saiu a contagem de boas. */
  boas_por: 'caixas' | 'peso' | null;
  /** null = retrabalho não registrado (histórico). */
  retrabalho: number | null;
  vazias: number | null;
  perda_nao_classificada: number | null;
  aproveitamento: number | null;
  retrabalho_pct: number | null;
  vazias_pct: number | null;
  perda_nao_classificada_pct: number | null;
  horas: number | null;
  minutos_parados: number;
  produtividade_kg_h: number | null;
  ciclos_por_minuto: number | null;
  filme_perdido_kg: number | null;
  filme_fundo_perdido_kg: number | null;
  filme_tampa_perdido_kg: number | null;
  filme_total_kg: number | null;
  filme_g_por_kg: number | null;
  filme_minimo_g_por_kg: number | null;
  peso_medio_kg: number | null;
  sobrepeso: number | null;
}

/** Valores de fábrica (seção 6.1), usados se o banco ainda não respondeu. */
export const MOLDES_FABRICA: MoldeInfo[] = [
  { molde: '2x1', cavidades: 2, filme_fundo_kg_bdj: 0.028078, filme_tampa_kg_bdj: 0.0070249 },
  { molde: '3x1', cavidades: 3, filme_fundo_kg_bdj: 0.0187187, filme_tampa_kg_bdj: 0.0031222 },
];

export function infoMolde(molde: Molde, moldes: MoldeInfo[]): MoldeInfo {
  return (
    moldes.find((m) => m.molde === molde) ??
    MOLDES_FABRICA.find((m) => m.molde === molde) ??
    MOLDES_FABRICA[0]
  );
}

/** Diferença entre dois horários HH:MM em horas; virada de dia soma 24 h. */
export function horasEntre(inicio: string | null, fim: string | null): number | null {
  if (!inicio || !fim) return null;
  const [h1, m1] = inicio.split(':').map(Number);
  const [h2, m2] = fim.split(':').map(Number);
  if (![h1, m1, h2, m2].every(Number.isFinite)) return null;
  let min = h2 * 60 + m2 - (h1 * 60 + m1);
  if (min < 0) min += 1440;
  return min / 60;
}

type CamposCalculo = Pick<
  Op,
  | 'molde' | 'passo_inicio' | 'passo_fim' | 'caixas' | 'embalagens_por_caixa' | 'embalagens_avulsas'
  | 'peso_final_kg' | 'peso_nominal_kg' | 'hora_inicio' | 'hora_fim' | 'retrabalho' | 'paradas'
>;

const div = (a: number | null, b: number | null): number | null =>
  a != null && b != null && b !== 0 ? a / b : null;

export function calcular(op: CamposCalculo, moldes: MoldeInfo[]): Indicadores {
  const m = infoMolde(op.molde, moldes);
  const cavidades = m.cavidades;
  const filmeBdj = m.filme_fundo_kg_bdj + m.filme_tampa_kg_bdj;

  const passos = op.passo_fim != null && op.passo_inicio != null ? op.passo_fim - op.passo_inicio : null;
  const bandejas_formadas = passos != null && passos > 0 ? passos * cavidades : null;

  // Boas: pelas caixas (preferencial) ou pelo peso final ÷ peso nominal (histórico).
  let embalagens_boas: number | null = null;
  let boas_por: Indicadores['boas_por'] = null;
  if (op.caixas != null && op.embalagens_por_caixa) {
    embalagens_boas = op.caixas * op.embalagens_por_caixa + (op.embalagens_avulsas ?? 0);
    boas_por = 'caixas';
  } else if (op.peso_final_kg && op.peso_nominal_kg) {
    embalagens_boas = Math.round(op.peso_final_kg / op.peso_nominal_kg);
    boas_por = 'peso';
  }

  const retrabalho = op.retrabalho ? Object.values(op.retrabalho).reduce((s, q) => s + (q || 0), 0) : null;

  let vazias: number | null = null;
  let perda_nao_classificada: number | null = null;
  if (bandejas_formadas != null && embalagens_boas != null) {
    if (retrabalho != null) vazias = Math.max(0, bandejas_formadas - embalagens_boas - retrabalho);
    else perda_nao_classificada = Math.max(0, bandejas_formadas - embalagens_boas);
  }

  const horas = horasEntre(op.hora_inicio, op.hora_fim);
  const minutos_parados = (op.paradas ?? []).reduce((s, p) => s + (p.minutos || 0), 0);

  const perdidas =
    bandejas_formadas != null && embalagens_boas != null ? Math.max(0, bandejas_formadas - embalagens_boas) : null;
  const filme_total_kg = bandejas_formadas != null ? bandejas_formadas * filmeBdj : null;
  const peso_medio_kg = embalagens_boas ? div(op.peso_final_kg, embalagens_boas) : null;

  return {
    cavidades,
    passos,
    bandejas_formadas,
    embalagens_boas,
    boas_por,
    retrabalho,
    vazias,
    perda_nao_classificada,
    aproveitamento: div(embalagens_boas, bandejas_formadas),
    retrabalho_pct: div(retrabalho, bandejas_formadas),
    vazias_pct: div(vazias, bandejas_formadas),
    perda_nao_classificada_pct: div(perda_nao_classificada, bandejas_formadas),
    horas,
    minutos_parados,
    produtividade_kg_h: horas ? div(op.peso_final_kg, horas) : null,
    ciclos_por_minuto: horas && passos != null && passos > 0 ? passos / (horas * 60) : null,
    filme_perdido_kg: perdidas != null ? perdidas * filmeBdj : null,
    filme_fundo_perdido_kg: perdidas != null ? perdidas * m.filme_fundo_kg_bdj : null,
    filme_tampa_perdido_kg: perdidas != null ? perdidas * m.filme_tampa_kg_bdj : null,
    filme_total_kg,
    filme_g_por_kg: filme_total_kg != null && op.peso_final_kg ? (filme_total_kg * 1000) / op.peso_final_kg : null,
    filme_minimo_g_por_kg: op.peso_nominal_kg ? (filmeBdj * 1000) / op.peso_nominal_kg : null,
    peso_medio_kg,
    // Sobrepeso só faz sentido com as boas contadas pelas caixas.
    sobrepeso:
      peso_medio_kg != null && op.peso_nominal_kg && boas_por === 'caixas'
        ? peso_medio_kg / op.peso_nominal_kg - 1
        : null,
  };
}

/**
 * Receita padrão que valia na data da OP: a mais recente com vigência até
 * aquele dia. Sem data (ou antes da primeira receita), usa a mais antiga.
 */
export function receitaVigente(receitas: ReceitaPadrao[], data?: string | null): ReceitaPadrao | null {
  if (!receitas.length) return null;
  const ordem = [...receitas].sort(
    (a, b) => Date.parse(a.vigente_desde) - Date.parse(b.vigente_desde) || a.id - b.id,
  );
  if (!data) return ordem[ordem.length - 1];
  let escolhida = ordem[0];
  for (const r of ordem) if (hojeISO(new Date(r.vigente_desde)) <= data) escolhida = r;
  return escolhida;
}

export function parametrosDaReceita(receita: ReceitaPadrao | null): Parametros {
  if (!receita) return { ...RECEITA_FABRICA };
  const p = {} as Parametros;
  for (const k of CHAVES_PARAMETROS) p[k] = receita[k];
  return p;
}

export function cicloTeorico(receita: ReceitaPadrao | null): number {
  return receita?.ciclo_teorico_s || CICLO_TEORICO_FABRICA_S;
}

/** Parâmetros da OP que diferem da receita padrão. */
export function parametrosAlterados(op: Parametros, padrao: Parametros): ChaveParametro[] {
  return CHAVES_PARAMETROS.filter((k) => op[k] != null && padrao[k] != null && Number(op[k]) !== Number(padrao[k]));
}

export function temParametros(op: Parametros): boolean {
  return CHAVES_PARAMETROS.some((k) => op[k] != null);
}

export interface Validacao {
  /** Campos obrigatórios que faltam. */
  faltas: string[];
  /** Impedem o encerramento. */
  bloqueios: string[];
  /** Só avisam. */
  avisos: string[];
}

type CamposValidacao = CamposCalculo;

export function validarEncerramento(op: CamposValidacao, ind: Indicadores): Validacao {
  const faltas: string[] = [];
  if (!op.hora_fim) faltas.push('hora de fim');
  if (op.passo_fim == null) faltas.push('passo no fim');
  if (op.caixas == null) faltas.push('caixas');
  if (op.peso_final_kg == null) faltas.push('peso final');
  if (!op.embalagens_por_caixa && !op.peso_nominal_kg) faltas.push('embalagens por caixa ou peso nominal');

  const bloqueios: string[] = [];
  if (ind.passos != null && ind.passos <= 0) {
    bloqueios.push('O passo no fim precisa ser maior que o passo no início.');
  }
  if (
    ind.bandejas_formadas != null &&
    ind.embalagens_boas != null &&
    ind.embalagens_boas + (ind.retrabalho ?? 0) > ind.bandejas_formadas * 1.02
  ) {
    bloqueios.push('Boas + retrabalho passam das bandejas formadas. Confira passos e caixas.');
  }

  const avisos: string[] = [];
  if (ind.ciclos_por_minuto != null && ind.ciclos_por_minuto > 8) {
    avisos.push('Mais de 8 ciclos por minuto: confira os horários e os passos.');
  }
  if (ind.aproveitamento != null && ind.aproveitamento > 1) {
    avisos.push('Aproveitamento acima de 100%: confira passos, caixas e embalagens por caixa.');
  }
  return { faltas, bloqueios, avisos };
}
