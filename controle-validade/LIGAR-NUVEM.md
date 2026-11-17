# Como ligar o Validade em Dia à nuvem

Passo a passo para quem nunca mexeu com Supabase. Leva uns 15 minutos e só
precisa ser feito uma vez.

## Para que serve

Sem a nuvem, cada aparelho guarda os seus próprios dados. Com ela:

- todos os aparelhos da casa veem o mesmo painel, o mesmo catálogo e o mesmo estoque;
- o que um faz aparece nos outros em até 20 segundos;
- se um aparelho quebrar ou o navegador for limpo, nada se perde;
- sem internet o aparelho continua etiquetando e dando baixa, e envia tudo quando a conexão volta.

A casa inteira usa **uma conta só** (um e-mail e uma senha), que fica salva em
cada aparelho. Quem está trabalhando continua se identificando do jeito de
sempre: lendo o próprio nome na cartela.

## Os links que você vai usar

| Para quê | Link |
|---|---|
| Criar a conta e o projeto | https://supabase.com |
| Arquivo que cria o banco | https://github.com/teppeyochi-ui/app-alimentos/blob/main/controle-validade/supabase/instalar.sql |
| Arquivo onde vão o endereço e a chave | https://github.com/teppeyochi-ui/app-alimentos/edit/main/controle-validade/nuvem-config.js |
| O aplicativo | https://teppeyochi-ui.github.io/app-alimentos/controle-validade/ |

Os nomes dos menus do Supabase mudam de vez em quando. Se algum não bater,
procure o mais parecido.

## Etapa 1: criar o projeto no Supabase

