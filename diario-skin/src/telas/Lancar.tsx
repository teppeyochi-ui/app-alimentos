// Lançar OP (seção 8.1): uma página com rolagem, em cinco blocos, na ordem em
// que o trabalho acontece, com o resultado calculado ao vivo.

import { useMemo, useState } from 'react';
import { BarraDestino, CampoNumero, Dialogo, Farol, Kpi, LegendaDestino } from '../componentes/Basicos';
import { Fotos } from '../componentes/Fotos';
import { SeletorProduto } from '../componentes/SeletorProduto';
import {
  calcular, cicloTeorico, parametrosAlterados, parametrosDaReceita, receitaVigente, validarEncerramento,
} from '../lib/calc';
import {
  FILMES_FUNDO, FILMES_TAMPA, MOTIVOS_PARADA, MOTIVOS_RETRABALHO, PARAMETROS, dentroDoLimite, filmeTampaSugerido,
} from '../lib/constantes';
import { MODO_LOCAL } from '../lib/config';
import { blobDaFoto, reduzirFoto } from '../lib/fotos';
import { agoraHHMM, dataBR, dataHoraBR, gramas, horaCurta, kg, num, pct } from '../lib/formato';
import {
  adicionarFoto, adicionarParada, alterarOp, avisar, contarRetrabalho, descarregar, encerrarOp, escolherProduto,
  lerEstado, lerServidor, novaOp, podeEditar, removerFoto, removerParada, useLoja, type Estado,
} from '../lib/loja';
import { classificar } from '../lib/servidor';
import { sincronizar } from '../lib/sincronizacao';
import type { Aparencia, ChaveParametro, Molde, Op, OpLocal } from '../lib/tipos';

const rotuloOp = (o: Op): string => o.produto_descricao || 'OP sem produto';

interface Props {
  opId: string | null;
  abrirOp: (id: string | null) => void;
}

