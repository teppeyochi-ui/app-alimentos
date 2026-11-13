// Lista de OPs em cartões (uma por linha no celular): produto, data, status,
// destino das bandejas e os números principais. Tocar abre o detalhe.

import { parametrosAlterados, parametrosDaReceita, receitaVigente, temParametros, type Indicadores } from '../lib/calc';
import { META_PARAMETRO } from '../lib/constantes';
import { dataBR, num, pct } from '../lib/formato';
import type { Op, ReceitaPadrao } from '../lib/tipos';
import { BarraDestino } from './Basicos';

export function EtiquetaStatus({ o }: { o: Op }) {
  return (
    <span className={`chip st-${o.status} ${o.origem === 'planilha' ? 'hist' : ''}`}>
      {o.origem === 'planilha' ? 'histórico' : o.status === 'aberta' ? 'em andamento' : o.status === 'fechada' ? 'encerrada' : o.status}
    </span>
  );
}

/** Parâmetros da OP que diferem da receita padrão que valia na data dela. */
export function ChipsReceita({ o, receitas }: { o: Op; receitas: ReceitaPadrao[] }) {
  if (!temParametros(o)) return <span className="small muted">sem registro</span>;
  const alterados = parametrosAlterados(o, parametrosDaReceita(receitaVigente(receitas, o.data)));
  if (!alterados.length) return <span className="chip">padrão</span>;
  return (
    <span className="chips">
      {alterados.map((k) => <span className="chip on" key={k}>{META_PARAMETRO[k].sigla} {num(o[k], META_PARAMETRO[k].casas)}</span>)}
    </span>
  );
}

interface Props<T extends Op> {
  linhas: { o: T; c: Indicadores }[];
  receitas: ReceitaPadrao[];
  aoAbrir: (id: string) => void;
  /** Mostra os cartões em qualquer largura (no painel eles só aparecem na tela estreita). */
  sempre?: boolean;
}

export function CartoesOps<T extends Op>({ linhas, receitas, aoAbrir, sempre }: Props<T>) {
  return (
    <div className={sempre ? 'ops-cartoes sempre' : 'ops-cartoes'}>
      {linhas.map(({ o, c }) => {
        const alterados = temParametros(o) ? parametrosAlterados(o, parametrosDaReceita(receitaVigente(receitas, o.data))) : [];
        return (
          <button type="button" key={o.id} className="op-cartao" onClick={() => aoAbrir(o.id)}>
            <span className="cab">
              <span>
                <span className="t">{o.produto_descricao || 'OP sem produto'}</span>
                <span className="small muted" style={{ display: 'block' }}>
                  {dataBR(o.data)} · OP {o.op || 's/ nº'}{o.fotos.length ? ` · ${o.fotos.length} ${o.fotos.length === 1 ? 'foto' : 'fotos'}` : ''}
                </span>
              </span>
              <EtiquetaStatus o={o} />
            </span>
            <BarraDestino c={c} />
            <span className="nums">
              <span>Aprov.<b>{pct(c.aproveitamento)}</b></span>
              <span>Retrab.<b>{pct(c.retrabalho_pct)}</b></span>
              <span>Vazias<b>{pct(c.vazias_pct)}</b></span>
              <span>Bandejas<b>{num(c.bandejas_formadas)}</b></span>
              <span>kg/h<b>{num(c.produtividade_kg_h)}</b></span>
              <span>Ciclos/min<b>{num(c.ciclos_por_minuto, 1)}</b></span>
            </span>
            {alterados.length > 0 && <ChipsReceita o={o} receitas={receitas} />}
          </button>
        );
      })}
    </div>
  );
}
