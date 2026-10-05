"""App de apontamento de produção (Plan1 - CONTROLE PRODUÇÃO).

Executar:  streamlit run app_producao.py

Acesso por PIN (configurado nos secrets do Streamlit):
    PIN_OPERADOR  -> Lançar e Registros
    PIN_CONSULTA  -> Registros e Indicadores (somente leitura)
    PIN_GESTOR    -> tudo, inclusive Cadastros e exclusão de lançamentos
Sem nenhum PIN configurado (uso local), entra direto como gestor.
"""
import hmac
import os
from datetime import date, datetime, timedelta

import pandas as pd
import streamlit as st
from sqlalchemy.exc import IntegrityError

from producao.database import (
    TURNOS, Linha, Molde, Operador, Produto, criar_engine, criar_sessao,
    popular_dados_iniciais,
)
from producao.servicos import (
    ErroValidacao, agrupar, calcular, carregar_apontamentos, combinar_horarios,
    excluir_apontamento, formatar_hm, listar_cadastro, resumo,
    salvar_apontamento, salvar_cadastro, tabela_plan1,
)

st.set_page_config(
    page_title="Controle de Produção", page_icon="🏭",
    layout="centered", initial_sidebar_state="collapsed",
)

# Botões e campos maiores para uso com o dedo no celular
st.markdown("""
    <style>
    .stButton button, .stDownloadButton button, .stFormSubmitButton button {
        width: 100%; border-radius: 12px; min-height: 3.2em; font-size: 1.05rem;
    }
    input { font-size: 1.05rem !important; }
    [data-testid="stMetricValue"] { font-size: 1.6rem; }
    </style>
""", unsafe_allow_html=True)

MOTIVOS_PARADA = [
    "Falta de matéria-prima", "Manutenção corretiva", "Setup / troca de produto",
    "Troca de filme", "Limpeza / higienização", "Falta de pessoal", "Falta de energia",
]
PAPEIS = {
    "PIN_OPERADOR": "operador",
    "PIN_CONSULTA": "consulta",
    "PIN_GESTOR": "gestor",
    "APP_PIN": "gestor",  # nome antigo, mantido por compatibilidade
}


def ler_secret(nome):
    try:
        valor = st.secrets.get(nome)
    except Exception:  # sem arquivo de secrets (uso local)
        valor = None
    return valor or os.environ.get(nome)


@st.cache_resource
def obter_sessao():
    url = ler_secret("DATABASE_URL")
    if url:
        os.environ["DATABASE_URL"] = url
    Sessao = criar_sessao(criar_engine())
    popular_dados_iniciais(Sessao)
    return Sessao


Sessao = obter_sessao()


# --------------------------------------------------------------------------
# Formatação pt-BR
# --------------------------------------------------------------------------
def nf(valor, casas=1):
    if valor is None or pd.isna(valor):
        return "–"
    return f"{valor:,.{casas}f}".replace(",", "X").replace(".", ",").replace("X", ".")


def pct(valor):
    return "–" if valor is None or pd.isna(valor) else nf(valor * 100, 1) + "%"


# --------------------------------------------------------------------------
# Acesso
# --------------------------------------------------------------------------
def papel_atual():
    pins = {k: str(v) for k in PAPEIS if (v := ler_secret(k))}
    if not pins:
        return "gestor"
    if papel := st.session_state.get("papel"):
        return papel

    st.title("🏭 Controle de Produção")
    tentativas = st.session_state.get("tentativas", 0)
    if tentativas >= 5:
        st.error("Muitas tentativas erradas. Feche e abra o app de novo.")
        st.stop()
    with st.form("login"):
        digitado = st.text_input("PIN de acesso", type="password")
        entrar = st.form_submit_button("Entrar", type="primary")
    if entrar:
        for chave, pin in pins.items():
            if hmac.compare_digest(digitado.strip(), pin):
                st.session_state.papel = PAPEIS[chave]
                st.rerun()
        st.session_state.tentativas = tentativas + 1
        st.error("PIN incorreto.")
    st.stop()


