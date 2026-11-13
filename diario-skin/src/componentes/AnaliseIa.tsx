// Mostra a avaliação da foto do produto feita pela IA (guardada na OP).

import { META_PARAMETRO, MOTIVOS_RETRABALHO } from '../lib/constantes';
import { dataHoraBR, num } from '../lib/formato';
import type { AcaoSugerida, AnaliseIa } from '../lib/tipos';

const NOME_DEFEITO: Record<string, string> = {
  ...Object.fromEntries(MOTIVOS_RETRABALHO.map((m) => [m.chave, m.nome])),
  liquido: 'Líquido ou gelo na embalagem',
};
const GRAVIDADE = { leve: 'leve', moderado: 'moderado', grave: 'grave' } as const;
const ACAO: Record<AcaoSugerida, string> = { aumentar: 'Aumentar', diminuir: 'Diminuir', manter: 'Manter', verificar: 'Conferir' };
const CONFIANCA = { baixa: 'baixa', media: 'média', alta: 'alta' } as const;

export function notaTexto(nota: number | null): string {
  return nota == null ? 'sem nota' : `${num(nota, Number.isInteger(nota) ? 0 : 1)} de 10`;
}

export function CartaoAnaliseIa({ analise }: { analise: AnaliseIa }) {
  return (
    <div className="pilha" style={{ gap: 10 }}>
      <div className="dl">
        <div><span>Nota da aparência</span><b>{notaTexto(analise.nota_aparencia)}</b></div>
        <div><span>Confiança da avaliação</span><b>{CONFIANCA[analise.confianca] ?? analise.confianca}</b></div>
        <div><span>Avaliada em</span><b>{dataHoraBR(analise.em)}</b></div>
        <div><span>Fotos avaliadas</span><b>{analise.fotos.length}</b></div>
      </div>
      {analise.diagnostico && <p>{analise.diagnostico}</p>}
      {analise.defeitos.length > 0 && (
        <div>
          <div className="eyebrow">O que aparece na foto</div>
          <ul className="lista-simples">
            {analise.defeitos.map((d, i) => (
              <li key={i}>
                <b>{NOME_DEFEITO[d.tipo] ?? d.tipo}</b> ({GRAVIDADE[d.gravidade] ?? d.gravidade}){d.descricao ? `: ${d.descricao}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
      {analise.sugestoes.length > 0 && (
        <div>
          <div className="eyebrow">Sugestões (uma por vez)</div>
          <ul className="lista-simples">
            {analise.sugestoes.map((s, i) => {
              const meta = s.parametro ? META_PARAMETRO[s.parametro] : null;
              return (
                <li key={i}>
                  <b>
                    {ACAO[s.acao] ?? s.acao}{meta ? ` ${meta.nome}` : ''}
                    {meta && s.valor_sugerido != null ? ` para ${num(s.valor_sugerido, meta.casas)} ${meta.unidade}` : ''}
                  </b>
                  {s.motivo ? `: ${s.motivo}` : ''}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {analise.limitacoes && <p className="small muted">Limites desta avaliação: {analise.limitacoes}</p>}
      <p className="small muted">
        A IA sugere; quem decide é o operador e o P&D. Mude um parâmetro por vez e registre o resultado.
      </p>
    </div>
  );
}