1. Abra [supabase.com](https://supabase.com) e entre na sua conta (ou crie uma em **Start your project**). O plano gratuito serve para começar.
2. Clique em **New project**. É um projeto novo, separado do Diário da Linha Skin.
3. Preencha:
   - **Organization:** deixe a que já vem escolhida.
   - **GitHub (optional):** não precisa. Não clique em **Connect GitHub**.
   - **Project name:** `validade-em-dia`
   - **Database password:** clique em **Generate a password** e guarde essa senha num lugar seguro. O aplicativo não usa essa senha.
   - **Region:** **South America (São Paulo)**
   - O que mais aparecer na página, deixe como veio. Se houver uma opção sobre **Data API**, ela precisa ficar ligada, com o esquema **public**: é por ela que o aplicativo conversa com o banco.
4. Clique em **Create new project** e espere 1 a 2 minutos.

## Etapa 2: criar o banco

1. Abra o [arquivo que cria o banco](https://github.com/teppeyochi-ui/app-alimentos/blob/main/controle-validade/supabase/instalar.sql).
2. No canto de cima do arquivo, clique no ícone de dois quadradinhos (**Copy raw file**). Isso copia tudo.
3. No Supabase, no menu da esquerda, clique em **SQL Editor**.
4. Cole (Ctrl+V) na área de texto e clique em **Run**.
5. O resultado esperado é **Success. No rows returned**.

Esse arquivo pode ser rodado de novo sem perigo: ele não apaga nada do que já
foi guardado.

## Etapa 3: criar a conta da casa

1. No Supabase: **Authentication → Users**.
2. Clique em **Add user → Create new user**.
3. Preencha:
   - **Email:** o e-mail que vai ser a conta da casa (por exemplo o e-mail geral da empresa).
   - **Password:** uma senha boa. É ela que será digitada uma vez em cada aparelho.
   - Marque **Auto Confirm User**.
4. Clique em **Create user**.

**Recomendado:** como a casa só precisa dessa conta, feche a porta para outras.
Em **Authentication → Sign In / Providers** (ou **Settings**), desligue
**Allow new users to sign up** e salve. Mesmo sem isso ninguém de fora vê os
dados da casa (cada conta só enxerga as próprias linhas), mas assim nem contas
vazias são criadas.

## Etapa 4: copiar o endereço e a chave pública

1. No Supabase, clique no botão **Connect** no topo da página, ou vá em **Project Settings → API**.
2. Copie para um bloco de notas:
   - **Project URL:** parece com `https://abcdefgh.supabase.co`
   - **Chave pública:** chamada **publishable** ou **anon**. Começa com `sb_publishable_...` ou com `eyJ...`

**Nunca** use a chave **secret** nem a **service_role**. Elas dão acesso total
ao banco e não podem ir para o GitHub nem para o aplicativo.

## Etapa 5: dizer ao aplicativo onde fica a nuvem

Há dois jeitos. O primeiro é melhor: faz uma vez e vale para todos os aparelhos.

**Jeito 1: no arquivo do aplicativo (recomendado)**

1. Abra o [arquivo nuvem-config.js](https://github.com/teppeyochi-ui/app-alimentos/edit/main/controle-validade/nuvem-config.js), logado no GitHub.
2. Preencha as duas linhas, mantendo as aspas:

   ```js
   window.NUVEM = {
     url: 'https://abcdefgh.supabase.co',
     chave: 'sb_publishable_...',
   };
   ```

3. Clique em **Commit changes** (duas vezes). O aplicativo é publicado de novo sozinho em cerca de 1 minuto.

Se preferir, mande o endereço e a chave para o Claude e peça para ele preencher.
As duas informações são públicas por natureza: quem protege os dados são a
conta da casa e as regras do banco.

**Jeito 2: em cada aparelho**

No aplicativo, em **Ajustes → Nuvem**, cole o endereço e a chave e toque em
**Guardar endereço e chave**. Precisa repetir em cada aparelho.

## Etapa 6: ligar o primeiro aparelho

Comece pelo aparelho que **já tem os dados de verdade** (o catálogo com os seus
códigos, as etiquetas em uso). Se ainda está com os dados de exemplo, toque
antes em **Começar do zero** no painel e monte o catálogo.

1. Abra o aplicativo. Se aparecer versão nova, feche e abra de novo.
2. Vá em **Ajustes → Nuvem**, digite o e-mail e a senha da conta da casa e toque em **Ligar este aparelho à nuvem**.
3. O aplicativo avisa o que vai acontecer: "A nuvem da casa ainda está vazia. Os dados deste aparelho serão enviados para ela". Toque em **Ligar**.
4. No topo aparece **Nuvem em dia**. Pronto.

## Etapa 7: ligar os outros aparelhos

Um de cada vez, depois que o primeiro mostrar **Nuvem em dia**. Em cada um:
**Ajustes → Nuvem**, e-mail e senha da casa, **Ligar este aparelho à nuvem**. O aviso agora diz que entram os dados que a casa já tem. Os dados de
exemplo desse aparelho saem de cena.

Se o aparelho já tinha dados próprios de verdade, o aplicativo avisa que eles
serão **substituídos** pelos da nuvem. Para guardá-los, cancele e baixe antes
uma cópia de segurança.

## O que muda no dia a dia

- **O aviso no topo** diz como está a nuvem. Tocar nele leva aos Ajustes.

  | Aviso | O que quer dizer |
  |---|---|
  | Nuvem em dia | Tudo enviado e recebido. |
  | Sem conexão · 3 por enviar | Sem internet. O aparelho continua funcionando; as 3 mudanças vão quando a conexão voltar. |
  | Nuvem: entrar de novo | A sessão terminou. Toque no aviso e digite a senha da casa. Nada do que foi feito se perde. |
  | Nuvem com erro | A nuvem recusou a sincronização. Os Ajustes mostram o motivo. |

- **Números das etiquetas:** cada aparelho recebe uma faixa de mil números só
  dele, para dois aparelhos nunca imprimirem a mesma etiqueta, mesmo sem
  internet. Por isso o segundo aparelho começa em 001001, o terceiro em 002001,
  e assim por diante. Quando a faixa está pela metade, o aparelho reserva outra
  sozinho.
- **Recebimento e contagem** em aberto são de cada aparelho: o recebimento
  aberto no computador da recepção não mistura com o que outro aparelho
  etiqueta. Os outros veem no histórico, marcado "em aberto em outro aparelho".
- **Ajustes da casa** (nome, dias de alerta, regra do 1º dia, locais, equipe)
  valem para todos. **Ajustes do aparelho** (tamanho da etiqueta, tamanho das
  letras, som) são de cada um.
- **Restaurar cópia, carregar exemplo e apagar tudo** somem dos Ajustes enquanto
  a nuvem estiver ligada: eles mudariam os dados de todos os aparelhos. Para
  usá-los, desligue antes aquele aparelho da nuvem.
- **Duas pessoas mexendo na mesma etiqueta ao mesmo tempo:** se mexeram em
  coisas diferentes (uma mudou o local, a outra deu baixa), ficam as duas. Se
  mexeram na mesma coisa, vale a que chegou por último à nuvem.

## Se algo der errado

| O que aparece | O que fazer |
|---|---|
| "E-mail ou senha não conferem." | Confira a conta criada na etapa 3. Se esqueceu a senha, troque em **Authentication → Users**, nos três pontinhos da conta. |
| "…confira o endereço e a chave, e se o banco foi instalado" | O endereço ou a chave da etapa 4 estão errados, ou a etapa 2 não foi feita. Rode o arquivo do banco de novo: não faz mal. |
| "Sem conexão com a nuvem." com internet funcionando | Projetos gratuitos do Supabase parados por muito tempo são pausados. Entre no Supabase e reative o projeto. |
| "Os números reservados para este aparelho acabaram." | O aparelho ficou muito tempo sem internet. Conecte por um instante e ele reserva mais. |

Para parar de usar a nuvem num aparelho: **Ajustes → Nuvem → Desligar este
aparelho da nuvem**. Os dados continuam nele.

## O que foi testado, e o que ainda não

- O banco (o arquivo da etapa 2) foi testado de verdade num PostgreSQL: cada
  conta só enxerga as próprias linhas, ninguém escreve direto nas tabelas, os
  campos são juntados e as faixas de números nunca se repetem.
- A conversa do aplicativo com a nuvem foi testada contra um servidor que imita
  o Supabase: entrada, sessão vencida, queda de internet, vários aparelhos.
- **Ainda não foi testado contra um projeto do Supabase de verdade.** A
  primeira ligação (etapa 6) é essa prova. Se algo não funcionar, anote a
  mensagem que apareceu nos Ajustes.
