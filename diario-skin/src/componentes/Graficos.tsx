// Gráficos do painel, em HTML/SVG próprio.
// Regras seguidas: marcas finas, grade discreta, uma cor por série, legenda
// sempre que há mais de uma série, valor também fora da dica (tabela e detalhe),
// alvo de toque maior que a marca e identidade nunca só pela cor.

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import type { Indicadores } from '../lib/calc';
import { num, pct } from '../lib/formato';
import { BarraDestino, partesDestino } from './Basicos';

// ------------------------------------------------------------------ dica flutuante

interface DicaEstado { x: number; y: number; conteudo: ReactNode }

function useDica() {
  const [dica, setDica] = useState<DicaEstado | null>(null);
  // A dica não acompanha a rolagem: some quando a página rola.
  useEffect(() => {
    if (!dica) return;
    const esconder = () => setDica(null);
    window.addEventListener('scroll', esconder, { capture: true, passive: true });
    return () => window.removeEventListener('scroll', esconder, { capture: true });
  }, [dica]);
  return {
    dica,
    mostrar: (x: number, y: number, conteudo: ReactNode) => setDica({ x, y, conteudo }),
    esconder: () => setDica(null),
  };
}

function Dica({ dica }: { dica: DicaEstado | null }) {
  if (!dica) return null;
  const largura = typeof window !== 'undefined' ? window.innerWidth : 1024;
  const aEsquerda = dica.x > largura - 280;
  return (
    <div
      className="dica"
      role="tooltip"
      style={{
        top: Math.max(8, dica.y + 14),
        ...(aEsquerda ? { right: Math.max(8, largura - dica.x + 12) } : { left: dica.x + 14 }),
      }}
    >
      {dica.conteudo}
    </div>
  );
}

function useLargura<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [largura, setLargura] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const medir = () => setLargura(el.clientWidth);
    medir();
    const obs = new ResizeObserver(medir);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return [ref, largura];
}

// ------------------------------------------------------------------ destino das bandejas por OP

export interface LinhaDestino {
  id: string;
  rotulo: string;
  c: Indicadores;
}

/** Barras empilhadas a 100% (bandejas formadas), uma linha por OP. Tocar abre o detalhe. */
export function DestinoPorOp({ linhas, aoAbrir }: { linhas: LinhaDestino[]; aoAbrir: (id: string) => void }) {
  const { dica, mostrar, esconder } = useDica();
  const conteudo = (l: LinhaDestino) => (
    <>
      <b>{l.rotulo}</b>
      {partesDestino(l.c).map((p) => (
        <div key={p.chave}>
          <i className="lk" style={{ background: `var(--c-${p.chave})` }} />
          <strong>{num(p.valor)}</strong> {p.nome} · {pct(p.valor / l.c.bandejas_formadas!)}
        </div>
      ))}
      <div>{num(l.c.bandejas_formadas)} bandejas formadas</div>
    </>
  );
  return (
    <div className="dest">
      {linhas.map((l) => (
        <button
          type="button"
          key={l.id}
          className="dest-l"
          onClick={() => aoAbrir(l.id)}
          onPointerMove={(ev) => { if (ev.pointerType === 'mouse') mostrar(ev.clientX, ev.clientY, conteudo(l)); }}
          onPointerLeave={esconder}
          onFocus={(ev) => { const r = ev.currentTarget.getBoundingClientRect(); mostrar(r.left + 40, r.bottom - 10, conteudo(l)); }}
          onBlur={esconder}
        >
          <span className="rot">{l.rotulo}</span>
          <BarraDestino c={l.c} />
        </button>
      ))}
      <div className="dest-eixo" aria-hidden="true">
        <span />
        <div><span>0%</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span></div>
      </div>
      <Dica dica={dica} />
    </div>
  );
}

// ------------------------------------------------------------------ barras horizontais

