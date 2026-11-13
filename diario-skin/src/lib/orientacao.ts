// Orientação ao operador: compara a configuração da OP com a receita padrão e
// com as melhores OPs já registradas, aponta onde está a maior perda e o que
// conferir para cada defeito de retrabalho. Funções puras: funcionam sem
// internet, só com o que está no aparelho.
//
// As regras de REGRAS_DEFEITO são orientações gerais do processo skin, escritas
// para este aplicativo. Ainda não foram validadas pelo P&D nem pela ULMA: o P&D
// deve revisar este arquivo.

import { calcular, cicloTeorico, parametrosDaReceita, receitaVigente, temParametros, type Indicadores } from './calc';
import { CHAVES_PARAMETROS, META_PARAMETRO, MOTIVOS_RETRABALHO } from './constantes';
import { normalizar } from './formato';
import type { ChaveParametro, MoldeInfo, MotivoRetrabalho, Op, Parametros, Produto, ReceitaPadrao } from './tipos';

export interface OpCalculada { o: Op; c: Indicadores }

/** Quão parecida com a OP é a base de comparação. */
export type NivelReferencia = 'produto' | 'especie' | 'molde';

export interface Referencia {
  nivel: NivelReferencia;
  /** OPs comparáveis: encerradas, com parâmetros e aproveitamento. */
  base: OpCalculada[];
  /** As de maior aproveitamento (terço de cima, de 1 a 5 OPs). */
  melhores: OpCalculada[];
}

/** OP pequena demais não serve de referência (um teste de 10 bandejas com 100% não prova nada). */
export const MIN_BANDEJAS_REFERENCIA = 100;
/** Com menos OPs que isto no nível mais parecido, tenta o nível seguinte. */
const MIN_OPS_NIVEL = 2;

const especieDe = (o: Op, produtos: Produto[]): string | null =>
  (o.produto_codigo ? produtos.find((p) => p.codigo === o.produto_codigo)?.especie : null) ?? null;

const mesmoProduto = (a: Op, b: Op): boolean =>
  a.produto_codigo && b.produto_codigo
    ? a.produto_codigo === b.produto_codigo
    : a.produto_descricao.trim() !== '' && normalizar(a.produto_descricao.trim()) === normalizar(b.produto_descricao.trim());

/** Serve de referência: encerrada, com parâmetros, com resultado plausível e de tamanho razoável. */
export function serveDeReferencia(l: OpCalculada): boolean {
  return (
    l.o.status === 'fechada' &&
    temParametros(l.o) &&
    l.c.aproveitamento != null &&
    l.c.aproveitamento <= 1.02 &&
    (l.c.bandejas_formadas ?? 0) >= MIN_BANDEJAS_REFERENCIA
  );
}

/**
 * Base de comparação da OP: primeiro as OPs do mesmo produto; se forem poucas,
 * as da mesma espécie no mesmo molde; por fim, as do mesmo molde.
 */
export function referenciaDa(alvo: Op, ops: Op[], moldes: MoldeInfo[], produtos: Produto[]): Referencia | null {
  const candidatas = ops
    .filter((o) => o.id !== alvo.id)
    .map((o) => ({ o, c: calcular(o, moldes) }))
    .filter(serveDeReferencia);
  const especie = especieDe(alvo, produtos);
  const niveis: [NivelReferencia, OpCalculada[]][] = [
    ['produto', candidatas.filter((l) => mesmoProduto(l.o, alvo))],
    ['especie', especie ? candidatas.filter((l) => l.o.molde === alvo.molde && especieDe(l.o, produtos) === especie) : []],
    ['molde', candidatas.filter((l) => l.o.molde === alvo.molde)],
  ];
  const escolhido = niveis.find(([, l]) => l.length >= MIN_OPS_NIVEL) ?? niveis.find(([, l]) => l.length > 0);
  if (!escolhido) return null;
  const [nivel, base] = escolhido;
  const ordenadas = [...base].sort(
    (a, b) =>
      (b.c.aproveitamento ?? 0) - (a.c.aproveitamento ?? 0) ||
      (a.c.retrabalho_pct ?? 1) - (b.c.retrabalho_pct ?? 1) ||
      (b.o.data ?? '').localeCompare(a.o.data ?? ''),
  );
  const quantas = Math.min(5, Math.max(1, Math.ceil(base.length / 3)));
  return { nivel, base, melhores: ordenadas.slice(0, quantas) };
}

