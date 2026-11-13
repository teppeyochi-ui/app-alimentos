// Painel P&D (seção 8.2): filtros, indicadores, destino das bandejas, motivos,
// parâmetro × resultado, lista de OPs, detalhe, comparação e exportação.
// Calcula tudo a partir dos dados do aparelho (funciona sem internet e já
// inclui o que ainda não foi sincronizado).

import { useMemo, useState } from 'react';
import { BarraDestino, Farol, Kpi, LegendaDestino } from '../componentes/Basicos';
import { CartoesOps, ChipsReceita, EtiquetaStatus } from '../componentes/CartoesOps';
import {
  BarrasH, DestinoPorOp, Dispersao, LegendaProdutos, MARCADOR_OUTROS, marcadoresPorProduto, type Ponto,
} from '../componentes/Graficos';
import { calcular, type Indicadores } from '../lib/calc';
import { META_PARAMETRO, MOTIVOS_RETRABALHO, PARAMETROS } from '../lib/constantes';
import { exportarCsv, exportarXlsx } from '../lib/exportar';
import { dataBR, dataCurta, kg, num, pct } from '../lib/formato';
import { avisar, useLoja } from '../lib/loja';
import type { ChaveParametro, OpLocal } from '../lib/tipos';
import { CompararOps, DetalheOp, tituloOp } from './DetalheOp';

type EixoX = ChaveParametro | 'temp_produto_c';
type EixoY = 'aproveitamento' | 'retrabalho_pct' | 'vazias_pct' | 'produtividade_kg_h' | 'ciclos_por_minuto' | 'sobrepeso' | 'nota_ia';

const EIXOS_Y: { chave: EixoY; nome: string; percentual: boolean; casas: number }[] = [
  { chave: 'aproveitamento', nome: 'Aproveitamento de bandejas (%)', percentual: true, casas: 1 },
  { chave: 'retrabalho_pct', nome: 'Retrabalho (%)', percentual: true, casas: 1 },
  { chave: 'vazias_pct', nome: 'Vazias (%)', percentual: true, casas: 1 },
  { chave: 'produtividade_kg_h', nome: 'Produtividade (kg/h)', percentual: false, casas: 0 },
  { chave: 'ciclos_por_minuto', nome: 'Ciclos por minuto', percentual: false, casas: 1 },
  { chave: 'sobrepeso', nome: 'Sobrepeso (%)', percentual: true, casas: 1 },
  { chave: 'nota_ia', nome: 'Nota de aparência da foto (IA, 0 a 10)', percentual: false, casas: 1 },
];

const MAX_BARRAS = 40;

interface Linha { o: OpLocal; c: Indicadores }

const soma = (linhas: Linha[], f: (l: Linha) => number | null | undefined): number =>
  linhas.reduce((s, l) => s + (f(l) || 0), 0);

