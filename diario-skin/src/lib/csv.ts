// Leitura e escrita de CSV (separador ';', como o Excel em português usa).

/** Lê CSV com campos opcionais entre aspas. Devolve as linhas não vazias. */
export function lerCsv(texto: string, sep = ';'): string[][] {
  const linhas: string[][] = [];
  let campo = '';
  let linha: string[] = [];
  let aspas = false;
  const t = texto.replace(/^\uFEFF/, '');
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (aspas) {
      if (c === '"') {
        if (t[i + 1] === '"') { campo += '"'; i++; } else aspas = false;
      } else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === sep) { linha.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      linha.push(campo); campo = '';
      if (linha.some((x) => x.trim() !== '')) linhas.push(linha);
      linha = [];
    } else campo += c;
  }
  linha.push(campo);
  if (linha.some((x) => x.trim() !== '')) linhas.push(linha);
  return linhas;
}

/** CSV como lista de objetos, usando a primeira linha como cabeçalho. */
export function lerCsvObjetos(texto: string, sep = ';'): Record<string, string>[] {
  const [cab, ...resto] = lerCsv(texto, sep);
  if (!cab) return [];
  const nomes = cab.map((c) => c.trim().toLowerCase());
  return resto.map((l) => Object.fromEntries(nomes.map((n, i) => [n, (l[i] ?? '').trim()])));
}

export type Celula = string | number | null | undefined;

function celulaCsv(v: Celula, sep: string): string {
  if (v == null) return '';
  // Números com vírgula decimal, para abrir direto no Excel em português.
  const s = typeof v === 'number' ? (Number.isFinite(v) ? String(v).replace('.', ',') : '') : v;
  return s.includes(sep) || s.includes('"') || s.includes('\n') || s.includes('\r')
    ? '"' + s.replace(/"/g, '""') + '"'
    : s;
}

/** Gera CSV com BOM (acentos certos no Excel), ';' e vírgula decimal. */
export function gerarCsv(cabecalho: string[], linhas: Celula[][], sep = ';'): string {
  const out = [cabecalho, ...linhas].map((l) => l.map((c) => celulaCsv(c, sep)).join(sep));
  return '\uFEFF' + out.join('\r\n') + '\r\n';
}
