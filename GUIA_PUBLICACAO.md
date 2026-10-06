# Como colocar o app de Controle de Produção no ar

Resultado final: um endereço como `https://producao-frescatto.streamlit.app` que
abre no navegador do celular, sem conta no Claude, protegido por PIN, gravando
num banco de dados PostgreSQL.

São 3 etapas, cerca de 30 minutos. Tudo é gratuito para o volume de uma linha
de produção. Marque cada item `[x]` conforme for concluindo.

| Etapa | Serviço | Para quê |
|---|---|---|
| 1 | Supabase (supabase.com) | Banco de dados onde os lançamentos ficam guardados |
| 2 | Streamlit Community Cloud (share.streamlit.io) | Hospeda o app e gera o link |
| 3 | WhatsApp / e-mail | Enviar o link e os PINs para as pessoas |

## Checklist

- [ ] 1.1 Conta criada no Supabase
- [ ] 1.2 Projeto `controle-producao` criado (região São Paulo) e senha guardada
- [ ] 1.3 Janela **Connect** aberta
- [ ] 1.4 Endereço do tipo **Session pooler** copiado
- [ ] 1.5 DATABASE_URL montado (senha no lugar + `?sslmode=require` no final)
- [ ] 2.1 Entrada no Streamlit Community Cloud com o GitHub
- [ ] 2.2 **Create app** → **Deploy a public app from GitHub**
- [ ] 2.3 Repositório, branch, arquivo e endereço preenchidos
- [ ] 2.4 **Advanced settings**: Python 3.12 e Secrets colados
- [ ] 2.5 **Deploy** feito e app aberto
- [ ] 2.6 Conferido com o PIN de gestor (Cadastros e Indicadores)
- [ ] 3 Link e PINs enviados para operadores e para quem acompanha

---

## Etapa 1: criar o banco de dados (Supabase)

### 1.1 Criar a conta
Acesse **supabase.com** e clique em **Start your project**. Entre com a conta do
GitHub ou com um e-mail da empresa.

### 1.2 Criar o projeto
Clique em **New project** e preencha:

- **Name:** `controle-producao`
- **Database Password:** crie uma senha **só com letras e números** (ex.: `Fresc2026xyz`).
  Símbolos como `@ # / : ? %` quebram o endereço do passo 1.5. **Guarde essa senha.**
- **Region:** `South America (São Paulo)`

Clique em **Create new project** e espere uns 2 minutos.

> Esqueceu a senha ou ela tem símbolos? **Project Settings → Database → Reset
> database password** e crie uma nova.

### 1.3 Abrir a janela de conexão
No painel do projeto, clique no botão **Connect**, no topo da tela.

### 1.4 Copiar o endereço do banco
Na janela que abrir, escolha:

- **Type:** `URI`
- **Method** (em algumas telas aparece como **Source**): **`Session pooler`**

> Atenção: **não** use "Direct connection". O Streamlit não consegue usá-la e o
> app não abre.

Vai aparecer um texto parecido com este. Clique em **copiar**:

```
postgresql://postgres.abcdefghijkl:[YOUR-PASSWORD]@aws-0-sa-east-1.pooler.supabase.com:5432/postgres
```

### 1.5 Montar o DATABASE_URL
Cole o texto no Bloco de Notas e faça **duas alterações**:

**a) Troque `[YOUR-PASSWORD]` pela sua senha.** Os colchetes `[ ]` também saem.

**b) Acrescente `?sslmode=require` no final**, colado, sem espaço.

Exemplo, com a senha `Fresc2026xyz`:

| | Texto |
|---|---|
| Copiado do Supabase | `postgresql://postgres.abcdefghijkl:[YOUR-PASSWORD]@aws-0-sa-east-1.pooler.supabase.com:5432/postgres` |
| Pronto para usar | `postgresql://postgres.abcdefghijkl:Fresc2026xyz@aws-0-sa-east-1.pooler.supabase.com:5432/postgres?sslmode=require` |

O texto pronto é o **DATABASE_URL**, que vai ser colado na Etapa 2.

