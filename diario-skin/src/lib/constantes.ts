import type { ChaveParametro, Molde, MotivoRetrabalho, Parametros, Retrabalho } from './tipos';

export const MAQUINA = 'termoformadora ULMA 308332';

export interface MetaParametro {
  chave: ChaveParametro;
  /** Sigla usada nas etiquetas e na leitura das fotos (tDome, T1, pVent…). */
  sigla: string;
  /** Nome curto, para a grade do celular. */
  nome: string;
  /** Nome completo, como na especificação. */
  nomeCompleto: string;
  unidade: '°C' | 's' | 'mbar';
  tela: 412 | 414 | 417;
  passo: number;
  casas: number;
  min: number;
  max: number;
}

// Limites de digitação: temperaturas 0–250 °C; tempos 0–20 s; pressões 5–1000 mbar.
const T = { unidade: '°C', passo: 1, casas: 0, min: 0, max: 250 } as const;
const S = { unidade: 's', passo: 0.1, casas: 1, min: 0, max: 20 } as const;
const P = { unidade: 'mbar', passo: 1, casas: 0, min: 5, max: 1000 } as const;

export const PARAMETROS: MetaParametro[] = [
  { chave: 't_dome', sigla: 'tDome', nome: 'Temp. cúpula', nomeCompleto: 'Temperatura da placa da cúpula', tela: 417, ...T },
  { chave: 't_pre', sigla: 'tPre', nome: 'Temp. predome', nomeCompleto: 'Temperatura do predome', tela: 417, ...T },
  { chave: 't1', sigla: 'T1', nome: 'T1 atraso vácuo sup.', nomeCompleto: 'T1 atraso do vácuo superior', tela: 414, ...S },
  { chave: 't2', sigla: 'T2', nome: 'T2 atraso vácuo int.', nomeCompleto: 'T2 atraso do vácuo interior (aquecimento do filme)', tela: 414, ...S },
  { chave: 't4', sigla: 'T4', nome: 'T4 peq. ventilação', nomeCompleto: 'T4 pequena ventilação', tela: 414, ...S },
  { chave: 't5', sigla: 'T5', nome: 'T5 pressão superior', nomeCompleto: 'T5 pressão superior de ventilação', tela: 414, ...S },
  { chave: 't6', sigla: 'T6', nome: 'T6 vent. sup. grande', nomeCompleto: 'T6 ventilação superior grande', tela: 414, ...S },
  { chave: 't7', sigla: 'T7', nome: 'T7 vent. geral', nomeCompleto: 'T7 ventilação geral', tela: 414, ...S },
  { chave: 'p_vent', sigla: 'pVent', nome: 'Consigna vent. sup.', nomeCompleto: 'Consigna de pressão da ventilação superior', tela: 414, ...P },
  { chave: 'sp', sigla: 'sp', nome: 'Consigna vácuo', nomeCompleto: 'Consigna de vácuo da embalagem', tela: 412, ...P },
  { chave: 'tx', sigla: 'Tx', nome: 'Tempo complementar', nomeCompleto: 'Tempo complementar de vácuo', tela: 412, ...S },
  { chave: 'tmax', sigla: 'Tmax', nome: 'Tempo máx. vácuo', nomeCompleto: 'Tempo máximo de vácuo', tela: 412, ...S },
];

export const CHAVES_PARAMETROS = PARAMETROS.map((p) => p.chave);
export const META_PARAMETRO = Object.fromEntries(PARAMETROS.map((p) => [p.chave, p])) as Record<ChaveParametro, MetaParametro>;

export const PARAMETROS_VAZIOS: Parametros = {
  t_dome: null, t_pre: null, t1: null, t2: null, t4: null, t5: null,
  t6: null, t7: null, p_vent: null, sp: null, tx: null, tmax: null,
};

/** Receita padrão de fábrica (seção 6.2). A vigente vem do banco; esta é a reserva. */
export const RECEITA_FABRICA: Parametros = {
  t_dome: 225, t_pre: 110, t1: 0.8, t2: 1.0, t4: 0, t5: 0,
  t6: 4.0, t7: 0.2, p_vent: 500, sp: 40, tx: 0.5, tmax: 10,
};
export const CICLO_TEORICO_FABRICA_S = 10.3;

export function dentroDoLimite(chave: ChaveParametro, valor: number): boolean {
  const m = META_PARAMETRO[chave];
  return Number.isFinite(valor) && valor >= m.min && valor <= m.max;
}

export const MOTIVOS_RETRABALHO: { chave: MotivoRetrabalho; nome: string }[] = [
  { chave: 'sem_vacuo', nome: 'Sem vácuo' },
  { chave: 'furo', nome: 'Filme furado' },
  { chave: 'ruga', nome: 'Rugas ou ar preso' },
  { chave: 'selagem', nome: 'Selagem fraca na borda' },
  { chave: 'peso', nome: 'Peso fora' },
  { chave: 'posicao', nome: 'Produto mal posicionado' },
  { chave: 'outro', nome: 'Outro' },
];

export const RETRABALHO_ZERADO: Retrabalho = {
  sem_vacuo: 0, furo: 0, ruga: 0, selagem: 0, peso: 0, posicao: 0, outro: 0,
};

export const MOTIVOS_PARADA = [
  'Falta de produto na alimentação',
  'Troca de bobina de filme',
  'Ajuste de parâmetro',
  'Limpeza ou higienização',
  'Falha mecânica ou alarme',
  'Troca de produto ou molde',
  'Intervalo ou refeição',
  'Outro',
];

export const FILMES_FUNDO = ['Evert Skin 400 µ', 'Outro'];
export const FILMES_TAMPA = ['Solupack Skin 100 µ', 'Solupack Skin (0,124 kg/m²)', 'Outro'];

export function filmeTampaSugerido(molde: Molde): string {
  return molde === '2x1' ? 'Solupack Skin (0,124 kg/m²)' : 'Solupack Skin 100 µ';
}

/** Faixas de cor do aproveitamento. */
export const APROVEITAMENTO_BOM = 0.85;
export const APROVEITAMENTO_MEDIO = 0.7;

/** Fotos: lado maior e qualidade JPEG antes do envio. */
export const FOTO_LADO_MAX = 1800;
export const FOTO_QUALIDADE = 0.82;
export const BUCKET_FOTOS = 'fotos-op';
