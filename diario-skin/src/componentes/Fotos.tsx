// Miniaturas das fotos de uma OP, com ampliação e (quando editável) remoção.

import { useState } from 'react';
import { MODO_LOCAL } from '../lib/config';
import { useUrlFoto } from '../lib/fotos';
import type { Foto } from '../lib/tipos';
import { Dialogo } from './Basicos';

interface MiniaturaProps {
  foto: Foto;
  indice: number;
  pendente: boolean;
  aoAmpliar: (url: string) => void;
  aoRemover?: () => void;
}

function Miniatura({ foto, indice, pendente, aoAmpliar, aoRemover }: MiniaturaProps) {
  const { url, estado } = useUrlFoto(foto);
  const nome = `Foto ${indice + 1}${foto.tela_numero ? ` (tela ${foto.tela_numero})` : ''}`;
  return (
    <div className="ph">
      {url ? (
        <button type="button" className="ver" onClick={() => aoAmpliar(url)} aria-label={`Ampliar ${nome}`}>
          <img src={url} alt={nome} loading="lazy" />
        </button>
      ) : (
        <div className="msg">{estado === 'carregando' ? 'abrindo…' : 'foto ainda não disponível neste aparelho'}</div>
      )}
      {(pendente || foto.tela_numero) && (
        <span className="selo">{pendente ? 'a enviar' : `tela ${foto.tela_numero}`}</span>
      )}
      {aoRemover && (
        <button type="button" className="x" onClick={aoRemover} aria-label={`Remover ${nome}`}>
          <span aria-hidden="true">×</span>
        </button>
      )}
    </div>
  );
}

interface FotosProps {
  fotos: Foto[];
  /** ids das fotos que ainda não chegaram ao servidor */
  pendentes?: string[];
  aoRemover?: (id: string) => void;
  vazio?: string;
}

export function Fotos({ fotos, pendentes = [], aoRemover, vazio }: FotosProps) {
  const [ampliada, setAmpliada] = useState<string | null>(null);
  if (!fotos.length) return vazio ? <p className="small muted">{vazio}</p> : null;
  return (
    <>
      <div className="photos">
        {fotos.map((f, i) => (
          <Miniatura
            key={f.id}
            foto={f}
            indice={i}
            pendente={!MODO_LOCAL && pendentes.includes(f.id)}
            aoAmpliar={setAmpliada}
            aoRemover={aoRemover ? () => aoRemover(f.id) : undefined}
          />
        ))}
      </div>
      <Dialogo aberto={ampliada != null} aoFechar={() => setAmpliada(null)} titulo="Foto ampliada" classe="zoom">
        {ampliada && <img src={ampliada} alt="Foto ampliada" />}
      </Dialogo>
    </>
  );
}
