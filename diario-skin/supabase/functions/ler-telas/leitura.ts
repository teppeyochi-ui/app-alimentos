// Leitura automática das telas da IHM (fase 3, seção 9 da especificação).
// Recebe até 3 fotos e devolve os 12 parâmetros lidos, já com os nomes das
// colunas do banco e sem os valores fora dos limites de digitação.

import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';

export const MODELO = 'claude-opus-5-5';
export const MAX_FOTOS = 3;
/** Tamanho máximo de cada foto em base64 (~4,5 MB de imagem). O aplicativo envia ~0,5 MB. */
export const MAX_BASE64 = 6_000_000;

export const INSTRUCAO = `Você vai ler fotos do painel (IHM) de uma termoformadora ULMA, estação de selagem skin.
Cada foto mostra uma tela, numerada no canto superior direito (412, 414 ou 417).
Os campos editáveis são botões cinza claros com números; "CONSIGNA" = valor ajustado,
"ACTUAL" = valor medido (ignore ACTUAL).

Tela 417 (temperaturas): linha de cima, placa aquecida da cúpula = tDome (°C, consigna);
linha de baixo, predome = tPre (°C, consigna). Os campos pequenos à direita (ex.: 5 °C)
são tolerância: ignore.

Tela 414 (tempos, s): ícone de tubo com setas saindo e ampulheta, à esquerda em cima = T1;
ícone de bandeja com setas e ampulheta, embaixo à esquerda = T2; tubo com seta fina
entrando = T4 (pequena ventilação); tubo com "P" = T5 (pressão superior); tubo com seta
grossa entrando = T6 (ventilação superior grande); tubo com "P=P" = T7 (ventilação geral);
par ACTUAL/CONSIGNA em mbar = pVent (use a CONSIGNA).

Tela 412 (vácuo): CONSIGNA em mbar no topo = sp; à direita, de cima para baixo:
primeiro tempo em s = Tx (tempo complementar), segundo = Tmax (tempo máximo de vácuo).
Ignore campos em cinza esmaecido.

Responda com:
- telas: o número da tela de cada foto, na mesma ordem em que as fotos foram enviadas
  (null se não der para identificar a tela daquela foto);
- valores: os 12 parâmetros, com null quando o valor não aparece em nenhuma foto
  ou não dá para ler com segurança (não chute);
- duvidas: texto curto, em português, com o que ficou em dúvida; vazio se não houver.`;

const valor = z.number().nullable();

const Resposta = z.object({
  telas: z.array(z.number().nullable()),
  valores: z.object({
    tDome: valor, tPre: valor, T1: valor, T2: valor, T4: valor, T5: valor,
    T6: valor, T7: valor, pVent: valor, sp: valor, Tx: valor, Tmax: valor,
  }),
  duvidas: z.string(),
});

type Sigla = keyof z.infer<typeof Resposta>['valores'];

/** Sigla da tela → coluna do banco e limites de digitação (seção 6.2). */
const CAMPOS: Record<Sigla, { coluna: string; min: number; max: number }> = {
  tDome: { coluna: 't_dome', min: 0, max: 250 },
  tPre: { coluna: 't_pre', min: 0, max: 250 },
  T1: { coluna: 't1', min: 0, max: 20 },
  T2: { coluna: 't2', min: 0, max: 20 },
  T4: { coluna: 't4', min: 0, max: 20 },
  T5: { coluna: 't5', min: 0, max: 20 },
  T6: { coluna: 't6', min: 0, max: 20 },
  T7: { coluna: 't7', min: 0, max: 20 },
  pVent: { coluna: 'p_vent', min: 5, max: 1000 },
  sp: { coluna: 'sp', min: 5, max: 1000 },
  Tx: { coluna: 'tx', min: 0, max: 20 },
  Tmax: { coluna: 'tmax', min: 0, max: 20 },
};

const TIPOS_DE_IMAGEM = ['image/jpeg', 'image/png', 'image/webp'] as const;
type TipoDeImagem = (typeof TIPOS_DE_IMAGEM)[number];

export interface FotoEnviada {
  tipo: string;
  base64: string;
}

export interface Leitura {
  /** Tela de cada foto, na ordem do envio (412, 414, 417 ou null). */
  telas: (number | null)[];
  /** Só os valores lidos e dentro dos limites; chaves = colunas do banco. */
  valores: Record<string, number>;
  duvidas: string;
}

/** Erro com o código HTTP que a função deve devolver. */
export class ErroLeitura extends Error {
  status: number;
  constructor(status: number, mensagem: string) {
    super(mensagem);
    this.name = 'ErroLeitura';
    this.status = status;
  }
}

export function validarFotos(corpo: unknown): FotoEnviada[] {
  const fotos = (corpo as { fotos?: unknown } | null)?.fotos;
  if (!Array.isArray(fotos) || fotos.length === 0) throw new ErroLeitura(400, 'Envie de 1 a 3 fotos.');
  if (fotos.length > MAX_FOTOS) throw new ErroLeitura(400, `Envie no máximo ${MAX_FOTOS} fotos.`);
  return fotos.map((f) => {
    const { tipo, base64 } = (f ?? {}) as Partial<FotoEnviada>;
    if (typeof base64 !== 'string' || !base64 || typeof tipo !== 'string') throw new ErroLeitura(400, 'Foto sem conteúdo.');
    if (!(TIPOS_DE_IMAGEM as readonly string[]).includes(tipo)) throw new ErroLeitura(400, 'Formato de foto não aceito.');
    if (base64.length > MAX_BASE64) throw new ErroLeitura(413, 'Foto grande demais.');
    return { tipo, base64 };
  });
}

/** Tira o que não pode ser gravado: valores fora dos limites e telas que não existem. */
export function filtrar(bruto: z.infer<typeof Resposta>, quantasFotos: number): Leitura {
  const valores: Record<string, number> = {};
  for (const sigla of Object.keys(CAMPOS) as Sigla[]) {
    const v = bruto.valores[sigla];
    const { coluna, min, max } = CAMPOS[sigla];
    if (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max) valores[coluna] = v;
  }
  const telas = Array.from({ length: quantasFotos }, (_, i) => {
    const t = bruto.telas[i];
    return t === 412 || t === 414 || t === 417 ? t : null;
  });
  return { telas, valores, duvidas: bruto.duvidas.trim().slice(0, 300) };
}

export async function lerTelas(cliente: Anthropic, fotos: FotoEnviada[]): Promise<Leitura> {
  const conteudo: Anthropic.Beta.BetaContentBlockParam[] = [];
  fotos.forEach((f, i) => {
    conteudo.push({ type: 'text', text: `Foto ${i + 1}:` });
    conteudo.push({ type: 'image', source: { type: 'base64', media_type: f.tipo as TipoDeImagem, data: f.base64 } });
  });
  conteudo.push({ type: 'text', text: INSTRUCAO });

  const resposta = await cliente.beta.messages.parse({
    model: MODELO,
    max_tokens: 16000,
    // Se o modelo recusar por política, o servidor da Anthropic tenta de novo no modelo reserva.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: betaZodOutputFormat(Resposta) },
    messages: [{ role: 'user', content: conteudo }],
  });

  if (resposta.stop_reason === 'refusal') throw new ErroLeitura(422, 'O modelo não leu estas fotos.');
  if (resposta.stop_reason === 'max_tokens' || !resposta.parsed_output) {
    throw new ErroLeitura(502, 'Resposta incompleta do modelo.');
  }
  return filtrar(resposta.parsed_output, fotos.length);
}