export type SituacaoParametro =
  | 'sem_valor'            // a OP não tem este parâmetro
  | 'na_referencia'        // dentro da faixa das melhores OPs
  | 'fora_da_referencia'   // fora da faixa das melhores OPs
  | 'no_padrao'            // sem referência: igual à receita padrão
  | 'fora_do_padrao';      // sem referência: diferente da receita padrão

export interface LinhaConfiguracao {
  chave: ChaveParametro;
  atual: number | null;
  padrao: number | null;
  /** Menor e maior valor usados nas melhores OPs; null = sem referência para este parâmetro. */
  faixa: { min: number; max: number } | null;
  situacao: SituacaoParametro;
  /** Valor mais próximo dentro da faixa das melhores, quando o atual está fora. */
  alvo: number | null;
}

/** Cada parâmetro da OP contra a receita padrão e contra a faixa das melhores OPs. */
export function compararConfiguracao(op: Parametros, padrao: Parametros, ref: Referencia | null): LinhaConfiguracao[] {
  return CHAVES_PARAMETROS.map((chave) => {
    const atual = op[chave];
    const valores = (ref?.melhores ?? []).map((l) => l.o[chave]).filter((v): v is number => v != null);
    const faixa = valores.length ? { min: Math.min(...valores), max: Math.max(...valores) } : null;
    let situacao: SituacaoParametro;
    let alvo: number | null = null;
    if (atual == null) situacao = 'sem_valor';
    else if (faixa) {
      if (atual < faixa.min) { situacao = 'fora_da_referencia'; alvo = faixa.min; }
      else if (atual > faixa.max) { situacao = 'fora_da_referencia'; alvo = faixa.max; }
      else situacao = 'na_referencia';
    } else situacao = padrao[chave] == null || Number(padrao[chave]) === Number(atual) ? 'no_padrao' : 'fora_do_padrao';
    return { chave, atual, padrao: padrao[chave], faixa, situacao, alvo };
  });
}

export interface GrupoPorValor {
  valor: number;
  ops: number;
  bandejas: number;
  /** Ponderado pelas bandejas formadas. */
  aproveitamento: number;
  /** Ponderado pelas bandejas; null = nenhuma OP do grupo registrou retrabalho. */
  retrabalho_pct: number | null;
}

export interface EfeitoParametro {
  chave: ChaveParametro;
  grupos: GrupoPorValor[];
  /** Valor com o maior aproveitamento. */
  melhor: number;
  /** 'fraco' = poucas OPs em algum valor: é só um indício. */
  forca: 'fraco' | 'razoavel';
}

/**
 * O que a base mostra para um parâmetro: resultado médio das OPs em cada valor
 * usado. Só existe quando o parâmetro foi usado em pelo menos dois valores.
 */
export function efeitoDoParametro(base: OpCalculada[], chave: ChaveParametro): EfeitoParametro | null {
  const porValor = new Map<number, OpCalculada[]>();
  for (const l of base) {
    const v = l.o[chave];
    if (v == null || !l.c.bandejas_formadas || l.c.embalagens_boas == null) continue;
    porValor.set(v, [...(porValor.get(v) ?? []), l]);
  }
  if (porValor.size < 2) return null;
  const grupos: GrupoPorValor[] = [...porValor.entries()]
    .map(([valor, linhas]) => {
      const bandejas = linhas.reduce((s, l) => s + (l.c.bandejas_formadas ?? 0), 0);
      const boas = linhas.reduce((s, l) => s + (l.c.embalagens_boas ?? 0), 0);
      const comRetrabalho = linhas.filter((l) => l.c.retrabalho != null);
      const bandejasRetr = comRetrabalho.reduce((s, l) => s + (l.c.bandejas_formadas ?? 0), 0);
      return {
        valor,
        ops: linhas.length,
        bandejas,
        aproveitamento: boas / bandejas,
        retrabalho_pct: bandejasRetr ? comRetrabalho.reduce((s, l) => s + (l.c.retrabalho ?? 0), 0) / bandejasRetr : null,
      };
    })
    .sort((a, b) => a.valor - b.valor);
  const melhor = [...grupos].sort((a, b) => b.aproveitamento - a.aproveitamento)[0].valor;
  const forca = grupos.every((g) => g.ops >= 3) ? 'razoavel' : 'fraco';
  return { chave, grupos, melhor, forca };
}

