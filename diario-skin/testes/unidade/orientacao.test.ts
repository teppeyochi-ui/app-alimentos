import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MOLDES_FABRICA, calcular } from '../../src/lib/calc';
import { RECEITA_FABRICA, RETRABALHO_ZERADO } from '../../src/lib/constantes';
import {
  REGRAS_DEFEITO, compararConfiguracao, contextoParaIa, efeitoDoParametro, maiorPerda, motivosEmOrdem, referenciaDa, ritmo,
} from '../../src/lib/orientacao';
import { historicoDoCsv, produtosDoCsv } from '../../src/lib/semente';
import type { Op, ReceitaPadrao } from '../../src/lib/tipos';

const produtos = produtosDoCsv(readFileSync('dados/catalogo.csv', 'utf8')).produtos;
const historico = historicoDoCsv(readFileSync('dados/historico.csv', 'utf8'));
const RECEITA: ReceitaPadrao = { ...RECEITA_FABRICA, id: 1, vigente_desde: '2026-01-01T03:00:00.000Z', ciclo_teorico_s: 10.3 };

const SALMAO_600 = '24616701063781-975'; // 2x1, espécie SALMON
const MEDALHAO = '24625054175781-964';   // 2x1, espécie SALMON (outro produto)

let n = 0;
/** OP encerrada do diário: 600 passos no 2x1 = 1.200 bandejas; `boas` embalagens em caixas de 10. */
function op(muda: Partial<Op> & { boas?: number } = {}): Op {
  const { boas = 1000, ...resto } = muda;
  n++;
  return {
    ...historico[0], ...RECEITA_FABRICA,
    id: `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, '0')}`,
    origem: 'diario', status: 'fechada', data: `2026-11-${String(n).padStart(2, '0')}`,
    produto_codigo: SALMAO_600, produto_descricao: 'F. SALMON PREM PEDACOS S/E 600GR SKIN PREMIUM', molde: '2x1',
    peso_nominal_kg: 0.6, embalagens_por_caixa: 10, caixas: boas / 10, embalagens_avulsas: 0,
    hora_inicio: '08:00', hora_fim: '10:30', passo_inicio: 0, passo_fim: 600, peso_final_kg: boas * 0.6,
    retrabalho: { ...RETRABALHO_ZERADO }, paradas: [], fotos: [], analise_ia: null,
    ...resto,
  };
}

describe('referência', () => {
  it('sem OP comparável não há referência (o histórico da planilha não tem parâmetros)', () => {
    expect(referenciaDa(op(), historico, MOLDES_FABRICA, produtos)).toBeNull();
  });

  it('usa as OPs do mesmo produto e destaca o terço de maior aproveitamento', () => {
    const base = [op({ boas: 900 }), op({ boas: 1100, t2: 1.2 }), op({ boas: 1000 }), op({ boas: 1080, t2: 1.2 }), op({ boas: 950 }), op({ boas: 840 })];
    const alvo = op({ status: 'aberta' });
    const ref = referenciaDa(alvo, [...base, alvo, ...historico], MOLDES_FABRICA, produtos)!;
    expect(ref.nivel).toBe('produto');
    expect(ref.base).toHaveLength(6);
    expect(ref.melhores.map((l) => l.c.embalagens_boas)).toEqual([1100, 1080]);
  });

  it('não usa OP aberta, cancelada, pequena demais ou sem parâmetros', () => {
    const boa = op({ boas: 1000 });
    const outras = [
      op({ status: 'aberta' }), op({ status: 'cancelada' }),
      op({ passo_fim: 40, boas: 80 }),                 // 80 bandejas: teste pequeno
      op({ ...Object.fromEntries(Object.keys(RECEITA_FABRICA).map((k) => [k, null])) }), // sem parâmetros
      op({ boas: 1300 }),                              // mais boas do que bandejas: dado errado
    ];
    const ref = referenciaDa(op(), [boa, ...outras], MOLDES_FABRICA, produtos)!;
    expect(ref.base.map((l) => l.o.id)).toEqual([boa.id]);
  });

  it('com poucas OPs do produto, usa a mesma espécie no mesmo molde; depois, o mesmo molde', () => {
    const medalhao = (m: Partial<Op> & { boas?: number }) => op({ produto_codigo: MEDALHAO, produto_descricao: 'MEDALHAO SALMON S/CL 500GR SKIN PREMIUM', ...m });
    const alvo = op();
    const ref = referenciaDa(alvo, [op({ boas: 900 }), medalhao({ boas: 1000 }), medalhao({ boas: 1100 })], MOLDES_FABRICA, produtos)!;
    expect(ref.nivel).toBe('especie');
    expect(ref.base).toHaveLength(3);

    const pescada = (m: Partial<Op> & { boas?: number }) => op({ produto_codigo: '10068093246591-964', produto_descricao: 'F. PESCADA AMARELA', ...m });
    const ref2 = referenciaDa(alvo, [pescada({ boas: 900 }), pescada({ boas: 1000 }), op({ molde: '3x1', produto_codigo: null, produto_descricao: 'OUTRO' })], MOLDES_FABRICA, produtos)!;
    expect(ref2.nivel).toBe('molde');
    expect(ref2.base).toHaveLength(2);
  });
});

