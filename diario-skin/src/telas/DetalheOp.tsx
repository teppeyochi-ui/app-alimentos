// Detalhe de uma OP e comparação de duas OPs lado a lado (painel P&D).

import { useMemo, useState } from 'react';
import { BarraDestino, Dialogo, LegendaDestino } from '../componentes/Basicos';
import { Fotos } from '../componentes/Fotos';
import { calcular, parametrosAlterados, parametrosDaReceita, receitaVigente, temParametros, type Indicadores } from '../lib/calc';
import { MOTIVOS_RETRABALHO, PARAMETROS } from '../lib/constantes';
import { dataBR, dataHoraBR, gramas, kg, num, pct } from '../lib/formato';
import { cancelarOp, nomeDoPerfil, podeEditar, restaurarOp, type Estado } from '../lib/loja';
import type { Op, OpLocal } from '../lib/tipos';

const ORIGEM_PARAMETROS = { digitado: 'digitados', lido_da_foto: 'lidos das fotos', padrao: 'receita padrão' } as const;

export const tituloOp = (o: Op): string => `${o.produto_descricao || 'OP sem produto'} · OP ${o.op || 's/ nº'}`;

function Item({ rotulo, valor }: { rotulo: string; valor: React.ReactNode }) {
  return <div><span>{rotulo}</span><b>{valor ?? '—'}</b></div>;
}

interface DetalheProps {
  op: OpLocal;
  e: Estado;
  aoFechar: () => void;
  abrirNoLancamento: (id: string) => void;
  aoComparar: (outraId: string) => void;
}

