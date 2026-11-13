// Administração (seção 8.3): catálogo de produtos, pesos de filme por molde,
// receita padrão (com vigência) e usuários. Só para o papel administrador.

import { useMemo, useState } from 'react';
import { CampoNumero, Dialogo } from '../componentes/Basicos';
import { cicloTeorico, parametrosDaReceita, receitaVigente } from '../lib/calc';
import { incluirReceita, salvarMolde, salvarPerfil, salvarProdutos } from '../lib/cadastros';
import { MODO_LOCAL } from '../lib/config';
import { PARAMETROS } from '../lib/constantes';
import { dataBR, gramas, hojeISO, normalizar, num } from '../lib/formato';
import { avisar, useLoja, type Estado } from '../lib/loja';
import { embalagensPorCaixaCalculado, pesoCaixaDaDerivacao, produtosDoCsv } from '../lib/semente';
import type { Molde, MoldeInfo, Papel, Parametros, Perfil, Produto } from '../lib/tipos';

type Secao = 'produtos' | 'filme' | 'receita' | 'usuarios';
const SECOES: [Secao, string][] = [
  ['produtos', 'Produtos'], ['filme', 'Filme por molde'], ['receita', 'Receita padrão'], ['usuarios', 'Usuários'],
];

/** Mostra o resultado de uma gravação. Devolve true se deu certo. */
function concluir(erro: string | null, ok: string): boolean {
  avisar(erro ?? ok, erro ? 'erro' : 'ok');
  return !erro;
}

export default function Admin() {
  const e = useLoja();
  const [secao, setSecao] = useState<Secao>('produtos');
  return (
    <div className="pilha">
      <div className="sub-abas" role="group" aria-label="Cadastros">
        {SECOES.map(([s, nome]) => (
          <button type="button" key={s} aria-pressed={secao === s} onClick={() => setSecao(s)}>{nome}</button>
        ))}
      </div>
      {secao === 'produtos' && <Produtos e={e} />}
      {secao === 'filme' && <Filme e={e} />}
      {secao === 'receita' && <Receita e={e} />}
      {secao === 'usuarios' && <Usuarios e={e} />}
    </div>
  );
}

// ------------------------------------------------------------------ produtos

const PRODUTO_NOVO: Produto = {
  codigo: '', descricao: '', molde: '3x1', peso_nominal_kg: null, embalagens_por_caixa: null,
  derivacao: null, peso_caixa_kg: null, especie: null, molde_a_confirmar: false, ativo: true,
};