export function efeitosDosParametros(base: OpCalculada[]): EfeitoParametro[] {
  return CHAVES_PARAMETROS.map((k) => efeitoDoParametro(base, k)).filter((x): x is EfeitoParametro => x != null);
}

// ------------------------------------------------------------------ perdas e ritmo

export interface MaiorPerda {
  tipo: 'vazias' | 'retrabalho' | 'nao_classificada';
  pct: number;
  quantidade: number;
}

/** Para onde foi a maior parte das bandejas que não viraram embalagem boa. */
export function maiorPerda(c: Indicadores): MaiorPerda | null {
  const opcoes: MaiorPerda[] = [];
  if (c.vazias && c.vazias_pct) opcoes.push({ tipo: 'vazias', pct: c.vazias_pct, quantidade: c.vazias });
  if (c.retrabalho && c.retrabalho_pct) opcoes.push({ tipo: 'retrabalho', pct: c.retrabalho_pct, quantidade: c.retrabalho });
  if (c.perda_nao_classificada && c.perda_nao_classificada_pct) {
    opcoes.push({ tipo: 'nao_classificada', pct: c.perda_nao_classificada_pct, quantidade: c.perda_nao_classificada });
  }
  return opcoes.sort((a, b) => b.pct - a.pct)[0] ?? null;
}

/** Ciclos por minuto da OP em relação ao teórico da receita (1 = igual ao teórico). */
export function ritmo(c: Indicadores, receita: ReceitaPadrao | null): number | null {
  if (c.ciclos_por_minuto == null) return null;
  return c.ciclos_por_minuto / (60 / cicloTeorico(receita));
}

export interface MotivoContado {
  chave: MotivoRetrabalho;
  nome: string;
  quantidade: number;
  /** Parte das bandejas formadas; null = ainda sem passo no fim. */
  pct: number | null;
}

/** Motivos de retrabalho da OP, do mais frequente para o menos. */
export function motivosEmOrdem(op: Pick<Op, 'retrabalho'>, c: Indicadores): MotivoContado[] {
  if (!op.retrabalho) return [];
  return MOTIVOS_RETRABALHO
    .map((m) => ({
      chave: m.chave,
      nome: m.nome,
      quantidade: op.retrabalho![m.chave] || 0,
      pct: c.bandejas_formadas ? (op.retrabalho![m.chave] || 0) / c.bandejas_formadas : null,
    }))
    .filter((m) => m.quantidade > 0)
    .sort((a, b) => b.quantidade - a.quantidade);
}

// ------------------------------------------------------------------ regras por defeito

/** 'testar' = o sentido certo depende do caso: mude um passo e veja o resultado. */
export type AcaoRegra = 'aumentar' | 'diminuir' | 'testar' | 'conferir';

export interface AjusteRegra {
  chave: ChaveParametro;
  acao: AcaoRegra;
  /** Tamanho de um passo de ajuste, quando se aplica. */
  passo: string;
  porque: string;
}

export interface RegraDefeito {
  resumo: string;
  /** O que olhar antes de mexer em parâmetro. */
  verificar: string[];
  ajustes: AjusteRegra[];
}

