# Diário da Linha Skin

Aplicativo do P&D da Frescatto para registrar cada ordem de produção (OP) da termoformadora ULMA 308332, estação skin pack: parâmetros da máquina, fotos das telas e do produto final, retrabalho, paradas e números de produção. O painel mostra como cada mudança de parâmetro afeta rendimento, retrabalho e consumo de filme.

- **Celular primeiro** (360 px), botões de 48 px, tema claro e escuro, em português.
- **Funciona sem internet:** tudo é gravado no aparelho e enviado quando a conexão volta, sem duplicar.
- **Instalável** (PWA) no celular e no computador.
- **Banco próprio** no Supabase (PostgreSQL), com login e permissões por papel: operador, P&D e administrador.

O que está pronto, pelas fases da especificação:

| Fase | Conteúdo | Situação |
|---|---|---|
| 1 | Banco, login, catálogo e histórico, Lançar OP com fotos, cálculo ao vivo, offline, instalação | Pronto e testado |
| 2 | Painel P&D, detalhe e comparação de OPs, exportação CSV/XLSX, administração | Pronto e testado |
| 3 | Leitura automática das telas pelas fotos | Código pronto; **falta testar com as três fotos reais** (ver [passo 6](#6-leitura-automática-das-telas-opcional)) |

## Experimentar agora, sem servidor

Sem configurar nada, o aplicativo roda em **modo local**: funciona inteiro, com o catálogo e o histórico da especificação, mas os dados ficam só no aparelho e não há login.

```bash
cd diario-skin
```

```bash
npm install
```

```bash
npm run dev
```

Abra o endereço que aparecer no terminal. Precisa do Node.js 20 ou mais novo.

## Colocar no ar, passo a passo

Os nomes dos menus do Supabase mudam de vez em quando; se algum não bater, procure pelo nome mais parecido.

### 1. Criar o projeto no Supabase

1. Crie uma conta em [supabase.com](https://supabase.com) e um projeto novo. De preferência na região de São Paulo.
2. Guarde a senha do banco num lugar seguro (não é usada pelo aplicativo).

### 2. Criar o banco

1. No painel do projeto, abra **SQL Editor**.
2. Cole todo o conteúdo de [`supabase/instalar.sql`](supabase/instalar.sql) e clique em **Run**.

Esse arquivo cria as tabelas, as permissões, a função de gravação, a view `ops_indicadores`, o bucket de fotos `fotos-op` e carrega os moldes, a receita padrão, os 91 produtos e as 15 produções do histórico. Rode **uma vez**, num projeto novo.

Quem preferir a linha de comando do Supabase pode usar os arquivos separados: `supabase/migrations/*.sql` (na ordem) e depois `supabase/seed.sql`.

### 3. Configurar o login

Em **Authentication**:

- **URL Configuration:** quando o aplicativo estiver publicado (passo 5), coloque o endereço dele em *Site URL* e em *Redirect URLs*. É para onde o link do e-mail volta.
- **Sign In / Providers → Email:** deixe ligado. Com "Confirm email" ligado, quem cria conta precisa confirmar pelo e-mail antes de entrar.
- **Opcional, recomendado para iPhone:** em *Emails → Magic Link*, inclua `{{ .Token }}` no texto do e-mail. Assim a pessoa pode digitar o código de 6 dígitos dentro do aplicativo instalado, em vez de depender do link (no iPhone, o link abre no Safari e não no aplicativo instalado).
- O envio de e-mails embutido do Supabase tem limite baixo por hora. Para uso contínuo, configure um SMTP próprio em *Emails → SMTP Settings*.

### 4. Criar o primeiro administrador

1. Abra o aplicativo (pode ser em `npm run dev`, já com o `.env` do passo 5) e use **Criar conta**.
2. Toda conta nova entra como operador **sem acesso**. Para liberar a primeira e torná-la administradora, rode no **SQL Editor**, trocando o e-mail:

```sql
update public.perfis
   set papel = 'admin', ativo = true
 where id = (select id from auth.users where email = 'seu-email@empresa.com');
```

3. No aplicativo, toque em **Já fui liberado**.

Daí em diante, as próximas contas são liberadas dentro do aplicativo, em **Administração → Usuários**.

### 5. Configurar e publicar o aplicativo

1. Copie `.env.example` para `.env` e preencha `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` (painel do Supabase → *Project Settings → API*). Use a chave pública (*anon* ou *publishable*), **nunca** a *service_role*.
2. Teste na sua máquina com `npm run dev`.
3. Publique em qualquer hospedagem de site estático com HTTPS. Em todas, a configuração é a mesma:

| Campo | Valor |
|---|---|
| Pasta raiz (root / base directory) | `diario-skin` |
| Comando de build | `npm run build` |
| Pasta de saída | `dist` |
| Variáveis de ambiente | `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` |

Funciona em Vercel, Netlify e Cloudflare Pages ligando o repositório do GitHub. Depois de publicar, volte ao passo 3 e informe o endereço do site no Supabase.

Com as duas variáveis preenchidas, o catálogo e o histórico **não** vão dentro do aplicativo publicado: só chegam do banco, depois do login.

### 6. Leitura automática das telas (opcional)

O botão **Ler valores das fotos** chama a função `ler-telas`, que roda no Supabase e consulta a API da Anthropic. A chave da Anthropic fica só no servidor.

1. Crie uma chave em [platform.claude.com](https://platform.claude.com).
2. Na pasta `diario-skin`, publique a função e grave a chave, trocando `SEU_PROJETO` pelo identificador do projeto (aparece no endereço do painel):

```bash
npx supabase login
```

```bash
npx supabase functions deploy ler-telas --project-ref SEU_PROJETO
```

```bash
npx supabase secrets set ANTHROPIC_API_KEY=sua-chave --project-ref SEU_PROJETO
```

Se a ferramenta pedir, rode `npx supabase init` antes. Também dá para criar a função pelo painel (*Edge Functions*), copiando os três arquivos de `supabase/functions/ler-telas/`, e gravar a chave em *Edge Functions → Secrets*.

3. **Teste de aceite que ainda falta:** fotografe as telas 417, 414 e 412 com a receita padrão e confira se voltam os 12 valores de referência (tDome 225, tPre 110, T1 0,8, T2 1,0, T4 0,0, T5 0,0, T6 4,0, T7 0,2, pVent 500, sp 40, Tx 0,5, Tmax 10,0). Se algum campo vier errado, o ajuste é no texto da instrução, em `supabase/functions/ler-telas/leitura.ts`.

A função usa o modelo `claude-opus-5-5` (constante `MODELO` no mesmo arquivo). Cada leitura custa da ordem de centavos de dólar; confira os preços atuais antes de liberar para toda a equipe. Os valores lidos nunca são gravados sem o operador ver: os campos ficam marcados para conferência e o que vier fora dos limites é descartado.

### 7. Instalar no celular

- **Android (Chrome):** abra o endereço, toque no estado da sincronização (canto de cima) e em **Instalar o aplicativo neste aparelho**; ou use o menu do Chrome → *Instalar aplicativo*.
- **iPhone (Safari):** botão *Compartilhar* → *Adicionar à Tela de Início*.

O primeiro acesso precisa de internet (login e download do catálogo). Depois disso o aplicativo abre e funciona sem sinal.

## Como funciona

### Offline e sincronização

- Cada alteração é gravada no aparelho em menos de meio segundo e enviada ao servidor cerca de 2 segundos depois. O rodapé do lançamento mostra o estado: *Gravando no aparelho*, *Salvo no aparelho* (com o motivo, se não foi enviado) ou *Sincronizado*.
- Sem conexão, o aplicativo tenta de novo sozinho: quando o sinal volta, ao reabrir, e a cada minuto com a tela aberta.
- Reenviar não duplica: os identificadores de OP, parada e foto nascem no aparelho e o servidor grava por identificador.
- **Conflito entre aparelhos:** por OP, vence a edição mais recente (hora da edição no aparelho). Paradas e fotos se somam; só saem as que alguém removeu.
- As fotos são reduzidas no aparelho (1800 px no lado maior, JPEG 0,82) e ficam guardadas nele até subirem para o bucket privado `fotos-op`. O painel as exibe com endereços assinados de curta duração.
- "Nova OP" só vira OP de verdade quando recebe o primeiro dado, para não deixar OP vazia aberta por toque acidental.

### Permissões

Valem no banco (políticas por linha), não só na tela:

| Papel | Pode |
|---|---|
| Operador | Criar OP, alterar OP aberta, encerrar |
| P&D | Tudo do operador, mais corrigir OP encerrada e o histórico da planilha |
| Administrador | Tudo do P&D, mais catálogo, pesos de filme, receita padrão, usuários e cancelar/restaurar OP |

Ninguém apaga OP. Conta nova fica sem acesso até um administrador liberar.

### Cálculos

As fórmulas da seção 7 da especificação estão em `src/lib/calc.ts` (usadas no lançamento, no painel e na exportação) e repetidas em SQL na view `ops_indicadores`, para consulta direta no banco ou em ferramentas de BI. Os testes conferem as duas contra os mesmos casos.

### Exportação

No painel, **Exportar CSV** e **Exportar XLSX** geram uma linha por OP do filtro atual (sem filtro, todas), com os dados lançados e os indicadores. O CSV usa `;` e vírgula decimal, para abrir direto no Excel em português; o XLSX leva números de verdade e uma segunda planilha com as paradas.

### Diferenças em relação à especificação

| O que | Por quê |
|---|---|
| `ops.status` aceita `cancelada` | A especificação previa: o administrador cancela, ninguém apaga |
| `ops.data` pode ficar vazia no histórico da planilha | Duas das 15 linhas do histórico vieram sem data; no diário a data continua obrigatória |
| `ops.sincronizado_em` (coluna nova) | Hora em que o servidor recebeu a gravação; os aparelhos baixam só o que mudou |
| `receitas_padrao.ciclo_teorico_s` (coluna nova) | Ciclo teórico configurável (10,3 s na carga inicial) |
| `perfis.ativo` começa `false` | Conta nova só entra depois de liberada |
| Parâmetros alterados comparam com a receita que valia **na data da OP** | Mudar a receita padrão não reescreve a leitura das OPs antigas |
| O painel calcula no aparelho, não lê a view | Funciona sem internet e já inclui o que ainda não foi enviado; a view existe para uso externo |
| A leitura das fotos devolve a tela de cada foto, na ordem | Para preencher `op_fotos.tela_numero` |
| Na dispersão, cor **e forma** identificam o produto (12 combinações; do 13º em diante, "outros") | Legível também para quem tem daltonismo |

## Pastas

```
diario-skin/
├─ src/
│  ├─ lib/           cálculos, banco do aparelho, sincronização, login, exportação
│  ├─ telas/         Lançar OP, Painel P&D, Detalhe/Comparação, Administração, Entrar
│  └─ componentes/   campos, fotos, seletor de produto, gráficos
├─ supabase/
│  ├─ migrations/    tabelas, permissões, salvar_op, view, bucket de fotos
│  ├─ functions/     ler-telas (leitura das fotos das telas)
│  ├─ seed.sql       carga inicial (gerada)
│  └─ instalar.sql   tudo acima num arquivo só (gerado)
├─ dados/            catalogo.csv e historico.csv (origem da carga inicial)
├─ ferramentas/      geradores do SQL e dos ícones
└─ testes/           unidade, banco e navegador
```

Depois de alterar um CSV de `dados/` ou uma migração, rode `npm run sql` para gerar de novo `seed.sql` e `instalar.sql`.

## Testes

| Comando | O que confere | Precisa de |
|---|---|---|
| `npm test` | Cálculos (critérios 1 a 3), carga inicial, sincronização com servidor simulado, CSV e XLSX | Node |
| `npm run test:banco` | Migrações, carga, view (critérios 2 e 3), permissões (critério 5), `salvar_op` sem duplicar, num PostgreSQL temporário | PostgreSQL 15+ |
| `npm run test:navegador` | Fluxo completo em celular de 360 px, modo local: critérios 1, 2, 3, uso em modo avião, rolagem e alvos de toque (critério 6), painel, exportação | Chromium (Playwright) |
| `npm run test:integrado` | O aplicativo com login contra um PostgreSQL temporário com as migrações reais: modo avião → sincronização sem duplicar (critério 4), operador × P&D em OP fechada (critério 5), liberação de usuário | PostgreSQL 15+ e Chromium |

Os dois testes de navegador pedem um build antes (`npm run build`; o integrado gera o próprio). Para ter o Playwright: `npm install --no-save playwright` e `npx playwright install chromium`. `npm run test:tudo` roda tudo em sequência.

O teste integrado usa uma API de teste que imita só os endereços do Supabase que o aplicativo chama. **Não substitui um teste num projeto Supabase de verdade**, que é o próximo passo depois do [passo 5](#5-configurar-e-publicar-o-aplicativo): login por e-mail, envio de fotos ao bucket e a função `ler-telas`.

## Pontos em aberto (seção 12 da especificação)

- **Embalagens por caixa** de cada produto: começa vazio; o aplicativo sugere o valor da última OP do mesmo código e o administrador pode fixar no catálogo.
- Espessura do filme de **tampa do molde 2x1** (0,1239 kg/m²): editável em *Administração → Filme por molde*.
- **Molde 2x2:** não incluído.
- Três campos das telas foram **interpretados pelos ícones** (consigna de 500 mbar na tela 414; tempo complementar e tempo máximo de vácuo na 412): confirmar com a ULMA.
- **Dois códigos** para Camarão Rosa 10/15 200 g e Pescada Amarela 500 g: o histórico ficou sem código; o P&D pode corrigir abrindo a OP no lançamento.
- A Cauda de Lagosta de 08/10/2026 está como 2x1 no histórico e 3x1 no catálogo: mantida como veio, com correção possível pelo P&D.

## Privacidade

Este repositório guarda o catálogo de produtos e o histórico de produção da especificação (`dados/`, `supabase/seed.sql`, `supabase/instalar.sql`). Se o repositório for público, esses dados também são. No modo local eles vão embutidos no aplicativo; com o servidor configurado, não.