function Produtos({ e }: { e: Estado }) {
  const [busca, setBusca] = useState('');
  const [soAConfirmar, setSoAConfirmar] = useState(false);
  const [editando, setEditando] = useState<{ produto: Produto; novo: boolean } | null>(null);
  const [importar, setImportar] = useState<{ produtos: Produto[]; erros: string[]; novos: number } | null>(null);
  const [gravando, setGravando] = useState(false);

  const lista = useMemo(() => {
    const termos = normalizar(busca).split(/\s+/).filter(Boolean);
    return e.produtos.filter(
      (p) => (!soAConfirmar || p.molde_a_confirmar) &&
        termos.every((t) => normalizar(`${p.codigo} ${p.descricao} ${p.derivacao ?? ''} ${p.especie ?? ''}`).includes(t)),
    );
  }, [busca, e.produtos, soAConfirmar]);
  const aConfirmar = e.produtos.filter((p) => p.molde_a_confirmar).length;

  async function gravar(produtos: Produto[], mensagem: string): Promise<boolean> {
    setGravando(true);
    try {
      return concluir(await salvarProdutos(produtos), mensagem);
    } finally {
      setGravando(false);
    }
  }

  async function lerArquivo(arquivo: File | undefined) {
    if (!arquivo) return;
    const { produtos, erros } = produtosDoCsv(await arquivo.text());
    const atuais = new Map(e.produtos.map((p) => [p.codigo, p]));
    // O que o arquivo não traz fica como está no catálogo.
    const mesclados = produtos.map((p) => {
      const atual = atuais.get(p.codigo);
      return atual
        ? {
            ...p,
            molde: p.molde ?? atual.molde,
            molde_a_confirmar: p.molde ? p.molde_a_confirmar : atual.molde_a_confirmar,
            embalagens_por_caixa: p.embalagens_por_caixa ?? atual.embalagens_por_caixa,
            derivacao: p.derivacao ?? atual.derivacao,
            peso_caixa_kg: p.peso_caixa_kg ?? atual.peso_caixa_kg,
            especie: p.especie ?? atual.especie,
            ativo: atual.ativo,
          }
        : p;
    });
    setImportar({ produtos: mesclados, erros, novos: mesclados.filter((p) => !atuais.has(p.codigo)).length });
  }

  const ed = editando?.produto;
  const mudar = (m: Partial<Produto>) => setEditando((x) => (x ? { ...x, produto: { ...x.produto, ...m } } : x));

  return (
    <section className="card" aria-labelledby="t-prod">
      <div className="sec-h">
        <h2 id="t-prod">Catálogo de produtos</h2>
        <span className="muted small">{e.produtos.length} produtos · {e.produtos.filter((p) => !p.ativo).length} inativos</span>
      </div>
      <div className="row">
        <label style={{ flex: '2 1 200px' }}>
          Buscar por código ou nome
          <input type="search" value={busca} onChange={(ev) => setBusca(ev.target.value)} />
        </label>
        <button type="button" className="primary" onClick={() => setEditando({ produto: { ...PRODUTO_NOVO }, novo: true })}>Novo produto</button>
        <span className="filebtn">
          <button type="button" tabIndex={-1}>Importar CSV</button>
          <input type="file" accept=".csv,text/csv" aria-label="Importar CSV de produtos" onChange={(ev) => { void lerArquivo(ev.target.files?.[0]); ev.target.value = ''; }} />
        </span>
      </div>
      {aConfirmar > 0 && (
        <label className="linha">
          <input type="checkbox" checked={soAConfirmar} onChange={(ev) => setSoAConfirmar(ev.target.checked)} />
          só os {aConfirmar} com molde a confirmar
        </label>
      )}
      <p className="small muted">
        CSV com ponto e vírgula e a primeira linha{' '}
        <span className="mono">codigo;descricao;molde;peso_nominal_kg;embalagens_por_caixa;derivacao;peso_caixa_kg;especie</span>{' '}
        (só código e descrição são obrigatórios). O peso da caixa é lido da derivação (“CXA 7,5”) e, com o peso nominal,
        dá as embalagens por caixa. Produto que já existe é atualizado; nenhum é apagado.
      </p>
      <div>
        {lista.map((p) => (
          <div className="linha-adm" key={p.codigo}>
            <div className="t">
              <b>{p.descricao}</b>{!p.ativo && <> <span className="chip">inativo</span></>}
              {p.molde_a_confirmar && <> <span className="chip on">molde a confirmar</span></>}
              <div className="small muted mono">
                {p.codigo} · {p.molde ?? 'sem molde'} · {p.peso_nominal_kg ? gramas(p.peso_nominal_kg) : 'peso variável (PDV)'} ·{' '}
                {p.embalagens_por_caixa ? `${p.embalagens_por_caixa} por caixa` : p.peso_nominal_kg ? 'emb./caixa a definir' : 'emb./caixa informada na OP'}
              </div>
              {(p.derivacao || p.especie) && (
                <div className="small muted">{[p.derivacao, p.especie].filter(Boolean).join(' · ')}</div>
              )}
              {p.molde_a_confirmar && (
                <div className="row" style={{ marginTop: 6 }}>
                  {(['2x1', '3x1'] as Molde[]).map((m) => (
                    <button
                      type="button" key={m} disabled={gravando} aria-label={`Confirmar molde ${m} para ${p.descricao} (${p.codigo})`}
                      onClick={() => void gravar([{ ...p, molde: m, molde_a_confirmar: false }], `Molde ${m} confirmado.`)}
                    >
                      {p.molde === m ? `Confirmar ${m}` : `É ${m}`}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button type="button" onClick={() => setEditando({ produto: { ...p }, novo: false })} aria-label={`Editar ${p.descricao} (${p.codigo})`}>Editar</button>
          </div>
        ))}
        {!lista.length && <p className="small muted">Nenhum produto com esse código ou nome.</p>}
      </div>

      <Dialogo aberto={ed != null} aoFechar={() => setEditando(null)} titulo={editando?.novo ? 'Novo produto' : 'Editar produto'} estreito>
        {ed && (
          <>
            <label>
              SKU (código PROD_DER)
              <input value={ed.codigo} disabled={!editando!.novo} onChange={(ev) => mudar({ codigo: ev.target.value.trim() })} placeholder="ex.: 24616701063781-975" />
            </label>
            <label>
              Descrição
              <input value={ed.descricao} onChange={(ev) => mudar({ descricao: ev.target.value })} />
            </label>
            <label>
              Derivação (DESCR_DER)
              <input
                value={ed.derivacao ?? ''} placeholder="ex.: FRESCATTO CXA 7,5 ou FRESC CXA PDV PF"
                onChange={(ev) => {
                  // A caixa escrita na derivação preenche o peso da caixa e, com o peso nominal, as embalagens por caixa.
                  const derivacao = ev.target.value || null;
                  const caixa = pesoCaixaDaDerivacao(derivacao);
                  mudar({
                    derivacao,
                    peso_caixa_kg: caixa,
                    embalagens_por_caixa: embalagensPorCaixaCalculado(caixa, ed.peso_nominal_kg) ?? ed.embalagens_por_caixa,
                  });
                }}
              />
            </label>
            <div className="grid">
              <label>
                Molde
                <select aria-label="Molde" value={ed.molde ?? ''} onChange={(ev) => mudar({ molde: (ev.target.value || null) as Molde | null })}>
                  <option value="">a confirmar</option>
                  <option value="2x1">2x1</option>
                  <option value="3x1">3x1</option>
                </select>
              </label>
              <label>
                Espécie (agrupamento)
                <input value={ed.especie ?? ''} onChange={(ev) => mudar({ especie: ev.target.value || null })} placeholder="ex.: SALMON" />
              </label>
              <label htmlFor="ad-pc">
                Peso da caixa (kg)
                <CampoNumero id="ad-pc" valor={ed.peso_caixa_kg} aoMudar={(v) => mudar({ peso_caixa_kg: v || null })} min={0} max={100} placeholder="vazio = variável (PDV)" />
              </label>
              <label htmlFor="ad-pn">
                Peso nominal (kg)
                <CampoNumero id="ad-pn" valor={ed.peso_nominal_kg} aoMudar={(v) => mudar({ peso_nominal_kg: v || null })} min={0} max={50} placeholder="vazio = variável" />
              </label>
              <label htmlFor="ad-epc">
                Embalagens por caixa
                <CampoNumero id="ad-epc" valor={ed.embalagens_por_caixa} aoMudar={(v) => mudar({ embalagens_por_caixa: v || null })} inteiro min={1} max={500} />
              </label>
            </div>
            <label className="linha">
              <input type="checkbox" checked={ed.ativo} onChange={(ev) => mudar({ ativo: ev.target.checked })} />
              ativo (aparece na busca do lançamento)
            </label>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button
                type="button" className="primary" disabled={gravando}
                onClick={async () => {
                  if (!ed.codigo || !ed.descricao.trim()) { avisar('Informe código e descrição.', 'erro'); return; }
                  if (editando!.novo && e.produtos.some((p) => p.codigo === ed.codigo)) { avisar('Já existe um produto com este código.', 'erro'); return; }
                  // Salvar aqui com o molde escolhido confirma o molde.
                  const produto = {
                    ...ed, descricao: ed.descricao.trim(), derivacao: ed.derivacao?.trim() || null, especie: ed.especie?.trim() || null,
                    molde_a_confirmar: ed.molde == null,
                  };
                  if (await gravar([produto], 'Produto salvo.')) setEditando(null);
                }}
              >
                {gravando ? 'Salvando…' : 'Salvar'}
              </button>
            </div>
          </>
        )}
      </Dialogo>

      <Dialogo aberto={importar != null} aoFechar={() => setImportar(null)} titulo="Importar produtos" estreito>
        {importar && (
          <>
            <p>
              {importar.produtos.length} {importar.produtos.length === 1 ? 'produto lido' : 'produtos lidos'}: {importar.novos} novos e{' '}
              {importar.produtos.length - importar.novos} que já existem (serão atualizados).
            </p>
            {importar.erros.length > 0 && (
              <div className="notice warn">
                {importar.erros.length} {importar.erros.length === 1 ? 'linha ignorada' : 'linhas ignoradas'}:
                <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{importar.erros.slice(0, 8).map((x) => <li key={x}>{x}</li>)}</ul>
              </div>
            )}
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setImportar(null)}>Cancelar</button>
              <button
                type="button" className="primary" disabled={gravando || !importar.produtos.length}
                onClick={async () => { if (await gravar(importar.produtos, `${importar.produtos.length} produtos importados.`)) setImportar(null); }}
              >
                {gravando ? 'Importando…' : `Importar ${importar.produtos.length}`}
              </button>
            </div>
          </>
        )}
      </Dialogo>
    </section>
  );
}

// ------------------------------------------------------------------ filme por molde

function LinhaMolde({ molde }: { molde: MoldeInfo }) {
  const [m, setM] = useState(molde);
  const [gravando, setGravando] = useState(false);
  const mudou = m.filme_fundo_kg_bdj !== molde.filme_fundo_kg_bdj || m.filme_tampa_kg_bdj !== molde.filme_tampa_kg_bdj;
  return (
    <div className="card" style={{ background: 'var(--bg)' }}>
      <div className="sec-h"><h3>Molde {m.molde}</h3><span className="muted small">{m.cavidades} bandejas por passo</span></div>
      <div className="grid">
        <label htmlFor={`ff-${m.molde}`}>
          Filme de fundo (kg/bandeja)
          <CampoNumero id={`ff-${m.molde}`} valor={m.filme_fundo_kg_bdj} aoMudar={(v) => { if (v != null) setM({ ...m, filme_fundo_kg_bdj: v }); }} min={0} max={1} />
        </label>
        <label htmlFor={`ft-${m.molde}`}>
          Filme de tampa (kg/bandeja)
          <CampoNumero id={`ft-${m.molde}`} valor={m.filme_tampa_kg_bdj} aoMudar={(v) => { if (v != null) setM({ ...m, filme_tampa_kg_bdj: v }); }} min={0} max={1} />
        </label>
        <div className="campo">
          <span>Total (kg/bandeja)</span>
          <b className="mono" style={{ color: 'var(--ink)', fontSize: 16, minHeight: 48, display: 'flex', alignItems: 'center' }}>
            {num(m.filme_fundo_kg_bdj + m.filme_tampa_kg_bdj, 7)}
          </b>
        </div>
      </div>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button
          type="button" className="primary" disabled={!mudou || gravando}
          onClick={async () => { setGravando(true); concluir(await salvarMolde(m), `Molde ${m.molde} salvo.`); setGravando(false); }}
        >
          {gravando ? 'Salvando…' : 'Salvar'}
        </button>
      </div>
    </div>
  );
}

function Filme({ e }: { e: Estado }) {
  return (
    <section className="card" aria-labelledby="t-filme">
      <h2 id="t-filme">Peso de filme por bandeja</h2>
      <p className="small muted">
        Usado no cálculo de filme perdido e de filme por kg de produto. Passo da máquina: 0,42 m × 0,27 m = 0,1134 m².
        A alteração vale para todas as OPs, inclusive as já lançadas.
      </p>
      {e.moldes.map((m) => <LinhaMolde key={`${m.molde}-${m.filme_fundo_kg_bdj}-${m.filme_tampa_kg_bdj}`} molde={m} />)}
    </section>
  );
}

// ------------------------------------------------------------------ receita padrão

function Receita({ e }: { e: Estado }) {
  const vigente = receitaVigente(e.receitas, hojeISO());
  const [valores, setValores] = useState<Parametros>(() => parametrosDaReceita(vigente));
  const [ciclo, setCiclo] = useState<number | null>(() => cicloTeorico(vigente));
  const [desde, setDesde] = useState(hojeISO());
  const [gravando, setGravando] = useState(false);
  const historico = [...e.receitas].sort((a, b) => Date.parse(b.vigente_desde) - Date.parse(a.vigente_desde) || b.id - a.id);

  async function salvar() {
    if (PARAMETROS.some((p) => valores[p.chave] == null) || !ciclo || !desde) {
      avisar('Preencha os 12 parâmetros, o ciclo teórico e a data de vigência.', 'erro');
      return;
    }
    setGravando(true);
    // Vale a partir da meia-noite (hora do aparelho) do dia escolhido.
    const erro = await incluirReceita({ ...valores, ciclo_teorico_s: ciclo, vigente_desde: new Date(`${desde}T00:00:00`).toISOString() });
    setGravando(false);
    concluir(erro, 'Receita padrão registrada.');
  }

  return (
    <section className="card" aria-labelledby="t-rec">
      <h2 id="t-rec">Receita padrão da máquina</h2>
      <p className="small muted">
        Cada alteração entra como uma receita nova, com data de vigência; as anteriores ficam no histórico.
        Cada OP é comparada com a receita que valia na data dela.
      </p>
      <div className="params">
        {PARAMETROS.map((p) => (
          <div className="pf" key={p.chave}>
            <label htmlFor={`r-${p.chave}`} title={p.nomeCompleto}>
              <span>{p.nome} <span className="tela">{p.unidade} · tela {p.tela}</span></span>
              <CampoNumero id={`r-${p.chave}`} valor={valores[p.chave]} min={p.min} max={p.max} aoMudar={(v) => setValores((x) => ({ ...x, [p.chave]: v }))} />
            </label>
          </div>
        ))}
      </div>
      <div className="row">
        <label htmlFor="r-ciclo">
          Ciclo teórico da estação (s)
          <CampoNumero id="r-ciclo" valor={ciclo} aoMudar={setCiclo} min={1} max={120} />
        </label>
        <label>
          Vigente desde
          <input type="date" value={desde} onChange={(ev) => setDesde(ev.target.value)} />
        </label>
        <button type="button" className="primary" onClick={() => void salvar()} disabled={gravando}>
          {gravando ? 'Salvando…' : 'Registrar nova receita'}
        </button>
      </div>
      <div>
        <div className="eyebrow" style={{ marginBottom: 6 }}>Histórico</div>
        {historico.map((r) => (
          <div className="linha-adm" key={r.id}>
            <div className="t small">
              <b>Desde {dataBR(hojeISO(new Date(r.vigente_desde)))}</b>{vigente?.id === r.id && <> <span className="chip st-fechada">vigente</span></>}
              <div className="muted mono">
                {PARAMETROS.map((p) => `${p.sigla} ${num(r[p.chave], p.casas)}`).join(' · ')} · ciclo {num(r.ciclo_teorico_s, 1)} s
              </div>
            </div>
          </div>
        ))}
        {!historico.length && <p className="small muted">Nenhuma receita registrada: valem os valores de fábrica.</p>}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ usuários

const PAPEIS: [Papel, string][] = [['operador', 'Operador'], ['pd', 'P&D'], ['admin', 'Administrador']];

function LinhaUsuario({ perfil, eu }: { perfil: Perfil; eu: boolean }) {
  const [p, setP] = useState(perfil);
  const [gravando, setGravando] = useState(false);
  const mudou = p.nome !== perfil.nome || p.papel !== perfil.papel || p.ativo !== perfil.ativo;
  return (
    <div className="card" style={{ background: 'var(--bg)' }}>
      <div className="grid larga">
        <label>
          Nome{eu ? ' (você)' : ''}
          <input value={p.nome} onChange={(ev) => setP({ ...p, nome: ev.target.value })} />
        </label>
        <label>
          Papel
          <select aria-label="Papel" value={p.papel} onChange={(ev) => setP({ ...p, papel: ev.target.value as Papel })}>
            {PAPEIS.map(([v, nome]) => <option key={v} value={v}>{nome}</option>)}
          </select>
        </label>
        <label className="linha">
          <input type="checkbox" checked={p.ativo} onChange={(ev) => setP({ ...p, ativo: ev.target.checked })} />
          acesso liberado
        </label>
      </div>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button
          type="button" className="primary" disabled={!mudou || gravando || !p.nome.trim()}
          onClick={async () => { setGravando(true); concluir(await salvarPerfil({ ...p, nome: p.nome.trim() }), 'Usuário salvo.'); setGravando(false); }}
        >
          {gravando ? 'Salvando…' : 'Salvar'}
        </button>
      </div>
    </div>
  );
}

function Usuarios({ e }: { e: Estado }) {
  if (MODO_LOCAL) {
    return (
      <section className="card">
        <h2>Usuários</h2>
        <p className="muted">Em modo local não há login. Os usuários e papéis passam a valer quando o servidor estiver configurado.</p>
      </section>
    );
  }
  const pendentes = e.perfis.filter((p) => !p.ativo);
  const lista = [...pendentes, ...e.perfis.filter((p) => p.ativo)];
  return (
    <section className="card" aria-labelledby="t-usr">
      <div className="sec-h">
        <h2 id="t-usr">Usuários e papéis</h2>
        <span className="muted small">{e.perfis.length} contas · {pendentes.length} aguardando liberação</span>
      </div>
      <p className="small muted">
        Quem cria conta entra como operador sem acesso, até ser liberado aqui. Operador lança e encerra OPs;
        P&D também corrige OPs encerradas; administrador mantém estes cadastros.
      </p>
      {lista.map((p) => <LinhaUsuario key={`${p.id}-${p.nome}-${p.papel}-${p.ativo}`} perfil={p} eu={p.id === e.perfil?.id} />)}
    </section>
  );
}