def turno_atual():
    hora = datetime.now().hour
    if 6 <= hora < 14:
        return TURNOS[0]
    if 14 <= hora < 22:
        return TURNOS[1]
    return TURNOS[2]


def filtro_periodo(key):
    hoje = date.today()
    periodo = st.date_input(
        "Período", (hoje - timedelta(days=6), hoje), format="DD/MM/YYYY", key=key,
    )
    if isinstance(periodo, (tuple, list)) and len(periodo) == 2:
        return periodo
    st.info("Selecione a data final do período.")
    st.stop()


def mostrar_calculos(r):
    """Mostra os cálculos da Plan1 de um apontamento (dicionário com as colunas)."""
    c1, c2, c3 = st.columns(3)
    c1.metric("Passo total", nf(r["passo_total"], 0))
    c2.metric("Bdj total", nf(r["bdj_total"], 0))
    c3.metric("Produção (un.)", nf(r["producao_un"], 0))
    c1, c2, c3 = st.columns(3)
    c1.metric("Rendimento", pct(r["rendimento"]))
    c2.metric("kg/h", nf(r["kg_h"]))
    c3.metric("min/kg", nf(r["min_kg"], 2))
    c1, c2, c3 = st.columns(3)
    c1.metric("Tempo", formatar_hm(r["tempo_min"]) or "–")
    c2.metric("Filme fundo (kg)", nf(r["filme_fundo"], 2))
    c3.metric("Filme tampa (kg)", nf(r["filme_tampa"], 2))


