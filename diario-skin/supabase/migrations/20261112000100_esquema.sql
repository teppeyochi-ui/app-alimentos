-- Diário da Linha Skin — tabelas (seção 5 da especificação).
--
-- Diferenças em relação ao modelo da especificação, todas aditivas:
--   * ops.status aceita também 'cancelada' (o administrador cancela; ninguém apaga).
--   * ops.data pode ficar vazia só no histórico da planilha (duas linhas vieram sem data).
--   * ops.sincronizado_em: hora em que o servidor recebeu a última gravação
--     (os aparelhos usam para baixar só o que mudou).
--   * receitas_padrao.ciclo_teorico_s: ciclo teórico da estação, configurável.
--   * perfis.ativo começa falso: quem cria conta só entra depois que o
--     administrador libera.

-- Perfis de usuário
create table public.perfis (
  id uuid primary key references auth.users on delete cascade,
  nome text not null,
  papel text not null default 'operador' check (papel in ('operador','pd','admin')),
  ativo boolean not null default false
);

-- Catálogo de produtos skin
create table public.produtos (
  codigo text primary key,                 -- SKU (PROD_DER), ex.: 24616701063781-975
  descricao text not null,
  molde text check (molde in ('2x1','3x1')),               -- nulo = molde a confirmar (o operador escolhe na OP)
  peso_nominal_kg numeric check (peso_nominal_kg > 0),     -- nulo = peso variável (PDV)
  embalagens_por_caixa integer check (embalagens_por_caixa > 0),
  derivacao text,                          -- DESCR_DER, ex.: FRESCATTO CXA 7,5
  peso_caixa_kg numeric check (peso_caixa_kg > 0),         -- nulo = caixa de peso variável (PDV)
  especie text,                            -- DESCR_AGP, ex.: SALMON
  ativo boolean not null default true
);

-- Peso de filme por bandeja, por molde
create table public.moldes (
  molde text primary key,                  -- '2x1' | '3x1'
  cavidades integer not null check (cavidades > 0),
  filme_fundo_kg_bdj numeric not null check (filme_fundo_kg_bdj >= 0),
  filme_tampa_kg_bdj numeric not null check (filme_tampa_kg_bdj >= 0)
);

-- Receita padrão da máquina. Cada alteração entra como linha nova: vale a de
-- vigência mais recente e as anteriores ficam como histórico.
create table public.receitas_padrao (
  id bigint generated always as identity primary key,
  vigente_desde timestamptz not null default now(),
  t_dome numeric, t_pre numeric, t1 numeric, t2 numeric, t4 numeric, t5 numeric,
  t6 numeric, t7 numeric, p_vent numeric, sp numeric, tx numeric, tmax numeric,
  ciclo_teorico_s numeric not null default 10.3 check (ciclo_teorico_s > 0)
);

-- Ordem de produção
create table public.ops (
  id uuid primary key default gen_random_uuid(),
  origem text not null default 'diario' check (origem in ('diario','planilha')),
  status text not null default 'aberta' check (status in ('aberta','fechada','cancelada')),
  data date,
  produto_codigo text references public.produtos(codigo),
  produto_descricao text not null,         -- cópia do nome no momento do lançamento
  op text,
  molde text not null references public.moldes(molde),
  peso_nominal_kg numeric,
  embalagens_por_caixa integer,
  lote_mp text,
  temp_produto_c numeric,
  filme_fundo text, filme_tampa text, lote_filme text,
  hora_inicio time, hora_fim time,
  passo_inicio integer, passo_fim integer,
  caixas integer, embalagens_avulsas integer default 0,
  peso_final_kg numeric,
  aparencia text check (aparencia in ('boa','regular','ruim')),
  observacoes text,
  -- parâmetros da máquina nesta OP (telas 417, 414 e 412)
  t_dome numeric, t_pre numeric, t1 numeric, t2 numeric, t4 numeric, t5 numeric,
  t6 numeric, t7 numeric, p_vent numeric, sp numeric, tx numeric, tmax numeric,
  parametros_origem text check (parametros_origem in ('digitado','lido_da_foto','padrao')),
  criado_por uuid references public.perfis(id), criado_em timestamptz default now(),
  alterado_por uuid references public.perfis(id), alterado_em timestamptz default now(),
  fechada_em timestamptz,
  analise_ia jsonb,                        -- última avaliação da foto do produto pela IA (função analisar-op)
  sincronizado_em timestamptz not null default now(),
  constraint ops_data_obrigatoria check (data is not null or origem = 'planilha')
);

create index ops_sincronizado_em_idx on public.ops (sincronizado_em);
create index ops_data_idx on public.ops (data);
create index ops_produto_idx on public.ops (produto_codigo);

-- Retrabalho por motivo (uma linha por motivo com contagem)
create table public.op_retrabalho (
  op_id uuid references public.ops(id) on delete cascade,
  motivo text not null check (motivo in
    ('sem_vacuo','furo','ruga','selagem','peso','posicao','outro')),
  quantidade integer not null default 0 check (quantidade >= 0),
  primary key (op_id, motivo)
);

-- Paradas
create table public.op_paradas (
  id uuid primary key default gen_random_uuid(),
  op_id uuid not null references public.ops(id) on delete cascade,
  motivo text not null,
  minutos integer not null check (minutos > 0)
);
create index op_paradas_op_idx on public.op_paradas (op_id);

-- Fotos
create table public.op_fotos (
  id uuid primary key default gen_random_uuid(),
  op_id uuid not null references public.ops(id) on delete cascade,
  tipo text not null check (tipo in ('tela','produto')),
  caminho text not null,                   -- caminho no bucket fotos-op
  tela_numero integer,                     -- 412, 414 ou 417 quando identificado
  criado_em timestamptz default now()
);
create index op_fotos_op_idx on public.op_fotos (op_id);
