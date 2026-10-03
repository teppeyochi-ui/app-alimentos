"""App mobile de apontamento de produção (produtividade e consumo).

Executar:  streamlit run app_producao.py
"""
import os
from datetime import date, datetime, timedelta

import pandas as pd
import streamlit as st
from sqlalchemy.exc import IntegrityError

from producao.database import (
    TIPOS_INSUMO, TURNOS, Insumo, Linha, Operador, Produto,
    criar_engine, criar_sessao, popular_dados_iniciais,
)
from producao.servicos import (
    ErroValidacao, agrupar_produtividade, carregar_apontamentos,
    carregar_consumos, combinar_horarios, consumo_especifico,
    excluir_apontamento, listar_cadastro, resumo_geral, salvar_apontamento,
    salvar_cadastro,
)

st.set_page_config(
    page_title="Apontamento de Produção", page_icon="🏭",
    layout="centered", initial_sidebar_state="collapsed",
)

# Botões e campos maiores para uso com o dedo no celular
st.markdown("""
    <style>
    .stButton button, .stDownloadButton button {
        width: 100%; border-radius: 12px; height: 3.2em; font-size: 1.05rem;
    }
    input { font-size: 1.05rem !important; }
    </style>
""", unsafe_allow_html=True)


def ler_secret(nome):
    try:
        return st.secrets.get(nome)
    except FileNotFoundError:
        return None


@st.cache_resource
def obter_sessao():
    url = ler_secret("DATABASE_URL")
    if url:
        os.environ["DATABASE_URL"] = url
    Sessao = criar_sessao(criar_engine())
    popular_dados_iniciais(Sessao)
    return Sessao


Sessao = obter_sessao()


def verificar_acesso():
    """Se APP_PIN estiver configurado nos secrets, exige o PIN para entrar."""
    pin = ler_secret("APP_PIN")
    if not pin or st.session_state.get("autenticado"):
        return True
    st.title("🏭 Apontamento de Produção")
    digitado = st.text_input("PIN de acesso", type="password")
    if st.button("Entrar"):
        if digitado == str(pin):
            st.session_state.autenticado = True
            st.rerun()
        st.error("PIN incorreto.")
    return False


def turno_atual():
    hora = datetime.now().hour
    if 6 <= hora < 14:
        return TURNOS[0]
    if 14 <= hora < 22:
        return TURNOS[1]
    return TURNOS[2]


def seletor(rotulo, itens, key):
    """Selectbox de cadastros que devolve o id do item escolhido."""
    opcoes = {i.id: i.nome for i in itens}
    return st.selectbox(
        rotulo, list(opcoes), format_func=opcoes.get, key=key,
        index=None, placeholder="Selecione...",
    )


def filtro_periodo(key):
    hoje = date.today()
    periodo = st.date_input(
        "Período", (hoje - timedelta(days=6), hoje), format="DD/MM/YYYY", key=key,
    )
    if isinstance(periodo, (tuple, list)) and len(periodo) == 2:
        return periodo
    st.info("Selecione a data final do período.")
    st.stop()


