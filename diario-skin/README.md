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
| 3 | Leitura automática das telas pelas fotos | Código pronto; **falta testar com as três fotos reais** (ver [passo 6](#6-leitura-das-fotos-por-ia-opcional)) |
| 4 | Catálogo pela planilha de produtos (SKU, derivação, caixa), aba **Orientação** para o operador | Pronto e testado |
| 4 | Avaliação da foto do produto por IA, cruzada com os parâmetros | Código pronto; **falta testar com fotos reais e a API da Anthropic** |

## Experimentar agora, sem servidor

Sem configurar nada, o aplicativo roda em **modo local**: lançamento, orientação e painel funcionam, com o catálogo e o histórico, mas os dados ficam só no aparelho e não há login. O que **não** funciona em modo local é o que depende da IA: ler os valores da foto da tela e avaliar a foto do produto.

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

## Publicado no GitHub Pages

O workflow `.github/workflows/pages-classificador.yml` publica o Diário junto com o Classificador de Camarão, a cada mudança no `main`:

- Classificador: `https://teppeyochi-ui.github.io/app-alimentos/`
- Diário da Linha Skin: `https://teppeyochi-ui.github.io/app-alimentos/diario-skin/`

Sem configuração, o Diário é publicado em **modo local**. Para o celular: abra o endereço, instale (ver [passo 7](#7-instalar-no-celular)) e use.

### Como os dados ficam gravados no modo local

- **Gravação automática no próprio aparelho**, a cada alteração: OPs, contagens, paradas e fotos. Não precisa de internet nem de botão; o rodapé mostra "Salvo no aparelho".
- **Ficam só naquele aparelho e naquele navegador.** O que um operador lança não aparece no celular de outro nem no computador do P&D.
- **Para tirar os dados:** no próprio aparelho, *Painel P&D → Exportar XLSX* (ou CSV). As fotos não vão na exportação; ficam visíveis no detalhe da OP, naquele aparelho.
- **Podem se perder** se alguém limpar os dados do navegador ou desinstalar o aplicativo. No iPhone, instale na Tela de Início: o Safari pode apagar dados de sites não instalados que ficam semanas sem uso.
- **Quando o Supabase for ligado** neste mesmo endereço, o aplicativo avisa que há versão nova, pede login e envia sozinho as OPs e fotos que estavam no aparelho. Elas ficam registradas em nome de quem fizer esse primeiro login.

### Ligar o Pages ao Supabase

Depois dos passos 1 a 4 abaixo, crie duas variáveis no GitHub, em *Settings → Secrets and variables → Actions → Variables*: `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` (a chave pública, nunca a *service_role*). Depois rode o workflow de novo (aba *Actions → Run workflow*) e informe o endereço do Diário no Supabase ([passo 3](#3-configurar-o-login)).

## Colocar no ar, passo a passo

Para quem não é da área técnica, o mesmo caminho está em [LIGAR-SUPABASE.md](LIGAR-SUPABASE.md), com os links diretos de cada etapa.

Os nomes dos menus do Supabase mudam de vez em quando; se algum não bater, procure pelo nome mais parecido.

### 1. Criar o projeto no Supabase

1. Crie uma conta em [supabase.com](https://supabase.com) e um projeto novo. De preferência na região de São Paulo.
2. Guarde a senha do banco num lugar seguro (não é usada pelo aplicativo).

### 2. Criar o banco

1. No painel do projeto, abra **SQL Editor**.
2. Cole todo o conteúdo de [`supabase/instalar.sql`](supabase/instalar.sql) e clique em **Run**.

Esse arquivo cria as tabelas, as permissões, a função de gravação, a view `ops_indicadores`, o bucket de fotos `fotos-op` e carrega os moldes, a receita padrão, os 118 SKUs do catálogo e as 15 produções do histórico. Rode **uma vez**, num projeto novo.

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

Funciona em Vercel, Netlify e Cloudflare Pages ligando o repositório do GitHub. No GitHub Pages já está configurado: basta criar as duas variáveis, como descrito em [Ligar o Pages ao Supabase](#ligar-o-pages-ao-supabase). Depois de publicar, volte ao passo 3 e informe o endereço do site no Supabase.

Com as duas variáveis preenchidas, o catálogo e o histórico **não** vão dentro do aplicativo publicado: só chegam do banco, depois do login.

### 6. Leitura das fotos por IA (opcional)

Duas funções rodam no Supabase e consultam a API da Anthropic. A chave da Anthropic fica só no servidor.

| Função | O que faz | Onde aparece |
|---|---|---|
| `ler-telas` | Lê os 12 parâmetros nas fotos das telas 412, 414 e 417 | Lançar OP: ao fotografar a tela, os campos são preenchidos na hora |
| `analisar-op` | Avalia a foto do produto final junto com os parâmetros, o retrabalho e as OPs anteriores | Orientação: botão **Avaliar a foto com IA** |

1. Crie uma chave em [platform.claude.com](https://platform.claude.com).
2. Na pasta `diario-skin`, publique as funções e grave a chave, trocando `SEU_PROJETO` pelo identificador do projeto (aparece no endereço do painel):

```bash
npx supabase login
```

```bash
npx supabase functions deploy ler-telas --project-ref SEU_PROJETO
```

```bash
npx supabase functions deploy analisar-op --project-ref SEU_PROJETO
```

```bash
npx supabase secrets set ANTHROPIC_API_KEY=sua-chave --project-ref SEU_PROJETO
```

Se a ferramenta pedir, rode `npx supabase init` antes. Também dá para criar cada função pelo painel (*Edge Functions*), copiando os três arquivos da pasta dela em `supabase/functions/`, e gravar a chave em *Edge Functions → Secrets*.

3. **Testes de aceite que ainda faltam:**
   - `ler-telas`: fotografe as telas 417, 414 e 412 com a receita padrão e confira se voltam os 12 valores de referência (tDome 225, tPre 110, T1 0,8, T2 1,0, T4 0,0, T5 0,0, T6 4,0, T7 0,2, pVent 500, sp 40, Tx 0,5, Tmax 10,0). Se algum campo vier errado, o ajuste é no texto da instrução, em `supabase/functions/ler-telas/leitura.ts`.
   - `analisar-op`: avalie fotos de embalagens boas e com defeito conhecido (ruga, furo, sem vácuo) e veja se a nota e o diagnóstico fazem sentido para o P&D. O ajuste é na instrução de `supabase/functions/analisar-op/analise.ts`.

As funções usam o modelo `claude-opus-5-5` (constante `MODELO` em cada arquivo). Cada chamada custa da ordem de centavos de dólar; confira os preços atuais antes de liberar para toda a equipe. Nada do que a IA devolve é aplicado sozinho: os valores lidos ficam marcados para conferência, o que vier fora dos limites é descartado, e as sugestões de ajuste são só texto para o operador e o P&D decidirem.

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

### Catálogo de produtos

O catálogo vem da planilha de produtos do P&D (`dados/catalogo.csv`, 118 SKUs):

| Coluna da planilha | No aplicativo |
|---|---|
| `SKU` | Código do produto |
| `DESCR_PRO` | Descrição |
| `DESCR_DER` (derivação) | Mostrada no lançamento e na busca. A caixa escrita nela vira o **peso da caixa**: “CXA 7,5” = 7,5 kg; “CXA PDV” = peso variável |
| `DESCR_AGP` | Espécie: a orientação usa para comparar com produtos parecidos |
| `MOLDE` | Molde. Onde a planilha diz “Não encontrado” (27 SKUs), o molde fica **a confirmar**: 21 herdam o molde do mesmo produto em outra origem e 6 ficam sem molde |

**Molde a confirmar:** ao escolher um desses 27 SKUs, o lançamento mostra os botões **2x1** e **3x1**, com o molde herdado já marcado. A escolha vale para a OP e, feita pelo administrador (ou em modo local), fica gravada no catálogo: o SKU deixa de pedir confirmação. Operador e P&D escolhem o molde da OP, e a próxima OP do mesmo SKU já sugere esse molde. Em *Administração → Produtos*, a caixa “só os com molde a confirmar” lista os que faltam, com os mesmos dois botões. Em qualquer outro SKU, trocar o molde na OP faz o aplicativo avisar a diferença e oferecer “Corrigir o catálogo”.

**Embalagens por caixa:**

- **Peso fixo:** peso da caixa ÷ peso nominal (7,5 kg ÷ 500 g = 15). Vem preenchido e o operador pode corrigir.
- **Peso variável (PDV):** não dá para calcular. O campo fica vazio, marcado em vermelho, e é obrigatório para encerrar a OP.
- Em 4 SKUs de peso fixo a conta não fecha em número inteiro (por exemplo, caixa de 4 kg com embalagem de 240 g); neles o campo também fica para o operador.

O aparelho que já usava o aplicativo em modo local recebe os SKUs e os campos novos na primeira abertura depois da atualização, sem perder o que tinha. Para atualizar o catálogo depois: *Administração → Produtos → Importar CSV* (aceita os nomes de coluna da planilha).

### Orientação ao operador

A aba **Orientação** responde, para uma OP: a configuração da máquina está boa, e o que tentar para melhorar? Funciona sem internet, só com os dados do aparelho.

- **Como está esta OP:** aproveitamento, retrabalho, vazias e ritmo, com o que já foi lançado (a OP não precisa estar encerrada). Diz qual é a maior perda: bandeja vazia é da alimentação; retrabalho é que pede ajuste de máquina.
- **Configuração × referência:** cada parâmetro contra a receita padrão e contra a faixa usada nas **melhores OPs** já encerradas. A base é, nesta ordem: OPs do mesmo produto; da mesma espécie no mesmo molde; do mesmo molde. As melhores são o terço de maior aproveitamento (de 1 a 5 OPs). Não entram OPs abertas, canceladas, sem parâmetros ou com menos de 100 bandejas.
- **Retrabalho, o que conferir:** para cada defeito contado, o que olhar primeiro e quais parâmetros mexer, com o valor atual e o das melhores OPs.
- **O que as OPs anteriores mostram:** para cada parâmetro que já foi usado com valores diferentes, o aproveitamento e o retrabalho médios em cada valor. Com menos de 3 OPs em algum valor, aparece como “indício fraco”.
- **Foto do produto avaliada por IA** (precisa do servidor): nota de aparência de 0 a 10, defeitos vistos, diagnóstico e até 3 sugestões. A avaliação fica guardada na OP; no painel, “Nota de aparência da foto” é uma das opções do gráfico parâmetro × resultado, e a view `ops_indicadores` traz `nota_aparencia_ia`.

> **A validar pelo P&D:** as regras por defeito (`src/lib/orientacao.ts`, `REGRAS_DEFEITO`) são orientações gerais do processo skin escritas para este aplicativo. Não vieram do manual da ULMA nem foram validadas na linha. Revise o texto antes de a equipe tratar como regra.

No começo, sem OPs encerradas com parâmetros, a aba compara só com a receita padrão. A referência e a comparação por valor aparecem conforme as OPs do diário se acumulam: as 15 produções do histórico não têm parâmetros e não servem de referência.

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
| `ops.analise_ia` (coluna nova, JSON) | Última avaliação da foto do produto pela IA |
| `produtos.derivacao`, `peso_caixa_kg`, `especie`, `molde_a_confirmar` (colunas novas); `produtos.molde` pode ficar vazio | Planilha de produtos do P&D: derivação, caixa e agrupamento; 27 SKUs com o molde a confirmar |
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
│  ├─ lib/           cálculos, orientação, banco do aparelho, sincronização, login, exportação
│  ├─ telas/         Lançar OP, Orientação, Painel P&D, Detalhe/Comparação, Administração, Entrar
│  └─ componentes/   campos, fotos, seletor de produto, gráficos
├─ supabase/
│  ├─ migrations/    tabelas, permissões, salvar_op, view, bucket de fotos
│  ├─ functions/     ler-telas (lê as fotos das telas) e analisar-op (avalia a foto do produto)
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
| `npm test` | Cálculos (critérios 1 a 3), catálogo (derivação, caixa, PDV), orientação, sincronização com servidor simulado, CSV e XLSX | Node |
| `npm run test:banco` | Migrações, carga, view (critérios 2 e 3), permissões (critério 5), `salvar_op` sem duplicar, num PostgreSQL temporário | PostgreSQL 15+ |
| `npm run test:navegador` | Fluxo completo em celular de 360 px, modo local: critérios 1, 2, 3, produto PDV, uso em modo avião, rolagem e alvos de toque (critério 6), orientação, painel, exportação | Chromium (Playwright) |
| `npm run test:integrado` | O aplicativo com login contra um PostgreSQL temporário com as migrações reais: leitura da foto da tela na hora, modo avião → sincronização sem duplicar (critério 4), operador × P&D em OP fechada (critério 5), avaliação da foto gravada no banco, liberação de usuário | PostgreSQL 15+ e Chromium |

Os dois testes de navegador pedem um build antes (`npm run build`; o integrado gera o próprio). Para ter o Playwright: `npm install --no-save playwright` e `npx playwright install chromium`. `npm run test:tudo` roda tudo em sequência.

O teste integrado usa uma API de teste que imita só os endereços do Supabase que o aplicativo chama; as duas funções de IA respondem com valores fixos, sem modelo. **Não substitui um teste num projeto Supabase de verdade**, que é o próximo passo depois do [passo 5](#5-configurar-e-publicar-o-aplicativo): login por e-mail, envio de fotos ao bucket e as funções `ler-telas` e `analisar-op`.

## Pontos em aberto (seção 12 da especificação)

- **Embalagens por caixa:** no peso fixo sai do peso da caixa da derivação; no PDV o operador informa (o aplicativo sugere o valor da última OP do mesmo SKU). Confirmar com o P&D os 4 SKUs em que a conta não fecha: `10256093283531-1061` (7 oz, caixa de 4 kg), `16507014073621-010` (200 g, caixa de 18,144 kg), `24616245167481-978` (150 g, caixa de 3,62 kg) e `24664020761801-032` (240 g, caixa de 4 kg).
- **Molde a confirmar** em 27 SKUs: 6 sem molde (`0622203000134F-1058`, `0634402500133F-1058`, `0908409931213E-086`, `0908409931413E-086`, `0908409931513E-086`, `0938907200103M-815`) e 21 de filial com o molde herdado do mesmo produto. São confirmados no lançamento ou em *Administração → Produtos* (ver [Catálogo de produtos](#catálogo-de-produtos)).
- **Regras de orientação por defeito:** texto a validar pelo P&D e, se possível, com a ULMA (ver [Orientação ao operador](#orientação-ao-operador)).
- Espessura do filme de **tampa do molde 2x1** (0,1239 kg/m²): editável em *Administração → Filme por molde*.
- **Molde 2x2:** não incluído.
- Três campos das telas foram **interpretados pelos ícones** (consigna de 500 mbar na tela 414; tempo complementar e tempo máximo de vácuo na 412): confirmar com a ULMA.
- **Dois códigos** para Camarão Rosa 10/15 200 g e Pescada Amarela 500 g: o histórico ficou sem código; o P&D pode corrigir abrindo a OP no lançamento.
- A Cauda de Lagosta de 08/10/2026 está como 2x1 no histórico e 3x1 no catálogo: mantida como veio, com correção possível pelo P&D.

## Privacidade

Este repositório guarda o catálogo de produtos (118 SKUs, com derivação e espécie) e o histórico de produção da especificação (`dados/`, `supabase/seed.sql`, `supabase/instalar.sql`). Se o repositório for público, esses dados também são. No modo local eles vão embutidos no aplicativo; com o servidor configurado, não.
