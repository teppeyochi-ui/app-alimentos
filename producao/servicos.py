"""Regras de negócio: gravação de apontamentos e cálculo de indicadores."""
from datetime import date, datetime, time, timedelta

import pandas as pd
from sqlalchemy import select
from sqlalchemy.orm import joinedload

from .database import Apontamento, Consumo, Insumo, Linha, Operador, Produto


class ErroValidacao(ValueError):
    pass


def combinar_horarios(dia: date, inicio: time, fim: time):
    """Monta datetimes de início/fim; fim antes do início = virou o dia."""
    dt_inicio = datetime.combine(dia, inicio)
    dt_fim = datetime.combine(dia, fim)
    if dt_fim < dt_inicio:
        dt_fim += timedelta(days=1)
    return dt_inicio, dt_fim


def validar_apontamento(dados: dict):
    erros = []
    for campo in ("linha_id", "produto_id", "operador_id", "turno"):
        if not dados.get(campo):
            erros.append(f"Campo obrigatório não informado: {campo.replace('_id', '')}")
    if dados.get("quantidade_produzida") is None or dados["quantidade_produzida"] <= 0:
        erros.append("A quantidade produzida deve ser maior que zero.")
    if (dados.get("quantidade_refugo") or 0) < 0:
        erros.append("O refugo não pode ser negativo.")
    if (dados.get("pessoas") or 0) < 1:
        erros.append("Informe ao menos 1 pessoa na equipe.")
    duracao_min = (dados["hora_fim"] - dados["hora_inicio"]).total_seconds() / 60
    if duracao_min <= 0:
        erros.append("O horário de fim deve ser diferente do horário de início.")
    elif duracao_min > 24 * 60:
        erros.append("A duração do apontamento não pode passar de 24 horas.")
    parada = dados.get("tempo_parada_min") or 0
    if parada < 0:
        erros.append("O tempo de parada não pode ser negativo.")
    elif duracao_min > 0 and parada >= duracao_min:
        erros.append("O tempo de parada deve ser menor que a duração total.")
    for c in dados.get("consumos", []):
        if c["quantidade"] < 0:
            erros.append("Quantidades de consumo não podem ser negativas.")
            break
    if erros:
        raise ErroValidacao("\n".join(erros))


def salvar_apontamento(Sessao, dados: dict) -> int:
    """Valida e grava o apontamento com seus consumos. Retorna o id gerado.

    `dados["consumos"]` é uma lista de {"insumo_id": int, "quantidade": float};
    itens com quantidade zero são ignorados.
    """
    validar_apontamento(dados)
    consumos = [c for c in dados.get("consumos", []) if c["quantidade"] > 0]
    campos = {k: v for k, v in dados.items() if k != "consumos"}
    with Sessao() as s:
        apont = Apontamento(**campos)
        apont.consumos = [Consumo(**c) for c in consumos]
        s.add(apont)
        s.commit()
        return apont.id


def excluir_apontamento(Sessao, apontamento_id: int):
    with Sessao() as s:
        apont = s.get(Apontamento, apontamento_id)
        if apont:
            s.delete(apont)
            s.commit()


def salvar_cadastro(Sessao, modelo, df: pd.DataFrame):
    """Grava a tabela editada de um cadastro: linhas sem id são inclusões."""
    with Sessao() as s:
        for registro in df.to_dict("records"):
            if not str(registro.get("nome") or "").strip():
                continue
            dados = {
                k: (None if pd.isna(v) else v)
                for k, v in registro.items() if k != "id"
            }
            dados["nome"] = dados["nome"].strip()
            dados["ativo"] = True if dados.get("ativo") is None else bool(dados["ativo"])
            if pd.isna(registro.get("id")):
                s.add(modelo(**dados))
            else:
                obj = s.get(modelo, int(registro["id"]))
                for k, v in dados.items():
                    setattr(obj, k, v)
        s.commit()


def listar_cadastro(Sessao, modelo, somente_ativos=True):
    with Sessao() as s:
        consulta = select(modelo).order_by(modelo.nome)
        if somente_ativos:
            consulta = consulta.where(modelo.ativo.is_(True))
        return list(s.scalars(consulta))


def carregar_apontamentos(Sessao, inicio: date, fim: date) -> pd.DataFrame:
    """Apontamentos do período já com os indicadores calculados por registro."""
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
                "id": a.id,
                "data": a.data,
                "turno": a.turno,
                "linha": a.linha.nome,
                "produto": a.produto.nome,
                "unidade": a.produto.unidade,
                "meta_hora": a.produto.meta_hora,
                "operador": a.operador.nome,
                "lote": a.lote,
                "hora_inicio": a.hora_inicio,
                "hora_fim": a.hora_fim,
                "pessoas": a.pessoas,
                "quantidade_produzida": a.quantidade_produzida,
                "quantidade_refugo": a.quantidade_refugo,
                "tempo_parada_min": a.tempo_parada_min,
                "motivo_parada": a.motivo_parada,
                "observacoes": a.observacoes,
            }
            for a in registros
        ]
    return calcular_indicadores(pd.DataFrame(linhas))


