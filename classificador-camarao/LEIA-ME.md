# Classificador de Camarão — Frescatto P&D

App de celular para técnicos de P&D e Qualidade classificarem lotes de camarão na fábrica. O técnico pesa unidade por unidade, digita os pesos e o app mostra:

- a classificação do lote;
- a faixa de peso por peça;
- a faixa de peças por embalagem.

É um **PWA**, um site que se instala na tela inicial e funciona **sem internet** depois da primeira abertura. Roda em Android (Chrome) e iPhone (Safari) e não tem dependências externas.

---

## 1. Arquivos

| Arquivo | Para que serve |
|---|---|
| `index.html` | Estrutura das 4 telas: Produto, Pesagem, Resultado e Histórico. |
| `styles.css` | Visual: tema claro e escuro, botões grandes para uso com luva. |
| `app.js` | Interface: telas, teclado, histórico, compartilhar, CSV e instalação. |
| `core.js` | **Tabelas e regras de classificação.** Único arquivo a editar para mudar tabelas. |
| `sw.js` | Service worker: guarda o app no aparelho para uso offline. Tem a constante `VERSION`. |
| `manifest.webmanifest` | Nome, cores e ícones do app instalado. |
| `icones/` | Ícones 192, 512, 512 maskable (Android), apple-touch-icon (iPhone) e `logo-frescatto.png` (topo do app). |
| `teste-motor.js` | Testes das regras e tabelas: `node teste-motor.js`. |
| `teste-interface.js` | Teste de interface com Playwright: `node teste-interface.js`. |
| `Teste_Classificador.xlsx` | Relatório dos testes e achados das tabelas (vãos e sobreposições). |
| `ferramentas/` | Scripts para gerar a planilha e os ícones. Não precisam ser publicados. |
| `capturas/` | Screenshots das telas. Não precisam ser publicados. |

Para publicar, bastam: `index.html`, `styles.css`, `app.js`, `core.js`, `sw.js`, `manifest.webmanifest` e a pasta `icones/`. Os demais arquivos não atrapalham se forem junto.

---

## 2. Publicar em HTTPS

O modo offline e a instalação **só funcionam em HTTPS**. Abrir o `index.html` direto do arquivo, por e-mail ou pelo WhatsApp não funciona. Escolha uma das opções abaixo. Todas servem arquivos estáticos e não precisam de banco de dados nem de servidor de aplicação.

### Opção A — Netlify Drop (mais rápida, sem conta técnica)

1. Descompacte o `.zip` numa pasta.
2. Acesse **https://app.netlify.com/drop** e entre com uma conta (e-mail ou Google).
3. Arraste a pasta `classificador-camarao` para a página.
4. Em segundos sai um endereço como `https://nome-aleatorio.netlify.app`. Em *Site configuration → Change site name* dá para trocar por algo como `classificador-frescatto`.
5. Para atualizar, abra o site no painel, vá em **Deploys** e arraste a pasta nova.

### Opção B — GitHub Pages (recomendada: versionada e automática)

O repositório já tem o workflow `.github/workflows/pages-classificador.yml`. Ele roda os testes do motor e publica **só os arquivos do app** em:

**https://teppeyochi-ui.github.io/app-alimentos/**

Configuração, feita uma única vez:

1. Leve o código para a branch `main` (merge do pull request).
2. No GitHub, abra o repositório e vá em **Settings → Pages**.
3. Em *Build and deployment → Source*, escolha **GitHub Actions**. Não é *Deploy from a branch*.
4. Vá em **Actions → Publicar Classificador de Camarão → Run workflow** para a primeira publicação. Depois, cada `push` na `main` que altere `classificador-camarao/` publica sozinho em 1 a 2 minutos.
5. Se o workflow falhar no passo **Testes do motor**, o site não é atualizado. A versão anterior continua no ar.

Cuidados:

- O repositório e o site são **públicos**. Qualquer pessoa com o endereço abre o app e vê as tabelas em `core.js`. As avaliações não vão para o site: ficam só no celular de cada técnico. Se as tabelas não puderem ser públicas, use a Opção C ou torne o repositório privado. Com repositório privado, o Pages só funciona em planos pagos e o site continua público, a menos que a conta seja GitHub Enterprise.
- Lembre de mudar a `VERSION` em `sw.js` a cada publicação (seção 4.2).

### Opção C — Servidor interno da Frescatto

Qualquer servidor web serve (IIS, Apache, Nginx), desde que:

