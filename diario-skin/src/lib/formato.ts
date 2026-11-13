// Números em formato brasileiro na tela; ponto decimal só no banco.

const TRACO = '—';

export function num(v: number | null | undefined, casas = 0): string {
  if (v == null || !Number.isFinite(v)) return TRACO;
  return v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

/** Fração (0,825) como percentual ("82,5%"). */
export function pct(v: number | null | undefined, casas = 1): string {
  if (v == null || !Number.isFinite(v)) return TRACO;
  return num(v * 100, casas) + '%';
}

export function kg(v: number | null | undefined, casas = 2): string {
  return v == null || !Number.isFinite(v) ? TRACO : num(v, casas) + ' kg';
}

/** Quilos como gramas inteiros ("626 g"). */
export function gramas(vKg: number | null | undefined): string {
  return vKg == null || !Number.isFinite(vKg) ? TRACO : num(vKg * 1000, 0) + ' g';
}

/** Número para campo de edição: vírgula decimal, sem separador de milhar. */
export function numCampo(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '';
  return String(v).replace('.', ',');
}

/** Lê "1.234,5", "1234,5" ou "1234.5". Devolve null se não for número. */
export function lerNumero(texto: string | null | undefined): number | null {
  if (texto == null) return null;
  let t = String(texto).trim().replace(/\s/g, '');
  if (!t) return null;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  if (!/^-?\d*\.?\d+$/.test(t) && !/^-?\d+\.$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function dataBR(iso: string | null | undefined): string {
  if (!iso) return 'sem data';
  const [a, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}

export function dataCurta(iso: string | null | undefined): string {
  if (!iso) return 's/ data';
  const [, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}`;
}

const dois = (n: number) => String(n).padStart(2, '0');

/** Data de hoje no fuso do aparelho (não em UTC). */
export function hojeISO(agora = new Date()): string {
  return `${agora.getFullYear()}-${dois(agora.getMonth() + 1)}-${dois(agora.getDate())}`;
}

export function agoraHHMM(agora = new Date()): string {
  return `${dois(agora.getHours())}:${dois(agora.getMinutes())}`;
}

export function horaCurta(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${dois(d.getHours())}:${dois(d.getMinutes())}`;
}

export function dataHoraBR(iso: string | null | undefined): string {
  if (!iso) return TRACO;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return TRACO;
  return `${dois(d.getDate())}/${dois(d.getMonth() + 1)}/${d.getFullYear()} ${dois(d.getHours())}:${dois(d.getMinutes())}`;
}

/** Sem acentos e em maiúsculas, para busca. */
export function normalizar(t: string): string {
  return t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
}

export function uuid(): string {
  const c: Crypto = globalThis.crypto;
  if (typeof c.randomUUID === 'function') return c.randomUUID();
  // Reserva para contexto sem crypto.randomUUID (http fora de localhost).
  const b = new Uint8Array(16);
  c.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