describe('configuração', () => {
  it('sem referência, compara com a receita padrão', () => {
    const linhas = compararConfiguracao({ ...RECEITA_FABRICA, t2: 1.2, sp: null }, RECEITA_FABRICA, null);
    const por = Object.fromEntries(linhas.map((l) => [l.chave, l.situacao]));
    expect(por.t2).toBe('fora_do_padrao');
    expect(por.t_dome).toBe('no_padrao');
    expect(por.sp).toBe('sem_valor');
  });

  it('com referência, aponta o que está fora da faixa das melhores e o valor mais próximo', () => {
    const base = [op({ boas: 1100, t2: 1.2, sp: 30 }), op({ boas: 1090, t2: 1.4, sp: 30 }), op({ boas: 900 }), op({ boas: 880 }), op({ boas: 870 }), op({ boas: 860 })];
    const alvo = op({ status: 'aberta', t2: 1.0, sp: 30 });
    const ref = referenciaDa(alvo, base, MOLDES_FABRICA, produtos)!;
    const linhas = compararConfiguracao(alvo, RECEITA_FABRICA, ref);
    expect(linhas.find((l) => l.chave === 't2')).toMatchObject({ situacao: 'fora_da_referencia', faixa: { min: 1.2, max: 1.4 }, alvo: 1.2 });
    expect(linhas.find((l) => l.chave === 'sp')).toMatchObject({ situacao: 'na_referencia', faixa: { min: 30, max: 30 } });
    expect(linhas.find((l) => l.chave === 't_dome')).toMatchObject({ situacao: 'na_referencia' });
  });
});

describe('o que as OPs anteriores mostram', () => {
  const linhas = (ops: Op[]) => ops.map((o) => ({ o, c: calcular(o, MOLDES_FABRICA) }));

  it('sem variação do parâmetro não há o que comparar', () => {
    expect(efeitoDoParametro(linhas([op(), op(), op()]), 't2')).toBeNull();
  });

  it('agrupa por valor, pondera pelas bandejas e marca a força do indício', () => {
    const base = linhas([
      op({ boas: 900, retrabalho: { ...RETRABALHO_ZERADO, ruga: 60 } }), op({ boas: 960, retrabalho: { ...RETRABALHO_ZERADO, ruga: 36 } }),
      op({ boas: 1080, t2: 1.2, retrabalho: { ...RETRABALHO_ZERADO, ruga: 12 } }),
    ]);
    const ef = efeitoDoParametro(base, 't2')!;
    expect(ef.grupos.map((g) => [g.valor, g.ops])).toEqual([[1, 2], [1.2, 1]]);
    expect(ef.grupos[0].aproveitamento).toBeCloseTo(1860 / 2400, 10);
    expect(ef.grupos[0].retrabalho_pct).toBeCloseTo(96 / 2400, 10);
    expect(ef.grupos[1].aproveitamento).toBeCloseTo(0.9, 10);
    expect(ef.melhor).toBe(1.2);
    expect(ef.forca).toBe('fraco');

    const maior = linhas([op(), op(), op(), op({ t2: 1.2, boas: 1100 }), op({ t2: 1.2, boas: 1100 }), op({ t2: 1.2, boas: 1100 })]);
    expect(efeitoDoParametro(maior, 't2')!.forca).toBe('razoavel');
  });
});