1. **Use HTTPS com certificado válido** para os celulares. Certificado autoassinado não serve: o iPhone e o Android não instalam o app.
2. Sirva o tipo `application/manifest+json` para `.webmanifest`. No IIS, adicione esse *MIME type*; no Nginx, inclua em `types`.
3. Não force cache longo no `sw.js`. Use `Cache-Control: no-cache` nesse arquivo para que as atualizações cheguem.
4. Copie os arquivos para uma pasta publicada, por exemplo `https://intranet.frescatto.com.br/classificador/`.

Se o servidor só for acessível pela rede interna, os técnicos precisam estar no Wi-Fi da empresa **na primeira abertura** e nas atualizações. Depois disso, o app funciona offline.

---

## 3. Instalar no celular

Antes de levar o celular para a área de produção, abra o endereço **com internet** pelo menos uma vez e espere a tela carregar. É nesse momento que o app fica guardado para uso offline.

### Android (Chrome)

1. Abra o endereço no **Chrome**.
2. Toque em **Instalar** no cartão "Instale o app no celular" da tela Produto. Outro caminho é o menu **⋮ → Instalar app** (ou *Adicionar à tela inicial*).
3. Confirme. O ícone "Classificador" aparece na tela inicial e abre em tela cheia, sem barra do navegador.

### iPhone (Safari)

1. Abra o endereço no **Safari**. No iPhone, a instalação só funciona pelo Safari.
2. Toque no botão **Compartilhar** (quadrado com seta para cima).
3. Role a lista e toque em **Adicionar à Tela de Início**, depois em **Adicionar**.
4. Abra o app sempre pelo ícone da tela inicial.

### Cuidados com os dados

- As avaliações salvas ficam **só naquele celular**, no armazenamento do app. Elas não vão para nenhum servidor.
- **Exporte o CSV com frequência** (Histórico → *Exportar todas (CSV)*) e envie para a pasta da Qualidade. Os dados se perdem se o app for desinstalado, se o celular for trocado ou se os dados do navegador forem limpos.
- No iPhone, use sempre o app instalado. Se ele for usado só pelo Safari, sem instalar, o iOS pode apagar os dados após algumas semanas sem uso.

---

## 4. Atualizar o app (tabelas, telas ou ícones)

### 4.1 Mudar uma tabela

Todas as tabelas estão em `core.js`:

| Tabela | Onde está em `core.js` | Formato |
|---|---|---|
| Frescatto Inteiro | `FRESCATTO_INTEIRO` | `{ nome: '7/10', g: [100, 143], gCong: [120, 171], pecas: { 1000: [7, 10], 2000: [14, 20] } }` |
| Frescatto Tail on | `FRESCATTO_TAILON` | Igual à de inteiro. `g` é a faixa resfriado. |
| Frescatto DES/EVISC | `FRESCATTO_DESEVISC` | `{ nome: '31/50', g: [8, 12], pecas: { 400: [31, 50], 2000: [155, 250] } }` |
| Tabela geral | `GERAL_TEXTO` | Uma linha por classe: `classe \| 200g,400g,500g,800g,1kg,2kg,5kg` |

Em todas elas:

- `g` e `gCong` são faixas de peso em gramas por peça.
- `pecas` traz as peças por embalagem: a chave é o peso líquido em gramas e o valor é `[mínimo, máximo]`.

Na tabela geral, a faixa de peso **vem da coluna de 1 kg** (1.000 g ÷ peças). Não precisa digitá-la.

Ao alterar uma tabela, siga estes passos:

1. Edite o trecho em `core.js` e registre a origem da alteração num comentário.
2. Rode os testes:
   ```bash
   node teste-motor.js
   ```
   Se mudar o número de classes, a contagem de pontos da varredura muda. Ajuste em `teste-motor.js` o valor esperado, hoje 2.352, e os casos de referência afetados.
3. Opcional: gere de novo a planilha de testes:
   ```bash
   node teste-motor.js --json ferramentas/relatorio-testes.json
   python3 ferramentas/gerar-planilha.py ferramentas/relatorio-testes.json Teste_Classificador.xlsx
   ```
4. **Aumente a `VERSION` em `sw.js`** (veja 4.2) e publique.

As regras (escolha da tabela, tolerância de ±0,5, faixa mais estreita, glaciamento, compensação, frases da análise) também estão em `core.js`. Cada regra tem um comentário em português explicando o que aplica.

### 4.2 `VERSION` do service worker (obrigatório a cada publicação)

O app fica guardado no celular. Ele só baixa a versão nova quando percebe que o `sw.js` mudou. Por isso, **toda publicação precisa mudar a `VERSION`** no topo de `sw.js`:

```js
const VERSION = '1.0.0';   // → '1.0.1', '1.1.0', ...
```

O que acontece no celular depois disso:

1. Na próxima vez que o técnico abrir o app **com internet**, a versão nova é baixada em segundo plano e aparece o aviso "App atualizado para a versão mais recente".
2. Ao fechar e abrir o app de novo, a versão nova está em uso. O cache antigo é apagado sozinho.
3. Rascunho e histórico **não são apagados** na atualização.

Se a `VERSION` não mudar, os celulares continuam usando a versão antiga mesmo com o site atualizado.

Se você criar um arquivo novo que o app precise (por exemplo, outro ícone), inclua o caminho na lista `APP_SHELL` em `sw.js`.

### 4.3 Logo e cores da marca

- **Logo do topo:** `icones/logo-frescatto.png`. Hoje é um recorte do site, com 103×58 px. Para trocar pelo arquivo oficial, salve-o com o mesmo nome. De preferência use um PNG com cerca de 300 px de largura ou mais, para ficar nítido em telas retina.
- **Cores:** ficam no topo de `styles.css`, como variáveis. `--marca-teal` (#039FA3) é a faixa do topo e `--marca-vinho` (#AB0433) é o título e o indicador da navegação. `--prim` (#00777B) é um teal mais escuro, usado em botões e seleção porque mantém o contraste do texto branco acima de 4,5:1. Os valores do tema escuro estão logo abaixo.
- **Ícones do app:** o desenho está em `ferramentas/icone.svg`. Depois de editar, rode `node ferramentas/gerar-icones.js`.
- Mude a `VERSION` em `sw.js` depois de qualquer troca.

### 4.4 Testes antes de publicar

```bash
node teste-motor.js        # regras e tabelas: deve terminar em "0 falhas"
node teste-interface.js    # interface (precisa do Playwright e do Chromium)
```

`teste-interface.js` sobe um servidor local sozinho e percorre o fluxo completo: configura o produto, pesa 8 unidades, confere o resultado, salva, recarrega, testa offline e verifica que não há erros no console. Ele também atualiza as imagens em `capturas/`. Para instalar o Playwright numa máquina nova: `npm install playwright` e `npx playwright install chromium`.

---

## 5. Regras aplicadas (resumo)

- **Tabela usada:**
  - Rosa em Inteiro, Descascado tail on cru e Descascado cru (bloco DES/EVISC) usa a **Tabela Frescatto**.
  - Os demais casos usam a **Tabela geral**.
- **Peso líquido da peça:** peso pesado ÷ (1 + glaciamento/100). Fresco e congelado sem glaciamento usam o peso pesado direto.
- **Classe de cada unidade:**
  - vale a faixa que contém o peso;
  - se nenhuma contém, aplica-se a tolerância de ±0,5 g (Tabela Frescatto) ou ±0,5 peça na coluna de 1 kg (Tabela geral);
  - com faixas sobrepostas, vale a mais estreita;
  - se mesmo assim nenhuma couber, a unidade fica "fora da tabela", com a classe mais próxima e a indicação de acima ou abaixo.
- **Classe do lote** = classe da **média** do peso líquido.
- **Glaciamento** (IN SDA/MAPA nº 23/2019, art. 4º):
  - o limite é 20% do peso líquido declarado, e acima disso o alerta é crítico;
  - **compensada:** a faixa de peças é calculada sobre o peso declarado, e o app mostra quanto envasar em peso bruto;
  - **não compensada:** a faixa é calculada sobre o peso líquido real (declarado ÷ (1 + g)), com alerta crítico.
- **Faixa de peças:**
  - usa a coluna igual ao peso da embalagem;
  - sem essa coluna, calcula proporcional à de 1 kg (ou à coluna mais próxima), arredondando, e marca como "proporcional".
- **Achados das tabelas** (vãos, sobreposições e colunas fora de proporção) estão na aba *Achados* de `Teste_Classificador.xlsx`. Os dados foram mantidos como no documento de origem.

---

## 6. Problemas comuns

| Sintoma | Causa provável e solução |
|---|---|
| Não aparece a opção de instalar | O endereço não está em HTTPS, ou no iPhone não está aberto no Safari. |
| Abre em branco sem internet | O app nunca foi aberto com internet naquele celular. Abra uma vez com sinal. |
| Mudei a tabela e o celular não atualizou | A `VERSION` em `sw.js` não foi alterada, ou o celular ainda não abriu o app com internet. |
| Histórico sumiu | Dados do navegador limpos, app reinstalado ou outro celular. Os dados ficam só no aparelho: exporte o CSV com frequência. |
| CSV abre com acentos errados no Excel | Abra pelo Excel com *Dados → De Texto/CSV* e escolha UTF-8. O arquivo já sai com BOM, separador `;` e vírgula decimal. |
