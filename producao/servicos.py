"""Regras de negócio: gravação de apontamentos e cálculos da Plan1.

Fórmulas (iguais às da planilha CONTROLE PRODUÇÃO, Plan1):
    Passo total            = passo fim − passo início
    Produção (un.)         = produção kg ÷ peso líquido
    Produção (Bdj Total)   = passo total × bandejas por passo do molde
    Rendimento (máquina)   = produção (un.) ÷ produção (Bdj Total)
    Tempo de produção      = hora término − hora início
    Produtividade (kg/h)   = produção kg ÷ horas
    Tempo por kg (min)     = minutos ÷ produção kg
    Consumo filme fundo    = Bdj Total × filme de fundo por bandeja (Planilha2)
    Consumo filme tampa    = Bdj Total × filme de tampa por bandeja (Planilha2)
    FT consumo fundo/tampa = consumo de filme ÷ produção kg
"""
from datetime import date, datetime, time, timedelta

import numpy as np
import pandas as pd
from sqlalchemy import select
from sqlalchemy.orm import joinedload

from .database import Apontamento, Linha, Molde, Operador, Produto


class ErroValidacao(ValueError):
    pass


def combinar_horarios(dia: date, inicio: time, fim: time):
    """Monta datetimes de início/fim; fim antes do início = virou o dia (MOD da Plan1)."""
    dt_inicio = datetime.combine(dia, inicio)
    dt_fim = datetime.combine(dia, fim)
    if dt_fim < dt_inicio:
        dt_fim += timedelta(days=1)
    return dt_inicio, dt_fim


def validar_apontamento(dados: dict):
    erros = []
    for campo, nome in (("operador_id", "operador"), ("linha_id", "linha"), ("produto_id", "produto"), ("turno", "turno")):
        if not dados.get(campo):
            erros.append(f"Selecione o {nome}.")
    if not dados.get("producao_kg") or dados["producao_kg"] <= 0:
        erros.append("A produção (kg) deve ser maior que zero.")
    pi, pf = dados.get("passo_inicial"), dados.get("passo_final")
    if pi is None or pf is None:
        erros.append("Informe o passo inicial e o passo final.")
    elif pi < 0 or pf < 0:
        erros.append("Os passos não podem ser negativos.")
    elif pf < pi:
        erros.append("O passo final deve ser maior ou igual ao passo inicial.")
    duracao_min = (dados["hora_fim"] - dados["hora_inicio"]).total_seconds() / 60
    if duracao_min <= 0:
        erros.append("A hora de término deve ser diferente da hora de início.")
    parada = dados.get("parada_min") or 0
    if parada < 0:
        erros.append("A parada não pode ser negativa.")
    elif duracao_min > 0 and parada >= duracao_min:
        erros.append("A parada deve ser menor que o tempo total.")
    if erros:
        raise ErroValidacao("\n".join(erros))


def salvar_apontamento(Sessao, dados: dict) -> int:
    """Valida e grava o apontamento. Peso e molde vêm do cadastro do produto,
    a não ser que `molde_id` seja informado (o operador pode trocar o molde)."""
    validar_apontamento(dados)
    dados = dict(dados)
    molde_id = dados.pop("molde_id", None)
    with Sessao() as s:
        produto = s.get(Produto, dados["produto_id"])
        molde = s.get(Molde, molde_id) if molde_id else None
        apont = Apontamento(
            **dados,
            peso_liquido=produto.peso,
            molde=molde.nome if molde else None,
            cavidades=molde.cavidades if molde else None,
            fundo_un=molde.fundo_un if molde else None,
            tampa_un=molde.tampa_un if molde else None,
        )
        s.add(apont)
        s.commit()
        return apont.id


def excluir_apontamento(Sessao, apontamento_id: int):
    with Sessao() as s:
        apont = s.get(Apontamento, apontamento_id)
        if apont:
            s.delete(apont)
            s.commit()


def listar_cadastro(Sessao, modelo, somente_ativos=True):
    ordem = modelo.codigo if modelo is Produto else modelo.nome
    with Sessao() as s:
        consulta = select(modelo).order_by(ordem)
        if modelo is Produto:
            consulta = consulta.options(joinedload(Produto.molde))
        if somente_ativos:
            consulta = consulta.where(modelo.ativo.is_(True))
        return list(s.scalars(consulta))


