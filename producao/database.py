"""Modelos e conexão com o banco de dados de apontamentos de produção.

O banco é definido pela variável DATABASE_URL (ou pelo secret de mesmo nome
no Streamlit). Sem configuração, usa um arquivo SQLite local (producao.db).

Exemplos de DATABASE_URL:
    sqlite:///producao.db
    postgresql+psycopg2://usuario:senha@host:5432/banco
"""
import os
from datetime import datetime

from sqlalchemy import (
    Boolean, Column, Date, DateTime, Float, ForeignKey, Integer, String, Text,
    create_engine, select,
)
from sqlalchemy.orm import declarative_base, relationship, sessionmaker

Base = declarative_base()

TURNOS = ["1º Turno", "2º Turno", "3º Turno"]
TIPOS_INSUMO = ["Matéria-prima", "Embalagem", "Utilidade", "Outro"]


class Linha(Base):
    """Linha ou setor de produção (ex.: Filetagem, Empanamento)."""
    __tablename__ = "linhas"
    id = Column(Integer, primary_key=True)
    nome = Column(String(100), unique=True, nullable=False)
    ativo = Column(Boolean, default=True, nullable=False)


class Produto(Base):
    __tablename__ = "produtos"
    id = Column(Integer, primary_key=True)
    nome = Column(String(150), unique=True, nullable=False)
    unidade = Column(String(20), default="kg", nullable=False)
    meta_hora = Column(Float)  # produção esperada por hora, na unidade do produto
    ativo = Column(Boolean, default=True, nullable=False)


class Insumo(Base):
    """Item consumido na produção: matéria-prima, embalagem, água, energia..."""
    __tablename__ = "insumos"
    id = Column(Integer, primary_key=True)
    nome = Column(String(150), unique=True, nullable=False)
    unidade = Column(String(20), default="kg", nullable=False)
    tipo = Column(String(30), default="Matéria-prima", nullable=False)
    ativo = Column(Boolean, default=True, nullable=False)


class Operador(Base):
    __tablename__ = "operadores"
    id = Column(Integer, primary_key=True)
    nome = Column(String(150), unique=True, nullable=False)
    matricula = Column(String(30))
    ativo = Column(Boolean, default=True, nullable=False)


class Apontamento(Base):
    """Registro de produção de um lote/ordem feito pelo operador."""
    __tablename__ = "apontamentos"
    id = Column(Integer, primary_key=True)
    data = Column(Date, nullable=False)
    turno = Column(String(20), nullable=False)
    linha_id = Column(Integer, ForeignKey("linhas.id"), nullable=False)
    produto_id = Column(Integer, ForeignKey("produtos.id"), nullable=False)
    operador_id = Column(Integer, ForeignKey("operadores.id"), nullable=False)
    lote = Column(String(50))
    hora_inicio = Column(DateTime, nullable=False)
    hora_fim = Column(DateTime, nullable=False)
    pessoas = Column(Integer, default=1, nullable=False)
    quantidade_produzida = Column(Float, nullable=False)
    quantidade_refugo = Column(Float, default=0, nullable=False)
    tempo_parada_min = Column(Float, default=0, nullable=False)
    motivo_parada = Column(String(150))
    observacoes = Column(Text)
    criado_em = Column(DateTime, default=datetime.now, nullable=False)

    linha = relationship("Linha")
    produto = relationship("Produto")
    operador = relationship("Operador")
    consumos = relationship(
        "Consumo", back_populates="apontamento", cascade="all, delete-orphan"
    )


class Consumo(Base):
    __tablename__ = "consumos"
    id = Column(Integer, primary_key=True)
    apontamento_id = Column(Integer, ForeignKey("apontamentos.id"), nullable=False)
    insumo_id = Column(Integer, ForeignKey("insumos.id"), nullable=False)
    quantidade = Column(Float, nullable=False)

    apontamento = relationship("Apontamento", back_populates="consumos")
    insumo = relationship("Insumo")


def obter_url_banco():
    url = os.environ.get("DATABASE_URL")
    if url:
        # Provedores como Heroku/Supabase às vezes entregam "postgres://"
        return url.replace("postgres://", "postgresql+psycopg2://", 1)
    return "sqlite:///producao.db"


def criar_engine(url=None):
    url = url or obter_url_banco()
    kwargs = {"pool_pre_ping": True}
    if url.startswith("sqlite"):
        kwargs["connect_args"] = {"check_same_thread": False}
    engine = create_engine(url, **kwargs)
    Base.metadata.create_all(engine)
    return engine


def criar_sessao(engine):
    return sessionmaker(bind=engine, expire_on_commit=False)


DADOS_INICIAIS = {
    Linha: [{"nome": "Linha 1"}, {"nome": "Linha 2"}],
    Produto: [
        {"nome": "Filé de Peixe Congelado", "unidade": "kg", "meta_hora": 250},
        {"nome": "Camarão Descascado", "unidade": "kg", "meta_hora": 120},
    ],
    Insumo: [
        {"nome": "Matéria-prima (peixe inteiro)", "unidade": "kg", "tipo": "Matéria-prima"},
        {"nome": "Embalagem primária", "unidade": "un", "tipo": "Embalagem"},
        {"nome": "Caixa de papelão", "unidade": "un", "tipo": "Embalagem"},
        {"nome": "Água", "unidade": "m³", "tipo": "Utilidade"},
        {"nome": "Energia elétrica", "unidade": "kWh", "tipo": "Utilidade"},
        {"nome": "Gelo", "unidade": "kg", "tipo": "Utilidade"},
    ],
    Operador: [{"nome": "Operador Exemplo", "matricula": "0001"}],
}


def popular_dados_iniciais(Sessao):
    """Cria cadastros de exemplo apenas se o banco estiver vazio."""
    with Sessao() as s:
        if s.scalar(select(Linha.id).limit(1)) is not None:
            return
        for modelo, registros in DADOS_INICIAIS.items():
            s.add_all(modelo(**r) for r in registros)
        s.commit()
