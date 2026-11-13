import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MOLDES_FABRICA } from '../../src/lib/calc';
import { RECEITA_FABRICA, RETRABALHO_ZERADO } from '../../src/lib/constantes';
import { calcularLinhas, diasAntes, doPeriodo, intervalo, motivosDoPeriodo, porDia, totais } from '../../src/lib/resumo';
import { historicoDoCsv } from '../../src/lib/semente';
import type { Op } from '../../src/lib/tipos';

const historico = historicoDoCsv(readFileSync('dados/historico.csv', 'utf8'));
const HOJE = '2026-11-13';
const HIST_30D = historico.map((o) => o.data).filter((d): d is string => d != null && d >= '2026-10-15').sort();

let n = 0;
/** OP do diário no 2x1: 600 passos = 1.200 bandejas; `boas` embalagens em caixas de 10; 2,5 h. */
function op(muda: Partial<Op> & { boas?: number } = {}): Op {
  const { boas = 1000, ...resto } = muda;
  n++;
  return {
    ...historico[0], ...RECEITA_FABRICA,
    id: `bbbbbbbb-0000-4000-8000-${String(n).padStart(12, '0')}`,
    origem: 'diario', status: 'fechada', data: HOJE, produto_codigo: null, produto_descricao: 'PRODUTO', molde: '2x1',
    peso_nominal_kg: 0.6, embalagens_por_caixa: 10, caixas: boas / 10, embalagens_avulsas: 0,
    hora_inicio: '08:00', hora_fim: '10:30', passo_inicio: 0, passo_fim: 600, peso_final_kg: boas * 0.6,
    retrabalho: { ...RETRABALHO_ZERADO }, paradas: [], fotos: [], analise_ia: null,
    ...resto,
  };
}

describe('período', () => {
  it('conta os dias no calendário, passando por mês e ano', () => {
    expect(diasAntes('2026-11-13', 1)).toBe('2026-11-12');
    expect(diasAntes('2026-03-01', 1)).toBe('2026-02-28');
    expect(diasAntes('2026-01-03', 6)).toBe('2025-12-28');
  });

  it('intervalos: hoje, 7 e 30 dias terminam hoje; o anterior encosta sem sobrepor', () => {
    expect(intervalo('hoje', HOJE)).toEqual({ de: '2026-11-13', ate: '2026-11-13' });
    expect(intervalo('7d', HOJE)).toEqual({ de: '2026-11-07', ate: '2026-11-13' });
    expect(intervalo('30d', HOJE)).toEqual({ de: '2026-10-15', ate: '2026-11-13' });
    expect(intervalo('7d', HOJE, 1)).toEqual({ de: '2026-10-31', ate: '2026-11-06' });
    expect(intervalo('hoje', HOJE, 1)).toEqual({ de: '2026-11-12', ate: '2026-11-12' });
    expect(intervalo('tudo', HOJE)).toBeNull();
  });

  it('filtra pelo dia da OP, tira as canceladas e só mostra as sem data em "tudo"', () => {
    const ops = [op(), op({ data: '2026-11-07' }), op({ data: '2026-11-06' }), op({ status: 'cancelada' }), op({ data: null })];
    expect(doPeriodo(ops, 'hoje', HOJE)).toHaveLength(1);
    expect(doPeriodo(ops, '7d', HOJE)).toHaveLength(2);
    expect(doPeriodo(ops, '7d', HOJE, 1)).toHaveLength(1);
    expect(doPeriodo(ops, 'tudo', HOJE)).toHaveLength(4);
    expect(doPeriodo(historico, 'tudo', HOJE)).toHaveLength(15);
    // As 3 produções de 15/10/2026 em diante caem nos 30 dias; as 2 sem data, só em "tudo".
    expect(doPeriodo(historico, '30d', HOJE).map((o) => o.data).sort()).toEqual(HIST_30D);
  });
});

