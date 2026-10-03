from datetime import date, time

import pandas as pd
import pytest
from sqlalchemy.exc import IntegrityError

from producao.database import (
    Insumo, Linha, Operador, Produto, criar_engine, criar_sessao,
    popular_dados_iniciais,
)
from producao.servicos import (
    ErroValidacao, agrupar_produtividade, carregar_apontamentos,
    carregar_consumos, combinar_horarios, consumo_especifico,
    excluir_apontamento, listar_cadastro, resumo_geral, salvar_apontamento, salvar_cadastro,
)

DIA = date(2026, 10, 1)


@pytest.fixture
def Sessao():
    Sessao = criar_sessao(criar_engine("sqlite://"))
    popular_dados_iniciais(Sessao)
    return Sessao


def ids(Sessao):
    return {
        "linha_id": listar_cadastro(Sessao, Linha)[0].id,
        "produto_id": next(
            p.id for p in listar_cadastro(Sessao, Produto) if p.meta_hora == 250
        ),
        "operador_id": listar_cadastro(Sessao, Operador)[0].id,
        "mp": next(i.id for i in listar_cadastro(Sessao, Insumo) if i.tipo == "Matéria-prima"),
    }


def apontamento(Sessao, **extra):
    i = ids(Sessao)
    inicio, fim = combinar_horarios(DIA, time(6, 0), time(10, 0))
    dados = {
        "data": DIA, "turno": "1º Turno", "linha_id": i["linha_id"],
        "produto_id": i["produto_id"], "operador_id": i["operador_id"],
        "hora_inicio": inicio, "hora_fim": fim, "pessoas": 4,
        "quantidade_produzida": 800.0, "quantidade_refugo": 200.0,
        "tempo_parada_min": 60.0,
        "consumos": [{"insumo_id": i["mp"], "quantidade": 1200.0}],
    }
    dados.update(extra)
    return dados


def test_combinar_horarios_vira_o_dia():
    inicio, fim = combinar_horarios(DIA, time(22, 0), time(6, 0))
    assert (fim - inicio).total_seconds() == 8 * 3600
    assert fim.date() == date(2026, 10, 2)


def test_dados_iniciais_nao_duplicam(Sessao):
    popular_dados_iniciais(Sessao)
    assert len(listar_cadastro(Sessao, Linha)) == 2


def test_salva_e_calcula_indicadores(Sessao):
    salvar_apontamento(Sessao, apontamento(Sessao))
    df = carregar_apontamentos(Sessao, DIA, DIA)
    r = df.iloc[0]
    assert r["horas_totais"] == 4
    assert r["horas_efetivas"] == 3
    assert r["produtividade_hora"] == pytest.approx(266.67, abs=0.01)
    assert r["produtividade_homem_hora"] == pytest.approx(66.67, abs=0.01)
    assert r["refugo_pct"] == 20
    assert r["disponibilidade_pct"] == 75
    assert r["eficiencia_pct"] == pytest.approx(106.7)


def test_resumo_pondera_pelo_tempo(Sessao):
    salvar_apontamento(Sessao, apontamento(Sessao))  # 800 em 3h efetivas
    inicio, fim = combinar_horarios(DIA, time(10, 0), time(11, 0))
    salvar_apontamento(Sessao, apontamento(
        Sessao, hora_inicio=inicio, hora_fim=fim, tempo_parada_min=0,
        quantidade_produzida=100.0, quantidade_refugo=0.0, pessoas=1,
    ))
    df = carregar_apontamentos(Sessao, DIA, DIA)
    r = resumo_geral(df)
    assert r["produzido"] == 900
    assert r["produtividade_hora"] == pytest.approx(900 / 4)
    assert r["produtividade_homem_hora"] == pytest.approx(900 / (3 * 4 + 1))
    por_linha = agrupar_produtividade(df, "linha")
    assert por_linha.iloc[0]["produtividade_hora"] == 225


def test_consumo_especifico_e_rendimento(Sessao):
    salvar_apontamento(Sessao, apontamento(Sessao))
    cons = consumo_especifico(carregar_consumos(Sessao, DIA, DIA))
    r = cons.iloc[0]
    assert r["consumo_por_unidade"] == 1.5
    assert r["rendimento_pct"] == pytest.approx(66.7)


def test_consumos_zerados_sao_ignorados(Sessao):
    i = ids(Sessao)
    salvar_apontamento(Sessao, apontamento(
        Sessao, consumos=[{"insumo_id": i["mp"], "quantidade": 0.0}],
    ))
    assert carregar_consumos(Sessao, DIA, DIA).empty


@pytest.mark.parametrize("extra, mensagem", [
    ({"quantidade_produzida": 0.0}, "maior que zero"),
    ({"tempo_parada_min": 240.0}, "menor que a duração"),
    ({"operador_id": None}, "operador"),
    ({"pessoas": 0}, "1 pessoa"),
    ({"hora_fim": combinar_horarios(DIA, time(6, 0), time(6, 0))[1]}, "fim deve ser diferente"),
])
def test_validacao(Sessao, extra, mensagem):
    with pytest.raises(ErroValidacao, match=mensagem):
        salvar_apontamento(Sessao, apontamento(Sessao, **extra))
    assert carregar_apontamentos(Sessao, DIA, DIA).empty


def test_excluir_remove_consumos(Sessao):
    novo_id = salvar_apontamento(Sessao, apontamento(Sessao))
    excluir_apontamento(Sessao, novo_id)
    assert carregar_apontamentos(Sessao, DIA, DIA).empty
    assert carregar_consumos(Sessao, DIA, DIA).empty


def test_salvar_cadastro_inclui_edita_e_inativa(Sessao):
    linhas = listar_cadastro(Sessao, Linha)
    df = pd.DataFrame([
        {"id": linhas[0].id, "nome": "Filetagem", "ativo": True},
        {"id": linhas[1].id, "nome": linhas[1].nome, "ativo": False},
        {"id": None, "nome": "  Empanamento ", "ativo": None},
        {"id": None, "nome": "", "ativo": True},
    ])
    salvar_cadastro(Sessao, Linha, df)
    assert [l.nome for l in listar_cadastro(Sessao, Linha)] == ["Empanamento", "Filetagem"]
    assert len(listar_cadastro(Sessao, Linha, somente_ativos=False)) == 3


def test_salvar_cadastro_nome_duplicado(Sessao):
    df = pd.DataFrame([{"id": None, "nome": "Linha 1", "ativo": True}])
    with pytest.raises(IntegrityError):
        salvar_cadastro(Sessao, Linha, df)