describe('perdas, ritmo e defeitos', () => {
  it('aponta para onde foi a maior perda', () => {
    const vazias = op({ boas: 1000, retrabalho: { ...RETRABALHO_ZERADO, furo: 20 } }); // 180 vazias × 20 de retrabalho
    expect(maiorPerda(calcular(vazias, MOLDES_FABRICA))).toMatchObject({ tipo: 'vazias', quantidade: 180 });
    const retrabalho = op({ boas: 1000, retrabalho: { ...RETRABALHO_ZERADO, furo: 150 } });
    expect(maiorPerda(calcular(retrabalho, MOLDES_FABRICA))).toMatchObject({ tipo: 'retrabalho', quantidade: 150 });
    expect(maiorPerda(calcular(op({ boas: 1200 }), MOLDES_FABRICA))).toBeNull();
    expect(maiorPerda(calcular(op({ boas: 1000, retrabalho: null }), MOLDES_FABRICA))).toMatchObject({ tipo: 'nao_classificada' });
  });

  it('ritmo em relação ao ciclo teórico', () => {
    // 600 passos em 150 min = 4 ciclos/min; teórico = 60 / 10,3 = 5,83.
    expect(ritmo(calcular(op(), MOLDES_FABRICA), RECEITA)).toBeCloseTo(4 / (60 / 10.3), 10);
    expect(ritmo(calcular(op({ hora_fim: null }), MOLDES_FABRICA), RECEITA)).toBeNull();
  });

  it('ordena os motivos de retrabalho e todo motivo tem regra', () => {
    const o = op({ retrabalho: { ...RETRABALHO_ZERADO, ruga: 3, sem_vacuo: 12, peso: 1 } });
    const motivos = motivosEmOrdem(o, calcular(o, MOLDES_FABRICA));
    expect(motivos.map((m) => [m.chave, m.quantidade])).toEqual([['sem_vacuo', 12], ['ruga', 3], ['peso', 1]]);
    expect(motivos[0].pct).toBeCloseTo(0.01, 10);
    for (const chave of Object.keys(RETRABALHO_ZERADO)) {
      const regra = REGRAS_DEFEITO[chave as keyof typeof REGRAS_DEFEITO];
      expect(regra.resumo.length).toBeGreaterThan(10);
      expect(regra.verificar.length).toBeGreaterThan(0);
    }
  });
});

describe('contexto para a IA', () => {
  it('leva produto, parâmetros com a sigla da tela, resultado e as melhores OPs', () => {
    const base = [op({ boas: 1100, t2: 1.2 }), op({ boas: 900 })];
    const alvo = op({ status: 'aberta', temp_produto_c: -18, observacoes: 'filme enrugando no canto', retrabalho: { ...RETRABALHO_ZERADO, ruga: 30 } });
    const ctx = contextoParaIa(alvo, [...base, alvo], MOLDES_FABRICA, produtos, [RECEITA]) as {
      produto: Record<string, unknown>; parametros: Record<string, number>; receita_padrao: Record<string, number>;
      resultado: Record<string, number>; referencia: { nivel: string; melhores: { parametros: Record<string, number> }[] };
      retrabalho_por_motivo: Record<string, number>;
    };
    expect(ctx.produto).toMatchObject({ especie: 'SALMON', derivacao: 'FRESCATTO CXA 09', molde: '2x1', temperatura_c: -18 });
    expect(ctx.parametros).toMatchObject({ tDome: 225, T2: 1, sp: 40 });
    expect(ctx.receita_padrao.Tmax).toBe(10);
    expect(ctx.resultado.aproveitamento).toBeCloseTo(0.8333, 4);
    expect(ctx.retrabalho_por_motivo.ruga).toBe(30);
    expect(ctx.referencia.nivel).toBe('produto');
    expect(ctx.referencia.melhores[0].parametros.T2).toBe(1.2);
    expect(JSON.stringify(ctx).length).toBeLessThan(40_000);
  });
});