export const REGRAS_DEFEITO: Record<MotivoRetrabalho, RegraDefeito> = {
  sem_vacuo: {
    resumo: 'A embalagem perdeu o vácuo ou o filme não aderiu ao produto.',
    verificar: [
      'Furo no filme ou na bandeja: ponta de espinha, casca ou cristal de gelo.',
      'Borda da bandeja suja de produto, líquido ou gelo: o filme não cola e o ar volta.',
      'Na tela 412, veja se o vácuo medido (ACTUAL) chega na consigna antes do tempo máximo. Se não chega, há vazamento na câmara ou a bomba está fraca: chame a manutenção.',
    ],
    ajustes: [
      { chave: 'sp', acao: 'diminuir', passo: '5 mbar por vez', porque: 'Consigna mais baixa é vácuo mais profundo antes de o filme descer.' },
      { chave: 'tx', acao: 'aumentar', passo: '0,2 s por vez', porque: 'Mais tempo de vácuo depois da consigna tira o ar que sobra em volta do produto.' },
      { chave: 'tmax', acao: 'conferir', passo: '', porque: 'Se o ciclo sempre para no tempo máximo sem chegar na consigna, o problema é vazamento, não parâmetro.' },
    ],
  },
  furo: {
    resumo: 'O filme de tampa furou ou rasgou sobre o produto.',
    verificar: [
      'Pontas no produto: espinha, osso, casca de crustáceo, aresta de produto muito congelado.',
      'Produto mais alto que a borda da bandeja ou encostado na lateral.',
      'Lote do filme: anote. Furo repetido só com um lote aponta para o filme.',
    ],
    ajustes: [
      { chave: 't_dome', acao: 'testar', passo: '5 °C por vez', porque: 'Filme frio demais fica rígido e rasga nas pontas; quente demais afina e fura. Compare com as melhores OPs.' },
      { chave: 't2', acao: 'testar', passo: '0,1 s por vez', porque: 'É o tempo de aquecimento do filme: vale o mesmo raciocínio da temperatura.' },
      { chave: 't4', acao: 'testar', passo: '0,1 s por vez', porque: 'Uma pequena ventilação antes da grande faz o filme descer mais devagar sobre as pontas.' },
    ],
  },
  ruga: {
    resumo: 'O filme ficou com rugas ou com bolhas de ar em volta do produto.',
    verificar: [
      'Produto molhado ou com gelo solto na superfície.',
      'Produto alto ou com degraus: o filme precisa esticar mais.',
      'Bolha sempre no mesmo ponto da bandeja: confira os furos de vácuo do molde naquele ponto.',
    ],
    ajustes: [
      { chave: 't_dome', acao: 'aumentar', passo: '5 °C por vez', porque: 'Filme mais quente molda melhor e copia o produto sem dobrar.' },
      { chave: 't2', acao: 'aumentar', passo: '0,1 s por vez', porque: 'Mais tempo de aquecimento antes de o filme descer.' },
      { chave: 'sp', acao: 'diminuir', passo: '5 mbar por vez', porque: 'Bolha de ar preso pede vácuo mais profundo.' },
      { chave: 'tx', acao: 'aumentar', passo: '0,2 s por vez', porque: 'Mais tempo para o ar sair antes de o filme descer.' },
    ],
  },
  selagem: {
    resumo: 'O filme não colou bem na borda da bandeja.',
    verificar: [
      'Borda da bandeja suja de produto, gordura, líquido ou gelo.',
      'Filme de tampa desalinhado ou bobina no fim.',
      'Produto passando por cima da borda.',
    ],
    ajustes: [
      { chave: 't_dome', acao: 'aumentar', passo: '5 °C por vez', porque: 'Filme mais quente cola melhor na borda.' },
      { chave: 't2', acao: 'aumentar', passo: '0,1 s por vez', porque: 'Mais tempo de aquecimento do filme.' },
      { chave: 't6', acao: 'conferir', passo: '', porque: 'É o tempo em que a ventilação superior pressiona o filme contra a bandeja. Compare com as melhores OPs.' },
      { chave: 'p_vent', acao: 'conferir', passo: '', porque: 'É a pressão dessa ventilação. Compare com as melhores OPs.' },
    ],
  },
  peso: {
    resumo: 'Peso fora não se corrige na termoformadora.',
    verificar: [
      'Porcionamento e balança antes da máquina.',
      'O sobrepeso médio da OP aparece em “Peso médio”, no resultado do lançamento.',
    ],
    ajustes: [],
  },
  posicao: {
    resumo: 'Produto mal posicionado na bandeja é da alimentação, não dos parâmetros.',
    verificar: [
      'Produto centrado, abaixo da borda e sem encostar na lateral.',
      'Ritmo da máquina maior do que a equipe consegue alimentar: veja também as bandejas vazias.',
    ],
    ajustes: [],
  },
  outro: {
    resumo: 'Defeito fora da lista.',
    verificar: [
      'Descreva o defeito nas observações e tire uma foto do produto: é o que permite achar a causa depois.',
    ],
    ajustes: [],
  },
};

