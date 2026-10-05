"""Modelos e conexão com o banco de dados de apontamentos de produção.

O banco é definido pela variável DATABASE_URL (ou pelo secret de mesmo nome
no Streamlit). Sem configuração, usa um arquivo SQLite local (producao.db).

Exemplos de DATABASE_URL:
    sqlite:///producao.db
    postgresql+psycopg2://usuario:senha@host:5432/banco
"""
import json
import os
from datetime import datetime
from pathlib import Path

from sqlalchemy import (
    Boolean, Column, Date, DateTime, Float, ForeignKey, Integer, String, Text,
    create_engine, select,
)
from sqlalchemy.orm import declarative_base, relationship, sessionmaker

Base = declarative_base()

TURNOS = ["1º Turno", "2º Turno", "3º Turno"]
ARQUIVO_DADOS_INICIAIS = Path(__file__).with_name("dados_iniciais.json")


class Linha(Base):
    __tablename__ = "linhas"
    id = Column(Integer, primary_key=True)
    nome = Column(String(100), unique=True, nullable=False)
    ativo = Column(Boolean, default=True, nullable=False)


class Operador(Base):
    __tablename__ = "operadores"
    id = Column(Integer, primary_key=True)
    nome = Column(String(150), unique=True, nullable=False)
    ativo = Column(Boolean, default=True, nullable=False)


class Molde(Base):
    """Molde da seladora (Planilha2): bandejas por passo e filme por bandeja."""
    __tablename__ = "moldes"
    id = Column(Integer, primary_key=True)
    nome = Column(String(50), unique=True, nullable=False)
    cavidades = Column(Integer, nullable=False)       # bandejas por passo
    fundo_un = Column(Float, nullable=False)          # kg de filme de fundo por bandeja
    tampa_un = Column(Float, nullable=False)          # kg de filme de tampa por bandeja
    ativo = Column(Boolean, default=True, nullable=False)


class Produto(Base):
    """Cadastro de produtos (Planilha3)."""
    __tablename__ = "produtos"
    id = Column(Integer, primary_key=True)
    codigo = Column(String(40), unique=True, nullable=False)   # PROD_DER
    descricao = Column(String(200), default="", nullable=False)  # DESPRO
    desder = Column(String(100), default="", nullable=False)     # DESDER
    setor = Column(String(50), default="", nullable=False)       # LINHA da Planilha3
    peso = Column(Float)                                         # kg por bandeja
    pdv = Column(Boolean, default=False, nullable=False)         # peso variável
    molde_id = Column(Integer, ForeignKey("moldes.id"))
    ativo = Column(Boolean, default=True, nullable=False)

    molde = relationship("Molde")


class Apontamento(Base):
    """Uma linha da Plan1, lançada pelo operador.

    Peso líquido e dados do molde são copiados no momento do lançamento, para
    que mudanças posteriores no cadastro não alterem o histórico.
    """
    __tablename__ = "apontamentos"
    id = Column(Integer, primary_key=True)
    data = Column(Date, nullable=False)
    turno = Column(String(20), nullable=False)
    linha_id = Column(Integer, ForeignKey("linhas.id"), nullable=False)
    operador_id = Column(Integer, ForeignKey("operadores.id"), nullable=False)
    produto_id = Column(Integer, ForeignKey("produtos.id"), nullable=False)
    op = Column(String(50))
    peso_liquido = Column(Float)
    molde = Column(String(50))
    cavidades = Column(Integer)
    fundo_un = Column(Float)
    tampa_un = Column(Float)
    hora_inicio = Column(DateTime, nullable=False)
    hora_fim = Column(DateTime, nullable=False)
    passo_inicial = Column(Float, nullable=False)
    passo_final = Column(Float, nullable=False)
    producao_kg = Column(Float, nullable=False)
    parada_min = Column(Float, default=0, nullable=False)
    motivo_parada = Column(String(150))
    observacoes = Column(Text)
    criado_em = Column(DateTime, default=datetime.now, nullable=False)

    linha = relationship("Linha")
    operador = relationship("Operador")
    produto = relationship("Produto")


def normalizar_url(url):
    """Usa sempre o driver psycopg2 (o do requirements.txt). O Supabase entrega
    "postgresql://..." e o SQLAlchemy 2.1 associaria esse prefixo ao psycopg 3."""
    for prefixo in ("postgres://", "postgresql://"):
        if url.startswith(prefixo):
            return "postgresql+psycopg2://" + url[len(prefixo):]
    return url


def obter_url_banco():
    return os.environ.get("DATABASE_URL") or "sqlite:///producao.db"


def criar_engine(url=None):
    url = normalizar_url(url or obter_url_banco())
    kwargs = {"pool_pre_ping": True}
    if url.startswith("sqlite"):
        kwargs["connect_args"] = {"check_same_thread": False}
    engine = create_engine(url, **kwargs)
    Base.metadata.create_all(engine)
    return engine


def criar_sessao(engine):
    return sessionmaker(bind=engine, expire_on_commit=False)


def popular_dados_iniciais(Sessao, arquivo=ARQUIVO_DADOS_INICIAIS):
    """Carrega linhas, operadores, moldes e produtos apenas se o banco estiver vazio."""
    with Sessao() as s:
        if s.scalar(select(Produto.id).limit(1)) is not None:
            return
        dados = json.loads(Path(arquivo).read_text(encoding="utf-8"))
        s.add_all(Linha(nome=n) for n in dados["linhas"])
        s.add_all(Operador(nome=n) for n in dados["operadores"])
        moldes = {m["nome"]: Molde(**m) for m in dados["moldes"]}
        s.add_all(moldes.values())
        for p in dados["produtos"]:
            molde = moldes.get(p.pop("molde") or "")
            s.add(Produto(**p, molde=molde))
        s.commit()