# --------------------------------------------------------------------------
# Página: Lançar
# --------------------------------------------------------------------------
def pagina_lancamento():
    st.title("📝 Lançar produção")

    if msg := st.session_state.pop("msg_sucesso", None):
        st.success(msg)

    linhas = listar_cadastro(Sessao, Linha)
    operadores = listar_cadastro(Sessao, Operador)
    produtos = listar_cadastro(Sessao, Produto)
    moldes = listar_cadastro(Sessao, Molde)
    if not (linhas and operadores and produtos):
        st.warning("Cadastre linhas, operadores e produtos antes de lançar.")
        return

    # Campos com sufixo de versão são limpos depois de cada gravação;
    # operador, data, turno e linha ficam para o próximo lançamento.
    v = st.session_state.setdefault("versao_form", 0)
    op_nomes = {o.id: o.nome for o in operadores}
    lin_nomes = {l.id: l.nome for l in linhas}
    prods = {p.id: p for p in produtos}
    mol = {m.id: m for m in moldes}

    st.subheader("Identificação")
    operador_id = st.selectbox("Operador", list(op_nomes), format_func=op_nomes.get,
                               index=None, placeholder="Selecione...", key="operador")
    c1, c2 = st.columns(2)
    dia = c1.date_input("Data", date.today(), format="DD/MM/YYYY", key="data")
    turno = c2.selectbox("Turno", TURNOS, index=TURNOS.index(turno_atual()), key="turno")
    linha_id = st.selectbox("Linha", list(lin_nomes), format_func=lin_nomes.get,
                            index=None, placeholder="Selecione...", key="linha")
    produto_id = st.selectbox(
        "Produto (PROD_DER)", list(prods),
        format_func=lambda i: f"{prods[i].codigo} · {prods[i].descricao}",
        index=None, placeholder="Digite o código ou parte da descrição", key=f"produto_{v}",
    )
    produto = prods.get(produto_id)
    if produto:
        peso = (f"{nf(produto.peso, 3)} kg por bandeja" if produto.peso
                else "PDV (peso variável): produção em unidades e rendimento ficam em branco" if produto.pdv
                else "sem peso no cadastro: produção em unidades e rendimento ficam em branco")
        st.caption(f"**{produto.descricao}** · {produto.desder} · Peso líquido: {peso}")

    c1, c2 = st.columns(2)
    opcoes_molde = [None, *mol]
    molde_id = c1.selectbox(
        "Molde", opcoes_molde,
        index=opcoes_molde.index(produto.molde_id) if produto and produto.molde_id in mol else 0,
        format_func=lambda i: mol[i].nome if i else "Sem molde",
        key=f"molde_{v}_{produto_id}",  # volta ao molde do cadastro ao trocar de produto
        help="Vem do cadastro do produto. Sem molde, Bdj total, rendimento e filme ficam em branco.",
    )
    op = c2.text_input("OP", key=f"op_{v}")

    st.subheader("Horário")
    c1, c2 = st.columns(2)
    agora = datetime.now().replace(second=0, microsecond=0)
    inicio = c1.time_input("Hora início", st.session_state.get("proximo_inicio", (agora - timedelta(hours=1)).time()),
                           step=300, key=f"inicio_{v}")
    fim = c2.time_input("Hora término", agora.time(), step=300, key=f"fim_{v}")

    st.subheader("Produção")
    producao = st.number_input("Produção (kg)", min_value=0.0, step=1.0, value=None,
                               placeholder="0", key=f"kg_{v}")
    c1, c2 = st.columns(2)
    passo_ini = c1.number_input("Passo inicial", min_value=0.0, step=1.0, format="%.0f",
                                value=st.session_state.get("proximo_passo"), placeholder="0", key=f"pi_{v}")
    passo_fim = c2.number_input("Passo final", min_value=0.0, step=1.0, format="%.0f",
                                value=None, placeholder="0", key=f"pf_{v}")
    c1, c2 = st.columns(2)
    parada = c1.number_input("Parada (min)", min_value=0.0, step=5.0, key=f"parada_{v}")
    motivo = c2.selectbox("Motivo da parada", MOTIVOS_PARADA, index=None, accept_new_options=True,
                          placeholder="Escolha ou digite", disabled=parada == 0, key=f"motivo_{v}")
    obs = st.text_area("Observações", key=f"obs_{v}", height=80)

    hora_inicio, hora_fim = combinar_horarios(dia, inicio, fim)
    if producao and passo_ini is not None and passo_fim is not None and produto:
        prev = pd.DataFrame([{
            "passo_inicial": passo_ini, "passo_final": passo_fim, "producao_kg": producao,
            "peso_liquido": produto.peso, "cavidades": mol[molde_id].cavidades if molde_id else None,
            "fundo_un": mol[molde_id].fundo_un if molde_id else None,
            "tampa_un": mol[molde_id].tampa_un if molde_id else None,
            "hora_inicio": hora_inicio, "hora_fim": hora_fim,
        }])
        with st.container(border=True):
            st.caption("Cálculos da Plan1 para este lançamento")
            mostrar_calculos(calcular(prev).iloc[0])

    if st.button("💾 Gravar apontamento", type="primary"):
        try:
            novo_id = salvar_apontamento(Sessao, {
                "data": dia, "turno": turno, "linha_id": linha_id,
                "operador_id": operador_id, "produto_id": produto_id, "molde_id": molde_id,
                "op": op.strip() or None, "hora_inicio": hora_inicio, "hora_fim": hora_fim,
                "passo_inicial": passo_ini, "passo_final": passo_fim, "producao_kg": producao,
                "parada_min": parada, "motivo_parada": motivo if parada else None,
                "observacoes": obs.strip() or None,
            })
        except ErroValidacao as e:
            st.error(str(e))
        except Exception as e:  # falha de conexão/gravação no banco
            st.error(f"Não foi possível gravar no banco de dados: {e}")
        else:
            st.session_state.msg_sucesso = f"Apontamento nº {novo_id} gravado: {nf(producao)} kg de {produto.descricao}."
            st.session_state.versao_form = v + 1
            st.session_state.proximo_passo = passo_fim   # próximo começa onde este terminou
            st.session_state.proximo_inicio = fim
            st.rerun()