> Quem tiver essa linha tem acesso total aos dados. **Não mande por WhatsApp,
> e-mail ou chat.** Ela só vai na caixa Secrets do Streamlit.

As tabelas são criadas sozinhas na primeira vez que o app abrir, já com os 124
produtos da Planilha3, os 3 moldes da Planilha2, as linhas Skinpack e Alfresco e
os operadores Luciano e Edson.

---

## Etapa 2: publicar o app (Streamlit Community Cloud)

### 2.1 Entrar
Acesse **share.streamlit.io** e entre com a conta do GitHub que tem acesso ao
repositório `teppeyochi-ui/app-alimentos`. Se pedir, autorize o acesso a
repositórios privados.

### 2.2 Criar o app
Clique em **Create app** e depois em **Deploy a public app from GitHub**.

### 2.3 Dizer qual código publicar

| Campo | O que colocar |
|---|---|
| **Repository** | `teppeyochi-ui/app-alimentos` |
| **Branch** | `claude/app-producao-dados-7txkhs` (ou `main`, depois que o código for incorporado) |
| **Main file path** | `app_producao.py` |
| **App URL** | o endereço que você quiser, ex.: `producao-frescatto` |

### 2.4 Configurações avançadas (antes de clicar em Deploy)
1. Clique em **Advanced settings**.
2. Em **Python version**, escolha **3.12**.
3. Na caixa **Secrets**, cole as 4 linhas abaixo e troque os valores:

```toml
DATABASE_URL = "cole aqui o texto pronto do passo 1.5"
PIN_OPERADOR = "482915"
PIN_CONSULTA = "730264"
PIN_GESTOR   = "915837"
```

- Mantenha as **aspas** em volta de cada valor.
- Os PINs são as "senhas" de cada grupo. Invente 6 números diferentes para
  cada um e **não use os números do exemplo**.

| PIN | Quem usa | O que vê |
|---|---|---|
| `PIN_OPERADOR` | Luciano, Edson | Lançar e Registros |
| `PIN_CONSULTA` | Gestores e pessoas selecionadas | Indicadores e Registros, sem alterar nada |
| `PIN_GESTOR` | Você / PCP | Tudo, inclusive Cadastros e exclusão de lançamentos |

4. Clique em **Save**.

### 2.5 Publicar
Clique em **Deploy**. A primeira publicação leva de 2 a 5 minutos. No final, o
app abre no endereço escolhido no passo 2.3.

### 2.6 Conferir
Entre com o **PIN_GESTOR** e confira:
- aba **Cadastros**: os 124 produtos e os 3 moldes aparecem;
- faça um lançamento de teste na aba **Lançar** e veja na aba **Indicadores**;
- depois exclua o teste em **Registros → Excluir apontamento lançado errado**.

---

## Etapa 3: distribuir o acesso

Mande o link e o PIN **em mensagens separadas**:

| Quem | Recebe |
|---|---|
| Operadores (Luciano, Edson) | Link + `PIN_OPERADOR` |
| Gestores e pessoas selecionadas | Link + `PIN_CONSULTA` |

No celular, abra o link e use **Adicionar à tela inicial** para ficar com ícone
de aplicativo.

---

## Se der erro

| O que aparece | Causa provável | O que fazer |
|---|---|---|
| Tela vermelha com `could not translate host name` ou `Network is unreachable` | Endereço de "Direct connection" | Refaça o passo 1.4 escolhendo **Session pooler** |
| `password authentication failed` | Senha errada ou com símbolos | Reset da senha (passo 1.2) e monte o endereço de novo |
| `Invalid TOML` ao salvar Secrets | Faltou aspas ou sobrou espaço | Confira se cada valor está entre aspas `"..."` |
| `ModuleNotFoundError` | Versão do Python | Settings → Python 3.12 → Reboot app |
| App pede PIN e não aceita | PIN digitado diferente do que está em Secrets | Confira em Settings → Secrets |

Para ver o erro completo: no canto inferior direito do app, **Manage app** →
os registros (logs) aparecem na lateral. Mande um print (escondendo a senha).

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