export function DetalheOp({ op, e, aoFechar, abrirNoLancamento, aoComparar }: DetalheProps) {
  const [outra, setOutra] = useState('');
  const c = calcular(op, e.moldes);
  const padrao = parametrosDaReceita(receitaVigente(e.receitas, op.data));
  const alterados = parametrosAlterados(op, padrao);
  const comParametros = temParametros(op);
  const fotosTela = op.fotos.filter((f) => f.tipo === 'tela');
  const fotosProduto = op.fotos.filter((f) => f.tipo === 'produto');
  const ehAdmin = e.perfil?.papel === 'admin';

  // Para comparar: primeiro as OPs do mesmo produto, depois as demais, da mais recente para a mais antiga.
  const candidatas = useMemo(
    () =>
      e.ops
        .filter((o) => o.id !== op.id && o.status !== 'cancelada')
        .sort(
          (a, b) =>
            Number(b.produto_descricao === op.produto_descricao) - Number(a.produto_descricao === op.produto_descricao) ||
            (b.data ?? '').localeCompare(a.data ?? ''),
        ),
    [e.ops, op.id, op.produto_descricao],
  );

  return (
    <Dialogo
      aberto
      aoFechar={aoFechar}
      titulo={tituloOp(op)}
      sobretitulo={`${op.origem === 'planilha' ? 'histórico da planilha' : 'diário'} · ${op.status}`}
    >
      <BarraDestino c={c} />
      <LegendaDestino comNaoClassificada={c.perda_nao_classificada != null} />

      <div className="dl">
        <Item rotulo="Data" valor={dataBR(op.data)} />
        <Item rotulo="Código" valor={op.produto_codigo} />
        <Item rotulo="Molde" valor={`${op.molde} (${c.cavidades} por passo)`} />
        <Item rotulo="Horário" valor={`${op.hora_inicio ?? '?'} – ${op.hora_fim ?? '?'}`} />
        <Item rotulo="Passos" valor={c.passos != null ? `${num(c.passos)} (${num(op.passo_inicio)} → ${num(op.passo_fim)})` : null} />
        <Item rotulo="Bandejas formadas" valor={num(c.bandejas_formadas)} />
        <Item
          rotulo="Embalagens boas"
          valor={c.embalagens_boas == null ? null : `${num(c.embalagens_boas)}${c.boas_por === 'peso' ? ' (pelo peso)' : ''}`}
        />
        <Item rotulo="Aproveitamento" valor={pct(c.aproveitamento)} />
        <Item rotulo="Retrabalho" valor={c.retrabalho != null ? `${num(c.retrabalho)} (${pct(c.retrabalho_pct)})` : 'não registrado'} />
        <Item
          rotulo={c.vazias != null ? 'Vazias' : 'Perda não classificada'}
          valor={c.vazias != null ? `${num(c.vazias)} (${pct(c.vazias_pct)})` : c.perda_nao_classificada != null ? `${num(c.perda_nao_classificada)} (${pct(c.perda_nao_classificada_pct)})` : null}
        />
        <Item rotulo="Caixas" valor={op.caixas != null ? `${num(op.caixas)} × ${num(op.embalagens_por_caixa)}${op.embalagens_avulsas ? ` + ${num(op.embalagens_avulsas)}` : ''}` : null} />
        <Item rotulo="Peso final" valor={op.peso_final_kg != null ? kg(op.peso_final_kg, 1) : null} />
        <Item rotulo="Peso médio" valor={c.peso_medio_kg != null ? gramas(c.peso_medio_kg) : null} />
        <Item rotulo="Sobrepeso" valor={c.sobrepeso != null ? pct(c.sobrepeso) : null} />
        <Item rotulo="Produtividade" valor={c.produtividade_kg_h != null ? `${num(c.produtividade_kg_h)} kg/h` : null} />
        <Item rotulo="Ciclos por minuto" valor={c.ciclos_por_minuto != null ? num(c.ciclos_por_minuto, 1) : null} />
        <Item
          rotulo="Filme perdido"
          valor={c.filme_perdido_kg != null ? `${kg(c.filme_perdido_kg)} (fundo ${num(c.filme_fundo_perdido_kg, 2)} · tampa ${num(c.filme_tampa_perdido_kg, 2)})` : null}
        />
        <Item rotulo="Filme por kg de produto" valor={c.filme_g_por_kg != null ? `${num(c.filme_g_por_kg)} g/kg` : null} />
        <Item rotulo="Filmes" valor={[op.filme_fundo, op.filme_tampa].filter(Boolean).join(' / ') || null} />
        <Item rotulo="Lote do filme" valor={op.lote_filme} />
        <Item rotulo="Lote da matéria-prima" valor={op.lote_mp} />
        <Item rotulo="Temp. do produto" valor={op.temp_produto_c != null ? `${num(op.temp_produto_c, 1)} °C` : null} />
        <Item rotulo="Aparência" valor={op.aparencia} />
        <Item rotulo="Registrado por" valor={nomeDoPerfil(op.criado_por)} />
        <Item rotulo="Última alteração" valor={op.alterado_em ? `${dataHoraBR(op.alterado_em)}${nomeDoPerfil(op.alterado_por) ? ' · ' + nomeDoPerfil(op.alterado_por) : ''}` : null} />
      </div>

      <div>
        <div className="eyebrow" style={{ marginBottom: 6 }}>
          Parâmetros da máquina
          {comParametros
            ? ` · ${op.parametros_origem ? ORIGEM_PARAMETROS[op.parametros_origem] + ' · ' : ''}${alterados.length ? 'em laranja o que mudou da padrão' : 'iguais à padrão'}`
            : ''}
        </div>
        {comParametros ? (
          <div className="chips">
            {PARAMETROS.map((p) => (
              <span key={p.chave} className={alterados.includes(p.chave) ? 'chip on' : 'chip'}>
                {p.nome}: {num(op[p.chave], p.casas)} {p.unidade}
                {alterados.includes(p.chave) ? ` (padrão ${num(padrao[p.chave], p.casas)})` : ''}
              </span>
            ))}
          </div>
        ) : (
          <p className="small muted">Sem registro de parâmetros nesta OP.</p>
        )}
      </div>

      {op.retrabalho && (
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Retrabalho por motivo</div>
          <div className="chips">
            {MOTIVOS_RETRABALHO.filter((m) => op.retrabalho![m.chave] > 0).map((m) => (
              <span className="chip" key={m.chave}>{m.nome}: {op.retrabalho![m.chave]}</span>
            ))}
            {c.retrabalho === 0 && <span className="small muted">nenhum</span>}
          </div>
        </div>
      )}

      {op.paradas.length > 0 && (
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Paradas · {c.minutos_parados} min</div>
          <div className="chips">
            {op.paradas.map((p) => <span className="chip" key={p.id}>{p.motivo} · {p.minutos} min</span>)}
          </div>
        </div>
      )}

      {op.fotos.length > 0 && (
        <div className="lado">
          <div>
            <div className="eyebrow" style={{ marginBottom: 6 }}>Telas da máquina</div>
            <Fotos fotos={fotosTela} pendentes={e.fotosPendentes} vazio="Sem foto das telas." />
          </div>
          <div>
            <div className="eyebrow" style={{ marginBottom: 6 }}>Produto final</div>
            <Fotos fotos={fotosProduto} pendentes={e.fotosPendentes} vazio="Sem foto do produto." />
          </div>
        </div>
      )}

      {op.observacoes && (
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>Observações</div>
          <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{op.observacoes}</p>
        </div>
      )}

      <div className="row">
        <label style={{ flex: '2 1 220px' }}>
          Comparar com outra OP
          <select aria-label="Comparar com outra OP" value={outra} onChange={(ev) => setOutra(ev.target.value)}>
            <option value="">Escolher…</option>
            {candidatas.map((o) => (
              <option key={o.id} value={o.id}>{dataBR(o.data)} · {tituloOp(o)}</option>
            ))}
          </select>
        </label>
        <button type="button" disabled={!outra} onClick={() => aoComparar(outra)}>Comparar</button>
      </div>

      <div className="row" style={{ justifyContent: 'flex-end' }}>
        {ehAdmin && op.status !== 'cancelada' && (
          <button
            type="button" className="perigo"
            onClick={() => { if (window.confirm('Cancelar esta OP? Ela sai do painel e dos indicadores. Dá para restaurar depois.')) { cancelarOp(op.id); aoFechar(); } }}
          >
            Cancelar OP
          </button>
        )}
        {ehAdmin && op.status === 'cancelada' && (
          <button type="button" onClick={() => restaurarOp(op.id)}>Restaurar OP</button>
        )}
        {podeEditar(op, e.perfil) && (
          <button type="button" className="primary" onClick={() => abrirNoLancamento(op.id)}>Abrir no lançamento</button>
        )}
      </div>
    </Dialogo>
  );
}

