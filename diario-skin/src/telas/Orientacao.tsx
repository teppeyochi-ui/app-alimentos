// Orientação: ajuda o operador a saber se a configuração da máquina está boa e
// o que tentar para melhorar. Compara a OP com a receita padrão e com as
// melhores OPs já registradas, aponta a maior perda e o que conferir em cada
// defeito. Funciona sem internet; só a avaliação da foto por IA pede o servidor.

import { useMemo, useState } from 'react';
import { CartaoAnaliseIa } from '../componentes/AnaliseIa';
import { Farol, Kpi } from '../componentes/Basicos';
import { Fotos } from '../componentes/Fotos';
import { calcular, cicloTeorico, parametrosDaReceita, receitaVigente, temParametros } from '../lib/calc';
import { MODO_LOCAL } from '../lib/config';
import { META_PARAMETRO } from '../lib/constantes';
import { blobDaFoto } from '../lib/fotos';
import { dataBR, num, pct } from '../lib/formato';
import { gravarAnaliseIa, lerEstado, lerServidor, podeEditar, useLoja, type Estado } from '../lib/loja';
import {
  REGRAS_DEFEITO, compararConfiguracao, contextoParaIa, efeitosDosParametros, maiorPerda, motivosEmOrdem,
  referenciaDa, ritmo, type AcaoRegra, type LinhaConfiguracao,
} from '../lib/orientacao';
import { classificar } from '../lib/servidor';
import type { ChaveParametro, OpLocal } from '../lib/tipos';

interface Props {
  opId: string | null;
  escolherOp: (id: string) => void;
  abrirNoLancamento: (id: string) => void;
}

const rotuloOp = (o: OpLocal): string =>
  `${o.produto_descricao || 'OP sem produto'} · ${dataBR(o.data)}${o.op ? ` · OP ${o.op}` : ''}${o.status === 'aberta' ? ' · em andamento' : ''}`;

const valor = (chave: ChaveParametro, v: number | null): string =>
  v == null ? '—' : `${num(v, META_PARAMETRO[chave].casas)} ${META_PARAMETRO[chave].unidade}`;

const NIVEL = {
  produto: 'deste produto',
  especie: 'da mesma espécie, no mesmo molde',
  molde: 'do mesmo molde (outros produtos)',
} as const;

const ACAO: Record<AcaoRegra, string> = { aumentar: 'Aumentar', diminuir: 'Diminuir', testar: 'Testar', conferir: 'Conferir' };

export default function Orientacao({ opId, escolherOp, abrirNoLancamento }: Props) {
  const e = useLoja();
  // As OPs que podem ser orientadas: as do diário, abertas primeiro, depois as mais recentes.
  const opcoes = useMemo(
    () =>
      e.ops
        .filter((o) => o.origem === 'diario' && o.status !== 'cancelada')
        .sort(
          (a, b) =>
            Number(b.status === 'aberta') - Number(a.status === 'aberta') ||
            (b.data ?? '').localeCompare(a.data ?? '') ||
            (b.criado_em ?? '').localeCompare(a.criado_em ?? ''),
        )
        .slice(0, 30),
    [e.ops],
  );
  const op = (opId ? e.ops.find((o) => o.id === opId) : null) ?? opcoes[0] ?? null;

  if (!op) {
    return (
      <div className="vazio">
        <b>Nenhuma OP para orientar</b>
        <span>Abra uma OP na aba “Lançar OP” e escolha o produto. A orientação aparece aqui assim que a OP existir.</span>
      </div>
    );
  }

  return (
    <div className="pilha">
      <section className="card" aria-labelledby="t-ori">
        <div className="sec-h">
          <h2 id="t-ori">Orientação</h2>
          <button type="button" onClick={() => abrirNoLancamento(op.id)}>Abrir no lançamento</button>
        </div>
        <label>
          OP
          <select aria-label="OP" value={op.id} onChange={(ev) => escolherOp(ev.target.value)}>
            {!opcoes.some((o) => o.id === op.id) && <option value={op.id}>{rotuloOp(op)}</option>}
            {opcoes.map((o) => <option key={o.id} value={o.id}>{rotuloOp(o)}</option>)}
          </select>
        </label>
        <p className="small muted">
          Esta aba compara a configuração da máquina com a receita padrão e com as melhores OPs já registradas,
          e mostra o que conferir em cada defeito. Mude um parâmetro por vez e registre o resultado: é isso que
          faz a orientação melhorar.
        </p>
      </section>
      <Conteudo key={op.id} op={op} e={e} />
    </div>
  );
}

