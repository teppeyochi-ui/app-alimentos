// Escolha do produto: busca por código ou nome; a lista mostra "código — descrição · molde".

import { useMemo, useState } from 'react';
import { normalizar } from '../lib/formato';
import type { Produto } from '../lib/tipos';
import { Dialogo } from './Basicos';

const LIMITE = 40;

interface Props {
  aberto: boolean;
  produtos: Produto[];
  aoEscolher: (p: Produto) => void;
  aoEscolherOutro: () => void;
  aoFechar: () => void;
}

export function SeletorProduto({ aberto, produtos, aoEscolher, aoEscolherOutro, aoFechar }: Props) {
  const [busca, setBusca] = useState('');

  const encontrados = useMemo(() => {
    const termos = normalizar(busca).split(/\s+/).filter(Boolean);
    return produtos.filter((p) => {
      if (!p.ativo) return false;
      const alvo = `${p.codigo} ${normalizar(p.descricao)}`;
      return termos.every((t) => alvo.includes(t));
    });
  }, [busca, produtos]);

  function fechar() {
    setBusca('');
    aoFechar();
  }

  return (
    <Dialogo aberto={aberto} aoFechar={fechar} titulo="Escolher produto" estreito>
      <label>
        Buscar por código ou nome
        <input
          type="search"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="ex.: 24616 ou SALMON 600"
          autoFocus
          autoComplete="off"
          enterKeyHint="search"
        />
      </label>
      <p className="small muted" aria-live="polite">
        {encontrados.length === 0
          ? 'Nenhum produto com esse código ou nome.'
          : encontrados.length > LIMITE
            ? `${encontrados.length} produtos. Mostrando os ${LIMITE} primeiros: digite mais para afinar.`
            : `${encontrados.length} ${encontrados.length === 1 ? 'produto' : 'produtos'}.`}
      </p>
      <div className="lista-produtos">
        {encontrados.slice(0, LIMITE).map((p) => (
          <button type="button" key={p.codigo} onClick={() => { setBusca(''); aoEscolher(p); }}>
            <span className="n">{p.descricao}</span>
            <span className="small muted mono">{p.codigo} · {p.molde}</span>
          </button>
        ))}
        <button type="button" className="ghost" onClick={() => { setBusca(''); aoEscolherOutro(); }}>
          <span className="n">Outro (fora do catálogo)…</span>
          <span className="small muted">digitar o nome do produto</span>
        </button>
      </div>
    </Dialogo>
  );
}
