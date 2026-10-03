# App Alimentos — Frescatto

## Apontamento de Produção (`app_producao.py`)

Aplicativo web para celular em que o operador lança os dados da produção
direto no banco de dados, e a gestão acompanha produtividade e consumo.

```bash
pip install -r requirements.txt
streamlit run app_producao.py
```

No celular, abra o endereço do app no navegador e use **"Adicionar à tela
inicial"** para que ele funcione como um aplicativo.

### Telas

| Tela | Uso |
|------|-----|
| **Lançar** | Operador, data, turno, linha, produto, lote, horário de início/fim, pessoas na equipe, quantidade produzida, refugo, paradas (min + motivo), consumo de cada insumo e observações. Operador/linha/turno ficam memorizados entre lançamentos. |
| **Registros** | Lista do período com indicadores por apontamento, exportação CSV (abre direto no Excel) e exclusão de lançamentos errados. |
| **Indicadores** | Totais do período, produção diária, produtividade por linha/produto/operador, eficiência x meta, consumo específico e rendimento, paradas por motivo. |
| **Cadastros** | Linhas, produtos (unidade e meta/hora), insumos (matéria-prima, embalagem, utilidades) e operadores. Itens são desativados, nunca apagados, para preservar o histórico. |

### Indicadores calculados

- **Horas efetivas** = (fim − início) − paradas
- **Produtividade/h** = produzido ÷ horas efetivas
- **Produtividade por homem·hora** = produzido ÷ (horas efetivas × pessoas)
- **Refugo %** = refugo ÷ (produzido + refugo)
- **Disponibilidade %** = horas efetivas ÷ horas totais
- **Eficiência %** = produtividade/h ÷ meta/h do produto
- **Consumo específico** = consumo do insumo ÷ produzido (ex.: kWh/kg, caixas/kg)
- **Rendimento %** (matéria-prima) = produzido ÷ matéria-prima consumida

Os totais do período são ponderados pelo tempo (não são médias simples).

### Banco de dados

Tabelas: `linhas`, `produtos`, `insumos`, `operadores`, `apontamentos` e
`consumos` (criadas automaticamente na primeira execução).

- **Sem configuração:** SQLite local (`producao.db`) — bom para testes.
- **Produção:** configure `DATABASE_URL` apontando para um PostgreSQL
  (Supabase, Neon, Azure, AWS RDS ou servidor interno), via variável de
  ambiente ou `.streamlit/secrets.toml` (veja `secrets.toml.example`). Os
  dados ficam centralizados e podem ser lidos por Power BI/Excel.

> No Streamlit Community Cloud o disco é apagado a cada reinício, então lá é
> obrigatório usar um PostgreSQL externo.

Para restringir o acesso, defina `APP_PIN` nos secrets.

### Testes

```bash
pip install pytest
python -m pytest
```

## Gestão de P&D (`app_gestao_produtos.py`)

Captura de dados de embalagens via IA (OpenAI).