/** Uma série, uma cor: motivos de retrabalho (Pareto) e minutos de parada. Valor na ponta da barra. */
export function BarrasH({ itens, cor, unidade, rotulo }: { itens: [string, number][]; cor: string; unidade: string; rotulo: string }) {
  const maior = Math.max(...itens.map((i) => i[1]), 1);
  return (
    <div className="barras" role="list" aria-label={rotulo}>
      {itens.map(([nome, valor]) => (
        <div key={nome} role="listitem" style={{ display: 'contents' }}>
          <span className="rot">{nome}</span>
          <span className="b">
            <i style={{ width: `calc((100% - 76px) * ${valor / maior})`, background: cor }} />
            <span>{num(valor)}{unidade}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ dispersão

export type Forma = 'circulo' | 'quadrado' | 'triangulo' | 'losango';
export interface Marcador { cor: string; forma: Forma }

const CORES = ['var(--s1)', 'var(--s2)', 'var(--s3)'];
const FORMAS: Forma[] = ['circulo', 'quadrado', 'triangulo', 'losango'];
export const MARCADOR_OUTROS: Marcador = { cor: 'var(--s-outros)', forma: 'circulo' };

/**
 * Marcador de cada produto: três matizes × quatro formas (12 combinações), na
 * ordem em que os produtos apareceram no diário. A ordem não muda com os
 * filtros, então um produto não troca de cor. Do 13º em diante: "outros".
 */
export function marcadoresPorProduto(produtosEmOrdem: string[]): Map<string, Marcador> {
  const mapa = new Map<string, Marcador>();
  produtosEmOrdem.forEach((p, i) => {
    if (i < CORES.length * FORMAS.length) mapa.set(p, { cor: CORES[i % CORES.length], forma: FORMAS[Math.floor(i / CORES.length)] });
  });
  return mapa;
}

export function Simbolo({ m, anel = true }: { m: Marcador; anel?: boolean }) {
  // O contorno na cor da superfície separa pontos sobrepostos (não é borda de dado).
  const comum = { fill: m.cor, stroke: anel ? 'var(--surface)' : 'none', strokeWidth: 2, className: 'anel' };
  switch (m.forma) {
    case 'quadrado': return <rect x={-5} y={-5} width={10} height={10} rx={1.5} {...comum} />;
    case 'triangulo': return <path d="M0,-6.5 L6.2,4.6 L-6.2,4.6 Z" strokeLinejoin="round" {...comum} />;
    case 'losango': return <path d="M0,-7 L7,0 L0,7 L-7,0 Z" strokeLinejoin="round" {...comum} />;
    default: return <circle r={5.5} {...comum} />;
  }
}

export function LegendaProdutos({ itens }: { itens: { nome: string; marcador: Marcador }[] }) {
  if (itens.length < 2) return null;
  return (
    <div className="legend">
      {itens.map((i) => (
        <span key={i.nome}>
          <svg width="16" height="16" viewBox="-8 -8 16 16" aria-hidden="true"><Simbolo m={i.marcador} anel={false} /></svg>
          {i.nome}
        </span>
      ))}
    </div>
  );
}

/** Escala com marcas em números redondos. */
function escala(min: number, max: number, alvo = 4): { min: number; max: number; marcas: number[] } {
  if (min === max) { min -= 1; max += 1; }
  const bruto = (max - min) / alvo;
  const pot = 10 ** Math.floor(Math.log10(bruto));
  const passo = [1, 2, 2.5, 5, 10].map((m) => m * pot).find((p) => p >= bruto) ?? 10 * pot;
  const ini = Math.floor(min / passo) * passo;
  const fim = Math.ceil(max / passo) * passo;
  const marcas: number[] = [];
  for (let v = ini; v <= fim + passo / 1e6; v += passo) marcas.push(Number(v.toPrecision(12)));
  return { min: ini, max: fim, marcas };
}

const casasDoPasso = (marcas: number[]): number => {
  const passo = Math.abs((marcas[1] ?? 1) - (marcas[0] ?? 0));
  return passo >= 1 ? 0 : passo >= 0.1 ? 1 : 2;
};

export interface Ponto {
  id: string;
  x: number;
  y: number;
  produto: string;
  rotulo: string;
}

interface DispersaoProps {
  pontos: Ponto[];
  nomeX: string;
  nomeY: string;
  /** Y é fração (0,85) mostrada como percentual. */
  yPercentual: boolean;
  casasY: number;
  casasX: number;
  marcadores: Map<string, Marcador>;
  aoAbrir: (id: string) => void;
}

/** Um ponto por OP: parâmetro (X) × resultado (Y). Cor e forma identificam o produto. */
export function Dispersao({ pontos, nomeX, nomeY, yPercentual, casasY, casasX, marcadores, aoAbrir }: DispersaoProps) {
  const [ref, largura] = useLargura<HTMLDivElement>();
  const { dica, mostrar, esconder } = useDica();
  const W = Math.max(largura, 280);
  const H = W < 480 ? 250 : 300;
  const M = { e: 52, d: 16, t: 26, b: 44 };

  const ex = escala(Math.min(...pontos.map((p) => p.x)), Math.max(...pontos.map((p) => p.x)));
  const ey = escala(Math.min(...pontos.map((p) => p.y)), Math.max(...pontos.map((p) => p.y)));
  const sx = (v: number) => M.e + ((v - ex.min) / (ex.max - ex.min)) * (W - M.e - M.d);
  const sy = (v: number) => M.t + (1 - (v - ey.min) / (ey.max - ey.min)) * (H - M.t - M.b);
  const fy = (v: number, casas = yPercentual ? Math.max(0, casasDoPasso(ey.marcas.map((m) => m * 100))) : casasDoPasso(ey.marcas)) =>
    yPercentual ? pct(v, casas) : num(v, casas);
  const fx = (v: number) => num(v, Math.max(casasDoPasso(ex.marcas), 0));

  const conteudo = (p: Ponto) => (
    <>
      <b>{yPercentual ? pct(p.y, 1) : num(p.y, casasY)}</b>
      <div>{nomeY}</div>
      <div><strong>{num(p.x, casasX)}</strong> · {nomeX}</div>
      <div>{p.rotulo}</div>
    </>
  );

  return (
    <div className="dispersao" ref={ref}>
      <svg viewBox={`0 0 ${W} ${H}`} height={H} role="group" aria-label={`Dispersão: ${nomeX} por ${nomeY}. ${pontos.length} OPs.`}>
        {ey.marcas.map((v) => (
          <g key={`y${v}`}>
            <line className="grade" x1={M.e} x2={W - M.d} y1={sy(v)} y2={sy(v)} />
            <text x={M.e - 8} y={sy(v) + 4} textAnchor="end">{fy(v)}</text>
          </g>
        ))}
        {ex.marcas.map((v) => (
          <text key={`x${v}`} x={sx(v)} y={H - M.b + 18} textAnchor="middle">{fx(v)}</text>
        ))}
        <text x={0} y={11}>{nomeY}</text>
        <text x={(M.e + W - M.d) / 2} y={H - 6} textAnchor="middle">{nomeX}</text>
        {pontos.map((p) => {
          const m = marcadores.get(p.produto) ?? MARCADOR_OUTROS;
          return (
            <g
              key={p.id}
              className="ponto"
              transform={`translate(${sx(p.x)},${sy(p.y)})`}
              tabIndex={0}
              role="button"
              aria-label={`${p.rotulo}: ${nomeX} ${num(p.x, casasX)}, ${nomeY} ${yPercentual ? pct(p.y, 1) : num(p.y, casasY)}. Abrir detalhe.`}
              onClick={() => aoAbrir(p.id)}
              onKeyDown={(ev: KeyboardEvent) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); aoAbrir(p.id); } }}
              onPointerMove={(ev: PointerEvent) => { if (ev.pointerType === 'mouse') mostrar(ev.clientX, ev.clientY, conteudo(p)); }}
              onPointerLeave={esconder}
              onFocus={(ev) => { const r = ev.currentTarget.getBoundingClientRect(); mostrar(r.right, r.top, conteudo(p)); }}
              onBlur={esconder}
            >
              {/* Alvo de toque de 48 px em volta da marca. */}
              <circle r={24} fill="transparent" />
              <Simbolo m={m} />
            </g>
          );
        })}
      </svg>
      <Dica dica={dica} />
    </div>
  );
}
