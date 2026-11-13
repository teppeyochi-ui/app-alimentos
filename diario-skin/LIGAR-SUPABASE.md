# Como ligar o Diário da Linha Skin ao Supabase

Guia passo a passo, para fazer com calma. Leva cerca de 30 minutos. Faça no **computador**: é bem mais fácil que no celular.

## Para que serve

Sem o Supabase, o aplicativo funciona em **modo local**: os dados ficam só em cada celular. Ligar ao Supabase traz:

- login por pessoa (operador, P&D, administrador);
- os dados de todos os celulares juntos, com cópia fora do aparelho;
- a leitura da foto da tela e a avaliação da foto do produto por IA (etapa 8, opcional).

```
  CELULAR (aplicativo)  <---- internet ---->  SUPABASE
  lança as OPs                                guarda os dados, as fotos
        ^                                     e controla o login
        | baixa o aplicativo
        |
  GITHUB (onde o aplicativo está publicado)
  precisa saber 2 coisas do Supabase:
  o ENDEREÇO e a CHAVE PÚBLICA
```

## Os links que você vai usar

| Para quê | Link |
|---|---|
| Criar a conta e o projeto | https://supabase.com |
| Arquivo que cria o banco | https://github.com/teppeyochi-ui/app-alimentos/blob/main/diario-skin/supabase/instalar.sql |
| Colar o endereço e a chave no GitHub | https://github.com/teppeyochi-ui/app-alimentos/settings/variables/actions |
| Publicar o aplicativo de novo | https://github.com/teppeyochi-ui/app-alimentos/actions/workflows/pages-classificador.yml |
| O aplicativo | https://teppeyochi-ui.github.io/app-alimentos/diario-skin/ |

Os nomes dos menus do Supabase mudam de vez em quando. Se algum não bater, procure o mais parecido.

## Etapa 1: criar o projeto no Supabase

