// Peças pequenas usadas em todas as telas.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Indicadores } from '../lib/calc';
import { APROVEITAMENTO_BOM, APROVEITAMENTO_MEDIO } from '../lib/constantes';
import { lerNumero, num, numCampo, pct } from '../lib/formato';

// ------------------------------------------------------------------ diálogo

interface DialogoProps {
  aberto: boolean;
  aoFechar: () => void;
  titulo: string;
  sobretitulo?: string;
  estreito?: boolean;
  classe?: string;
  children: ReactNode;
}

/** Janela modal nativa (<dialog>): fecha com Esc, com o botão ou tocando fora. */
export function Dialogo({ aberto, aoFechar, titulo, sobretitulo, estreito, classe, children }: DialogoProps) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (aberto && !d.open) d.showModal();
    if (!aberto && d.open) d.close();
  }, [aberto]);
  if (!aberto) return null;
  return (
    <dialog
      ref={ref}
      className={[estreito ? 'estreito' : '', classe ?? ''].join(' ').trim() || undefined}
      onClose={aoFechar}
      onClick={(e) => { if (e.target === ref.current) aoFechar(); }}
      aria-label={titulo}
    >
      <div className="dlg">
        <div className="dlg-cab">
          <div>
            {sobretitulo && <div className="eyebrow">{sobretitulo}</div>}
            <h2>{titulo}</h2>
          </div>
          <button type="button" onClick={aoFechar}>Fechar</button>
        </div>
        {children}
      </div>
    </dialog>
  );
}

// ------------------------------------------------------------------ campo numérico

interface CampoNumeroProps {
  id?: string;
  valor: number | null;
  aoMudar: (v: number | null) => void;
  /** Só inteiros (teclado numérico sem vírgula). */
  inteiro?: boolean;
  min?: number;
  max?: number;
  placeholder?: string;
  desabilitado?: boolean;
  rotuloAcessivel?: string;
}

/**
 * Campo de número com vírgula decimal. Aceita vírgula ou ponto ao digitar.
 * Valor fora do limite fica marcado e não é gravado (volta ao último válido ao sair do campo).
 */
export function CampoNumero({ id, valor, aoMudar, inteiro, min, max, placeholder, desabilitado, rotuloAcessivel }: CampoNumeroProps) {
  const [texto, setTexto] = useState(numCampo(valor));
  const [erro, setErro] = useState<string | null>(null);
  /** Último valor que este campo informou; se o valor recebido for outro, a mudança veio de fora. */
  const informado = useRef<number | null>(valor);

  // Valor mudou por fora (outra OP, botão ±, leitura da foto, sincronização): atualiza o texto,
  // mesmo com o campo em foco (no iPhone, tocar num botão não tira o foco do campo).
  useEffect(() => {
    if (valor !== informado.current) {
      informado.current = valor;
      setTexto(numCampo(valor));
      setErro(null);
    }
  }, [valor]);

  function informar(v: number | null) {
    informado.current = v;
    aoMudar(v);
  }

  function digitar(t: string) {
    setTexto(t);
    if (t.trim() === '') { setErro(null); informar(null); return; }
    const n = lerNumero(t);
    if (n == null) {
      // "-" ou "0," no meio da digitação ainda não é erro.
      setErro(/^-?\d*[.,]?$/.test(t.trim()) ? null : 'Só números');
      return;
    }
    if (inteiro && !Number.isInteger(n)) { setErro('Só número inteiro'); return; }
    if (min != null && n < min) { setErro(`Mínimo ${num(min, 0)}`); return; }
    if (max != null && n > max) { setErro(`Máximo ${num(max, 0)}`); return; }
    setErro(null);
    informar(n);
  }

  return (
    <span className={erro ? 'campo campo-erro' : 'campo'}>
      <input
        id={id}
        type="text"
        inputMode={inteiro ? 'numeric' : 'decimal'}
        autoComplete="off"
        value={texto}
        placeholder={placeholder}
        disabled={desabilitado}
        aria-label={rotuloAcessivel}
        aria-invalid={erro ? true : undefined}
        onFocus={(e) => e.currentTarget.select()}
        // Ao sair do campo: normaliza o texto e desfaz o que não era válido.
        onBlur={() => { setTexto(numCampo(valor)); setErro(null); }}
        onChange={(e) => digitar(e.target.value)}
      />
      {erro && <span className="dica-erro" role="alert">{erro}</span>}
    </span>
  );
}