def salvar_cadastro(Sessao, modelo, df: pd.DataFrame):
    """Grava a tabela editada de um cadastro: linhas sem id são inclusões."""
    chave = "codigo" if modelo is Produto else "nome"
    with Sessao() as s:
        moldes = {m.nome: m.id for m in s.scalars(select(Molde))}
        for registro in df.to_dict("records"):
            if not str(registro.get(chave) or "").strip():
                continue
            dados = {k: (None if pd.isna(v) else v) for k, v in registro.items() if k != "id"}
            dados[chave] = str(dados[chave]).strip()
            dados["ativo"] = True if dados.get("ativo") is None else bool(dados["ativo"])
            if modelo is Produto:
                dados["molde_id"] = moldes.get(dados.pop("molde", None) or "")
                dados["pdv"] = bool(dados.get("pdv"))
                for campo in ("descricao", "desder", "setor"):
                    dados[campo] = dados.get(campo) or ""
                if dados["pdv"]:
                    dados["peso"] = None
            if pd.isna(registro.get("id")):
                s.add(modelo(**dados))
            else:
                obj = s.get(modelo, int(registro["id"]))
                for k, v in dados.items():
                    setattr(obj, k, v)
        s.commit()


def carregar_apontamentos(Sessao, inicio: date, fim: date) -> pd.DataFrame:
    """Apontamentos do período já com os cálculos da Plan1 por linha."""
    with Sessao() as s:
        registros = s.scalars(
            select(Apontamento)
            .options(
                joinedload(Apontamento.linha),
                joinedload(Apontamento.produto),
                joinedload(Apontamento.operador),
            )
            .where(Apontamento.data.between(inicio, fim))
            .order_by(Apontamento.data.desc(), Apontamento.hora_inicio.desc())
        ).all()
        linhas = [
            {
                "id": a.id, "data": a.data, "turno": a.turno,
                "linha": a.linha.nome, "operador": a.operador.nome,
                "codigo": a.produto.codigo, "descricao": a.produto.descricao,
                "desder": a.produto.desder, "pdv": a.produto.pdv,
                "peso_liquido": a.peso_liquido, "molde": a.molde,
                "cavidades": a.cavidades, "fundo_un": a.fundo_un, "tampa_un": a.tampa_un,
                "op": a.op, "hora_inicio": a.hora_inicio, "hora_fim": a.hora_fim,
                "passo_inicial": a.passo_inicial, "passo_final": a.passo_final,
                "producao_kg": a.producao_kg, "parada_min": a.parada_min,
                "motivo_parada": a.motivo_parada, "observacoes": a.observacoes,
            }
            for a in registros
        ]
    return calcular(pd.DataFrame(linhas))


def _div(a, b):
    """Divisão que devolve NaN (célula em branco) quando o divisor é zero ou vazio."""
    a = pd.to_numeric(a, errors="coerce")
    b = pd.to_numeric(b, errors="coerce")
    return a / b.where(b != 0)


def calcular(df: pd.DataFrame) -> pd.DataFrame:
    """Acrescenta as colunas calculadas da Plan1 a cada apontamento."""
    if df.empty:
        return df
    df = df.copy()
    df["passo_total"] = df["passo_final"] - df["passo_inicial"]
    df["bdj_total"] = df["passo_total"] * pd.to_numeric(df["cavidades"], errors="coerce")
    df["producao_un"] = _div(df["producao_kg"], df["peso_liquido"])
    df["rendimento"] = _div(df["producao_un"], df["bdj_total"])
    df["tempo_min"] = (df["hora_fim"] - df["hora_inicio"]).dt.total_seconds() / 60
    df["kg_h"] = _div(df["producao_kg"], df["tempo_min"] / 60)
    df["min_kg"] = _div(df["tempo_min"], df["producao_kg"])
    df["filme_fundo"] = df["bdj_total"] * pd.to_numeric(df["fundo_un"], errors="coerce")
    df["filme_tampa"] = df["bdj_total"] * pd.to_numeric(df["tampa_un"], errors="coerce")
    df["ft_fundo"] = _div(df["filme_fundo"], df["producao_kg"])
    df["ft_tampa"] = _div(df["filme_tampa"], df["producao_kg"])
    return df


