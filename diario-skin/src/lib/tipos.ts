// Tipos do domínio. Os nomes dos campos são os mesmos das colunas do banco.

export type Molde = '2x1' | '3x1';
export type Papel = 'operador' | 'pd' | 'admin';
export type StatusOp = 'aberta' | 'fechada' | 'cancelada';
export type Origem = 'diario' | 'planilha';
export type Aparencia = 'boa' | 'regular' | 'ruim';
export type OrigemParametros = 'digitado' | 'lido_da_foto' | 'padrao';

export type MotivoRetrabalho = 'sem_vacuo' | 'furo' | 'ruga' | 'selagem' | 'peso' | 'posicao' | 'outro';

export type ChaveParametro =
  | 't_dome' | 't_pre' | 't1' | 't2' | 't4' | 't5' | 't6' | 't7' | 'p_vent' | 'sp' | 'tx' | 'tmax';

export type Parametros = Record<ChaveParametro, number | null>;

export interface Perfil {
  id: string;
  nome: string;
  papel: Papel;
  ativo: boolean;
}

export interface Produto {
  codigo: string;
  descricao: string;
  molde: Molde;
  peso_nominal_kg: number | null; // nulo = peso variável (PDV)
  embalagens_por_caixa: number | null;
  ativo: boolean;
}

export interface MoldeInfo {
  molde: Molde;
  cavidades: number;
  filme_fundo_kg_bdj: number;
  filme_tampa_kg_bdj: number;
}

export interface ReceitaPadrao extends Parametros {
  id: number;
  vigente_desde: string; // ISO
  ciclo_teorico_s: number | null;
}

export interface Parada {
  id: string;
  motivo: string;
  minutos: number;
}

export interface Foto {
  id: string;
  tipo: 'tela' | 'produto';
  caminho: string; // caminho no bucket fotos-op
  tela_numero: number | null;
  criado_em: string;
}

export type Retrabalho = Record<MotivoRetrabalho, number>;

export interface Op extends Parametros {
  id: string;
  origem: Origem;
  status: StatusOp;
  data: string | null; // AAAA-MM-DD; só o histórico da planilha pode ficar sem data
  produto_codigo: string | null;
  produto_descricao: string;
  op: string | null;
  molde: Molde;
  peso_nominal_kg: number | null;
  embalagens_por_caixa: number | null;
  lote_mp: string | null;
  temp_produto_c: number | null;
  filme_fundo: string | null;
  filme_tampa: string | null;
  lote_filme: string | null;
  hora_inicio: string | null; // HH:MM
  hora_fim: string | null;
  passo_inicio: number | null;
  passo_fim: number | null;
  caixas: number | null;
  embalagens_avulsas: number | null;
  peso_final_kg: number | null;
  aparencia: Aparencia | null;
  observacoes: string | null;
  parametros_origem: OrigemParametros | null;
  criado_por: string | null;
  criado_em: string | null;
  alterado_por: string | null;
  alterado_em: string | null; // hora da última edição (define quem vence no conflito)
  fechada_em: string | null;
  /** null = retrabalho não registrado (histórico da planilha). */
  retrabalho: Retrabalho | null;
  paradas: Parada[];
  fotos: Foto[];
}

/** OP como fica guardada no aparelho, com o controle de sincronização. */
export interface OpLocal extends Op {
  /** true = tem alteração que ainda não chegou ao servidor. */
  _sujo: boolean;
  _paradas_removidas: string[];
  _fotos_removidas: string[];
}
