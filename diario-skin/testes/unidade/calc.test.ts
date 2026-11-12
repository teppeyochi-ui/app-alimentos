import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  MOLDES_FABRICA, calcular, horasEntre, parametrosAlterados, receitaVigente, validarEncerramento,
} from '../../src/lib/calc';
import { RECEITA_FABRICA, RETRABALHO_ZERADO } from '../../src/lib/constantes';
import { gramas, kg, lerNumero, num, pct } from '../../src/lib/formato';
import { historicoDoCsv, produtosDoCsv } from '../../src/lib/semente';
import type { Op, ReceitaPadrao } from '../../src/lib/tipos';

const catalogo = produtosDoCsv(readFileSync('dados/catalogo.csv', 'utf8'));
const historico = historicoDoCsv(readFileSync('dados/historico.csv', 'utf8'));

const base: Pick<Op,
  'molde' | 'passo_inicio' | 'passo_fim' | 'caixas' | 'embalagens_por_caixa' | 'embalagens_avulsas' |
  'peso_final_kg' | 'peso_nominal_kg' | 'hora_inicio' | 'hora_fim' | 'retrabalho' | 'paradas'> = {
  molde: '2x1', passo_inicio: 0, passo_fim: 600, caixas: 110, embalagens_por_caixa: 9, embalagens_avulsas: 0,
  peso_final_kg: 620, peso_nominal_kg: 0.6, hora_inicio: '08:00', hora_fim: '10:30',
  retrabalho: { ...RETRABALHO_ZERADO, sem_vacuo: 5, furo: 2 }, paradas: [],
};

describe('carga inicial', () => {
  it('catálogo tem 91 produtos, sem erro e sem código repetido', () => {
    expect(catalogo.erros).toEqual([]);
    expect(catalogo.produtos).toHaveLength(91);
    expect(new Set(catalogo.produtos.map((p) => p.codigo)).size).toBe(91);
  });

  it('critério 1: produto 16507014073621-011 é molde 3x1 e peso nominal 0,2 kg', () => {
    const p = catalogo.produtos.find((x) => x.codigo === '16507014073621-011');
    expect(p?.molde).toBe('3x1');
    expect(p?.peso_nominal_kg).toBe(0.2);
  });

  it('histórico tem 15 produções fechadas, de origem planilha', () => {
    expect(historico).toHaveLength(15);
    expect(historico.every((o) => o.origem === 'planilha' && o.status === 'fechada')).toBe(true);
    expect(historico.filter((o) => o.produto_codigo == null)).toHaveLength(4);
    expect(historico.filter((o) => o.data == null)).toHaveLength(2);
  });
});

describe('critério 2: OP de teste', () => {
  const c = calcular(base, MOLDES_FABRICA);

  it('contagens', () => {
    expect(c.bandejas_formadas).toBe(1200);
    expect(c.embalagens_boas).toBe(990);
    expect(c.retrabalho).toBe(7);
    expect(c.vazias).toBe(203);
    expect(c.perda_nao_classificada).toBeNull();
  });

  it('valores como aparecem na tela', () => {
    expect(pct(c.aproveitamento)).toBe('82,5%');
    expect(kg(c.filme_perdido_kg)).toBe('7,37 kg');
    expect(num(c.filme_fundo_perdido_kg, 2)).toBe('5,90');
    expect(num(c.filme_tampa_perdido_kg, 2)).toBe('1,48');
    expect(num(c.filme_g_por_kg, 0)).toBe('68');
    expect(num(c.produtividade_kg_h, 0)).toBe('248');
    expect(num(c.ciclos_por_minuto, 1)).toBe('4,0');
    expect(gramas(c.peso_medio_kg)).toBe('626 g');
    expect(pct(c.sobrepeso)).toBe('4,4%');
  });

  it('pode encerrar, sem aviso', () => {
    expect(validarEncerramento(base, c)).toEqual({ faltas: [], bloqueios: [], avisos: [] });
  });
});