describe('totais', () => {
  it('soma o período e pondera os percentuais pelas bandejas', () => {
    const linhas = calcularLinhas([
      op({ boas: 1000, retrabalho: { ...RETRABALHO_ZERADO, ruga: 50 }, paradas: [{ id: 'p', motivo: 'Outro', minutos: 12 }] }),
      op({ boas: 600, passo_fim: 400, retrabalho: { ...RETRABALHO_ZERADO, furo: 30, ruga: 10 } }), // 800 bandejas
      op({ status: 'aberta', hora_fim: null, passo_fim: null, caixas: null, peso_final_kg: null }),  // sem resultado ainda
    ], MOLDES_FABRICA);
    const t = totais(linhas);
    expect(t).toMatchObject({ ops: 3, encerradas: 2, em_andamento: 1, bandejas_formadas: 2000, embalagens_boas: 1600, retrabalho: 90, vazias: 310, perda_nao_classificada: 0, minutos_parados: 12 });
    expect(t.aproveitamento).toBeCloseTo(0.8, 10);
    expect(t.retrabalho_pct).toBeCloseTo(0.045, 10);
    expect(t.vazias_pct).toBeCloseTo(0.155, 10);
    expect(t.peso_final_kg).toBeCloseTo(960, 10);
    expect(t.produtividade_kg_h).toBeCloseTo(960 / 5, 10);
    // As partes fecham com as bandejas formadas.
    expect(t.embalagens_boas + t.retrabalho + t.vazias + t.perda_nao_classificada).toBe(t.bandejas_formadas);
  });

  it('histórico sem retrabalho entra como perda não classificada e não distorce o percentual de retrabalho', () => {
    const t = totais(calcularLinhas([op({ boas: 1000, retrabalho: { ...RETRABALHO_ZERADO, ruga: 60 } }), op({ boas: 900, retrabalho: null })], MOLDES_FABRICA));
    expect(t).toMatchObject({ bandejas_formadas: 2400, embalagens_boas: 1900, retrabalho: 60, vazias: 140, perda_nao_classificada: 300 });
    expect(t.retrabalho_pct).toBeCloseTo(60 / 1200, 10);
    expect(t.embalagens_boas + t.retrabalho + t.vazias + t.perda_nao_classificada).toBe(t.bandejas_formadas);
  });

  it('sem OP com resultado, os percentuais ficam vazios', () => {
    const t = totais([]);
    expect(t).toMatchObject({ ops: 0, aproveitamento: null, retrabalho_pct: null, produtividade_kg_h: null, peso_final_kg: 0 });
  });

  it('histórico da especificação: 15 OPs e os totais do salmão 600 g de 10/10/2026', () => {
    const linhas = calcularLinhas(historico, MOLDES_FABRICA);
    expect(totais(linhas).ops).toBe(15);
    const dia = porDia(linhas).find((d) => d.data === '2026-10-10')!;
    expect(dia.bandejas_formadas).toBeGreaterThanOrEqual(1598);
  });
});

describe('série por dia e motivos', () => {
  it('junta as OPs do mesmo dia, em ordem de data', () => {
    const linhas = calcularLinhas([op({ data: '2026-11-12', boas: 900 }), op({ boas: 1000 }), op({ boas: 1100 }), op({ data: null })], MOLDES_FABRICA);
    const dias = porDia(linhas);
    expect(dias.map((d) => [d.data, d.ops, d.bandejas_formadas])).toEqual([['2026-11-12', 1, 1200], ['2026-11-13', 2, 2400]]);
    expect(dias[1].aproveitamento).toBeCloseTo(2100 / 2400, 10);
  });

  it('motivos de retrabalho somados e em ordem', () => {
    const linhas = calcularLinhas([
      op({ retrabalho: { ...RETRABALHO_ZERADO, ruga: 5, furo: 2 } }), op({ retrabalho: { ...RETRABALHO_ZERADO, furo: 9 } }), op({ retrabalho: null }),
    ], MOLDES_FABRICA);
    expect(motivosDoPeriodo(linhas)).toEqual([['Filme furado', 11], ['Rugas ou ar preso', 5]]);
  });
});
