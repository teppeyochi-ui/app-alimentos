// Casca do aplicativo: cabeçalho, abas, estado da sincronização, menu e avisos.

import { lazy, Suspense, useEffect, useState } from 'react';
import { Dialogo } from './componentes/Basicos';
import { MODO_LOCAL } from './lib/config';
import { MAQUINA } from './lib/constantes';
import { dataHoraBR } from './lib/formato';
import { descartarRascunho, quantasPendentes, useLoja, type Estado } from './lib/loja';
import { aplicarTema, atualizarAgora, instalar, lerTema, usePwa, type Tema } from './lib/pwa';
import { sair } from './lib/sessao';
import { sincronizar } from './lib/sincronizacao';
import { AguardandoLiberacao, Entrar } from './telas/Entrar';
import { Lancar } from './telas/Lancar';

// O painel e a administração carregam só quando abertos (o celular do operador não precisa deles).
const Painel = lazy(() => import('./telas/Painel'));
const Admin = lazy(() => import('./telas/Admin'));

type Tela = 'lancar' | 'painel' | 'admin';
interface Rota { tela: Tela; id: string | null }

const CHAVE_OP = 'diario-skin:op';

function lerRota(): Rota {
  const [tela, id] = window.location.hash.replace(/^#\/?/, '').split('/');
  if (tela === 'painel' || tela === 'admin') return { tela, id: id || null };
  return { tela: 'lancar', id: tela === 'lancar' ? id || null : null };
}

function irPara(tela: Tela, id?: string | null): void {
  window.location.hash = id ? `#${tela}/${id}` : `#${tela}`;
}

function useRota(): Rota {
  const [rota, setRota] = useState(lerRota);
  useEffect(() => {
    const ouvir = () => setRota(lerRota());
    window.addEventListener('hashchange', ouvir);
    return () => window.removeEventListener('hashchange', ouvir);
  }, []);
  return rota;
}

const PAPEIS = { operador: 'Operador', pd: 'P&D', admin: 'Administrador' } as const;

function resumoSync(e: Estado): { classe: string; texto: string } {
  const pendentes = quantasPendentes(e);
  const fotos = e.fotosPendentes.length;
  if (e.sync.modo === 'local') return { classe: 'pend', texto: 'Modo local' };
  if (e.sync.situacao === 'sincronizando') return { classe: 'sinc', texto: 'Sincronizando…' };
  if (e.sync.situacao === 'sem_sessao') return { classe: 'off', texto: 'Entre de novo' };
  if (e.sync.situacao === 'erro') return { classe: 'off', texto: 'Erro ao enviar' };
  if (e.sync.situacao === 'sem_conexao') {
    return { classe: 'off', texto: pendentes || fotos ? `Sem conexão · ${pendentes + fotos} a enviar` : 'Sem conexão' };
  }
  if (pendentes || fotos) return { classe: 'pend', texto: `${pendentes + fotos} a enviar` };
  return { classe: 'ok', texto: 'Sincronizado' };
}

export function App() {
  const e = useLoja();
  const pwa = usePwa();
  const rota = useRota();
  const [menu, setMenu] = useState(false);
  const [tema, setTema] = useState<Tema>(lerTema);

  // Ao abrir sem OP na rota, retoma a última OP aberta neste aparelho.
  useEffect(() => {
    if (!e.pronto || rota.tela !== 'lancar' || rota.id) return;
    try {
      const ultima = localStorage.getItem(CHAVE_OP);
      if (ultima && e.ops.some((o) => o.id === ultima && o.status === 'aberta')) irPara('lancar', ultima);
    } catch { /* sem armazenamento */ }
    // Só na abertura do aplicativo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [e.pronto]);

  useEffect(() => {
    try {
      if (rota.tela === 'lancar' && rota.id) localStorage.setItem(CHAVE_OP, rota.id);
    } catch { /* sem armazenamento */ }
    if (rota.tela !== 'lancar' || rota.id !== e.rascunho?.id) descartarRascunho();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rota.tela, rota.id]);

  if (!e.pronto) {
    return <main className="wrap"><p className="muted" role="status">Abrindo…</p></main>;
  }
  if (!e.perfil) return <Entrar />;
  if (!e.perfil.ativo) return <AguardandoLiberacao perfil={e.perfil} />;

  const perfil = e.perfil;
  const ehAdmin = perfil.papel === 'admin';
  const tela: Tela = rota.tela === 'admin' && !ehAdmin ? 'lancar' : rota.tela;
  const sync = resumoSync(e);
  const pendentes = quantasPendentes(e);

  return (
    <div className="wrap">
      <header className="topo">
        <div className="topo-titulo">
          <div>
            <div className="eyebrow">Frescatto · P&D · {MAQUINA}</div>
            <h1>Diário da Linha Skin</h1>
          </div>
          <button type="button" className={`estado ${sync.classe}`} onClick={() => setMenu(true)} aria-label={`${sync.texto}. Abrir menu`}>
            <i aria-hidden="true" />{sync.texto}
          </button>
        </div>
        <nav className="abas" aria-label="Seções">
          <a href="#lancar" aria-current={tela === 'lancar' ? 'page' : undefined}>Lançar OP</a>
          <a href="#painel" aria-current={tela === 'painel' ? 'page' : undefined}>Painel P&D</a>
          {ehAdmin && <a href="#admin" aria-current={tela === 'admin' ? 'page' : undefined}>Administração</a>}
        </nav>
      </header>

      {pwa.atualizacao && (
        <div className="notice faixa" role="status">
          <span>Há uma versão nova do aplicativo.</span>
          <button type="button" className="primary" onClick={atualizarAgora}>Atualizar</button>
        </div>
      )}
      {MODO_LOCAL && (
        <div className="notice warn" role="status">
          Modo local: nenhum servidor configurado. Os dados ficam só neste aparelho e não há login. Veja o README para ligar ao Supabase.
        </div>
      )}
      {e.sync.situacao === 'sem_sessao' && (
        <div className="notice bad faixa" role="alert">
          <span>{e.sync.mensagem ?? 'Sua sessão expirou.'} Os dados lançados continuam guardados neste aparelho.</span>
          <button type="button" onClick={() => void sair()}>Entrar de novo</button>
        </div>
      )}

      <main>
        {tela === 'lancar' && <Lancar opId={rota.id} abrirOp={(id) => irPara('lancar', id)} />}
        <Suspense fallback={<p className="muted" role="status">Abrindo…</p>}>
          {tela === 'painel' && <Painel abrirNoLancamento={(id) => irPara('lancar', id)} />}
          {tela === 'admin' && ehAdmin && <Admin />}
        </Suspense>
      </main>

      <Dialogo aberto={menu} aoFechar={() => setMenu(false)} titulo={perfil.nome} sobretitulo={PAPEIS[perfil.papel]} estreito>
        <div className="dl">
          <div><span>Situação</span><b>{sync.texto}</b></div>
          <div><span>OPs a enviar</span><b>{pendentes}</b></div>
          <div><span>Fotos a enviar</span><b>{e.fotosPendentes.length}</b></div>
          <div><span>Última sincronização</span><b>{e.sync.modo === 'local' ? 'não se aplica' : dataHoraBR(e.sync.ultimo)}</b></div>
        </div>
        {e.sync.mensagem && <div className="notice warn">{e.sync.mensagem}</div>}
        {!MODO_LOCAL && (
          <button type="button" className="primary" onClick={() => void sincronizar({ cadastros: true })} disabled={e.sync.situacao === 'sincronizando'}>
            {e.sync.situacao === 'sincronizando' ? 'Sincronizando…' : 'Sincronizar agora'}
          </button>
        )}
        <label>
          Tema
          <select aria-label="Tema" value={tema} onChange={(ev) => { const t = ev.target.value as Tema; setTema(t); aplicarTema(t); }}>
            <option value="auto">Automático (segue o aparelho)</option>
            <option value="light">Claro</option>
            <option value="dark">Escuro</option>
          </select>
        </label>
        {pwa.instalavel && <button type="button" onClick={() => void instalar()}>Instalar o aplicativo neste aparelho</button>}
        {!MODO_LOCAL && (
          <>
            {(pendentes > 0 || e.fotosPendentes.length > 0) && (
              <p className="small muted">
                Há dados ainda não enviados. Se sair agora, eles continuam neste aparelho e são enviados no próximo acesso.
              </p>
            )}
            <button type="button" onClick={() => { setMenu(false); void sair(); }}>Sair</button>
          </>
        )}
      </Dialogo>

      <div className="avisos" aria-live="polite">
        {e.avisos.map((a) => (
          <div key={a.id} className={`aviso ${a.tipo === 'erro' ? 'erro' : ''}`} role={a.tipo === 'erro' ? 'alert' : 'status'}>{a.texto}</div>
        ))}
      </div>
    </div>
  );
}
