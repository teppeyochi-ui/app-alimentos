// Resumo: acompanhamento da produção para a chefia, pensado para o celular.
// Em cima, os indicadores do período; embaixo, as OPs registradas (tocar abre
// o detalhe). Só leitura: nada aqui altera dados. Funciona sem internet.

import { useMemo, useState } from 'react';
import { BarraDestino, Farol, Kpi, LegendaDestino } from '../componentes/Basicos';
import { CartoesOps } from '../componentes/CartoesOps';
import { BarrasH, Tendencia } from '../componentes/Graficos';
import { APROVEITAMENTO_BOM } from '../lib/constantes';
import { dataBR, hojeISO, kg, num, pct } from '../lib/formato';
import { useLoja } from '../lib/loja';
import {
  PERIODOS, calcularLinhas, doPeriodo, intervalo, motivosDoPeriodo, porDia, totais, type Periodo,
} from '../lib/resumo';
import { DetalheOp, CompararOps } from './DetalheOp';

interface Props {
  abrirNoLancamento: (id: string) => void;
}

export default function Resumo({ abrirNoLancamento }: Props) {
  const e = useLoja();
  const hoje = hojeISO();
  // Começa em 30 dias; se não houver OP nesse período, começa em "Tudo".
  const [periodo, setPeriodo] = useState<Periodo>(() => (doPeriodo(e.ops, '30d', hoje).length ? '30d' : 'tudo'));
  const [detalhe, setDetalhe] = useState<string | null>(null);
  const [comparar, setComparar] = useState<[string, string] | null>(null);

  const meta = PERIODOS.find((p) => p.chave === periodo)!;
  const linhas = useMemo(() => calcularLinhas(doPeriodo(e.ops, periodo, hoje), e.moldes), [e.ops, e.moldes, periodo, hoje]);
  const t = useMemo(() => totais(linhas), [linhas]);
  const antes = useMemo(
    () => (meta.dias == null ? null : totais(calcularLinhas(doPeriodo(e.ops, periodo, hoje, 1), e.moldes))),
    [e.ops, e.moldes, periodo, hoje, meta.dias],
  );
  const dias = useMemo(() => porDia(linhas), [linhas]);
  const motivos = useMemo(() => motivosDoPeriodo(linhas), [linhas]);
  // Em andamento agora: todas as abertas, qualquer que seja o período escolhido.
  const abertas = useMemo(
    () => calcularLinhas(e.ops.filter((o) => o.status === 'aberta'), e.moldes)
      .sort((a, b) => (b.o.data ?? '').localeCompare(a.o.data ?? '') || (b.o.criado_em ?? '').localeCompare(a.o.criado_em ?? '')),
    [e.ops, e.moldes],
  );
  const recentes = useMemo(
    () => [...linhas].sort((a, b) => (b.o.data ?? '').localeCompare(a.o.data ?? '') || (b.o.criado_em ?? '').localeCompare(a.o.criado_em ?? '')),
    [linhas],
  );

  const i = intervalo(periodo, hoje);
  const quando = i ? (i.de === i.ate ? dataBR(i.de) : `${dataBR(i.de)} a ${dataBR(i.ate)}`) : 'todas as OPs registradas';
  const diferenca = t.aproveitamento != null && antes?.aproveitamento != null ? (t.aproveitamento - antes.aproveitamento) * 100 : null;
  const opDetalhe = detalhe ? e.ops.find((o) => o.id === detalhe) ?? null : null;
  const opsComparar = comparar ? comparar.map((id) => e.ops.find((o) => o.id === id)) : null;

  return (
    <div className="pilha">
      <section className="card" aria-labelledby="t-res">
        <div className="sec-h"><h2 id="t-res">Acompanhamento da produção</h2><span className="muted small">{quando}</span></div>
        <div className="seg quatro" role="group" aria-label="Período">
          {PERIODOS.map((p) => (
            <button type="button" key={p.chave} aria-pressed={periodo === p.chave} onClick={() => setPeriodo(p.chave)}>{p.nome}</button>
          ))}
        </div>

        {linhas.length === 0 ? (
          <div className="vazio">
            <b>Nenhuma OP neste período</b>
            <span>Escolha um período maior acima.</span>
          </div>
        ) : (
          <>
            <div className="destaque">
              <div className="l">Aproveitamento de bandejas</div>
              <div className="v">{pct(t.aproveitamento)}</div>
              <div className="s"><Farol aproveitamento={t.aproveitamento} /></div>
              {meta.dias != null && (
                <div className="s">
                  {diferenca == null
                    ? `Sem resultado ${meta.antes} para comparar.`
                    : Math.abs(diferenca) < 0.05
                      ? `Igual ao resultado ${meta.deAntes} (${pct(antes!.aproveitamento)}).`
                      : `${num(Math.abs(diferenca), 1)} ${num(Math.abs(diferenca), 1) === '1,0' ? 'ponto' : 'pontos'} ${diferenca > 0 ? 'acima' : 'abaixo'} ${meta.deAntes} (${pct(antes!.aproveitamento)}).`}
                </div>
              )}
            </div>
            {t.bandejas_formadas > 0 && (
              <>
                <BarraDestino c={t} />
                <LegendaDestino comNaoClassificada={t.perda_nao_classificada > 0} />
              </>
            )}
            <div className="kpis">
              <Kpi rotulo="Produção" valor={kg(t.peso_final_kg, 0)} sub={`${num(t.embalagens_boas)} embalagens boas`} />
              <Kpi rotulo="OPs" valor={num(t.ops)} sub={`${num(t.encerradas)} ${t.encerradas === 1 ? 'encerrada' : 'encerradas'} · ${num(t.em_andamento)} em andamento`} />
              <Kpi rotulo="Produtividade" valor={t.produtividade_kg_h != null ? `${num(t.produtividade_kg_h)} kg/h` : '—'} sub={`paradas: ${num(t.minutos_parados)} min`} />
              <Kpi rotulo="Retrabalho" valor={pct(t.retrabalho_pct)} sub={`${num(t.retrabalho)} embalagens`} />
              <Kpi rotulo="Bandejas vazias" valor={pct(t.vazias_pct)} sub={`${num(t.vazias)} bandejas`} />
              <Kpi rotulo="Filme perdido" valor={kg(t.filme_perdido_kg, 1)} sub="vazias + retrabalho" />
            </div>
          </>
        )}
      </section>

      <section className="card" aria-labelledby="t-agora">
        <div className="sec-h"><h3 id="t-agora">Em andamento agora</h3><span className="muted small">{abertas.length === 1 ? '1 OP aberta' : `${abertas.length} OPs abertas`}</span></div>
        {abertas.length ? (
          <CartoesOps linhas={abertas} receitas={e.receitas} aoAbrir={setDetalhe} sempre />
        ) : (
          <p className="small muted">Nenhuma OP aberta neste momento.</p>
        )}
      </section>

      {linhas.length > 0 && (
        <>
          <section className="card" aria-labelledby="t-tend">
            <div className="sec-h"><h3 id="t-tend">Aproveitamento por dia</h3><span className="muted small">toque no ponto para ver o dia</span></div>
            {dias.length ? (
              <Tendencia
                nome="Aproveitamento"
                referencia={APROVEITAMENTO_BOM}
                nomeReferencia={`bom: ${pct(APROVEITAMENTO_BOM, 0)} ou mais`}
                pontos={dias.map((d) => ({
                  data: d.data,
                  valor: d.aproveitamento,
                  detalhe: `${d.ops} ${d.ops === 1 ? 'OP' : 'OPs'} · ${num(d.embalagens_boas)} boas de ${num(d.bandejas_formadas)} bandejas`,
                }))}
              />
            ) : (
              <div className="vazio small">Nenhuma OP do período tem passos e embalagens boas para calcular o aproveitamento.</div>
            )}
          </section>

          <section className="card" aria-labelledby="t-mot">
            <h3 id="t-mot">Motivos de retrabalho</h3>
            {motivos.length ? (
              <BarrasH itens={motivos} cor="var(--c-retr)" unidade=" emb." rotulo="Embalagens retrabalhadas por motivo no período" />
            ) : (
              <p className="small muted">Sem retrabalho contado neste período.</p>
            )}
          </section>

          <section className="card" aria-labelledby="t-ops">
            <div className="sec-h"><h3 id="t-ops">OPs registradas</h3><span className="muted small">{recentes.length} no período · toque para ver detalhes e fotos</span></div>
            <CartoesOps linhas={recentes} receitas={e.receitas} aoAbrir={setDetalhe} sempre />
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
