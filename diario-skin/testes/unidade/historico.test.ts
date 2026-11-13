import { describe, expect, it } from 'vitest';
import { descreverHistorico, type RegistroHistorico } from '../../src/lib/historico';
import { podeEditar } from '../../src/lib/loja';
import type { Perfil } from '../../src/lib/tipos';

const OPERADOR = '33333333-3333-4333-8333-333333333333';
const PD = '22222222-2222-4222-8222-222222222222';
let n = 0;
const reg = (mudancas: RegistroHistorico['mudancas'], resto: Partial<RegistroHistorico> = {}): RegistroHistorico => ({
  id: ++n, op_id: 'op', em: '2026-11-13T11:00:00Z', ate: '2026-11-13T11:00:00Z', por: OPERADOR, criou: false, mudancas, ...resto,
});

describe('histórico de alterações', () => {
  it('descreve criação, digitação, encerramento e correção', () => {
    const h = descreverHistorico([
      reg({ caixas: { de: null, para: 110 }, t2: { de: 1, para: 1.2 }, 'retrabalho.sem_vacuo': { de: 0, para: 5 }, hora_fim: { de: null, para: '10:30:00' } }, { criou: true }),
      reg({ status: { de: 'aberta', para: 'fechada' } }),
      reg({ caixas: { de: 110, para: 111 } }, { por: PD }),
    ]);
    expect(h.map((r) => r.acao)).toEqual(['Criou a OP', 'Encerrou a OP', 'Alterou']);
    expect(h[0].linhas).toEqual([
      'Hora de fim: vazio → 10:30',
      'Caixas: vazio → 110',
      'T2 atraso vácuo int. (s): 1,0 → 1,2',
      'Retrabalho, sem vácuo: 0 → 5',
    ]);
    expect(h[1].linhas).toEqual([]);
    expect(h[2].linhas).toEqual(['Caixas: 110 → 111']);
    expect(h.map((r) => r.correcao)).toEqual([false, false, true]);
    expect(h[2].por).toBe(PD);
  });

  it('paradas, fotos, avaliação da IA, datas e status', () => {
    const h = descreverHistorico([
      reg({
        'parada.a': { de: null, para: '9 min · Outro' }, 'parada.b': { de: '12 min · Troca de bobina de filme', para: null },
        'foto.x': { de: null, para: 'tela' }, 'foto.y': { de: 'produto', para: null },
        analise_ia: { de: null, para: { nota: 7.5, em: '2026-11-13T12:00:00Z' } },
        data: { de: '2026-11-12', para: '2026-11-13' }, parametros_origem: { de: 'padrao', para: 'lido_da_foto' },
        observacoes: { de: 'filme enrugando', para: null },
      }),
      reg({ status: { de: 'aberta', para: 'cancelada' } }),
      reg({ status: { de: 'cancelada', para: 'fechada' } }),
      reg({ status: { de: 'fechada', para: 'aberta' }, caixas: { de: 5, para: 6 } }),
    ]);
    expect(h[0].linhas).toEqual([
      'Data: 12/11/2026 → 13/11/2026',
      'Observações: filme enrugando → vazio',
      'Origem dos parâmetros: receita padrão → lido da foto',
      'Parada incluída: 9 min · Outro',
      'Parada removida: 12 min · Troca de bobina de filme',
      'Foto da tela incluída',
      'Foto do produto removida',
      'Avaliação da foto por IA: sem avaliação → nota 7,5',
    ]);
    expect(h.slice(1).map((r) => r.acao)).toEqual(['Cancelou a OP', 'Restaurou a OP (encerrada)', 'Reabriu a OP']);
    expect(h[3].correcao).toBe(false);
  });

  it('OP criada e encerrada sem conexão chega num registro só', () => {
    const h = descreverHistorico([reg({ status: { de: 'aberta', para: 'fechada' }, caixas: { de: null, para: 25 } }, { criou: true })]);
    expect(h[0].acao).toBe('Criou e encerrou a OP');
    expect(h[0].correcao).toBe(false);
  });

  it('ordena pelos registros mais antigos primeiro, venha como vier', () => {
    const a = reg({ caixas: { de: 1, para: 2 } });
    const b = reg({ caixas: { de: 2, para: 3 } });
    expect(descreverHistorico([b, a]).map((r) => r.id)).toEqual([a.id, b.id]);
  });
});

describe('perfil gestor', () => {
  const perfil = (papel: Perfil['papel'], ativo = true): Perfil => ({ id: 'x', nome: 'X', papel, ativo });
  it('só consulta: não edita OP em nenhum status', () => {
    for (const status of ['aberta', 'fechada', 'cancelada'] as const) {
      expect(podeEditar({ status }, perfil('gestor'))).toBe(false);
    }
  });
  it('os outros perfis continuam como antes', () => {
    expect(podeEditar({ status: 'aberta' }, perfil('operador'))).toBe(true);
    expect(podeEditar({ status: 'fechada' }, perfil('operador'))).toBe(false);
    expect(podeEditar({ status: 'fechada' }, perfil('pd'))).toBe(true);
    expect(podeEditar({ status: 'cancelada' }, perfil('pd'))).toBe(false);
    expect(podeEditar({ status: 'cancelada' }, perfil('admin'))).toBe(true);
    expect(podeEditar({ status: 'aberta' }, perfil('admin', false))).toBe(false);
  });
});