export function Lancar({ opId, abrirOp }: Props) {
  const e = useLoja();
  const op = opId ? (e.rascunho?.id === opId ? e.rascunho : e.ops.find((o) => o.id === opId) ?? null) : null;

  const abertas = useMemo(
    () => e.ops.filter((o) => o.status === 'aberta').sort((a, b) => (b.criado_em ?? '').localeCompare(a.criado_em ?? '')),
    [e.ops],
  );

  return (
    <div className="pilha">
      <section className="card" aria-labelledby="t-andamento">
        <div className="sec-h">
          <h2 id="t-andamento">OPs em andamento</h2>
          <button type="button" className="primary" onClick={() => abrirOp(novaOp().id)}>Nova OP</button>
        </div>
        {abertas.length ? (
          <div className="lista-ops">
            {abertas.map((o) => (
              <button type="button" key={o.id} aria-current={o.id === opId ? 'true' : undefined} onClick={() => abrirOp(o.id)}>
                <span className="t">{rotuloOp(o)}</span>
                <span className="small muted">
                  OP {o.op || 's/ nº'} · {dataBR(o.data)}{o.hora_inicio ? ` · início ${o.hora_inicio}` : ''}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p className="small muted">Nenhuma OP aberta. Toque em “Nova OP” para começar.</p>
        )}
      </section>

      {op ? (
        <Formulario key={op.id} op={op} e={e} />
      ) : (
        <div className="vazio">
          <b>Nenhuma OP selecionada</b>
          <span>Retome uma OP da lista acima ou comece uma nova.</span>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ formulário

type Mensagem = { tipo: 'info' | 'ok' | 'warn'; texto: string };

function Formulario({ op, e }: { op: OpLocal; e: Estado }) {
  const editavel = podeEditar(op, e.perfil);
  const [seletor, setSeletor] = useState(false);
  const [outroAberto, setOutroAberto] = useState(false);
  const [lidos, setLidos] = useState<ChaveParametro[]>([]);
  const [lendo, setLendo] = useState(false);
  const [leitura, setLeitura] = useState<Mensagem | null>(null);
  const [processando, setProcessando] = useState(0);
  const [paradaMotivo, setParadaMotivo] = useState(MOTIVOS_PARADA[0]);
  const [paradaMin, setParadaMin] = useState<number | null>(null);
  const [confirmar, setConfirmar] = useState<string[] | null>(null);

  const mudar = (m: Partial<Op>) => alterarOp(op.id, m);
  const texto = (v: string): string | null => (v === '' ? null : v);

  const produto = op.produto_codigo ? e.produtos.find((p) => p.codigo === op.produto_codigo) ?? null : null;
  const receita = receitaVigente(e.receitas, op.data);
  const padrao = parametrosDaReceita(receita);
  const alterados = parametrosAlterados(op, padrao);
  const c = calcular(op, e.moldes);
  const cav = c.cavidades;
  const fotosTela = op.fotos.filter((f) => f.tipo === 'tela');
  const fotosProduto = op.fotos.filter((f) => f.tipo === 'produto');
  const mostrarNome = op.produto_codigo == null && (outroAberto || op.produto_descricao !== '');
  const ehRascunho = e.rascunho?.id === op.id;

  // ---------------------------------------------------------------- fotos

  async function receberFotos(arquivos: FileList | null, tipo: 'tela' | 'produto') {
    if (!arquivos?.length) return;
    const lista = [...arquivos];
    setProcessando((n) => n + lista.length);
    for (const arquivo of lista) {
      try {
        await adicionarFoto(op.id, tipo, await reduzirFoto(arquivo));
      } catch (erro) {
        console.error(erro);
        avisar('Não foi possível ler esta foto. Tente tirar de novo.', 'erro');
      } finally {
        setProcessando((n) => n - 1);
      }
    }
  }

  async function lerDasFotos() {
    const servidor = lerServidor();
    if (!servidor || lendo) return;
    setLendo(true);
    setLeitura({ tipo: 'info', texto: 'Lendo as fotos… pode levar até um minuto.' });
    try {
      // Até 3 fotos, as mais recentes (uma por tela: 412, 414 e 417).
      const escolhidas = fotosTela.slice(-3);
      const blobs: Blob[] = [];
      const usadas: typeof escolhidas = [];
      for (const f of escolhidas) {
        const b = await blobDaFoto(f);
        if (b) { blobs.push(b); usadas.push(f); }
      }
      if (!blobs.length) {
        setLeitura({ tipo: 'warn', texto: 'Não encontrei as fotos para ler. Fotografe as telas de novo.' });
        return;
      }
      const r = await servidor.lerTelas(blobs);
      // Valores fora dos limites são descartados; o que foi lido fica marcado para conferência.
      const validos: Partial<Record<ChaveParametro, number>> = {};
      for (const p of PARAMETROS) {
        const v = r.valores[p.chave];
        if (typeof v === 'number' && dentroDoLimite(p.chave, v)) validos[p.chave] = v;
      }
      const chaves = Object.keys(validos) as ChaveParametro[];
      if (!chaves.length) {
        setLeitura({ tipo: 'warn', texto: 'Não consegui ler valores nas fotos. Tente uma foto mais de frente e sem reflexo, ou digite os valores.' });
        return;
      }
      const telasPorFoto = new Map(usadas.map((f, i) => [f.id, r.telas[i]]));
      alterarOp(op.id, {
        ...validos,
        parametros_origem: 'lido_da_foto',
        fotos: op.fotos.map((f) => {
          const tela = telasPorFoto.get(f.id);
          return tela === 412 || tela === 414 || tela === 417 ? { ...f, tela_numero: tela } : f;
        }),
      });
      setLidos(chaves);
      const telas = [...new Set(r.telas.filter((t) => t === 412 || t === 414 || t === 417))].sort();
      setLeitura({
        tipo: 'ok',
        texto:
          `${chaves.length} ${chaves.length === 1 ? 'valor lido' : 'valores lidos'}` +
          (telas.length ? ` (telas ${telas.join(', ')})` : '') +
          '. Os campos com contorno azul vieram da foto: confira antes de encerrar.' +
          (r.duvidas ? ` Observação: ${r.duvidas}` : ''),
      });
    } catch (erro) {
      const falha = classificar(erro);
      setLeitura({
        tipo: 'warn',
        texto:
          falha.tipo === 'rede' ? 'Sem conexão para ler as fotos. Digite os valores ou tente quando o sinal voltar.'
          : falha.tipo === 'permissao' || falha.tipo === 'sessao' ? 'A leitura automática não está liberada para este acesso. Digite os valores.'
          : `${falha.message || 'Não consegui ler agora.'} Digite os valores ou tente de novo.`,
      });
    } finally {
      setLendo(false);
    }
  }

  // ---------------------------------------------------------------- salvar e encerrar

  async function salvar() {
    await descarregar();
    if (MODO_LOCAL) { avisar('OP salva neste aparelho.', 'ok'); return; }
    await sincronizar();
    const enviada = lerEstado().ops.find((o) => o.id === op.id)?._sujo === false;
    avisar(enviada ? 'OP salva e sincronizada.' : 'OP salva no aparelho. Será enviada quando a conexão voltar.', 'ok');
  }

  function pedirEncerramento() {
    const v = validarEncerramento(op, c);
    const faltas = [...v.faltas];
    if (!op.produto_descricao.trim()) faltas.unshift('produto');
    if (!op.data) faltas.unshift('data');
    if (faltas.length) { avisar('Falta preencher: ' + faltas.join(', ') + '.', 'erro'); return; }
    if (v.bloqueios.length) { avisar(v.bloqueios[0], 'erro'); return; }
    setConfirmar(v.avisos);
  }

  async function encerrar() {
    setConfirmar(null);
    encerrarOp(op.id);
    await descarregar();
    avisar('OP encerrada.', 'ok');
    void sincronizar();
  }

  // ---------------------------------------------------------------- estado do salvamento

  const fotosPendentes = op.fotos.filter((f) => e.fotosPendentes.includes(f.id)).length;
  const erroOp = e.errosOp[op.id];
  let estado: { classe: string; texto: string };
  if (ehRascunho) estado = { classe: '', texto: 'OP nova: comece a preencher para gravar' };
  else if (e.gravando.includes(op.id)) estado = { classe: 'pend', texto: 'Gravando no aparelho…' };
  else if (MODO_LOCAL) estado = { classe: 'ok', texto: `Salvo no aparelho às ${horaCurta(op.alterado_em)}` };
  else if (erroOp) estado = { classe: 'erro', texto: 'Salvo no aparelho · o servidor não aceitou' };
  else if (op._sujo || fotosPendentes) {
    const o_que = fotosPendentes && !op._sujo ? `${fotosPendentes} ${fotosPendentes === 1 ? 'foto' : 'fotos'} a enviar` : 'aguardando envio';
    estado = {
      classe: 'pend',
      texto:
        e.sync.situacao === 'sem_conexao' ? `Salvo no aparelho · sem conexão (${o_que})`
        : e.sync.situacao === 'sem_sessao' ? 'Salvo no aparelho · entre de novo para enviar'
        : `Salvo no aparelho · ${o_que}`,
    };
  } else estado = { classe: 'ok', texto: `Sincronizado · última alteração às ${horaCurta(op.alterado_em)}` };

  const idc = (campo: string) => `f-${campo}`;

  return (
    <form className="pilha" autoComplete="off" noValidate onSubmit={(ev) => ev.preventDefault()}>
      {!editavel && (
        <div className="notice warn" role="status">
          {op.status === 'cancelada'
            ? 'OP cancelada. Só o administrador pode alterar.'
            : 'OP encerrada. Só o P&D pode alterar os dados.'}
        </div>
      )}
      {editavel && op.status !== 'aberta' && (
        <div className="notice" role="status">
          OP {op.status}{op.fechada_em ? ` em ${dataHoraBR(op.fechada_em)}` : ''}. As correções feitas aqui valem para o painel.
        </div>
      )}
      {erroOp && <div className="notice bad" role="alert">O servidor não aceitou esta OP: {erroOp}</div>}

      <fieldset disabled={!editavel}>
        {/* ------------------------------------------------ 1. identificação */}
        <section className="card" aria-labelledby="t-ident">
          <div className="sec-h"><h3 id="t-ident">Identificação</h3><span className="step">1 · no início</span></div>
          <div className="campo">
            <span id="r-produto">Produto</span>
            <button
              type="button"
              className={op.produto_descricao || mostrarNome ? 'produto-btn' : 'produto-btn primary'}
              aria-labelledby="r-produto v-produto"
              onClick={() => setSeletor(true)}
            >
              <span className="n" id="v-produto">
                {op.produto_codigo ? op.produto_descricao : mostrarNome ? 'Outro (fora do catálogo)' : 'Escolher produto'}
              </span>
              {op.produto_codigo && <span className="small mono">{op.produto_codigo} · {op.molde}</span>}
              {!op.produto_codigo && !mostrarNome && <span className="small">busca por código ou nome</span>}
            </button>
            {produto && (
              <p className="small">
                Do catálogo: código {produto.codigo} · molde {produto.molde} ({produto.molde === '3x1' ? 3 : 2} bandejas por passo) ·{' '}
                {produto.peso_nominal_kg ? `peso nominal ${gramas(produto.peso_nominal_kg)}` : 'peso variável (PDV)'}
              </p>
            )}
          </div>
          <div className="grid">
            {mostrarNome && (
              <label className="tudo">
                Nome do produto
                <input
                  value={op.produto_descricao}
                  onChange={(ev) => mudar({ produto_descricao: ev.target.value })}
                  placeholder="ex.: F. Badejo 400 g skin"
                />
              </label>
            )}
            <label>
              Data
              <input type="date" value={op.data ?? ''} onChange={(ev) => { if (ev.target.value || op.origem === 'planilha') mudar({ data: texto(ev.target.value) }); }} />
            </label>
            <label>
              OP
              <input inputMode="numeric" value={op.op ?? ''} onChange={(ev) => mudar({ op: texto(ev.target.value) })} placeholder="nº da OP" />
            </label>
            <label>
              Molde
              <select aria-label="Molde"
                value={op.molde}
                onChange={(ev) => { const m = ev.target.value as Molde; mudar({ molde: m, filme_tampa: filmeTampaSugerido(m) }); }}
              >
                <option value="2x1">2x1 (2 bandejas)</option>
                <option value="3x1">3x1 (3 bandejas)</option>
              </select>
            </label>
            <label htmlFor={idc('pn')}>
              Peso nominal (kg)
              <CampoNumero id={idc('pn')} valor={op.peso_nominal_kg} aoMudar={(v) => mudar({ peso_nominal_kg: v })} min={0} max={50} placeholder="vazio = variável" />
            </label>
            <label htmlFor={idc('epc')}>
              Embalagens por caixa
              <CampoNumero id={idc('epc')} valor={op.embalagens_por_caixa} aoMudar={(v) => mudar({ embalagens_por_caixa: v })} inteiro min={1} max={500} />
            </label>
            <label>
              Lote da matéria-prima
              <input value={op.lote_mp ?? ''} onChange={(ev) => mudar({ lote_mp: texto(ev.target.value) })} />
            </label>
            <div className="campo">
              <label htmlFor={idc('temp')}>Temp. do produto (°C)</label>
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <CampoNumero id={idc('temp')} valor={op.temp_produto_c} aoMudar={(v) => mudar({ temp_produto_c: v })} min={-60} max={60} placeholder="ex.: -18" />
                </span>
                <button
                  type="button"
                  aria-label="Trocar o sinal da temperatura"
                  onClick={() => { if (op.temp_produto_c != null) mudar({ temp_produto_c: -op.temp_produto_c }); }}
                >
                  ±
                </button>
              </div>
            </div>
            <label>
              Filme de fundo
              <select aria-label="Filme de fundo" value={op.filme_fundo ?? ''} onChange={(ev) => mudar({ filme_fundo: texto(ev.target.value) })}>
                {!op.filme_fundo && <option value="">—</option>}
                {[...new Set([...FILMES_FUNDO, op.filme_fundo ?? FILMES_FUNDO[0]])].map((f) => <option key={f}>{f}</option>)}
              </select>
            </label>
            <label>
              Filme de tampa
              <select aria-label="Filme de tampa" value={op.filme_tampa ?? ''} onChange={(ev) => mudar({ filme_tampa: texto(ev.target.value) })}>
                {!op.filme_tampa && <option value="">—</option>}
                {[...new Set([...FILMES_TAMPA, op.filme_tampa ?? FILMES_TAMPA[0]])].map((f) => <option key={f}>{f}</option>)}
              </select>
            </label>
            <label>
              Lote do filme (fundo / tampa)
              <input value={op.lote_filme ?? ''} onChange={(ev) => mudar({ lote_filme: texto(ev.target.value) })} />
            </label>
          </div>
        </section>

        {/* ------------------------------------------------ 2. início */}
        <section className="card" aria-labelledby="t-inicio">
          <div className="sec-h"><h3 id="t-inicio">Início</h3><span className="step">2 · zere ou leia o contador de passos</span></div>
          <div className="row">
            <label>
              Hora de início
              <input type="time" value={op.hora_inicio ?? ''} onChange={(ev) => mudar({ hora_inicio: texto(ev.target.value) })} />
            </label>
            <button type="button" onClick={() => mudar({ hora_inicio: agoraHHMM() })} aria-label="Hora de início: agora">Agora</button>
            <label htmlFor={idc('pi')}>
              Passo no início
              <CampoNumero id={idc('pi')} valor={op.passo_inicio} aoMudar={(v) => mudar({ passo_inicio: v })} inteiro min={0} max={99999999} />
            </label>
          </div>
        </section>

        {/* ------------------------------------------------ 3. configuração da máquina */}
        <section className="card" aria-labelledby="t-maq">
          <div className="sec-h"><h3 id="t-maq">Configuração da máquina</h3><span className="step">3 · fotos das telas 412, 414 e 417</span></div>
          <p className="small muted">
            Fotografe as três telas. “Ler valores das fotos” preenche os campos; confira antes de encerrar.
            Campos em laranja estão diferentes da receita padrão.
          </p>
          <div className="row">
            <span className="filebtn">
              <button type="button" tabIndex={-1}>Adicionar foto da tela</button>
              <input
                type="file" accept="image/*" capture="environment" multiple aria-label="Adicionar foto da tela"
                onChange={(ev) => { void receberFotos(ev.target.files, 'tela'); ev.target.value = ''; }}
              />
            </span>
            {!MODO_LOCAL && fotosTela.length > 0 && (
              <button type="button" onClick={() => void lerDasFotos()} disabled={lendo}>
                {lendo ? 'Lendo…' : 'Ler valores das fotos'}
              </button>
            )}
            <button
              type="button" className="ghost"
              onClick={() => { mudar({ ...padrao, parametros_origem: 'padrao' }); setLidos([]); setLeitura(null); }}
            >
              Usar receita padrão
            </button>
          </div>
          {processando > 0 && <p className="small muted" role="status">Preparando {processando} {processando === 1 ? 'foto' : 'fotos'}…</p>}
          <Fotos fotos={fotosTela} pendentes={e.fotosPendentes} aoRemover={editavel ? (id) => void removerFoto(op.id, id) : undefined} />
          {leitura && <div className={`notice ${leitura.tipo === 'info' ? '' : leitura.tipo}`} role="status">{leitura.texto}</div>}
          <div className="params">
            {PARAMETROS.map((p) => (
              <div key={p.chave} className={['pf', alterados.includes(p.chave) ? 'diff' : '', lidos.includes(p.chave) ? 'lido' : ''].join(' ').trim()}>
                <label htmlFor={`p-${p.chave}`} title={p.nomeCompleto}>
                  <span>{p.nome} <span className="tela">{p.unidade} · tela {p.tela}</span></span>
                  <CampoNumero
                    id={`p-${p.chave}`}
                    valor={op[p.chave]}
                    min={p.min}
                    max={p.max}
                    aoMudar={(v) => {
                      mudar({ [p.chave]: v, parametros_origem: op.parametros_origem === 'lido_da_foto' ? 'lido_da_foto' : 'digitado' });
                      setLidos((l) => l.filter((k) => k !== p.chave));
                    }}
                  />
                </label>
              </div>
            ))}
          </div>
          {alterados.length > 0 && (
            <p className="small muted">
              Diferente da padrão:{' '}
              {alterados.map((k) => PARAMETROS.find((p) => p.chave === k)!).map((p) => `${p.nome} (padrão ${num(padrao[p.chave], p.casas)})`).join(' · ')}
            </p>
          )}
        </section>

        {/* ------------------------------------------------ 4. durante a produção */}
        <section className="card" aria-labelledby="t-durante">
          <div className="sec-h"><h3 id="t-durante">Durante a produção</h3><span className="step">4 · toque +1 a cada embalagem que volta</span></div>
          <div className="counters">
            {MOTIVOS_RETRABALHO.map((m) => (
              <div className="ctr" key={m.chave}>
                <span className="n">{m.nome}</span>
                <span className="v" aria-live="polite" aria-label={`${m.nome}: ${op.retrabalho?.[m.chave] ?? 0}`}>{op.retrabalho?.[m.chave] ?? 0}</span>
                <div className="b">
                  <button type="button" aria-label={`Menos um: ${m.nome}`} onClick={() => contarRetrabalho(op.id, m.chave, -1)}>−</button>
                  <button
                    type="button" className="plus" aria-label={`Mais um: ${m.nome}`}
                    onClick={() => {
                      contarRetrabalho(op.id, m.chave, 1);
                      try { navigator.vibrate?.(15); } catch { /* sem vibração */ }
                    }}
                  >
                    +1
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="pilha" style={{ gap: 8 }}>
            <div className="eyebrow">Paradas acima de 5 min</div>
            <div className="row">
              <label style={{ flex: '2 1 180px' }}>
                Motivo
                <select aria-label="Motivo" value={paradaMotivo} onChange={(ev) => setParadaMotivo(ev.target.value)}>
                  {MOTIVOS_PARADA.map((m) => <option key={m}>{m}</option>)}
                </select>
              </label>
              <label htmlFor={idc('pmin')} style={{ flex: '1 1 90px' }}>
                Minutos
                <CampoNumero id={idc('pmin')} valor={paradaMin} aoMudar={setParadaMin} inteiro min={1} max={1440} />
              </label>
              <button
                type="button"
                onClick={() => {
                  if (!paradaMin) { avisar('Informe os minutos da parada.', 'erro'); return; }
                  adicionarParada(op.id, paradaMotivo, paradaMin);
                  setParadaMin(null);
                }}
              >
                Adicionar
              </button>
            </div>
            {op.paradas.length ? (
              <div className="paradas">
                {op.paradas.map((p) => (
                  <div className="parada" key={p.id}>
                    <span>{p.motivo} · <b>{p.minutos} min</b></span>
                    <button type="button" aria-label={`Remover parada: ${p.motivo}, ${p.minutos} minutos`} onClick={() => removerParada(op.id, p.id)}>×</button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="small muted">Nenhuma parada registrada.</p>
            )}
          </div>
        </section>

        {/* ------------------------------------------------ 5. fim e produto acabado */}
        <section className="card" aria-labelledby="t-fim">
          <div className="sec-h"><h3 id="t-fim">Fim e produto acabado</h3><span className="step">5 · ao encerrar</span></div>
          <div className="row">
            <label>
              Hora de fim
              <input type="time" value={op.hora_fim ?? ''} onChange={(ev) => mudar({ hora_fim: texto(ev.target.value) })} />
            </label>
            <button type="button" onClick={() => mudar({ hora_fim: agoraHHMM() })} aria-label="Hora de fim: agora">Agora</button>
            <label htmlFor={idc('pf')}>
              Passo no fim
              <CampoNumero id={idc('pf')} valor={op.passo_fim} aoMudar={(v) => mudar({ passo_fim: v })} inteiro min={0} max={99999999} />
            </label>
          </div>
          <div className="grid">
            <label htmlFor={idc('cx')}>
              Caixas de produto acabado
              <CampoNumero id={idc('cx')} valor={op.caixas} aoMudar={(v) => mudar({ caixas: v })} inteiro min={0} max={100000} />
            </label>
            <label htmlFor={idc('av')}>
              Embalagens avulsas (fora de caixa)
              <CampoNumero id={idc('av')} valor={op.embalagens_avulsas} aoMudar={(v) => mudar({ embalagens_avulsas: v ?? 0 })} inteiro min={0} max={100000} />
            </label>
            <label htmlFor={idc('peso')}>
              Peso final (kg)
              <CampoNumero id={idc('peso')} valor={op.peso_final_kg} aoMudar={(v) => mudar({ peso_final_kg: v })} min={0} max={100000} />
            </label>
          </div>
          <div className="campo">
            <span id="r-aparencia">Aparência do produto final</span>
            <div className="seg" role="group" aria-labelledby="r-aparencia">
              {(['boa', 'regular', 'ruim'] as Aparencia[]).map((a) => (
                <button
                  type="button" key={a} aria-pressed={op.aparencia === a}
                  onClick={() => mudar({ aparencia: op.aparencia === a ? null : a })}
                >
                  {a[0].toUpperCase() + a.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <div className="row">
            <span className="filebtn">
              <button type="button" tabIndex={-1}>Adicionar foto do produto final</button>
              <input
                type="file" accept="image/*" capture="environment" multiple aria-label="Adicionar foto do produto final"
                onChange={(ev) => { void receberFotos(ev.target.files, 'produto'); ev.target.value = ''; }}
              />
            </span>
          </div>
          <Fotos fotos={fotosProduto} pendentes={e.fotosPendentes} aoRemover={editavel ? (id) => void removerFoto(op.id, id) : undefined} />
          <label>
            Observações
            <textarea
              value={op.observacoes ?? ''}
              onChange={(ev) => mudar({ observacoes: texto(ev.target.value) })}
              placeholder="o que se observou no produto, mudanças feitas e por quê"
            />
          </label>
        </section>
      </fieldset>

      {/* ------------------------------------------------ resultado */}
      <section className="card" aria-labelledby="t-result">
        <div className="sec-h"><h3 id="t-result">Resultado desta OP</h3><span className="muted small">calculado automaticamente</span></div>
        <div className="kpis">
          <Kpi rotulo="Bandejas formadas" valor={num(c.bandejas_formadas)} sub={c.passos != null && c.passos > 0 ? `${num(c.passos)} passos × ${cav}` : 'falta o passo no fim'} />
          <Kpi
            rotulo="Embalagens boas" valor={num(c.embalagens_boas)}
            sub={
              c.boas_por === 'caixas' ? `${num(op.caixas)} cx × ${num(op.embalagens_por_caixa)}${op.embalagens_avulsas ? ` + ${num(op.embalagens_avulsas)}` : ''}`
              : c.boas_por === 'peso' ? 'peso final ÷ peso nominal'
              : 'informe caixas e emb./caixa'
            }
          />
          <Kpi rotulo="Aproveitamento" valor={pct(c.aproveitamento)} sub={<Farol aproveitamento={c.aproveitamento} />} />
          <Kpi rotulo="Retrabalho" valor={num(c.retrabalho ?? 0)} sub={c.retrabalho_pct != null ? `${pct(c.retrabalho_pct)} das formadas` : undefined} />
          <Kpi rotulo="Vazias" valor={num(c.vazias)} sub={c.vazias_pct != null ? `${pct(c.vazias_pct)} das formadas` : c.perda_nao_classificada != null ? `${num(c.perda_nao_classificada)} de perda não classificada` : undefined} />
          <Kpi
            rotulo="Filme perdido" valor={kg(c.filme_perdido_kg)}
            sub={c.filme_perdido_kg != null ? `fundo ${num(c.filme_fundo_perdido_kg, 2)} · tampa ${num(c.filme_tampa_perdido_kg, 2)} kg` : 'vazias + retrabalho'}
          />
          <Kpi
            rotulo="Filme por kg de produto" valor={c.filme_g_por_kg != null ? `${num(c.filme_g_por_kg)} g/kg` : '—'}
            sub={`mínimo possível ${c.filme_minimo_g_por_kg != null ? num(c.filme_minimo_g_por_kg) + ' g/kg' : '—'}`}
          />
          <Kpi
            rotulo="Produtividade" valor={c.produtividade_kg_h != null ? `${num(c.produtividade_kg_h)} kg/h` : '—'}
            sub={c.horas != null ? `${num(c.horas, 2)} h · paradas ${c.minutos_parados} min` : undefined}
          />
          <Kpi rotulo="Ciclos por minuto" valor={num(c.ciclos_por_minuto, 1)} sub={`teórico ${num(60 / cicloTeorico(receita), 1)}`} />
          <Kpi rotulo="Peso médio" valor={gramas(c.peso_medio_kg)} sub={c.sobrepeso != null ? `sobrepeso ${pct(c.sobrepeso)}` : undefined} />
        </div>
        <BarraDestino c={c} />
        <LegendaDestino comNaoClassificada={c.perda_nao_classificada != null} />
      </section>

      <div className="actions">
        <span className={`stat ${estado.classe}`} role="status"><i aria-hidden="true" />{estado.texto}</span>
        {editavel && <button type="button" onClick={() => void salvar()} disabled={ehRascunho}>Salvar</button>}
        {editavel && op.status === 'aberta' && (
          <button type="button" className="primary" onClick={pedirEncerramento} disabled={ehRascunho}>Encerrar OP</button>
        )}
      </div>

      <SeletorProduto
        aberto={seletor}
        produtos={e.produtos}
        aoFechar={() => setSeletor(false)}
        aoEscolher={(p) => { escolherProduto(op.id, p); setOutroAberto(false); setSeletor(false); }}
        aoEscolherOutro={() => { mudar({ produto_codigo: null, produto_descricao: '' }); setOutroAberto(true); setSeletor(false); }}
      />

      <Dialogo aberto={confirmar != null} aoFechar={() => setConfirmar(null)} titulo="Encerrar esta OP?" estreito>
        <p>
          {rotuloOp(op)} · OP {op.op || 's/ nº'}: {num(c.bandejas_formadas)} bandejas formadas, {num(c.embalagens_boas)} boas,
          aproveitamento {pct(c.aproveitamento)}.
        </p>
        {confirmar?.map((a) => <div className="notice warn" key={a}>{a}</div>)}
        <p className="small muted">Depois de encerrada, só o P&D altera os dados.</p>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" onClick={() => setConfirmar(null)}>Voltar</button>
          <button type="button" className="primary" onClick={() => void encerrar()}>
            {confirmar?.length ? 'Encerrar mesmo assim' : 'Encerrar OP'}
          </button>
        </div>
      </Dialogo>
    </form>
  );
}
