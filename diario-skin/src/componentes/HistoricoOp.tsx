// Histórico de alterações de uma OP: quem mudou o quê, de quanto para quanto.
// Vem do servidor (tabela ops_historico), sob demanda.

import { useState } from 'react';
import { MODO_LOCAL } from '../lib/config';
import { dataHoraBR, horaCurta } from '../lib/formato';
import { descreverHistorico, type RegistroDescrito } from '../lib/historico';
import { lerServidor, nomeDoPerfil } from '../lib/loja';
import { classificar } from '../lib/servidor';

function quando(r: RegistroDescrito): string {
  // Registro que juntou vários minutos de digitação mostra o intervalo.
  const durou = Date.parse(r.ate) - Date.parse(r.em) >= 60_000;
  return durou ? `${dataHoraBR(r.em)} a ${horaCurta(r.ate)}` : dataHoraBR(r.em);
}

export function HistoricoOp({ opId }: { opId: string }) {
  const [estado, setEstado] = useState<'fechado' | 'carregando' | 'aberto'>('fechado');
  const [registros, setRegistros] = useState<RegistroDescrito[]>([]);
  const [erro, setErro] = useState<string | null>(null);

  async function carregar() {
    const servidor = lerServidor();
    if (!servidor) return;
    setEstado('carregando');
    setErro(null);
    try {
      setRegistros(descreverHistorico(await servidor.baixarHistorico(opId)).reverse());
      setEstado('aberto');
    } catch (falha) {
      const f = classificar(falha);
      setErro(f.tipo === 'rede' ? 'Sem conexão: o histórico fica no servidor.' : f.message || 'Não foi possível carregar o histórico.');
      setEstado('fechado');
    }
  }

  return (
    <div>
      <div className="eyebrow">Histórico de alterações</div>
      {MODO_LOCAL ? (
        <p className="small muted">O histórico de alterações é gravado pelo servidor. Em modo local ele não existe.</p>
      ) : estado !== 'aberto' ? (
        <div className="row">
          <button type="button" onClick={() => void carregar()} disabled={estado === 'carregando'}>
            {estado === 'carregando' ? 'Carregando…' : 'Ver quem alterou e o quê'}
          </button>
        </div>
      ) : registros.length === 0 ? (
        <p className="small muted">Nenhuma alteração registrada. O histórico começa a contar a partir da instalação desta função.</p>
      ) : (
        <ol className="historico">
          {registros.map((r) => (
            <li key={r.id}>
              <div className="cab">
                <b>{r.acao}</b>
                {r.correcao && <span className="chip on">depois de encerrada</span>}
              </div>
              <div className="small muted">{quando(r)} · {r.por ? nomeDoPerfil(r.por) ?? 'usuário removido' : 'direto no banco'}</div>
              {r.linhas.length > 0 && <ul className="lista-simples">{r.linhas.map((l) => <li key={l}>{l}</li>)}</ul>}
            </li>
          ))}
        </ol>
      )}
      {erro && <div className="notice warn" role="alert">{erro}</div>}
    </div>
  );
}