// ------------------------------------------------------------------ indicador

interface KpiProps {
  rotulo: string;
  valor: ReactNode;
  sub?: ReactNode;
}

export function Kpi({ rotulo, valor, sub }: KpiProps) {
  return (
    <div className="kpi">
      <div className="l">{rotulo}</div>
      <div className="v">{valor}</div>
      {sub ? <div className="s">{sub}</div> : null}
    </div>
  );
}

/** Faixa do aproveitamento: verde ≥ 85%, amarelo ≥ 70%, vermelho abaixo. Sempre com texto, nunca só a cor. */
export function Farol({ aproveitamento }: { aproveitamento: number | null }) {
  if (aproveitamento == null) return <>boas ÷ formadas</>;
  // Classifica pelo valor como aparece na tela (uma casa): 69,97% é mostrado e tratado como 70,0%.
  const v = Math.round(aproveitamento * 1000) / 1000;
  const [classe, texto] =
    v >= APROVEITAMENTO_BOM ? ['bom', 'bom (≥ 85%)']
    : v >= APROVEITAMENTO_MEDIO ? ['medio', 'atenção (70 a 85%)']
    : ['baixo', 'baixo (< 70%)'];
  return <span className={`farol ${classe}`}><i aria-hidden="true" />{texto}</span>;
}

// ------------------------------------------------------------------ destino das bandejas

export function partesDestino(c: Pick<Indicadores, 'embalagens_boas' | 'retrabalho' | 'vazias' | 'perda_nao_classificada'>) {
  return [
    { chave: 'boa', nome: 'boas', valor: c.embalagens_boas ?? 0 },
    { chave: 'retr', nome: 'retrabalho', valor: c.retrabalho ?? 0 },
    { chave: 'vazia', nome: 'vazias', valor: c.vazias ?? 0 },
    { chave: 'nc', nome: 'perda não classificada', valor: c.perda_nao_classificada ?? 0 },
  ].filter((p) => p.valor > 0);
}

export function resumoDestino(c: Indicadores): string {
  if (!c.bandejas_formadas || c.embalagens_boas == null) return 'Sem dados para o destino das bandejas';
  return partesDestino(c)
    .map((p) => `${p.nome}: ${num(p.valor)} (${pct(p.valor / c.bandejas_formadas!)})`)
    .join('; ');
}

/** Barra empilhada a 100% das bandejas formadas: boas, retrabalho, vazias, perda não classificada. */
export function BarraDestino({ c }: { c: Indicadores }) {
  const total = c.bandejas_formadas;
  // <span> (e não <div>) porque a barra também aparece dentro de botões.
  if (!total || c.embalagens_boas == null) return <span className="stack" aria-hidden="true" />;
  const partes = partesDestino(c);
  // Boas acima das formadas (dado a conferir): a barra continua somando 100%.
  const soma = Math.max(total, partes.reduce((s, p) => s + p.valor, 0));
  return (
    <span className="stack" role="img" aria-label={resumoDestino(c)}>
      {partes.map((p) => (
        <i key={p.chave} className={p.chave} style={{ width: `${(p.valor / soma) * 100}%` }} />
      ))}
    </span>
  );
}

export function LegendaDestino({ comNaoClassificada = true }: { comNaoClassificada?: boolean }) {
  return (
    <div className="legend">
      <span><i style={{ background: 'var(--c-boa)' }} />boas</span>
      <span><i style={{ background: 'var(--c-retr)' }} />retrabalho</span>
      <span><i style={{ background: 'var(--c-vazia)' }} />vazias</span>
      {comNaoClassificada && <span><i style={{ background: 'var(--c-nc)' }} />perda não classificada (histórico)</span>}
    </div>
  );
}