// ------------------------------------------------------------------ comparação

interface LinhaComp {
  rotulo: string;
  a: number | null;
  b: number | null;
  formato: (v: number) => string;
  /** Como mostrar a diferença (B − A). */
  diferenca?: (d: number) => string;
}

const sinal = (t: string, d: number): string => (d > 0 ? '+' : d < 0 ? '−' : '') + t;

function linhasResultado(o1: Op, c1: Indicadores, o2: Op, c2: Indicadores): LinhaComp[] {
  // Diferença entre percentuais: em pontos percentuais.
  const pp = (d: number) => sinal(`${num(Math.abs(d) * 100, 1)} pp`, d);
  const abs = (casas: number, un = '') => (d: number) => sinal(num(Math.abs(d), casas) + un, d);
  const p1 = (v: number) => pct(v);
  return [
    { rotulo: 'Aproveitamento', a: c1.aproveitamento, b: c2.aproveitamento, formato: p1, diferenca: pp },
    { rotulo: 'Retrabalho', a: c1.retrabalho_pct, b: c2.retrabalho_pct, formato: p1, diferenca: pp },
    { rotulo: 'Vazias', a: c1.vazias_pct, b: c2.vazias_pct, formato: p1, diferenca: pp },
    { rotulo: 'Produtividade (kg/h)', a: c1.produtividade_kg_h, b: c2.produtividade_kg_h, formato: (v) => num(v), diferenca: abs(0) },
    { rotulo: 'Ciclos por minuto', a: c1.ciclos_por_minuto, b: c2.ciclos_por_minuto, formato: (v) => num(v, 1), diferenca: abs(1) },
    { rotulo: 'Sobrepeso', a: c1.sobrepeso, b: c2.sobrepeso, formato: p1, diferenca: pp },
    { rotulo: 'Filme por kg (g/kg)', a: c1.filme_g_por_kg, b: c2.filme_g_por_kg, formato: (v) => num(v), diferenca: abs(0) },
    { rotulo: 'Filme perdido (kg)', a: c1.filme_perdido_kg, b: c2.filme_perdido_kg, formato: (v) => num(v, 2), diferenca: abs(2) },
    { rotulo: 'Bandejas formadas', a: c1.bandejas_formadas, b: c2.bandejas_formadas, formato: (v) => num(v), diferenca: abs(0) },
    { rotulo: 'Embalagens boas', a: c1.embalagens_boas, b: c2.embalagens_boas, formato: (v) => num(v), diferenca: abs(0) },
    { rotulo: 'Minutos parados', a: c1.minutos_parados, b: c2.minutos_parados, formato: (v) => num(v), diferenca: abs(0) },
    { rotulo: 'Temp. do produto (°C)', a: o1.temp_produto_c, b: o2.temp_produto_c, formato: (v) => num(v, 1), diferenca: abs(1) },
  ];
}

