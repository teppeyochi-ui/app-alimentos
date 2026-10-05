# Como colocar o app de Controle de Produção no ar

Resultado final: um endereço como `https://producao-frescatto.streamlit.app` que
abre no navegador do celular, sem conta no Claude, protegido por PIN, gravando
num banco de dados PostgreSQL.

São 3 etapas, cerca de 30 minutos. Tudo é gratuito para o volume de uma linha
de produção.

| Etapa | Serviço | Para quê |
|---|---|---|
| 1 | Supabase (supabase.com) | Banco de dados onde os lançamentos ficam guardados |
| 2 | Streamlit Community Cloud (share.streamlit.io) | Hospeda o app e gera o link |
| 3 | WhatsApp / e-mail | Enviar o link e os PINs para as pessoas |

---

## Etapa 1: criar o banco de dados (Supabase)

1. Acesse **supabase.com** e clique em **Start your project**. Entre com a conta
   do GitHub ou com um e-mail da empresa.
2. Clique em **New project**:
   - **Name:** `controle-producao`
   - **Database Password:** crie uma senha forte e **guarde-a** (vai ser usada no passo 4).
   - **Region:** `South America (São Paulo)`
   - Clique em **Create new project** e espere uns 2 minutos.
3. No topo da página do projeto, clique em **Connect**.
4. Na janela que abrir, escolha a aba **Connection String**, tipo **URI**, e em
   **Method** escolha **Session pooler** (não use "Direct connection": o
   Streamlit Cloud não consegue usá-la). Copie o texto, que é parecido com:

   ```
   postgresql://postgres.abcdefghijkl:[YOUR-PASSWORD]@aws-0-sa-east-1.pooler.supabase.com:5432/postgres
   ```

5. Troque `[YOUR-PASSWORD]` pela senha do passo 2 e acrescente
   `?sslmode=require` no final. Guarde esse texto: é o **DATABASE_URL**.

> As tabelas são criadas sozinhas na primeira vez que o app abrir, já com os
> 124 produtos da Planilha3, os 3 moldes da Planilha2, as linhas Skinpack e
> Alfresco e os operadores Luciano e Edson.

## Etapa 2: publicar o app (Streamlit Community Cloud)

1. Acesse **share.streamlit.io** e entre com a conta do GitHub que tem acesso
   ao repositório `teppeyochi-ui/app-alimentos`. Se pedir, autorize o acesso a
   repositórios privados.
2. Clique em **Create app** e depois em **Deploy a public app from GitHub**.
3. Preencha:
   - **Repository:** `teppeyochi-ui/app-alimentos`
   - **Branch:** `claude/app-producao-dados-7txkhs` (ou `main`, depois que o
     código for incorporado)
   - **Main file path:** `app_producao.py`
   - **App URL:** escolha o endereço, por exemplo `producao-frescatto`
4. Clique em **Advanced settings**:
   - **Python version:** 3.12
   - **Secrets:** cole o texto abaixo, trocando os valores:

   ```toml
   DATABASE_URL = "postgresql://postgres.abcdefghijkl:SENHA@aws-0-sa-east-1.pooler.supabase.com:5432/postgres?sslmode=require"
   PIN_OPERADOR = "482915"
   PIN_CONSULTA = "730264"
   PIN_GESTOR   = "915837"
   ```

   Use PINs de 6 dígitos, diferentes entre si e diferentes dos exemplos.
5. Clique em **Save** e depois em **Deploy**. A primeira publicação leva de 2 a
   5 minutos.
6. Abra o link, entre com o **PIN_GESTOR** e confira as abas Cadastros e
   Indicadores.

## Etapa 3: distribuir o acesso

| Quem | O que recebe | O que vê |
|---|---|---|
| Operadores (Luciano, Edson) | Link + **PIN_OPERADOR** | Lançar e Registros |
| Gestores e pessoas selecionadas | Link + **PIN_CONSULTA** | Indicadores e Registros, sem alterar nada |
| Você / PCP | Link + **PIN_GESTOR** | Tudo, inclusive Cadastros e exclusão de lançamentos |

Mande o link e o PIN em mensagens separadas. No celular, abra o link e use
**Adicionar à tela inicial** para ficar com ícone de aplicativo.

---

## Dia a dia

- **Trocar um PIN** (ex.: alguém saiu da equipe): share.streamlit.io → seu app →
  ⋮ → **Settings** → **Secrets** → altere e salve. Vale na hora para novos acessos.
- **Atualizar produtos ou moldes:** pelo próprio app, aba **Cadastros** (PIN gestor).
- **Levar os dados para a planilha:** aba **Registros** → **Baixar no formato da
  Plan1 (CSV)**. As colunas saem na mesma ordem da Plan1.
- **Power BI / Excel direto do banco:** use os mesmos dados de conexão do
  Supabase (host, porta 5432, usuário, senha). A tabela principal é `apontamentos`.

## Limites do plano gratuito

- **Streamlit:** se ninguém abrir o app por alguns dias, ele "dorme". Quem abrir
  verá um botão para acordá-lo e esperará cerca de 1 minuto. Nenhum dado se perde.
- **Supabase:** um projeto gratuito sem nenhum acesso por 7 dias é pausado e
  precisa ser reativado no painel. Com uso diário isso não acontece.
- O PIN é uma proteção simples, compartilhada por grupo. Para login individual
  ou para rodar dentro da rede da empresa, o mesmo app pode ser instalado num
  servidor interno (`streamlit run app_producao.py`) apontando para o banco da
  empresa. Basta definir as mesmas variáveis `DATABASE_URL` e `PIN_*`.