describe('critério 3: histórico', () => {
  it('Salmão 600 g de 2026-10-10 → 1.598 bandejas, 1.365 boas, aproveitamento 85%', () => {
    const op = historico.find((o) => o.data === '2026-10-10')!;
    const c = calcular(op, MOLDES_FABRICA);
    expect(c.bandejas_formadas).toBe(1598);
    expect(c.embalagens_boas).toBe(1365);
    expect(c.boas_por).toBe('peso');
    expect(pct(c.aproveitamento, 0)).toBe('85%');
    expect(c.retrabalho).toBeNull();
    expect(c.vazias).toBeNull();
    expect(c.perda_nao_classificada).toBe(233);
    expect(c.sobrepeso).toBeNull();
  });

  it('peso variável (lagosta) fica sem embalagens boas', () => {
    const op = historico.find((o) => o.data === '2026-10-08' && o.produto_codigo === '16516063001581-219')!;
    const c = calcular(op, MOLDES_FABRICA);
    expect(c.bandejas_formadas).toBe(670);
    expect(c.embalagens_boas).toBeNull();
    expect(c.aproveitamento).toBeNull();
  });
});

describe('regras', () => {
  it('virada de dia soma 24 h', () => {
    expect(horasEntre('22:00', '02:30')).toBe(4.5);
    expect(horasEntre('08:00', null)).toBeNull();
  });

  it('bloqueia quando boas + retrabalho passam de 102% das formadas', () => {
    const op = { ...base, caixas: 136 }; // 1.224 boas + 7 > 1.224
    const v = validarEncerramento(op, calcular(op, MOLDES_FABRICA));
    expect(v.bloqueios).toEqual(['Boas + retrabalho passam das bandejas formadas. Confira passos e caixas.']);
  });

  it('tolera até 2% acima e só avisa do aproveitamento', () => {
    const op = { ...base, caixas: 135, retrabalho: { ...RETRABALHO_ZERADO } }; // 1.215 boas
    const v = validarEncerramento(op, calcular(op, MOLDES_FABRICA));
    expect(v.bloqueios).toEqual([]);
    expect(v.avisos).toHaveLength(1);
  });

  it('avisa acima de 8 ciclos por minuto', () => {
    const op = { ...base, hora_fim: '09:00' }; // 600 passos em 60 min
    const v = validarEncerramento(op, calcular(op, MOLDES_FABRICA));
    expect(v.avisos.some((a) => a.includes('8 ciclos'))).toBe(true);
  });

  it('lista o que falta para encerrar', () => {
    const op = { ...base, hora_fim: null, passo_fim: null, caixas: null, peso_final_kg: null, embalagens_por_caixa: null, peso_nominal_kg: null };
    const v = validarEncerramento(op, calcular(op, MOLDES_FABRICA));
    expect(v.faltas).toEqual(['hora de fim', 'passo no fim', 'caixas', 'peso final', 'embalagens por caixa ou peso nominal']);
  });

  it('parâmetros alterados em relação à receita padrão', () => {
    expect(parametrosAlterados({ ...RECEITA_FABRICA, t2: 1.2, sp: 30 }, RECEITA_FABRICA)).toEqual(['t2', 'sp']);
    expect(parametrosAlterados({ ...RECEITA_FABRICA, t2: null }, RECEITA_FABRICA)).toEqual([]);
  });

  it('receita vigente na data da OP', () => {
    const r = (id: number, desde: string): ReceitaPadrao => ({ ...RECEITA_FABRICA, id, vigente_desde: desde, ciclo_teorico_s: 10.3 });
    const lista = [r(2, '2026-11-01T00:00:00Z'), r(1, '2026-01-01T00:00:00Z')];
    expect(receitaVigente(lista, '2026-10-10')?.id).toBe(1);
    expect(receitaVigente(lista, '2026-11-05')?.id).toBe(2);
    expect(receitaVigente(lista, '2025-06-01')?.id).toBe(1);
    expect(receitaVigente(lista, null)?.id).toBe(2);
    expect(receitaVigente([], '2026-11-05')).toBeNull();
  });

  it('lê números com vírgula ou ponto', () => {
    expect(lerNumero('0,8')).toBe(0.8);
    expect(lerNumero('0.8')).toBe(0.8);
    expect(lerNumero('1.234,5')).toBe(1234.5);
    expect(lerNumero('-18')).toBe(-18);
    expect(lerNumero('5,')).toBe(5);
    expect(lerNumero('')).toBeNull();
    expect(lerNumero('abc')).toBeNull();
  });
});