def carregar_consumos(Sessao, inicio: date, fim: date) -> pd.DataFrame:
    with Sessao() as s:
        registros = s.execute(
            select(
                Consumo.apontamento_id,
                Apontamento.data,
                Linha.nome.label("linha"),
                Produto.nome.label("produto"),
                Insumo.nome.label("insumo"),
                Insumo.tipo.label("tipo"),
                Insumo.unidade.label("unidade_insumo"),
                Consumo.quantidade,
                Apontamento.quantidade_produzida,
            )
            .join(Apontamento, Consumo.apontamento_id == Apontamento.id)
            .join(Linha, Apontamento.linha_id == Linha.id)
            .join(Produto, Apontamento.produto_id == Produto.id)
            .join(Insumo, Consumo.insumo_id == Insumo.id)
            .where(Apontamento.data.between(inicio, fim))
        ).all()
    return pd.DataFrame(registros, columns=[
        "apontamento_id", "data", "linha", "produto", "insumo", "tipo",
        "unidade_insumo", "quantidade", "quantidade_produzida",
    ])


def calcular_indicadores(df: pd.DataFrame) -> pd.DataFrame:
    """Acrescenta horas, produtividade, refugo e eficiência a cada apontamento."""
    if df.empty:
        return df
    df = df.copy()
    duracao_h = (df["hora_fim"] - df["hora_inicio"]).dt.total_seconds() / 3600
    df["horas_totais"] = duracao_h.round(2)
    df["horas_efetivas"] = (duracao_h - df["tempo_parada_min"] / 60).round(2)
    df["produtividade_hora"] = df["quantidade_produzida"] / df["horas_efetivas"]
    df["produtividade_homem_hora"] = df["produtividade_hora"] / df["pessoas"]
    bruto = df["quantidade_produzida"] + df["quantidade_refugo"]
    df["refugo_pct"] = df["quantidade_refugo"] / bruto * 100
    df["disponibilidade_pct"] = df["horas_efetivas"] / df["horas_totais"] * 100
    df["eficiencia_pct"] = df["produtividade_hora"] / df["meta_hora"] * 100
    return df.round({
        "produtividade_hora": 2, "produtividade_homem_hora": 2,
        "refugo_pct": 2, "disponibilidade_pct": 1, "eficiencia_pct": 1,
    })


def resumo_geral(df: pd.DataFrame) -> dict:
    """Totais do período (médias ponderadas pelo tempo, não médias simples)."""
    if df.empty:
        return {}
    horas_ef = df["horas_efetivas"].sum()
    homem_hora = (df["horas_efetivas"] * df["pessoas"]).sum()
    produzido = df["quantidade_produzida"].sum()
    refugo = df["quantidade_refugo"].sum()
    return {
        "apontamentos": len(df),
        "produzido": produzido,
        "refugo_pct": refugo / (produzido + refugo) * 100 if produzido + refugo else 0,
        "horas_efetivas": horas_ef,
        "horas_parada": df["tempo_parada_min"].sum() / 60,
        "produtividade_hora": produzido / horas_ef if horas_ef else 0,
        "produtividade_homem_hora": produzido / homem_hora if homem_hora else 0,
        "disponibilidade_pct": horas_ef / df["horas_totais"].sum() * 100,
    }


def agrupar_produtividade(df: pd.DataFrame, por: str) -> pd.DataFrame:
    """Produção, horas e produtividade agregadas por uma coluna (linha, produto...)."""
    if df.empty:
        return df
    g = df.assign(homem_hora=df["horas_efetivas"] * df["pessoas"]).groupby(por).agg(
        produzido=("quantidade_produzida", "sum"),
        refugo=("quantidade_refugo", "sum"),
        horas_efetivas=("horas_efetivas", "sum"),
        homem_hora=("homem_hora", "sum"),
        parada_min=("tempo_parada_min", "sum"),
    )
    g["produtividade_hora"] = (g["produzido"] / g["horas_efetivas"]).round(2)
    g["produtividade_homem_hora"] = (g["produzido"] / g["homem_hora"]).round(2)
    g["refugo_pct"] = (g["refugo"] / (g["produzido"] + g["refugo"]) * 100).round(2)
    return g.drop(columns="homem_hora").reset_index()


def consumo_especifico(consumos: pd.DataFrame) -> pd.DataFrame:
    """Consumo de cada insumo por unidade produzida, por produto.

    Ex.: 1,35 kg de matéria-prima por kg de filé (rendimento = 1/1,35 = 74%).
    """
    if consumos.empty:
        return consumos
    # Cada linha traz a produção do seu apontamento, então a soma por grupo
    # considera apenas os apontamentos em que aquele insumo foi registrado.
    g = (
        consumos.groupby(["produto", "insumo", "tipo", "unidade_insumo"])
        .agg(quantidade=("quantidade", "sum"), produzido=("quantidade_produzida", "sum"))
        .reset_index()
    )
    g["consumo_por_unidade"] = (g["quantidade"] / g["produzido"]).round(4)
    mp = g["tipo"] == "Matéria-prima"
    g.loc[mp, "rendimento_pct"] = (g.loc[mp, "produzido"] / g.loc[mp, "quantidade"] * 100).round(1)
    return g