1. Abra [supabase.com](https://supabase.com) e crie uma conta (**Start your project**). O plano gratuito serve.
2. Clique em **New project**.
3. Preencha:
   - **Name:** `diario-skin`
   - **Database password:** clique em **Generate a password** e guarde essa senha num lugar seguro. O aplicativo não usa essa senha.
   - **Region:** **South America (São Paulo)**
4. Clique em **Create new project** e espere 1 a 2 minutos.

## Etapa 2: criar o banco

1. Abra o [arquivo que cria o banco](https://github.com/teppeyochi-ui/app-alimentos/blob/main/diario-skin/supabase/instalar.sql).
2. No canto de cima do arquivo, clique no ícone de dois quadradinhos (**Copy raw file**). Isso copia tudo.
3. No Supabase, no menu da esquerda, clique em **SQL Editor**.
4. Cole (Ctrl+V) na área de texto e clique em **Run**.
5. Se aparecer um aviso de operação "destrutiva", confirme. O projeto é novo e não há nada para perder.
6. O resultado esperado é **Success. No rows returned**.

Rode esse arquivo **uma vez só**, num projeto novo. Ele cria as tabelas, as permissões, a pasta de fotos e carrega os 118 produtos e as 15 produções antigas.

## Etapa 3: copiar o endereço e a chave pública

1. No Supabase, clique no botão **Connect** no topo da página, ou vá em **Project Settings → API**.
2. Copie para um bloco de notas:
   - **Project URL:** parece com `https://abcdefgh.supabase.co`
   - **Chave pública:** chamada **anon** ou **publishable**. Começa com `eyJ...` ou com `sb_publishable_...`

**Nunca** use a chave **service_role** nem a **secret**. Elas dão acesso total ao banco e não podem ir para o GitHub.

## Etapa 4: colar as duas informações no GitHub

> **Já feito para o projeto atual:** o endereço e a chave pública estão gravados no arquivo de publicação, então as etapas 4 e 5 só são necessárias se você trocar de projeto no Supabase.

1. Abra a [página de variáveis do repositório](https://github.com/teppeyochi-ui/app-alimentos/settings/variables/actions), logado no GitHub. O caminho pelos menus é **Settings → Secrets and variables → Actions**, aba **Variables** (não é a aba "Secrets").
2. Clique em **New repository variable** e crie a primeira:
   - **Name:** `VITE_SUPABASE_URL`
   - **Value:** o endereço que você copiou
3. Clique de novo em **New repository variable** e crie a segunda:
   - **Name:** `VITE_SUPABASE_ANON_KEY`
   - **Value:** a chave pública

Os nomes precisam ficar exatamente assim, em maiúsculas.

## Etapa 5: publicar o aplicativo de novo

1. Abra a [página da publicação](https://github.com/teppeyochi-ui/app-alimentos/actions/workflows/pages-classificador.yml). O caminho pelos menus é **Actions → Publicar aplicativos no GitHub Pages**.
2. Na direita, clique em **Run workflow** e depois no botão verde **Run workflow**.
3. Espere a bolinha amarela virar um ✓ verde (cerca de 1 minuto).

## Etapa 6: informar o endereço do aplicativo no Supabase

1. No Supabase: **Authentication → URL Configuration**.
2. Em **Site URL**, cole `https://teppeyochi-ui.github.io/app-alimentos/diario-skin/` e salve.
3. Em **Redirect URLs**, clique em **Add URL**, cole o mesmo endereço e salve.

Isso faz o link do e-mail de confirmação voltar para o aplicativo.

## Etapa 7: criar sua conta e virar administrador

1. Abra o aplicativo no celular. Deve aparecer **Há uma versão nova do aplicativo**: toque em **Atualizar**. Se não aparecer, feche o aplicativo e abra de novo.
2. Agora aparece a tela de entrada. Toque em **Criar conta** e informe e-mail e senha.
3. Abra o e-mail que o Supabase enviar e toque no link de confirmação.
4. O aplicativo vai mostrar **Aguardando liberação**. É o esperado: toda conta nova entra bloqueada.
5. No Supabase, volte ao **SQL Editor**, apague o que estiver lá, cole o texto abaixo trocando o e-mail pelo seu e clique em **Run**:

```sql
update public.perfis
   set papel = 'admin', ativo = true
 where id = (select id from auth.users where email = 'seu-email@empresa.com');
```

6. No aplicativo, toque em **Já fui liberado**.

A partir daí:

- O que já estava lançado no celular em modo local sobe sozinho para o Supabase, em nome de quem fez esse primeiro login.
- As próximas pessoas só precisam abrir o endereço e tocar em **Criar conta**. Você libera cada uma dentro do aplicativo, em **Administração → Usuários**.
- O envio de e-mails gratuito do Supabase tem um limite baixo por hora. Para cadastrar várias pessoas, faça aos poucos.
- O catálogo e o histórico deixam de ir embutidos no aplicativo público: só aparecem para quem fizer login.

## Etapa 8 (opcional): ligar a leitura das fotos por IA

Esta etapa é mais técnica e pode ficar para depois. Ela liga duas coisas:

- **foto da tela** → os valores da máquina são preenchidos na hora;
- **foto do produto final** → nota de aparência e sugestões de ajuste, na aba Orientação.

Precisa de uma chave da Anthropic, criada em https://platform.claude.com, e de publicar duas funções no Supabase (`ler-telas` e `analisar-op`). O passo a passo está no [README, passo 6](README.md#6-leitura-das-fotos-por-ia-opcional). Cada leitura custa da ordem de centavos de dólar.

## Se aparecer `relation "perfis" already exists` na etapa 2

O banco já tinha sido criado antes. Nada foi estragado. Para saber em que versão ele está, abra uma consulta nova no **SQL Editor** (botão **+** → **Create a new snippet**), cole o texto abaixo e clique em **Run**:

```sql
select
  to_regclass('public.perfis') is not null as banco_criado,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'produtos'
      and column_name = 'molde_a_confirmar') = 1 as versao_nova;
```

| banco_criado | versao_nova | O que fazer |
|---|---|---|
| true | true | O banco está pronto. Siga para a etapa 3 |
| true | false | O banco é da primeira versão. Abra o [arquivo de atualização](https://github.com/teppeyochi-ui/app-alimentos/blob/main/diario-skin/supabase/atualizar.sql), copie com **Copy raw file**, cole numa consulta nova e clique em **Run**. Ele não apaga nada. No fim deve aparecer `118` e `true` |
| false | false | O arquivo foi colado duas vezes. Apague o editor, cole **uma vez só** e rode de novo |

## Se algo der errado

Anote em qual etapa parou e o que apareceu na tela. Com isso dá para achar o problema.