export default function Painel({ abrirNoLancamento }: { abrirNoLancamento: (id: string) => void }) {
  const e = useLoja();
  const ehAdmin = e.perfil?.papel === 'admin';
  const [fProduto, setFProduto] = useState('');
  const [fIni, setFIni] = useState('');
  const [fFim, setFFim] = useState('');
  const [comHistorico, setComHistorico] = useState(true);
  const [comCanceladas, setComCanceladas] = useState(false);
  const [eixoX, setEixoX] = useState<EixoX>('t2');
  const [eixoY, setEixoY] = useState<EixoY>('aproveitamento');
  const [detalhe, setDetalhe] = useState<string | null>(null);
  const [comparar, setComparar] = useState<[string, string] | null>(null);
  const [exportando, setExportando] = useState(false);

  // Produtos na ordem em que apareceram (define cor e forma na dispersão; não muda com os filtros).
  const produtosEmOrdem = useMemo(() => {
    const ordenadas = [...e.ops].sort(
      (a, b) => (a.data ?? '').localeCompare(b.data ?? '') || (a.criado_em ?? '').localeCompare(b.criado_em ?? '') || a.id.localeCompare(b.id),
    );
    return [...new Set(ordenadas.map((o) => o.produto_descricao))];
  }, [e.ops]);
  const marcadores = useMemo(() => marcadoresPorProduto(produtosEmOrdem), [produtosEmOrdem]);
  const produtos = useMemo(() => [...produtosEmOrdem].filter(Boolean).sort((a, b) => a.localeCompare(b)), [produtosEmOrdem]);

  const linhas: Linha[] = useMemo(
    () =>
      e.ops
        .filter(
          (o) =>
            (comCanceladas || o.status !== 'cancelada') &&
            (!fProduto || o.produto_descricao === fProduto) &&
            (comHistorico || o.origem !== 'planilha') &&
            // Com período definido, OP sem data fica de fora.
            (!fIni || (o.data != null && o.data >= fIni)) &&
            (!fFim || (o.data != null && o.data <= fFim)),
        )
        .sort((a, b) => (a.data ?? '').localeCompare(b.data ?? '') || (a.criado_em ?? '').localeCompare(b.criado_em ?? ''))
        .map((o) => ({ o, c: calcular(o, e.moldes) })),
    [e.ops, e.moldes, fProduto, fIni, fFim, comHistorico, comCanceladas],
  );

  // ---------------------------------------------------------------- indicadores do filtro
  const comDestino = linhas.filter((l) => l.c.bandejas_formadas && l.c.embalagens_boas != null);
  const formadas = soma(comDestino, (l) => l.c.bandejas_formadas);
  const boas = soma(comDestino, (l) => l.c.embalagens_boas);
  const classificadas = comDestino.filter((l) => l.c.retrabalho != null);
  const formadasClass = soma(classificadas, (l) => l.c.bandejas_formadas);
  const aproveitamento = formadas ? boas / formadas : null;
  const comTempo = linhas.filter((l) => l.c.horas && l.o.peso_final_kg);
  const horas = soma(comTempo, (l) => l.c.horas);
  const doDiario = linhas.filter((l) => l.o.origem !== 'planilha').length;
  const emAndamento = linhas.filter((l) => l.o.status === 'aberta').length;

  // ---------------------------------------------------------------- motivos
  const pareto: [string, number][] = MOTIVOS_RETRABALHO
    .map((m): [string, number] => [m.nome, soma(linhas, (l) => l.o.retrabalho?.[m.chave])])
    .filter((p) => p[1] > 0)
    .sort((a, b) => b[1] - a[1]);
  const porParada = new Map<string, number>();
  for (const l of linhas) for (const p of l.o.paradas) porParada.set(p.motivo, (porParada.get(p.motivo) ?? 0) + p.minutos);
  const paradas = [...porParada.entries()].sort((a, b) => b[1] - a[1]);

  // ---------------------------------------------------------------- dispersão
  const metaY = EIXOS_Y.find((y) => y.chave === eixoY)!;
  const nomeX = eixoX === 'temp_produto_c' ? 'Temp. do produto (°C)' : `${META_PARAMETRO[eixoX].nome} (${META_PARAMETRO[eixoX].unidade})`;
  const casasX = eixoX === 'temp_produto_c' ? 1 : META_PARAMETRO[eixoX].casas;
  const pontos: Ponto[] = linhas.flatMap((l) => {
    const x = l.o[eixoX];
    const y = eixoY === 'nota_ia' ? l.o.analise_ia?.nota_aparencia ?? null : l.c[eixoY];
    return x != null && y != null && Number.isFinite(y)
      ? [{ id: l.o.id, x, y, produto: l.o.produto_descricao, rotulo: `${dataBR(l.o.data)} · ${tituloOp(l.o)}` }]
      : [];
  });
  const produtosNoGrafico = [...new Set(pontos.map((p) => p.produto))];
  const legendaProdutos = produtosNoGrafico
    .filter((p) => marcadores.has(p))
    .map((p) => ({ nome: p, marcador: marcadores.get(p)! }))
    .concat(produtosNoGrafico.some((p) => !marcadores.has(p)) ? [{ nome: 'Outros produtos', marcador: MARCADOR_OUTROS }] : []);

  // ---------------------------------------------------------------- lista
  const recentes = [...linhas].reverse();
  const barras = recentes.filter((l) => l.c.bandejas_formadas && l.c.embalagens_boas != null);
  const opDetalhe = detalhe ? e.ops.find((o) => o.id === detalhe) ?? null : null;
  const opsComparar = comparar ? comparar.map((id) => e.ops.find((o) => o.id === id)) : null;

  const etiquetaStatus = (o: OpLocal) => <EtiquetaStatus o={o} />;
  const receitaDe = (o: OpLocal) => <ChipsReceita o={o} receitas={e.receitas} />;

  async function exportar(formato: 'csv' | 'xlsx') {
    const dados = { ops: linhas.map((l) => l.o), moldes: e.moldes, receitas: e.receitas, perfis: e.perfis, produtos: e.produtos };
    setExportando(true);
    try {
      if (formato === 'csv') exportarCsv(dados);
      else await exportarXlsx(dados);
    } catch (erro) {
      console.error(erro);
      avisar('Não foi possível gerar o arquivo.', 'erro');
    } finally {
      setExportando(false);
    }
  }

  return (
    <div className="pilha">
      <section className="card" aria-label="Filtros e indicadores">
        <div className="filtros">
          <label>
            Produto
            <select aria-label="Produto" value={fProduto} onChange={(ev) => setFProduto(ev.target.value)}>
              <option value="">Todos</option>
              {produtos.map((p) => <option key={p}>{p}</option>)}
            </select>
          </label>
          <label>Desde<input type="date" value={fIni} onChange={(ev) => setFIni(ev.target.value)} /></label>
          <label>Até<input type="date" value={fFim} onChange={(ev) => setFFim(ev.target.value)} /></label>
          <label className="linha">
            <input type="checkbox" checked={comHistorico} onChange={(ev) => setComHistorico(ev.target.checked)} />
            incluir histórico da planilha
          </label>
          {ehAdmin && (
            <label className="linha">
              <input type="checkbox" checked={comCanceladas} onChange={(ev) => setComCanceladas(ev.target.checked)} />
              mostrar canceladas
            </label>
          )}
          <div className="exportar">
            <button type="button" onClick={() => void exportar('csv')} disabled={exportando || !linhas.length}>Exportar CSV</button>
            <button type="button" onClick={() => void exportar('xlsx')} disabled={exportando || !linhas.length}>Exportar XLSX</button>
          </div>
        </div>
        {linhas.length > 0 && (
          <div className="kpis">
            <Kpi rotulo="OPs" valor={num(linhas.length)} sub={`${num(doDiario)} do diário · ${num(emAndamento)} em andamento`} />
            <Kpi rotulo="Bandejas formadas" valor={num(formadas)} sub={`${num(boas)} embalagens boas`} />
            <Kpi rotulo="Aproveitamento" valor={pct(aproveitamento)} sub={aproveitamento != null ? <Farol aproveitamento={aproveitamento} /> : 'ponderado pelas bandejas'} />
            <Kpi rotulo="Retrabalho" valor={formadasClass ? pct(soma(classificadas, (l) => l.c.retrabalho) / formadasClass) : '—'} sub="das bandejas · OPs do diário" />
            <Kpi rotulo="Vazias" valor={formadasClass ? pct(soma(classificadas, (l) => l.c.vazias) / formadasClass) : '—'} sub="das bandejas · OPs do diário" />
            <Kpi
              rotulo="Filme perdido" valor={kg(soma(linhas, (l) => l.c.filme_perdido_kg), 1)}
              sub={`fundo ${num(soma(linhas, (l) => l.c.filme_fundo_perdido_kg), 1)} · tampa ${num(soma(linhas, (l) => l.c.filme_tampa_perdido_kg), 1)} kg`}
            />
            <Kpi rotulo="Produtividade" valor={horas ? `${num(soma(comTempo, (l) => l.o.peso_final_kg) / horas)} kg/h` : '—'} sub="média ponderada pelo tempo" />
          </div>
        )}
      </section>

      {linhas.length === 0 ? (
        <div className="vazio">
          <b>Nenhuma OP neste filtro</b>
          <span>Lance uma OP na aba “Lançar OP” ou ajuste os filtros.</span>
        </div>
      ) : (
        <>
          <div className="charts">
            <section className="card" aria-labelledby="t-destino">
              <div className="sec-h"><h3 id="t-destino">Destino das bandejas por OP</h3><span className="muted small">100% = bandejas formadas</span></div>
              {barras.length ? (
                <>
                  <DestinoPorOp
                    linhas={barras.slice(0, MAX_BARRAS).map((l) => ({ id: l.o.id, rotulo: `${dataCurta(l.o.data)} ${l.o.produto_descricao}`, c: l.c }))}
                    aoAbrir={setDetalhe}
                  />
                  <LegendaDestino />
                  {barras.length > MAX_BARRAS && (
                    <p className="small muted">Mostrando as {MAX_BARRAS} OPs mais recentes de {barras.length}. A lista abaixo tem todas.</p>
                  )}
                </>
              ) : (
                <div className="vazio small">Nenhuma OP do filtro tem passos e embalagens boas para calcular o destino.</div>
              )}
            </section>
            <section className="card" aria-label="Motivos de retrabalho e paradas">
              <h3>Motivos de retrabalho</h3>
              {pareto.length ? (
                <BarrasH itens={pareto} cor="var(--c-retr)" unidade=" emb." rotulo="Embalagens retrabalhadas por motivo" />
              ) : (
                <div className="vazio small">Sem retrabalho classificado ainda. Os contadores “+1” do lançamento alimentam este gráfico.</div>
              )}
              <h3>Paradas</h3>
              {paradas.length ? (
                <BarrasH itens={paradas} cor="var(--accent)" unidade=" min" rotulo="Minutos parados por motivo" />
              ) : (
                <div className="vazio small">Sem paradas registradas.</div>
              )}
            </section>
          </div>

          <section className="card" aria-labelledby="t-disp">
            <div className="sec-h">
              <h3 id="t-disp">Parâmetro × resultado</h3>
              <div className="row" style={{ flex: '1 1 300px', justifyContent: 'flex-end' }}>
                <label style={{ maxWidth: 260 }}>
                  Parâmetro (eixo horizontal)
                  <select aria-label="Parâmetro (eixo horizontal)" value={eixoX} onChange={(ev) => setEixoX(ev.target.value as EixoX)}>
                    {PARAMETROS.map((p) => <option key={p.chave} value={p.chave}>{p.nome} ({p.unidade})</option>)}
                    <option value="temp_produto_c">Temp. do produto (°C)</option>
                  </select>
                </label>
                <label style={{ maxWidth: 260 }}>
                  Resultado (eixo vertical)
                  <select aria-label="Resultado (eixo vertical)" value={eixoY} onChange={(ev) => setEixoY(ev.target.value as EixoY)}>
                    {EIXOS_Y.map((y) => <option key={y.chave} value={y.chave}>{y.nome}</option>)}
                  </select>
                </label>
              </div>
            </div>
            {pontos.length < 2 ? (
              <div className="vazio small">
                Precisa de pelo menos 2 OPs com “{nomeX}” e “{metaY.nome}”. As OPs do histórico não têm parâmetros:
                eles começam a aparecer com os lançamentos do diário.
              </div>
            ) : (
              <>
                <Dispersao
                  pontos={pontos} nomeX={nomeX} nomeY={metaY.nome} yPercentual={metaY.percentual}
                  casasY={metaY.casas} casasX={casasX} marcadores={marcadores} aoAbrir={setDetalhe}
                />
                <LegendaProdutos itens={legendaProdutos} />
              </>
            )}
            <p className="small muted">
              Cada ponto é uma OP; cor e forma identificam o produto. Compare só OPs do mesmo produto (filtro acima)
              para isolar o efeito do parâmetro. Toque no ponto para abrir o detalhe.
            </p>
          </section>

          <section className="card" aria-labelledby="t-lista">
            <div className="sec-h"><h3 id="t-lista">OPs registradas</h3><span className="muted small">toque numa OP para ver fotos e detalhes</span></div>
            <div className="tbl ops-tabela">
              <table>
                <thead>
                  <tr>
                    <th>Data</th><th>Produto</th><th>OP</th><th>Status</th><th className="n">Bandejas</th><th>Destino</th>
                    <th className="n">Aprov.</th><th className="n">Retrab.</th><th className="n">Vazias</th><th className="n">kg/h</th>
                    <th className="n">Ciclos/min</th><th className="n">Filme perdido</th><th>Parâmetros alterados</th><th className="n">Fotos</th>
                  </tr>
                </thead>
                <tbody>
                  {recentes.map(({ o, c }) => (
                    <tr key={o.id} className="clicavel" onClick={() => setDetalhe(o.id)}>
                      <td>
                        <button type="button" className="abrir" aria-label={`Abrir detalhe: ${dataBR(o.data)} · ${tituloOp(o)}`}>{dataBR(o.data)}</button>
                      </td>
                      <td className="prod" title={o.produto_codigo ?? undefined}>{o.produto_descricao || '—'}</td>
                      <td className="mono">{o.op || '—'}</td>
                      <td>{etiquetaStatus(o)}</td>
                      <td className="n">{num(c.bandejas_formadas)}</td>
                      <td className="bar-cell"><BarraDestino c={c} /></td>
                      <td className="n">{pct(c.aproveitamento)}</td>
                      <td className="n">{pct(c.retrabalho_pct)}</td>
                      <td className="n">{pct(c.vazias_pct)}</td>
                      <td className="n">{num(c.produtividade_kg_h)}</td>
                      <td className="n">{num(c.ciclos_por_minuto, 1)}</td>
                      <td className="n">{kg(c.filme_perdido_kg)}</td>
                      <td>{receitaDe(o)}</td>
                      <td className="n">{o.fotos.length || ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <CartoesOps linhas={recentes} receitas={e.receitas} aoAbrir={setDetalhe} />
          </section>
        </>
      )}

      {opDetalhe && !opsComparar && (
        <DetalheOp
          op={opDetalhe}
          e={e}
          aoFechar={() => setDetalhe(null)}
          abrirNoLancamento={(id) => { setDetalhe(null); abrirNoLancamento(id); }}
          aoComparar={(outra) => setComparar([opDetalhe.id, outra])}
        />
      )}
      {opsComparar && opsComparar[0] && opsComparar[1] && (
        <CompararOps a={opsComparar[0]} b={opsComparar[1]} e={e} aoFechar={() => setComparar(null)} />
      )}
    </div>
  );
}