// ------------------------------------------------------------------ resumo para a análise por IA

const parametrosComSigla = (p: Parametros): Record<string, number | null> =>
  Object.fromEntries(CHAVES_PARAMETROS.map((k) => [META_PARAMETRO[k].sigla, p[k]]));

const arredondar = (v: number | null, casas = 4): number | null =>
  v == null || !Number.isFinite(v) ? null : Math.round(v * 10 ** casas) / 10 ** casas;

/**
 * Tudo o que a função analisar-op precisa saber da OP, além das fotos: produto,
 * parâmetros, resultado parcial, retrabalho e o que as OPs anteriores mostram.
 */
export function contextoParaIa(
  op: Op, ops: Op[], moldes: MoldeInfo[], produtos: Produto[], receitas: ReceitaPadrao[],
): Record<string, unknown> {
  const c = calcular(op, moldes);
  const produto = op.produto_codigo ? produtos.find((p) => p.codigo === op.produto_codigo) ?? null : null;
  const ref = referenciaDa(op, ops, moldes, produtos);
  const resumoOp = (l: OpCalculada) => ({
    data: l.o.data,
    produto: l.o.produto_descricao,
    aproveitamento: arredondar(l.c.aproveitamento),
    retrabalho_pct: arredondar(l.c.retrabalho_pct),
    nota_aparencia_ia: l.o.analise_ia?.nota_aparencia ?? null,
    aparencia_operador: l.o.aparencia,
    parametros: parametrosComSigla(l.o),
  });
  return {
    produto: {
      descricao: op.produto_descricao,
      especie: produto?.especie ?? null,
      derivacao: produto?.derivacao ?? null,
      molde: op.molde,
      peso_nominal_kg: op.peso_nominal_kg,
      temperatura_c: op.temp_produto_c,
    },
    filmes: { fundo: op.filme_fundo, tampa: op.filme_tampa },
    parametros: parametrosComSigla(op),
    receita_padrao: parametrosComSigla(parametrosDaReceita(receitaVigente(receitas, op.data))),
    resultado: {
      status: op.status,
      bandejas_formadas: c.bandejas_formadas,
      embalagens_boas: c.embalagens_boas,
      aproveitamento: arredondar(c.aproveitamento),
      retrabalho_pct: arredondar(c.retrabalho_pct),
      vazias_pct: arredondar(c.vazias_pct),
      ciclos_por_minuto: arredondar(c.ciclos_por_minuto, 2),
    },
    retrabalho_por_motivo: op.retrabalho,
    aparencia_marcada_pelo_operador: op.aparencia,
    observacoes: op.observacoes,
    referencia: ref
      ? {
          nivel: ref.nivel,
          ops_na_base: ref.base.length,
          melhores: ref.melhores.map(resumoOp),
          // Até 12 outras OPs da base, para o modelo ver a variação.
          outras: ref.base.filter((l) => !ref.melhores.includes(l)).slice(0, 12).map(resumoOp),
        }
      : null,
  };
}