# --------------------------------------------------------------------------
# Página: Lançar produção
# --------------------------------------------------------------------------
def pagina_lancamento():
    st.title("📝 Lançar Produção")

    if msg := st.session_state.pop("msg_sucesso", None):
        st.success(msg)

    linhas = listar_cadastro(Sessao, Linha)
    produtos = listar_cadastro(Sessao, Produto)
    operadores = listar_cadastro(Sessao, Operador)
    insumos = listar_cadastro(Sessao, Insumo)

    if not (linhas and produtos and operadores):
        st.warning("Cadastre linhas, produtos e operadores na aba Cadastros.")
        return

    # Campos "fixos" (mantidos entre lançamentos) e campos do registro, que
    # recebem um sufixo de versão para serem limpos após cada gravação.
    v = st.session_state.setdefault("versao_form", 0)

    st.subheader("Identificação")
    operador_id = seletor("Operador", operadores, "operador")
    c1, c2 = st.columns(2)
    dia = c1.date_input("Data", date.today(), format="DD/MM/YYYY", key="data")
    turno = c2.selectbox("Turno", TURNOS, index=TURNOS.index(turno_atual()), key="turno")
    linha_id = seletor("Linha / Setor", linhas, "linha")
    produto_id = seletor("Produto", produtos, f"produto_{v}")
    lote = st.text_input("Lote / OP (opcional)", key=f"lote_{v}")

    unidade = next((p.unidade for p in produtos if p.id == produto_id), "")

    st.subheader("Tempo e equipe")
    c1, c2 = st.columns(2)
    agora = datetime.now().replace(second=0, microsecond=0)
    inicio = c1.time_input(
        "Início", (agora - timedelta(hours=1)).time(), step=300, key=f"inicio_{v}",
    )
    fim = c2.time_input("Fim", agora.time(), step=300, key=f"fim_{v}")
    pessoas = st.number_input("Pessoas na equipe", 1, 200, 1, key="pessoas")

    st.subheader("Produção")
    c1, c2 = st.columns(2)
    produzido = c1.number_input(
        f"Produzido ({unidade or 'qtd'})", 0.0, step=1.0, key=f"produzido_{v}",
    )
    refugo = c2.number_input(
        f"Refugo / perda ({unidade or 'qtd'})", 0.0, step=1.0, key=f"refugo_{v}",
    )
    c1, c2 = st.columns(2)
    parada = c1.number_input("Paradas (min)", 0.0, step=5.0, key=f"parada_{v}")
    motivo = c2.text_input("Motivo da parada", key=f"motivo_{v}", disabled=parada == 0)

    consumos = []
    with st.expander("⚖️ Consumo de insumos", expanded=True):
        st.caption("Deixe em zero os itens que não foram usados.")
        for ins in insumos:
            qtd = st.number_input(
                f"{ins.nome} ({ins.unidade})", 0.0, step=1.0, key=f"ins_{ins.id}_{v}",
            )
            consumos.append({"insumo_id": ins.id, "quantidade": qtd})

    obs = st.text_area("Observações", key=f"obs_{v}", height=80)

    if st.button("💾 Gravar apontamento", type="primary"):
        hora_inicio, hora_fim = combinar_horarios(dia, inicio, fim)
        try:
            novo_id = salvar_apontamento(Sessao, {
                "data": dia, "turno": turno, "linha_id": linha_id,
                "produto_id": produto_id, "operador_id": operador_id,
                "lote": lote.strip() or None,
                "hora_inicio": hora_inicio, "hora_fim": hora_fim,
                "pessoas": int(pessoas), "quantidade_produzida": produzido,
                "quantidade_refugo": refugo, "tempo_parada_min": parada,
                "motivo_parada": (motivo.strip() or None) if parada else None,
                "observacoes": obs.strip() or None, "consumos": consumos,
            })
        except ErroValidacao as e:
            st.error(str(e))
        except Exception as e:  # falha de conexão/gravação no banco
            st.error(f"Não foi possível gravar no banco de dados: {e}")
        else:
            st.session_state.msg_sucesso = f"Apontamento nº {novo_id} gravado com sucesso!"
            st.session_state.versao_form = v + 1
            st.rerun()


# --------------------------------------------------------------------------
# Página: Registros
# --------------------------------------------------------------------------
COLUNAS_REGISTROS = {
    "id": "Nº", "data": "Data", "turno": "Turno", "linha": "Linha",
    "produto": "Produto", "operador": "Operador", "lote": "Lote",
    "quantidade_produzida": "Produzido", "unidade": "Un.",
    "quantidade_refugo": "Refugo", "horas_efetivas": "Horas efetivas",
    "tempo_parada_min": "Parada (min)", "motivo_parada": "Motivo parada",
    "pessoas": "Pessoas", "produtividade_hora": "Prod./h",
    "produtividade_homem_hora": "Prod./homem·h", "refugo_pct": "Refugo %",
    "eficiencia_pct": "Eficiência %", "observacoes": "Observações",
}