# --------------------------------------------------------------------------
# Página: Registros
# --------------------------------------------------------------------------
def pagina_registros():
    st.title("📋 Registros")
    inicio, fim = filtro_periodo("periodo_registros")
    df = carregar_apontamentos(Sessao, inicio, fim)
    if df.empty:
        st.info("Nenhum apontamento no período.")
        return

    tabela = tabela_plan1(df)
    tabela.insert(0, "Nº", df["id"].values)
    st.dataframe(
        tabela, hide_index=True, width="stretch",
        column_config={
            "Rendimento (máquina)": st.column_config.NumberColumn(format="percent"),
            "Produtividade (kg/h)": st.column_config.NumberColumn(format="%.1f"),
            "Tempo por kg (min)": st.column_config.NumberColumn(format="%.2f"),
            "Produção (un.)": st.column_config.NumberColumn(format="%.0f"),
            "Consumo filme fundo": st.column_config.NumberColumn(format="%.2f"),
            "Consumo Filme Tampa": st.column_config.NumberColumn(format="%.2f"),
            "FT consumo Fundo": st.column_config.NumberColumn(format="%.4f"),
            "FT consumo tampa": st.column_config.NumberColumn(format="%.4f"),
        },
    )
    st.download_button(
        "📥 Baixar no formato da Plan1 (CSV)",
        tabela.drop(columns="Nº").to_csv(index=False, sep=";", decimal=",").encode("utf-8-sig"),
        f"controle_producao_{inicio}_{fim}.csv", "text/csv",
    )

    if st.session_state.get("papel_pagina") == "gestor":
        with st.expander("🗑️ Excluir apontamento lançado errado"):
            descricoes = {
                r.id: f"Nº {r.id} · {r.data:%d/%m} · {r.descricao} · {r.operador}"
                for r in df.itertuples()
            }
            apont_id = st.selectbox("Apontamento", list(descricoes), format_func=descricoes.get,
                                    index=None, placeholder="Selecione o nº...")
            confirmar = st.checkbox("Confirmo a exclusão", disabled=apont_id is None)
            if st.button("Excluir", disabled=not confirmar):
                excluir_apontamento(Sessao, apont_id)
                st.success(f"Apontamento nº {apont_id} excluído.")
                st.rerun()


# --------------------------------------------------------------------------
# Página: Indicadores
# --------------------------------------------------------------------------
COLUNAS_RESUMO = {
    "producao_kg": ("Produção (kg)", "%.1f"), "passo_total": ("Passo total", "%.0f"),
    "producao_un": ("Produção (un.)", "%.0f"), "bdj_total": ("Bdj total", "%.0f"),
    "rendimento": ("Rendimento", "percent"), "kg_h": ("kg/h", "%.1f"),
    "min_kg": ("min/kg", "%.2f"), "filme_fundo": ("Filme fundo (kg)", "%.2f"),
    "filme_tampa": ("Filme tampa (kg)", "%.2f"), "ft_fundo": ("FT fundo", "%.4f"),
    "ft_tampa": ("FT tampa", "%.4f"), "apontamentos": ("Apontamentos", "%d"),
}


def tabela_resumo(df, por, rotulo):
    g = agrupar(df, por).sort_values("producao_kg", ascending=False)
    colunas = [*([por] if isinstance(por, str) else por), *COLUNAS_RESUMO]
    config = {k: st.column_config.NumberColumn(n, format=f) for k, (n, f) in COLUNAS_RESUMO.items()}
    config.update(rotulo)
    st.dataframe(g[colunas], hide_index=True, width="stretch", column_config=config)
    return g


