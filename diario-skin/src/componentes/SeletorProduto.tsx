// Escolha do produto: busca por SKU, nome, derivação ou espécie; a lista mostra
// a descrição, o SKU com o molde e a derivação (caixa).

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
      const alvo = normalizar(`${p.codigo} ${p.descricao} ${p.derivacao ?? ''} ${p.especie ?? ''}`);
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
        Buscar por SKU, nome ou derivação
        <input
          type="search"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="ex.: 24616, SALMON 600 ou CXA 7,5"
          autoFocus
          autoComplete="off"
          enterKeyHint="search"
        />
      </label>
      <p className="small muted" aria-live="polite">
        {encontrados.length === 0
          ? 'Nenhum produto com esse SKU, nome ou derivação.'
          : encontrados.length > LIMITE
            ? `${encontrados.length} produtos. Mostrando os ${LIMITE} primeiros: digite mais para afinar.`
            : `${encontrados.length} ${encontrados.length === 1 ? 'produto' : 'produtos'}.`}
      </p>
      <div className="lista-produtos">
        {encontrados.slice(0, LIMITE).map((p) => (
          <button type="button" key={p.codigo} onClick={() => { setBusca(''); aoEscolher(p); }}>
            <span className="n">{p.descricao}</span>
            <span className="small muted mono">{p.codigo} · {p.molde ? `${p.molde}${p.molde_a_confirmar ? ' (a confirmar)' : ''}` : 'molde a escolher'}</span>
            <span className="small muted">
              {p.derivacao ?? 'sem derivação'}
              {p.peso_nominal_kg ? '' : ' · peso variável (PDV)'}
              {p.embalagens_por_caixa ? ` · ${p.embalagens_por_caixa} por caixa` : ''}
            </span>
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