def pagina_registros():
    st.title("📋 Registros")
    inicio, fim = filtro_periodo("periodo_registros")
    df = carregar_apontamentos(Sessao, inicio, fim)
    if df.empty:
        st.info("Nenhum apontamento no período.")
        return

    tabela = df[list(COLUNAS_REGISTROS)].rename(columns=COLUNAS_REGISTROS)
    st.dataframe(tabela, hide_index=True, use_container_width=True)

    consumos = carregar_consumos(Sessao, inicio, fim)
    c1, c2 = st.columns(2)
    c1.download_button(
        "📥 Apontamentos (CSV)",
        tabela.to_csv(index=False, sep=";", decimal=",").encode("utf-8-sig"),
        f"apontamentos_{inicio}_{fim}.csv", "text/csv",
    )
    c2.download_button(
        "📥 Consumos (CSV)",
        consumos.to_csv(index=False, sep=";", decimal=",").encode("utf-8-sig"),
        f"consumos_{inicio}_{fim}.csv", "text/csv",
    )

    with st.expander("🗑️ Excluir apontamento lançado errado"):
        descricoes = {
            r.id: f"Nº {r.id} · {r.data:%d/%m} · {r.produto} · {r.operador}"
            for r in df.itertuples()
        }
        apont_id = st.selectbox(
            "Apontamento", list(descricoes), format_func=descricoes.get,
            index=None, placeholder="Selecione o nº...",
        )
        confirmar = st.checkbox("Confirmo a exclusão", disabled=apont_id is None)
        if st.button("Excluir", disabled=not confirmar):
            excluir_apontamento(Sessao, apont_id)
            st.success(f"Apontamento nº {apont_id} excluído.")
            st.rerun()


# --------------------------------------------------------------------------
# Página: Indicadores
# --------------------------------------------------------------------------
def pagina_indicadores():
    st.title("📊 Indicadores")
    inicio, fim = filtro_periodo("periodo_indicadores")
    df = carregar_apontamentos(Sessao, inicio, fim)
    if df.empty:
        st.info("Nenhum apontamento no período.")
        return

    c1, c2 = st.columns(2)
    f_linhas = c1.multiselect("Linhas", sorted(df["linha"].unique()))
    f_produtos = c2.multiselect("Produtos", sorted(df["produto"].unique()))
    if f_linhas:
        df = df[df["linha"].isin(f_linhas)]
    if f_produtos:
        df = df[df["produto"].isin(f_produtos)]
    if df.empty:
        st.info("Nenhum apontamento para os filtros escolhidos.")
        return

    unidades = df["unidade"].unique()
    if len(unidades) > 1:
        st.warning(
            "Há produtos com unidades diferentes no filtro "
            f"({', '.join(unidades)}); os totais somam unidades distintas."
        )

    r = resumo_geral(df)
    fmt = lambda x, d=1: f"{x:,.{d}f}".replace(",", "X").replace(".", ",").replace("X", ".")
    c1, c2, c3 = st.columns(3)
    c1.metric("Produzido", fmt(r["produzido"], 0))
    c2.metric("Produtividade /h", fmt(r["produtividade_hora"]))
    c3.metric("Por homem·hora", fmt(r["produtividade_homem_hora"]))
    c1, c2, c3 = st.columns(3)
    c1.metric("Refugo", f"{fmt(r['refugo_pct'])}%")
    c2.metric("Disponibilidade", f"{fmt(r['disponibilidade_pct'])}%")
    c3.metric("Horas paradas", fmt(r["horas_parada"]))

    aba_prod, aba_cons, aba_par = st.tabs(["Produtividade", "Consumo", "Paradas"])

    with aba_prod:
        st.markdown("**Produção diária**")
        diario = df.groupby(["data", "produto"])["quantidade_produzida"].sum().unstack()
        st.bar_chart(diario)

        st.markdown("**Por linha**")
        por_linha = agrupar_produtividade(df, "linha")
        st.bar_chart(por_linha, x="linha", y="produtividade_hora")
        st.dataframe(por_linha, hide_index=True, use_container_width=True)

        st.markdown("**Por produto** (eficiência = produtividade real ÷ meta)")
        por_produto = agrupar_produtividade(df, "produto")
        metas = df.groupby("produto")["meta_hora"].first()
        por_produto["meta_hora"] = por_produto["produto"].map(metas)
        por_produto["eficiencia_pct"] = (
            por_produto["produtividade_hora"] / por_produto["meta_hora"] * 100
        ).round(1)
        st.dataframe(por_produto, hide_index=True, use_container_width=True)

        st.markdown("**Por operador**")
        st.dataframe(
            agrupar_produtividade(df, "operador"), hide_index=True,
            use_container_width=True,
        )

    with aba_cons:
        consumos = carregar_consumos(Sessao, inicio, fim)
        consumos = consumos[consumos["apontamento_id"].isin(df["id"])]
        if consumos.empty:
            st.info("Nenhum consumo registrado no período.")
        else:
            st.caption(
                "Consumo por unidade produzida. Para matéria-prima, o rendimento "
                "indica quanto do insumo virou produto."
            )
            st.dataframe(
                consumo_especifico(consumos).rename(columns={
                    "produto": "Produto", "insumo": "Insumo", "tipo": "Tipo",
                    "unidade_insumo": "Un.", "quantidade": "Consumo total",
                    "produzido": "Produzido", "consumo_por_unidade": "Consumo / un. produzida",
                    "rendimento_pct": "Rendimento %",
                }),
                hide_index=True, use_container_width=True,
            )
            st.markdown("**Consumo total por insumo**")
            st.bar_chart(consumos.groupby("insumo")["quantidade"].sum())

    with aba_par:
        paradas = df[df["tempo_parada_min"] > 0]
        if paradas.empty:
            st.info("Nenhuma parada registrada no período.")
        else:
            por_motivo = (
                paradas.fillna({"motivo_parada": "Não informado"})
                .groupby("motivo_parada")["tempo_parada_min"].sum()
                .sort_values(ascending=False)
            )
            st.bar_chart(por_motivo, horizontal=True)
            st.dataframe(
                por_motivo.rename("Minutos").reset_index(), hide_index=True,
                use_container_width=True,
            )