def pagina_indicadores():
    st.title("📊 Indicadores")
    inicio, fim = filtro_periodo("periodo_indicadores")
    df = carregar_apontamentos(Sessao, inicio, fim)
    if df.empty:
        st.info("Nenhum apontamento no período.")
        return

    c1, c2 = st.columns(2)
    f_linhas = c1.multiselect("Linhas", sorted(df["linha"].unique()))
    f_produtos = c2.multiselect("Produtos", sorted(df["descricao"].unique()))
    if f_linhas:
        df = df[df["linha"].isin(f_linhas)]
    if f_produtos:
        df = df[df["descricao"].isin(f_produtos)]
    if df.empty:
        st.info("Nenhum apontamento para os filtros escolhidos.")
        return

    t = resumo(df)
    st.subheader("Produção")
    c1, c2, c3 = st.columns(3)
    c1.metric("Produção (kg)", nf(t["producao_kg"]))
    c2.metric("Produção (un.)", nf(t["producao_un"], 0))
    c3.metric("Bdj total", nf(t["bdj_total"], 0))
    c1, c2, c3 = st.columns(3)
    c1.metric("Rendimento da máquina", pct(t["rendimento"]))
    c2.metric("Passo total", nf(t["passo_total"], 0))
    c3.metric("Apontamentos", t["apontamentos"])
    st.subheader("Tempo")
    c1, c2, c3 = st.columns(3)
    c1.metric("Produtividade (kg/h)", nf(t["kg_h"]))
    c2.metric("Tempo por kg (min)", nf(t["min_kg"], 2))
    c3.metric("Paradas (h:mm)", formatar_hm(t["parada_min"]) or "0:00")
    st.subheader("Consumo de filme")
    c1, c2, c3 = st.columns(3)
    c1.metric("Filme fundo (kg)", nf(t["filme_fundo"], 2))
    c2.metric("Filme tampa (kg)", nf(t["filme_tampa"], 2))
    c3.metric("FT total (kg/kg)", nf(t["ft_fundo"] + t["ft_tampa"], 4))
    st.caption(
        "Totais ponderados: cada razão soma só os apontamentos que têm os dois dados "
        "(produtos PDV ou sem molde ficam fora do rendimento e do filme). "
        "FT = kg de filme por kg produzido."
    )

    aba_prod, aba_linha, aba_oper, aba_dia, aba_par = st.tabs(
        ["Por produto", "Por linha", "Por operador", "Por dia", "Paradas"])
    with aba_prod:
        g = tabela_resumo(df, ["codigo", "descricao"], {
            "codigo": st.column_config.TextColumn("PROD_DER"),
            "descricao": st.column_config.TextColumn("DESPRO")})
        rend = g.dropna(subset=["rendimento"])
        if not rend.empty:
            st.markdown("**Rendimento da máquina por produto (%)**")
            st.bar_chart(rend.assign(rendimento=rend["rendimento"] * 100),
                         x="descricao", y="rendimento", horizontal=True, x_label="Rendimento (%)", y_label="")
    with aba_linha:
        g = tabela_resumo(df, "linha", {"linha": st.column_config.TextColumn("Linha")})
        st.markdown("**Produtividade por linha (kg/h)**")
        st.bar_chart(g, x="linha", y="kg_h", x_label="", y_label="kg/h")
    with aba_oper:
        tabela_resumo(df, "operador", {"operador": st.column_config.TextColumn("Operador")})
    with aba_dia:
        g = tabela_resumo(df, "data", {"data": st.column_config.DateColumn("Data", format="DD/MM/YYYY")})
        st.markdown("**Produção por dia (kg)**")
        st.bar_chart(g.sort_values("data"), x="data", y="producao_kg", x_label="", y_label="kg")
    with aba_par:
        paradas = df[df["parada_min"] > 0]
        if paradas.empty:
            st.info("Nenhuma parada registrada no período.")
        else:
            por_motivo = (paradas.fillna({"motivo_parada": "Não informado"})
                          .groupby("motivo_parada")["parada_min"].sum().sort_values(ascending=False))
            st.bar_chart(por_motivo, horizontal=True, x_label="Minutos", y_label="")
            st.dataframe(por_motivo.rename("Minutos").reset_index().rename(columns={"motivo_parada": "Motivo"}),
                         hide_index=True, width="stretch")


