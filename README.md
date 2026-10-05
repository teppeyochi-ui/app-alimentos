# App Alimentos — Frescatto

## Controle de Produção (`app_producao.py`)

App web para celular em que o operador lança a produção (os dados da Plan1 da
planilha CONTROLE PRODUÇÃO) direto num banco de dados, e a gestão acompanha os
mesmos indicadores da planilha.

**Para colocar no ar, siga o [GUIA_PUBLICACAO.md](GUIA_PUBLICACAO.md).**

```bash
pip install -r requirements.txt
streamlit run app_producao.py
```

### Acessos (PIN)

| PIN (secret) | Telas |
|---|---|
| `PIN_OPERADOR` | Lançar, Registros |
| `PIN_CONSULTA` | Indicadores, Registros (somente leitura) |
| `PIN_GESTOR` | Tudo, inclusive Cadastros e exclusão de lançamentos |

Sem nenhum PIN configurado (uso local), o app entra direto como gestor.

### O que o operador lança

Operador, data, turno, linha, produto (PROD_DER), molde (vem do cadastro), OP,
hora de início e término, produção (kg), passo inicial e final, parada e motivo.
O passo inicial do lançamento seguinte já vem com o passo final do anterior.

### Cálculos (iguais aos da Plan1)

| Coluna da Plan1 | Fórmula |
|---|---|
| Passo total | passo fim − passo início |
| Produção (un.) | produção kg ÷ peso líquido |
| Produção (Bdj Total) | passo total × bandejas por passo do molde (2x1 = 2, 3x1 = 3, 2x2 = 4) |
| Rendimento (máquina) | produção (un.) ÷ Bdj Total |
| Tempo de produção total | hora término − hora início (passa da meia-noite) |
| Produtividade (kg/h) | kg ÷ horas |
| Tempo por kg (min) | minutos ÷ kg |
| Consumo filme fundo / tampa | Bdj Total × filme por bandeja do molde (Planilha2) |
| FT consumo fundo / tampa | consumo de filme ÷ kg |

Produtos PDV (peso variável) ou sem molde ficam com essas colunas em branco,
como na planilha. Os totais do período são ponderados: cada razão soma só os
apontamentos que têm os dois dados.

Peso e molde são copiados para cada lançamento, então alterar o cadastro não
muda o histórico.

### Telas

- **Lançar:** formulário com os cálculos da Plan1 mostrados antes de gravar.
- **Registros:** tabela no layout da Plan1 e download em CSV (abre no Excel).
- **Indicadores:** totais do período e tabelas por produto, linha, operador e
  dia; rendimento por produto; produtividade por linha; paradas por motivo.
- **Cadastros:** produtos (Planilha3), moldes (Planilha2), linhas e operadores.

### Banco de dados

Tabelas: `linhas`, `operadores`, `moldes`, `produtos` e `apontamentos`, criadas
na primeira execução e preenchidas com `producao/dados_iniciais.json` (extraído
da planilha). Sem `DATABASE_URL`, usa SQLite local (`producao.db`), só para teste.

### Testes

Os testes conferem os cálculos com os valores das linhas reais da Plan1.

```bash
pip install pytest
python -m pytest
```

## Gestão de P&D (`app_gestao_produtos.py`)

Captura de dados de embalagens via IA (OpenAI).
