#!/usr/bin/env node
// Gera a carga inicial e o instalador do banco a partir dos CSVs de dados/.
//   node ferramentas/gerar-sql.mjs
//
// Saídas:
//   supabase/seed.sql      — moldes, receita padrão, catálogo e histórico (seção 6)
//   supabase/instalar.sql  — todas as migrações + a carga, num arquivo só,
//                            para colar no SQL Editor do Supabase.

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const ler = (arq) => readFileSync(join(raiz, arq), 'utf8');

function csv(arq) {
  const [cab, ...linhas] = ler(arq).split(/\r?\n/).filter((l) => l.trim() !== '');
  const nomes = cab.split(';');
  return linhas.map((l) => {
    const campos = l.split(';');
    return Object.fromEntries(nomes.map((n, i) => [n, (campos[i] ?? '').trim()]));
  });
}

const txt = (v) => (v === '' || v == null ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
const num = (v) => (v === '' || v == null ? 'null' : String(Number(v)));

const produtos = csv('dados/catalogo.csv');
const historico = csv('dados/historico.csv');
if (produtos.length !== 118) throw new Error(`Catálogo com ${produtos.length} itens; esperado 118.`);
if (historico.length !== 15) throw new Error(`Histórico com ${historico.length} linhas; esperado 15.`);

const idHistorico = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

let s = `-- Diário da Linha Skin — carga inicial (seção 6 da especificação).
-- Gerado por ferramentas/gerar-sql.mjs a partir de dados/catalogo.csv e dados/historico.csv.
-- Pode ser rodado mais de uma vez: não duplica nem sobrescreve o que já foi alterado.

-- 6.1 Moldes e filme (kg de filme por bandeja)
--   Passo da máquina: 0,42 m × 0,27 m = 0,1134 m² de filme.
--   Fundo: Evert Skin 400 µ, 0,4952 kg/m².
--   Tampa 3x1: Solupack Skin 100 µ, 0,0826 kg/m². Tampa 2x1: Solupack Skin, 0,1239 kg/m².
insert into public.moldes (molde, cavidades, filme_fundo_kg_bdj, filme_tampa_kg_bdj) values
  ('2x1', 2, 0.0280780, 0.0070249),
  ('3x1', 3, 0.0187187, 0.0031222)
on conflict (molde) do nothing;

-- 6.2 Receita padrão da máquina (ciclo teórico da estação: 10,3 s)
insert into public.receitas_padrao
  (vigente_desde, t_dome, t_pre, t1, t2, t4, t5, t6, t7, p_vent, sp, tx, tmax, ciclo_teorico_s)
select '2026-01-01 00:00:00-03', 225, 110, 0.8, 1.0, 0.0, 0.0, 4.0, 0.2, 500, 40, 0.5, 10.0, 10.3
where not exists (select 1 from public.receitas_padrao);

-- 6.4 Catálogo de produtos skin (${produtos.length} SKUs, da planilha de produtos do P&D)
--   derivacao = DESCR_DER; peso_caixa_kg = caixa escrita na derivação (vazio = PDV);
--   embalagens_por_caixa = peso da caixa ÷ peso nominal, quando a conta fecha;
--   molde vazio = a planilha não traz (o operador escolhe na OP);
--   molde_a_confirmar = molde vazio ou herdado do mesmo produto em outra origem.
insert into public.produtos
  (codigo, descricao, molde, molde_a_confirmar, peso_nominal_kg, embalagens_por_caixa, derivacao, peso_caixa_kg, especie)
values
${produtos
  .map(
    (p) =>
      `  (${txt(p.codigo)}, ${txt(p.descricao)}, ${txt(p.molde)}, ${p.molde_a_confirmar === 'sim' || p.molde === '' ? 'true' : 'false'}, ` +
      `${num(p.peso_nominal_kg)}, ${num(p.embalagens_por_caixa)}, ` +
      `${txt(p.derivacao)}, ${num(p.peso_caixa_kg)}, ${txt(p.especie)})`,
  )
  .join(',\n')}
on conflict (codigo) do nothing;

-- 6.5 Histórico da planilha de controle (${historico.length} produções)
--   Sem caixas, retrabalho, paradas, parâmetros nem fotos. Linhas sem código têm
--   duas derivações possíveis no catálogo: produto_codigo fica nulo.
insert into public.ops
  (id, origem, status, data, produto_codigo, produto_descricao, op, molde, peso_nominal_kg,
   hora_inicio, hora_fim, passo_inicio, passo_fim, peso_final_kg, embalagens_avulsas)
values
${historico
  .map(
    (h, i) =>
      `  (${txt(idHistorico(i + 1))}, 'planilha', 'fechada', ${txt(h.data)}, ${txt(h.codigo)}, ${txt(h.produto)}, ` +
      `${txt(h.op)}, ${txt(h.molde)}, ${num(h.peso_nominal_kg)}, ${txt(h.hora_inicio)}, ${txt(h.hora_fim)}, ` +
      `${num(h.passo_inicio)}, ${num(h.passo_fim)}, ${num(h.peso_final_kg)}, null)`,
  )
  .join(',\n')}
on conflict (id) do nothing;
`;

writeFileSync(join(raiz, 'supabase/seed.sql'), s);
console.log('supabase/seed.sql');

const migracoes = readdirSync(join(raiz, 'supabase/migrations')).filter((f) => f.endsWith('.sql')).sort();
const instalar =
  `-- Diário da Linha Skin — instalação completa do banco num arquivo só.
-- Gerado por ferramentas/gerar-sql.mjs: junta supabase/migrations/*.sql e supabase/seed.sql.
-- Uso: Supabase → SQL Editor → colar tudo → Run. Rodar UMA vez, num projeto novo.

` +
  migracoes.map((f) => `-- ==================== ${f} ====================\n\n${ler('supabase/migrations/' + f)}`).join('\n') +
  `\n-- ==================== seed.sql ====================\n\n${s}`;
writeFileSync(join(raiz, 'supabase/instalar.sql'), instalar);
console.log('supabase/instalar.sql');