function Tabela({ titulo, linhas }: { titulo: string; linhas: LinhaComp[] }) {
  return (
    <div className="comp" role="table" aria-label={titulo}>
      <span className="h" role="columnheader">{titulo}</span>
      <span className="h v" role="columnheader">A</span>
      <span className="h v" role="columnheader">B</span>
      <span className="h v" role="columnheader">B − A</span>
      {linhas.map((l) => {
        const d = l.a != null && l.b != null ? l.b - l.a : null;
        const mudou = d != null && Math.abs(d) > 1e-9;
        return (
          <div key={l.rotulo} role="row" style={{ display: 'contents' }}>
            <span className="rot" role="cell">{l.rotulo}</span>
            <span className="v" role="cell">{l.a != null ? l.formato(l.a) : '—'}</span>
            <span className="v" role="cell">{l.b != null ? l.formato(l.b) : '—'}</span>
            <span className={mudou ? 'v dif' : 'v'} role="cell">{d == null ? '—' : mudou ? (l.diferenca ?? ((x) => num(x, 2)))(d) : 'igual'}</span>
          </div>
        );
      })}
    </div>
  );
}

interface CompararProps {
  a: OpLocal;
  b: OpLocal;
  e: Estado;
  aoFechar: () => void;
}

export function CompararOps({ a, b, e, aoFechar }: CompararProps) {
  const ca = calcular(a, e.moldes);
  const cb = calcular(b, e.moldes);
  const parametros: LinhaComp[] = PARAMETROS.map((p) => ({
    rotulo: `${p.nome} (${p.unidade})`,
    a: a[p.chave],
    b: b[p.chave],
    formato: (v: number) => num(v, p.casas),
    diferenca: (d: number) => sinal(num(Math.abs(d), p.casas), d),
  }));
  const cab = (letra: string, o: Op) => (
    <div>
      <div className="eyebrow">{letra} · {dataBR(o.data)} · {o.status}</div>
      <b style={{ overflowWrap: 'anywhere' }}>{tituloOp(o)}</b>
    </div>
  );
  return (
    <Dialogo aberto aoFechar={aoFechar} titulo="Comparar duas OPs" sobretitulo="diferença = B − A · pp = pontos percentuais">
      <div className="lado">
        <div className="pilha" style={{ gap: 6 }}>{cab('A', a)}<BarraDestino c={ca} /></div>
        <div className="pilha" style={{ gap: 6 }}>{cab('B', b)}<BarraDestino c={cb} /></div>
      </div>
      <LegendaDestino />
      <Tabela titulo="Resultado" linhas={linhasResultado(a, ca, b, cb)} />
      {temParametros(a) || temParametros(b) ? (
        <Tabela titulo="Parâmetros" linhas={parametros} />
      ) : (
        <p className="small muted">Nenhuma das duas OPs tem parâmetros registrados.</p>
      )}
      <div className="lado">
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>A · produto final</div>
          <Fotos fotos={a.fotos.filter((f) => f.tipo === 'produto')} pendentes={e.fotosPendentes} vazio="Sem foto do produto." />
        </div>
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>B · produto final</div>
          <Fotos fotos={b.fotos.filter((f) => f.tipo === 'produto')} pendentes={e.fotosPendentes} vazio="Sem foto do produto." />
        </div>
      </div>
    </Dialogo>
  );
}
