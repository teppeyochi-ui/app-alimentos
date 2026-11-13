import { strFromU8, unzipSync } from 'fflate';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MOLDES_FABRICA } from '../../src/lib/calc';
import { RECEITA_FABRICA, RETRABALHO_ZERADO } from '../../src/lib/constantes';
import { gerarCsv, lerCsv, lerCsvObjetos } from '../../src/lib/csv';
import { tabelaOps, tabelaParadas } from '../../src/lib/exportar';
import { historicoDoCsv, produtosDoCsv } from '../../src/lib/semente';
import type { Op } from '../../src/lib/tipos';
import { coluna, gerarXlsx } from '../../src/lib/xlsx';

const historico = historicoDoCsv(readFileSync('dados/historico.csv', 'utf8'));
const opDeTeste: Op = {
  ...historico[0], ...RECEITA_FABRICA, t2: 1.2,
  id: 'aaaaaaaa-0000-4000-8000-000000000001', origem: 'diario', data: '2026-11-12', op: '20109999',
  produto_descricao: 'Produto com ; ponto e vírgula e "aspas"', embalagens_por_caixa: 9, caixas: 110, embalagens_avulsas: 0,
  hora_inicio: '08:00', hora_fim: '10:30', passo_inicio: 0, passo_fim: 600, peso_final_kg: 620, peso_nominal_kg: 0.6,
  retrabalho: { ...RETRABALHO_ZERADO, sem_vacuo: 5, furo: 2 },
  paradas: [{ id: 'p1', motivo: 'Troca de bobina de filme', minutos: 12 }],
  observacoes: 'linha 1\nlinha 2 <&>',
};
const dados = {
  ops: [...historico, opDeTeste], moldes: MOLDES_FABRICA,
  receitas: [{ ...RECEITA_FABRICA, id: 1, vigente_desde: '2026-01-01T03:00:00.000Z', ciclo_teorico_s: 10.3 }], perfis: [],
};

describe('CSV', () => {
  it('lê campos entre aspas, com separador e quebra de linha dentro', () => {
    expect(lerCsv('a;b\r\n"x;y";"dito ""assim"""\n\n"duas\nlinhas";z\n')).toEqual([['a', 'b'], ['x;y', 'dito "assim"'], ['duas\nlinhas', 'z']]);
    expect(lerCsvObjetos('﻿Codigo;Descricao\n1;um\n')).toEqual([{ codigo: '1', descricao: 'um' }]);
  });

  it('importação de produtos aponta as linhas com problema', () => {
    const r = produtosDoCsv('codigo;descricao;molde;peso_nominal_kg;embalagens_por_caixa\nA-1;Produto A;3x1;0,25;12\nB-2;Produto B;4x1;;\n;Sem código;2x1;;\n');
    expect(r.produtos).toEqual([{
      codigo: 'A-1', descricao: 'Produto A', molde: '3x1', peso_nominal_kg: 0.25, embalagens_por_caixa: 12,
      derivacao: null, peso_caixa_kg: null, especie: null, molde_a_confirmar: false, ativo: true,
    }]);
    expect(r.erros).toHaveLength(2);
  });

  it('importação aceita as colunas da planilha de produtos e o molde vazio', () => {
    const r = produtosDoCsv('SKU;DESCR_PRO;DESCR_AGP;DESCR_DER;MOLDE;peso_nominal_kg\nA-1;Produto A;SALMON;FRESCATTO CXA 7,5;;0,5\nB-2;Produto B PDV;DOURADO;FRESC CXA PDV PF;3x1;\n');
    expect(r.erros).toEqual([]);
    expect(r.produtos).toEqual([
      { codigo: 'A-1', descricao: 'Produto A', molde: null, molde_a_confirmar: true, peso_nominal_kg: 0.5, embalagens_por_caixa: 15, derivacao: 'FRESCATTO CXA 7,5', peso_caixa_kg: 7.5, especie: 'SALMON', ativo: true },
      { codigo: 'B-2', descricao: 'Produto B PDV', molde: '3x1', molde_a_confirmar: false, peso_nominal_kg: null, embalagens_por_caixa: null, derivacao: 'FRESC CXA PDV PF', peso_caixa_kg: null, especie: 'DOURADO', ativo: true },
    ]);
  });

  it('exporta todas as OPs com vírgula decimal e volta a ler igual', () => {
    const t = tabelaOps(dados);
    const linhas = lerCsv(gerarCsv(t.cabecalho, t.linhas));
    expect(linhas).toHaveLength(17);
    expect(linhas.every((l) => l.length === t.cabecalho.length)).toBe(true);
    const ultima = Object.fromEntries(t.cabecalho.map((c, i) => [c, linhas[16][i]]));
    expect(ultima['Produto']).toBe('Produto com ; ponto e vírgula e "aspas"');
    expect(ultima['Aproveitamento (%)']).toBe('82,5');
    expect(ultima['Bandejas formadas']).toBe('1200');
    expect(ultima['Filme perdido (kg)']).toBe('7,372');
    expect(ultima['Parâmetros alterados']).toBe('T2 atraso vácuo int.');
    expect(ultima['Observações']).toBe('linha 1\nlinha 2 <&>');
  });
});

describe('XLSX', () => {
  it('nomes de coluna', () => {
    expect([0, 25, 26, 27, 701, 702].map(coluna)).toEqual(['A', 'Z', 'AA', 'AB', 'ZZ', 'AAA']);
  });

  it('gera um pacote válido com as planilhas OPs e Paradas', () => {
    const t = tabelaOps(dados);
    const zip = unzipSync(gerarXlsx([t, tabelaParadas(dados)]));
    expect(Object.keys(zip).sort()).toEqual([
      '[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/workbook.xml',
      'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml',
    ]);
    expect(strFromU8(zip['xl/workbook.xml'])).toContain('<sheet name="OPs" sheetId="1" r:id="rId1"/><sheet name="Paradas" sheetId="2" r:id="rId2"/>');
    const folha = strFromU8(zip['xl/worksheets/sheet1.xml']);
    expect(folha.match(/<row /g)).toHaveLength(17);
    // Número vai como número (com ponto), texto vai escapado.
    const colAprov = coluna(t.cabecalho.indexOf('Aproveitamento (%)'));
    expect(folha).toContain(`<c r="${colAprov}17"><v>82.5</v></c>`);
    expect(folha).toContain('Produto com ; ponto e vírgula e &quot;aspas&quot;');
    expect(folha).toContain('linha 2 &lt;&amp;&gt;');
    expect(strFromU8(zip['xl/worksheets/sheet2.xml'])).toContain('Troca de bobina de filme');
  });
});