def resumo(df: pd.DataFrame) -> dict:
    """Totais do período. Cada razão soma só os apontamentos que têm os dois
    lados dela (ex.: rendimento ignora produtos PDV ou sem molde)."""
    if df.empty:
        return {}
    kg = df["producao_kg"].sum()
    com_rend = df["producao_un"].notna() & (df["bdj_total"] > 0)
    com_tempo = df["tempo_min"] > 0
    com_filme = df["filme_fundo"].notna()
    soma = lambda col: df[col].sum() if df[col].notna().any() else np.nan  # vazio, não 0
    filme_f = df.loc[com_filme, "filme_fundo"].sum() if com_filme.any() else np.nan
    filme_t = df.loc[com_filme, "filme_tampa"].sum() if com_filme.any() else np.nan
    kg_filme = df.loc[com_filme, "producao_kg"].sum()
    minutos = df.loc[com_tempo, "tempo_min"].sum()
    kg_tempo = df.loc[com_tempo, "producao_kg"].sum()
    bdj_rend = df.loc[com_rend, "bdj_total"].sum()
    return {
        "apontamentos": len(df),
        "producao_kg": kg,
        "passo_total": df["passo_total"].sum(),
        "producao_un": soma("producao_un"),
        "bdj_total": soma("bdj_total"),
        "rendimento": df.loc[com_rend, "producao_un"].sum() / bdj_rend if bdj_rend else np.nan,
        "tempo_min": minutos,
        "kg_h": kg_tempo / (minutos / 60) if minutos else np.nan,
        "min_kg": minutos / kg_tempo if kg_tempo else np.nan,
        "parada_min": df["parada_min"].sum(),
        "filme_fundo": filme_f,
        "filme_tampa": filme_t,
        "ft_fundo": filme_f / kg_filme if kg_filme else np.nan,
        "ft_tampa": filme_t / kg_filme if kg_filme else np.nan,
    }


def agrupar(df: pd.DataFrame, por) -> pd.DataFrame:
    """Aplica `resumo` a cada grupo (produto, linha, operador, data...)."""
    if df.empty:
        return pd.DataFrame()
    por = [por] if isinstance(por, str) else list(por)
    linhas = []
    for chave, grupo in df.groupby(por, dropna=False, sort=False):
        chave = chave if isinstance(chave, tuple) else (chave,)
        linhas.append({**dict(zip(por, chave)), **resumo(grupo)})
    return pd.DataFrame(linhas)


COLUNAS_PLAN1 = {
    "data": "Data", "codigo": "PROD_DER", "descricao": "DESPRO", "desder": "DESDER",
    "peso_liquido": "Peso Líquido", "molde": "Molde", "op": "OP",
    "hora_inicio": "Hora inicio", "passo_inicial": "Passo inicio",
    "hora_fim": "Hora termino", "passo_final": "Passo fim",
    "producao_kg": "Produção (kg)", "passo_total": "Passo total",
    "producao_un": "Produção (un.)", "bdj_total": "Produção (Bdj Total)",
    "rendimento": "Rendimento (máquina)", "tempo": "Tempo de produção total",
    "kg_h": "Produtividade (kg/h)", "min_kg": "Tempo por kg (min)",
    "filme_fundo": "Consumo filme fundo", "filme_tampa": "Consumo Filme Tampa",
    "ft_fundo": "FT consumo Fundo", "ft_tampa": "FT consumo tampa",
    "linha": "Linha", "operador": "Operador", "turno": "Turno",
    "parada_min": "Parada (min)", "motivo_parada": "Motivo da parada",
    "observacoes": "Observações",
}


def formatar_hm(minutos):
    if minutos is None or pd.isna(minutos):
        return ""
    minutos = int(round(minutos))
    return f"{minutos // 60}:{minutos % 60:02d}"


def tabela_plan1(df: pd.DataFrame) -> pd.DataFrame:
    """Apontamentos no layout de colunas da Plan1 (para exportar e colar na planilha)."""
    if df.empty:
        return pd.DataFrame(columns=list(COLUNAS_PLAN1.values()))
    t = df.copy()
    t["data"] = pd.to_datetime(t["data"]).dt.strftime("%d/%m/%Y")
    t["hora_inicio"] = t["hora_inicio"].dt.strftime("%H:%M")
    t["hora_fim"] = t["hora_fim"].dt.strftime("%H:%M")
    t["tempo"] = t["tempo_min"].map(formatar_hm)
    t["peso_liquido"] = t["peso_liquido"].where(t["peso_liquido"].notna(), t["pdv"].map({True: "PDV", False: None}))
    return t[list(COLUNAS_PLAN1)].rename(columns=COLUNAS_PLAN1)
