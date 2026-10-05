"""Testes dos cálculos contra os valores da planilha CONTROLE PRODUÇÃO (Plan1)."""
import os
from datetime import date, time

import pandas as pd
import pytest
from sqlalchemy.exc import IntegrityError

from producao.database import (
    Base, Linha, Molde, Operador, Produto, criar_engine, criar_sessao,
    popular_dados_iniciais,
)
from producao.servicos import (
    ErroValidacao, agrupar, carregar_apontamentos, combinar_horarios,
    excluir_apontamento, listar_cadastro, resumo, salvar_apontamento,
    salvar_cadastro, tabela_plan1,
)

SALMAO_600 = "24616701063781-975"     # Molde 2x1, 0,6 kg
SALMAO_ALFRESCO = "23616206001371-1055"  # Molde 2x2, 0,4 kg
DOURADO_PDV = "06042002001341-1058"   # PDV, sem molde


@pytest.fixture
def Sessao():
    # TEST_DATABASE_URL permite rodar os mesmos testes num PostgreSQL de verdade
    engine = criar_engine(os.environ.get("TEST_DATABASE_URL", "sqlite://"))
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    Sessao = criar_sessao(engine)
    popular_dados_iniciais(Sessao)
    yield Sessao
    engine.dispose()


def produto(Sessao, codigo):
    return next(p for p in listar_cadastro(Sessao, Produto) if p.codigo == codigo)


def lancar(Sessao, codigo, dia, ini, fim, passo_ini, passo_fim, kg, **extra):
    p = produto(Sessao, codigo)
    hora_inicio, hora_fim = combinar_horarios(dia, ini, fim)
    dados = {
        "data": dia, "turno": "1º Turno",
        "linha_id": listar_cadastro(Sessao, Linha)[0].id,
        "operador_id": listar_cadastro(Sessao, Operador)[0].id,
        "produto_id": p.id, "molde_id": p.molde_id,
        "hora_inicio": hora_inicio, "hora_fim": hora_fim,
        "passo_inicial": passo_ini, "passo_final": passo_fim, "producao_kg": kg,
    }
    dados.update(extra)
    return salvar_apontamento(Sessao, dados)


def test_dados_iniciais_da_planilha(Sessao):
    assert len(listar_cadastro(Sessao, Produto)) == 124
    moldes = {m.nome: m.cavidades for m in listar_cadastro(Sessao, Molde)}
    assert moldes == {"Molde 2x1": 2, "Molde 3x1": 3, "Molde 2x2": 4}
    assert [l.nome for l in listar_cadastro(Sessao, Linha)] == ["Alfresco", "Skinpack"]
    popular_dados_iniciais(Sessao)  # não duplica
    assert len(listar_cadastro(Sessao, Produto)) == 124


def test_linha_2_da_plan1(Sessao):
    lancar(Sessao, SALMAO_600, date(2026, 9, 30), time(8, 0), time(11, 11), 0, 359, 234)
    r = carregar_apontamentos(Sessao, date(2026, 9, 30), date(2026, 9, 30)).iloc[0]
    assert r["passo_total"] == 359
    assert r["producao_un"] == pytest.approx(390)
    assert r["bdj_total"] == 718
    assert r["rendimento"] == pytest.approx(0.5431754874651811)
    assert r["tempo_min"] == 191
    assert r["kg_h"] == pytest.approx(73.50785340314134)
    assert r["min_kg"] == pytest.approx(0.8162393162393163)
    assert r["filme_fundo"] == pytest.approx(20.160027980103038)
    assert r["filme_tampa"] == pytest.approx(5.04388903681565)
    assert r["ft_fundo"] == pytest.approx(0.08615396572693607)
    assert r["ft_tampa"] == pytest.approx(0.021555081353913035)


def test_linha_6_da_plan1_molde_2x2(Sessao):
    lancar(Sessao, SALMAO_ALFRESCO, date(2026, 9, 26), time(8, 0), time(10, 0), 0, 300, 250)
    r = carregar_apontamentos(Sessao, date(2026, 9, 26), date(2026, 9, 26)).iloc[0]
    assert r["producao_un"] == pytest.approx(625)
    assert r["bdj_total"] == 1200
    assert r["rendimento"] == pytest.approx(0.5208333333333334)
    assert r["kg_h"] == pytest.approx(125)
    assert r["min_kg"] == pytest.approx(0.48)
    assert r["filme_fundo"] == pytest.approx(16.84682003908332)
    assert r["filme_tampa"] == pytest.approx(3.251376404494382)


def test_pdv_sem_molde_deixa_em_branco(Sessao):
    lancar(Sessao, DOURADO_PDV, date(2026, 9, 26), time(10, 0), time(11, 0), 0, 100, 50)
    df = carregar_apontamentos(Sessao, date(2026, 9, 26), date(2026, 9, 26))
    r = df.iloc[0]
    assert r["passo_total"] == 100 and r["kg_h"] == 50
    for col in ("producao_un", "bdj_total", "rendimento", "filme_fundo", "ft_fundo"):
        assert pd.isna(r[col]), col
    t = resumo(df)
    assert pd.isna(t["producao_un"]) and pd.isna(t["rendimento"]) and pd.isna(t["filme_fundo"])
    assert tabela_plan1(df).iloc[0]["Peso Líquido"] == "PDV"