# --------------------------------------------------------------------------
# Página: Cadastros
# --------------------------------------------------------------------------
CADASTROS = {
    "Linhas": (Linha, {"nome": "Nome", "ativo": "Ativo"}),
    "Produtos": (Produto, {
        "nome": "Nome", "unidade": "Unidade", "meta_hora": "Meta por hora",
        "ativo": "Ativo",
    }),
    "Insumos": (Insumo, {
        "nome": "Nome", "unidade": "Unidade", "tipo": "Tipo", "ativo": "Ativo",
    }),
    "Operadores": (Operador, {"nome": "Nome", "matricula": "Matrícula", "ativo": "Ativo"}),
}


def pagina_cadastros():
    st.title("⚙️ Cadastros")
    st.caption(
        "Adicione itens na última linha da tabela. Para retirar um item de uso, "
        "desmarque **Ativo** (o histórico é preservado)."
    )
    for aba, (nome, (modelo, colunas)) in zip(st.tabs(list(CADASTROS)), CADASTROS.items()):
        with aba:
            itens = listar_cadastro(Sessao, modelo, somente_ativos=False)
            df = pd.DataFrame(
                [{c: getattr(i, c) for c in ["id", *colunas]} for i in itens],
                columns=["id", *colunas],
            )
            config = {"id": None}
            config.update({c: st.column_config.Column(r) for c, r in colunas.items()})
            config["nome"] = st.column_config.TextColumn("Nome", required=True)
            config["ativo"] = st.column_config.CheckboxColumn("Ativo", default=True)
            if "tipo" in colunas:
                config["tipo"] = st.column_config.SelectboxColumn(
                    "Tipo", options=TIPOS_INSUMO, default=TIPOS_INSUMO[0], required=True,
                )
            if "unidade" in colunas:
                config["unidade"] = st.column_config.TextColumn(
                    "Unidade", default="kg", required=True,
                )
            if "meta_hora" in colunas:
                config["meta_hora"] = st.column_config.NumberColumn(
                    "Meta por hora", min_value=0, help="Produção esperada por hora de linha",
                )
            editado = st.data_editor(
                df, column_config=config, num_rows="add", hide_index=True,
                use_container_width=True, key=f"editor_{nome}",
            )
            if st.button(f"Salvar {nome.lower()}", key=f"salvar_{nome}"):
                try:
                    salvar_cadastro(Sessao, modelo, editado)
                except IntegrityError:
                    st.error("Já existe um item com esse nome.")
                else:
                    st.success("Cadastro atualizado.")
                    st.rerun()


# --------------------------------------------------------------------------
if verificar_acesso():
    pagina = st.navigation(
        [
            st.Page(pagina_lancamento, title="Lançar", icon="📝", default=True),
            st.Page(pagina_registros, title="Registros", icon="📋"),
            st.Page(pagina_indicadores, title="Indicadores", icon="📊"),
            st.Page(pagina_cadastros, title="Cadastros", icon="⚙️"),
        ],
        position="top",
    )
    pagina.run()