function Conteudo({ op, e }: { op: OpLocal; e: Estado }) {
  const c = calcular(op, e.moldes);
  const receita = receitaVigente(e.receitas, op.data);
  const padrao = parametrosDaReceita(receita);
  const ref = useMemo(() => referenciaDa(op, e.ops, e.moldes, e.produtos), [op, e.ops, e.moldes, e.produtos]);
  const linhas = compararConfiguracao(op, padrao, ref);
  const fora = linhas.filter((l) => l.situacao === 'fora_da_referencia' || l.situacao === 'fora_do_padrao');
  const perda = maiorPerda(c);
  const r = ritmo(c, receita);
  const motivos = motivosEmOrdem(op, c);
  const efeitos = useMemo(() => (ref ? efeitosDosParametros(ref.base) : []), [ref]);

  return (
    <>
      {/* ------------------------------------------------ situação */}
      <section className="card" aria-labelledby="t-sit">
        <div className="sec-h"><h3 id="t-sit">Como está esta OP</h3><span className="muted small">{op.status === 'aberta' ? 'parcial, com o que já foi lançado' : 'OP encerrada'}</span></div>
        {c.bandejas_formadas == null ? (
          <p className="small muted">
            Ainda sem resultado: para acompanhar durante a produção, lance o passo atual em “Passo no fim” e as caixas
            já fechadas. Pode atualizar quantas vezes quiser antes de encerrar.
          </p>
        ) : (
          <div className="kpis">
            <Kpi rotulo="Aproveitamento" valor={pct(c.aproveitamento)} sub={<Farol aproveitamento={c.aproveitamento} />} />
            <Kpi rotulo="Retrabalho" valor={pct(c.retrabalho_pct)} sub={`${num(c.retrabalho ?? 0)} embalagens`} />
            <Kpi rotulo="Vazias" valor={pct(c.vazias_pct)} sub={c.vazias != null ? `${num(c.vazias)} bandejas` : undefined} />
            <Kpi
              rotulo="Ciclos por minuto" valor={num(c.ciclos_por_minuto, 1)}
              sub={r != null ? `${pct(r, 0)} do teórico (${num(60 / cicloTeorico(receita), 1)})` : 'falta hora de fim'}
            />
          </div>
        )}
        {ref && (
          <p className="small">
            Melhor resultado já registrado {NIVEL[ref.nivel]}: <b>{pct(ref.melhores[0].c.aproveitamento)}</b> em{' '}
            {dataBR(ref.melhores[0].o.data)}.
            {c.aproveitamento == null ? ''
              : c.aproveitamento < (ref.melhores[0].c.aproveitamento ?? 0)
                ? ` Esta OP está ${num(((ref.melhores[0].c.aproveitamento ?? 0) - c.aproveitamento) * 100, 1)} pontos abaixo.`
                : ' Esta OP está igual ou acima.'}
          </p>
        )}
        {perda?.tipo === 'vazias' && (
          <div className="notice warn" role="status">
            A maior perda é de <b>bandejas vazias</b> ({pct(perda.pct)} das formadas, {num(perda.quantidade)} bandejas). Isso não
            se resolve nos parâmetros de selagem: é alimentação. Confira se a equipe acompanha o ritmo da máquina e as
            paradas por falta de produto.
          </div>
        )}
        {perda?.tipo === 'retrabalho' && (
          <div className="notice warn" role="status">
            A maior perda é de <b>retrabalho</b> ({pct(perda.pct)} das formadas, {num(perda.quantidade)} embalagens). Veja abaixo
            o que conferir para cada defeito.
          </div>
        )}
        {r != null && r < 0.8 && (
          <div className="notice" role="status">
            O ritmo está em {pct(r, 0)} do ciclo teórico. O tempo parado registrado é de {c.minutos_parados} min; o que
            falta explicar costuma ser microparada ou espera por produto.
          </div>
        )}
      </section>

      {/* ------------------------------------------------ configuração × referência */}
      <section className="card" aria-labelledby="t-cfg">
        <div className="sec-h"><h3 id="t-cfg">Configuração × referência</h3><span className="muted small">atual, padrão e melhores OPs</span></div>
        {!temParametros(op) ? (
          <p className="small muted">Esta OP não tem parâmetros lançados. Fotografe as telas ou use a receita padrão no lançamento.</p>
        ) : (
          <>
            {ref ? (
              <p className="small">
                Referência: {ref.melhores.length === 1 ? 'a melhor' : `as ${ref.melhores.length} melhores`} de {ref.base.length}{' '}
                {ref.base.length === 1 ? 'OP encerrada' : 'OPs encerradas'} {NIVEL[ref.nivel]}, com aproveitamento de{' '}
                {faixaTexto(ref.melhores.map((l) => l.c.aproveitamento ?? 0))}.
                {ref.base.length < 5 && ' São poucas OPs: trate como indício, não como regra.'}
              </p>
            ) : (
              <p className="small">
                Ainda não há OP encerrada com parâmetros e resultado para servir de referência. Por enquanto a comparação
                é só com a receita padrão; a referência aparece depois das primeiras OPs encerradas pelo diário.
              </p>
            )}
            <div className={`notice ${fora.length ? 'warn' : 'ok'}`} role="status">
              {fora.length === 0
                ? ref ? 'Todos os parâmetros estão dentro da faixa das melhores OPs.' : 'Todos os parâmetros estão iguais à receita padrão.'
                : `${fora.length} ${fora.length === 1 ? 'parâmetro diferente' : 'parâmetros diferentes'} ${ref ? 'da faixa das melhores OPs' : 'da receita padrão'}: ${fora.map((l) => META_PARAMETRO[l.chave].sigla).join(', ')}.`}
            </div>
            <div className="cfg">
              {linhas.map((l) => <LinhaCfg key={l.chave} l={l} />)}
            </div>
          </>
        )}
      </section>

      {/* ------------------------------------------------ retrabalho */}
      <section className="card" aria-labelledby="t-def">
        <div className="sec-h"><h3 id="t-def">Retrabalho: o que conferir</h3><span className="muted small">do defeito mais frequente para o menos</span></div>
        {motivos.length === 0 ? (
          <p className="small muted">
            Nenhum retrabalho contado nesta OP. Os contadores “+1” do lançamento alimentam esta parte.
          </p>
        ) : (
          motivos.map((m) => {
            const regra = REGRAS_DEFEITO[m.chave];
            return (
              <div className="regra" key={m.chave}>
                <div className="regra-cab">
                  <b>{m.nome}</b>
                  <span className="mono small">{num(m.quantidade)} emb.{m.pct != null ? ` · ${pct(m.pct)}` : ''}</span>
                </div>
                <p className="small">{regra.resumo}</p>
                <div className="eyebrow">Olhe primeiro</div>
                <ul className="lista-simples">{regra.verificar.map((v) => <li key={v}>{v}</li>)}</ul>
                {regra.ajustes.length > 0 && (
                  <>
                    <div className="eyebrow">Depois, nos parâmetros</div>
                    <ul className="lista-simples">
                      {regra.ajustes.map((a) => {
                        const linha = linhas.find((l) => l.chave === a.chave)!;
                        return (
                          <li key={a.chave}>
                            <b>{ACAO[a.acao]} {META_PARAMETRO[a.chave].nome}</b>
                            {' '}(agora {valor(a.chave, linha.atual)}
                            {linha.faixa ? `; melhores OPs: ${faixaParametro(linha)}` : ''}){a.passo ? `, ${a.passo}` : ''}. {a.porque}
                          </li>
                        );
                      })}
                    </ul>
                  </>
                )}
              </div>
            );
          })
        )}
        <p className="small muted">
          Orientações gerais do processo skin, ainda não validadas pelo P&D nem pela ULMA. Use como roteiro de
          verificação e confirme com o P&D antes de adotar como regra.
        </p>
      </section>

      {/* ------------------------------------------------ o que os dados mostram */}
      <section className="card" aria-labelledby="t-dados">
        <div className="sec-h"><h3 id="t-dados">O que as OPs anteriores mostram</h3>{ref && <span className="muted small">{ref.base.length} {ref.base.length === 1 ? 'OP' : 'OPs'} {NIVEL[ref.nivel]}</span>}</div>
        {efeitos.length === 0 ? (
          <p className="small muted">
            Ainda não dá para comparar: é preciso ter OPs encerradas em que um mesmo parâmetro foi usado com valores
            diferentes. Cada OP lançada com os parâmetros e o resultado aumenta esta base.
          </p>
        ) : (
          <>
            {efeitos.map((ef) => (
              <div className="regra" key={ef.chave}>
                <div className="regra-cab">
                  <b>{META_PARAMETRO[ef.chave].nome}</b>
                  <span className={`chip ${ef.forca === 'fraco' ? '' : 'ok'}`}>{ef.forca === 'fraco' ? 'indício fraco' : 'base razoável'}</span>
                </div>
                <div className="tabela-efeito" role="table" aria-label={`Resultado por valor de ${META_PARAMETRO[ef.chave].nome}`}>
                  <div role="row" className="cab"><span role="columnheader">Valor</span><span role="columnheader">OPs</span><span role="columnheader">Aprov.</span><span role="columnheader">Retrab.</span></div>
                  {ef.grupos.map((g) => (
                    <div role="row" key={g.valor} className={g.valor === ef.melhor ? 'melhor' : undefined}>
                      <span role="cell">{valor(ef.chave, g.valor)}{g.valor === op[ef.chave] ? ' (atual)' : ''}</span>
                      <span role="cell">{g.ops}</span>
                      <span role="cell">{pct(g.aproveitamento)}</span>
                      <span role="cell">{pct(g.retrabalho_pct)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            <p className="small muted">
              A linha destacada é o valor com maior aproveitamento. Diferença entre valores não prova causa: produto,
              lote e equipe também mudam de uma OP para outra. Com poucas OPs por valor, é só um indício.
            </p>
          </>
        )}
      </section>

      <AvaliacaoIa op={op} e={e} />
    </>
  );
}

function faixaTexto(valores: number[]): string {
  const min = Math.min(...valores);
  const max = Math.max(...valores);
  return min === max ? pct(min) : `${pct(min)} a ${pct(max)}`;
}

function faixaParametro(l: LinhaConfiguracao): string {
  if (!l.faixa) return '—';
  return l.faixa.min === l.faixa.max
    ? valor(l.chave, l.faixa.min)
    : `${num(l.faixa.min, META_PARAMETRO[l.chave].casas)} a ${valor(l.chave, l.faixa.max)}`;
}

function LinhaCfg({ l }: { l: LinhaConfiguracao }) {
  const meta = META_PARAMETRO[l.chave];
  let chip: { classe: string; texto: string };
  if (l.situacao === 'sem_valor') chip = { classe: '', texto: 'sem valor' };
  else if (l.situacao === 'na_referencia') chip = { classe: 'ok', texto: 'na faixa das melhores' };
  else if (l.situacao === 'fora_da_referencia') chip = { classe: 'on', texto: `melhores usaram ${valor(l.chave, l.alvo)}` };
  else if (l.situacao === 'no_padrao') chip = { classe: 'ok', texto: 'igual à padrão' };
  else chip = { classe: 'on', texto: 'diferente da padrão' };
  return (
    <div className="linha-cfg">
      <div>
        <b title={meta.nomeCompleto}>{meta.nome}</b>
        <div className="small muted mono">
          atual {valor(l.chave, l.atual)} · padrão {valor(l.chave, l.padrao)}{l.faixa ? ` · melhores ${faixaParametro(l)}` : ''}
        </div>
      </div>
      <span className={`chip ${chip.classe}`}>{chip.texto}</span>
    </div>
  );
}

// ------------------------------------------------------------------ avaliação da foto por IA

function AvaliacaoIa({ op, e }: { op: OpLocal; e: Estado }) {
  const [avaliando, setAvaliando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const fotosProduto = op.fotos.filter((f) => f.tipo === 'produto');
  const editavel = podeEditar(op, e.perfil);

  async function avaliar() {
    const servidor = lerServidor();
    if (!servidor || avaliando) return;
    setAvaliando(true);
    setErro(null);
    try {
      // Até 3 fotos do produto, as mais recentes.
      const escolhidas = fotosProduto.slice(-3);
      const blobs: Blob[] = [];
      const usadas: string[] = [];
      for (const f of escolhidas) {
        const b = await blobDaFoto(f);
        if (b) { blobs.push(b); usadas.push(f.id); }
      }
      if (!blobs.length) { setErro('Não consegui abrir as fotos do produto. Confira a conexão ou tire a foto de novo.'); return; }
      const atual = lerEstado();
      const agora = atual.ops.find((o) => o.id === op.id) ?? op;
      const resposta = await servidor.analisarOp(contextoParaIa(agora, atual.ops, atual.moldes, atual.produtos, atual.receitas), blobs);
      gravarAnaliseIa(op.id, { ...resposta, em: new Date().toISOString(), fotos: usadas });
    } catch (falha) {
      const f = classificar(falha);
      setErro(
        f.tipo === 'rede' ? 'Sem conexão para avaliar a foto. Tente quando o sinal voltar.'
        : f.tipo === 'permissao' || f.tipo === 'sessao' ? 'A avaliação por IA não está liberada para este acesso.'
        : f.message || 'Não consegui avaliar agora. Tente de novo.',
      );
    } finally {
      setAvaliando(false);
    }
  }

  return (
    <section className="card" aria-labelledby="t-ia">
      <div className="sec-h"><h3 id="t-ia">Foto do produto avaliada por IA</h3><span className="muted small">aparência × parâmetros</span></div>
      <p className="small muted">
        A IA olha a foto do produto final junto com os parâmetros da máquina, o retrabalho e as OPs anteriores, dá uma nota
        de aparência e sugere o que ajustar. A nota fica guardada na OP e entra no painel, para cruzar aparência com parâmetros.
      </p>
      <Fotos fotos={fotosProduto} pendentes={e.fotosPendentes} vazio="Sem foto do produto final nesta OP. Tire a foto no lançamento (bloco “Fim e produto acabado”)." />
      {MODO_LOCAL ? (
        <div className="notice" role="status">
          A avaliação por IA só funciona com o servidor ligado (Supabase e a chave da Anthropic). Neste aparelho, em modo
          local, as fotos ficam guardadas na OP e poderão ser avaliadas depois da ligação.
        </div>
      ) : (
        <div className="row">
          <button type="button" className="primary" onClick={() => void avaliar()} disabled={avaliando || !fotosProduto.length || !editavel}>
            {avaliando ? 'Avaliando… pode levar um minuto' : op.analise_ia ? 'Avaliar de novo' : 'Avaliar a foto com IA'}
          </button>
          {!editavel && <span className="small muted">OP encerrada: só o P&D pode gravar uma nova avaliação.</span>}
        </div>
      )}
      {erro && <div className="notice warn" role="alert">{erro}</div>}
      {op.analise_ia && <CartaoAnaliseIa analise={op.analise_ia} />}
    </section>
  );
}