# --------------------------------------------------------------------------
# Página: Cadastros
# --------------------------------------------------------------------------
def pagina_cadastros():
    st.title("⚙️ Cadastros")
    st.caption(
        "Adicione itens na última linha da tabela e toque em Salvar. Para retirar um item de uso, "
        "desmarque **Ativo** (o histórico é preservado). Mudar peso ou molde vale para os próximos "
        "lançamentos; os já gravados mantêm os valores da época."
    )
    moldes = listar_cadastro(Sessao, Molde, somente_ativos=False)
    nomes_moldes = [m.nome for m in moldes if m.ativo]

    aba_p, aba_m, aba_l, aba_o = st.tabs(["Produtos", "Moldes", "Linhas", "Operadores"])
    with aba_p:
        produtos = listar_cadastro(Sessao, Produto, somente_ativos=False)
        busca = st.text_input("Filtrar por código ou descrição", key="busca_prod")
        df = pd.DataFrame([{
            "id": p.id, "codigo": p.codigo, "descricao": p.descricao, "desder": p.desder,
            "setor": p.setor, "peso": p.peso, "pdv": p.pdv,
            "molde": p.molde.nome if p.molde else None, "ativo": p.ativo,
        } for p in produtos])
        if busca:
            termo = busca.lower()
            df = df[df["codigo"].str.lower().str.contains(termo, regex=False)
                    | df["descricao"].str.lower().str.contains(termo, regex=False)]
        editor_cadastro(Produto, df, "produtos", {
            "codigo": st.column_config.TextColumn("PROD_DER", required=True),
            "descricao": st.column_config.TextColumn("DESPRO"),
            "desder": st.column_config.TextColumn("DESDER"),
            "setor": st.column_config.TextColumn("Setor"),
            "peso": st.column_config.NumberColumn("Peso líquido (kg)", min_value=0, format="%.3f"),
            "pdv": st.column_config.CheckboxColumn("PDV", default=False),
            "molde": st.column_config.SelectboxColumn("Molde", options=nomes_moldes),
        })
    with aba_m:
        df = pd.DataFrame([{"id": m.id, "nome": m.nome, "cavidades": m.cavidades,
                            "fundo_un": m.fundo_un, "tampa_un": m.tampa_un, "ativo": m.ativo} for m in moldes])
        editor_cadastro(Molde, df, "moldes", {
            "nome": st.column_config.TextColumn("Molde", required=True),
            "cavidades": st.column_config.NumberColumn("Bandejas por passo", min_value=1, step=1, required=True),
            "fundo_un": st.column_config.NumberColumn("Filme fundo por bdj (kg)", min_value=0, format="%.6f", required=True),
            "tampa_un": st.column_config.NumberColumn("Filme tampa por bdj (kg)", min_value=0, format="%.6f", required=True),
        })
    for aba, modelo, chave, rotulo in ((aba_l, Linha, "linhas", "Linha"), (aba_o, Operador, "operadores", "Operador")):
        with aba:
            itens = listar_cadastro(Sessao, modelo, somente_ativos=False)
            df = pd.DataFrame([{"id": i.id, "nome": i.nome, "ativo": i.ativo} for i in itens],
                              columns=["id", "nome", "ativo"])
            editor_cadastro(modelo, df, chave, {"nome": st.column_config.TextColumn(rotulo, required=True)})


def editor_cadastro(modelo, df, chave, config):
    config = {"id": None, "ativo": st.column_config.CheckboxColumn("Ativo", default=True), **config}
    editado = st.data_editor(df, column_config=config, num_rows="add", hide_index=True,
                             width="stretch", key=f"editor_{chave}")
    if st.button("Salvar", key=f"salvar_{chave}"):
        try:
            salvar_cadastro(Sessao, modelo, editado)
        except IntegrityError:
            st.error("Já existe um item com esse nome ou código.")
        else:
            st.success("Cadastro atualizado.")
            st.rerun()


# --------------------------------------------------------------------------
papel = papel_atual()
st.session_state.papel_pagina = papel
lancar = st.Page(pagina_lancamento, title="Lançar", icon="📝", url_path="lancar")
registros = st.Page(pagina_registros, title="Registros", icon="📋", url_path="registros")
indicadores = st.Page(pagina_indicadores, title="Indicadores", icon="📊", url_path="indicadores")
cadastros = st.Page(pagina_cadastros, title="Cadastros", icon="⚙️", url_path="cadastros")
paginas = {
    "operador": [lancar, registros],
    "consulta": [indicadores, registros],
    "gestor": [lancar, registros, indicadores, cadastros],
}[papel]
if any(ler_secret(k) for k in PAPEIS):
    with st.sidebar:
        st.caption(f"Acesso: **{papel}**")
        if st.button("🚪 Sair"):
            st.session_state.pop("papel", None)
            st.rerun()
st.navigation(paginas, position="top").run()