def test_virada_de_dia():
    inicio, fim = combinar_horarios(date(2026, 10, 1), time(22, 0), time(6, 0))
    assert (fim - inicio).total_seconds() == 8 * 3600


def test_resumo_ponderado(Sessao):
    dia = date(2026, 9, 29)
    lancar(Sessao, SALMAO_600, dia, time(8, 0), time(11, 11), 0, 359, 234)
    lancar(Sessao, SALMAO_600, dia, time(15, 30), time(17, 25), 0, 529, 441)
    lancar(Sessao, DOURADO_PDV, dia, time(12, 0), time(13, 0), 0, 100, 50)
    df = carregar_apontamentos(Sessao, dia, dia)
    t = resumo(df)
    assert t["producao_kg"] == 725
    assert t["producao_un"] == pytest.approx(390 + 735)
    assert t["bdj_total"] == 718 + 1058
    assert t["rendimento"] == pytest.approx((390 + 735) / (718 + 1058))  # PDV fica de fora
    assert t["kg_h"] == pytest.approx(725 / ((191 + 115 + 60) / 60))
    assert t["ft_fundo"] == pytest.approx((20.160027980103038 + 29.706559335583584) / 675)
    por_produto = agrupar(df, "codigo").set_index("codigo")
    assert por_produto.loc[SALMAO_600, "producao_kg"] == 675


def test_tabela_plan1_tem_as_colunas_da_planilha(Sessao):
    lancar(Sessao, SALMAO_600, date(2026, 9, 30), time(8, 0), time(11, 11), 0, 359, 234, op="1234")
    t = tabela_plan1(carregar_apontamentos(Sessao, date(2026, 9, 30), date(2026, 9, 30)))
    assert list(t.columns)[:23] == [
        "Data", "PROD_DER", "DESPRO", "DESDER", "Peso Líquido", "Molde", "OP", "Hora inicio",
        "Passo inicio", "Hora termino", "Passo fim", "Produção (kg)", "Passo total",
        "Produção (un.)", "Produção (Bdj Total)", "Rendimento (máquina)", "Tempo de produção total",
        "Produtividade (kg/h)", "Tempo por kg (min)", "Consumo filme fundo", "Consumo Filme Tampa",
        "FT consumo Fundo", "FT consumo tampa"]
    r = t.iloc[0]
    assert (r["Data"], r["Hora inicio"], r["Tempo de produção total"], r["OP"]) == ("30/09/2026", "08:00", "3:11", "1234")


def test_molde_alterado_no_cadastro_nao_muda_historico(Sessao):
    dia = date(2026, 9, 30)
    lancar(Sessao, SALMAO_600, dia, time(8, 0), time(11, 11), 0, 359, 234)
    with Sessao() as s:
        s.query(Molde).filter_by(nome="Molde 2x1").update({"cavidades": 9})
        s.commit()
    assert carregar_apontamentos(Sessao, dia, dia).iloc[0]["bdj_total"] == 718


@pytest.mark.parametrize("extra, mensagem", [
    ({"producao_kg": 0}, "maior que zero"),
    ({"passo_final": None}, "passo inicial e o passo final"),
    ({"passo_inicial": 400}, "maior ou igual"),
    ({"parada_min": 500}, "menor que o tempo total"),
    ({"operador_id": None}, "operador"),
])
def test_validacao(Sessao, extra, mensagem):
    with pytest.raises(ErroValidacao, match=mensagem):
        lancar(Sessao, SALMAO_600, date(2026, 9, 30), time(8, 0), time(11, 11), 0, 359, 234, **extra)
    assert carregar_apontamentos(Sessao, date(2026, 9, 30), date(2026, 9, 30)).empty


def test_hora_igual_e_invalida(Sessao):
    with pytest.raises(ErroValidacao, match="término deve ser diferente"):
        lancar(Sessao, SALMAO_600, date(2026, 9, 30), time(8, 0), time(8, 0), 0, 359, 234)


def test_excluir(Sessao):
    novo = lancar(Sessao, SALMAO_600, date(2026, 9, 30), time(8, 0), time(11, 11), 0, 359, 234)
    excluir_apontamento(Sessao, novo)
    assert carregar_apontamentos(Sessao, date(2026, 9, 30), date(2026, 9, 30)).empty


def test_salvar_cadastro_produto_com_molde(Sessao):
    p = produto(Sessao, DOURADO_PDV)
    df = pd.DataFrame([
        {"id": p.id, "codigo": p.codigo, "descricao": p.descricao, "desder": p.desder, "setor": p.setor,
         "peso": None, "pdv": True, "molde": "Molde 3x1", "ativo": True},
        {"id": None, "codigo": " 999-1 ", "descricao": "TESTE 300GR", "desder": "", "setor": "",
         "peso": 0.3, "pdv": False, "molde": None, "ativo": None},
    ])
    salvar_cadastro(Sessao, Produto, df)
    assert produto(Sessao, DOURADO_PDV).molde.nome == "Molde 3x1"
    novo = produto(Sessao, "999-1")
    assert novo.peso == 0.3 and novo.molde_id is None and novo.ativo


def test_salvar_cadastro_nome_duplicado(Sessao):
    with pytest.raises(IntegrityError):
        salvar_cadastro(Sessao, Linha, pd.DataFrame([{"id": None, "nome": "Skinpack", "ativo": True}]))
