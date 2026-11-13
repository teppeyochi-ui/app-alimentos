import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { bancoLocal } from '../../src/lib/banco-local';
import {
  adicionarFoto, adicionarParada, alterarOp, contarRetrabalho, definirPerfil, descarregar, encerrarOp, escolherProduto,
  VERSAO_SEMENTE, iniciarLoja, lerEstado, novaOp, removerFoto, removerParada,
} from '../../src/lib/loja';
import { calcular, validarEncerramento } from '../../src/lib/calc';
import { reiniciarSincronizacao, sincronizar } from '../../src/lib/sincronizacao';
import type { Perfil, Produto } from '../../src/lib/tipos';
import { ServidorFalso } from './servidor-falso';

const OPERADOR: Perfil = { id: '33333333-3333-4333-8333-333333333333', nome: 'Operador', papel: 'operador', ativo: true };
const SALMAO: Produto = {
  codigo: '24616701063781-975', descricao: 'F. SALMON PREM PEDACOS S/E 600GR SKIN PREMIUM', molde: '2x1',
  peso_nominal_kg: 0.6, embalagens_por_caixa: 9, derivacao: null, peso_caixa_kg: null, especie: 'SALMON', ativo: true,
};
const foto = () => new Blob([new Uint8Array(2048)], { type: 'image/jpeg' });

let servidor: ServidorFalso;

/** Simula fechar e abrir o aplicativo: o estado em memória some e volta do IndexedDB. */
async function reabrirApp(): Promise<void> {
  await descarregar();
  reiniciarSincronizacao();
  await iniciarLoja({ servidor });
}

beforeEach(async () => {
  await bancoLocal.fechar();
  globalThis.indexedDB = new IDBFactory();
  reiniciarSincronizacao();
  servidor = new ServidorFalso();
  await iniciarLoja({ servidor });
  await definirPerfil(OPERADOR);
});

/** Lança uma OP inteira, como o operador faria. Devolve o id. */
async function lancarOpCompleta(): Promise<string> {
  const { id } = novaOp();
  escolherProduto(id, SALMAO);
  alterarOp(id, { op: '20109999', hora_inicio: '08:00', passo_inicio: 0 });
  for (let i = 0; i < 5; i++) contarRetrabalho(id, 'sem_vacuo', 1);
  contarRetrabalho(id, 'furo', 1);
  contarRetrabalho(id, 'furo', 1);
  adicionarParada(id, 'Troca de bobina de filme', 12);
  await adicionarFoto(id, 'tela', foto());
  await adicionarFoto(id, 'produto', foto());
  alterarOp(id, { hora_fim: '10:30', passo_fim: 600, caixas: 110, peso_final_kg: 620 });
  encerrarOp(id);
  return id;
}

describe('rascunho', () => {
  it('OP nova só é gravada quando recebe o primeiro dado', async () => {
    const { id } = novaOp();
    await descarregar();
    expect(lerEstado().ops).toHaveLength(0);
    expect(await bancoLocal.todasOps()).toHaveLength(0);

    escolherProduto(id, SALMAO);
    await descarregar();
    expect(lerEstado().rascunho).toBeNull();
    expect(await bancoLocal.todasOps()).toHaveLength(1);
    expect(lerEstado().ops[0]).toMatchObject({ molde: '2x1', peso_nominal_kg: 0.6, embalagens_por_caixa: 9, _sujo: true });
  });
});

describe('critério 4: lançar sem conexão e sincronizar depois', () => {
  it('cria, conta retrabalho, fotografa e encerra offline; ao voltar a conexão, chega tudo sem duplicar', async () => {
    servidor.semRede = true;
    const id = await lancarOpCompleta();
    await sincronizar();

    expect(lerEstado().sync.situacao).toBe('sem_conexao');
    expect(servidor.ops.size).toBe(0);
    expect(lerEstado().ops[0]._sujo).toBe(true);
    expect(lerEstado().fotosPendentes).toHaveLength(2);

    // O aplicativo é fechado e reaberto ainda sem conexão: nada se perde.
    await reabrirApp();
    expect(lerEstado().ops).toHaveLength(1);
    expect(lerEstado().ops[0]).toMatchObject({ status: 'fechada', caixas: 110, _sujo: true });
    expect(lerEstado().ops[0].retrabalho).toMatchObject({ sem_vacuo: 5, furo: 2 });
    expect(lerEstado().fotosPendentes).toHaveLength(2);

    servidor.semRede = false;
    await sincronizar();
    await sincronizar(); // uma segunda rodada não reenvia nada

    expect(lerEstado().sync.situacao).toBe('parado');
    expect(servidor.ops.size).toBe(1);
    const noServidor = servidor.ops.get(id)!.op;
    expect(noServidor).toMatchObject({ status: 'fechada', caixas: 110, peso_final_kg: 620, passo_fim: 600 });
    expect(noServidor.retrabalho).toMatchObject({ sem_vacuo: 5, furo: 2 });
    expect(noServidor.paradas).toHaveLength(1);
    expect(noServidor.fotos).toHaveLength(2);
    expect(servidor.arquivos.size).toBe(2);
    expect(servidor.chamadas.salvarOp).toBe(1);
    expect(servidor.chamadas.enviarFoto).toBe(2);
    expect(lerEstado().ops).toHaveLength(1);
    expect(lerEstado().ops[0]._sujo).toBe(false);
    expect(lerEstado().fotosPendentes).toHaveLength(0);
  });

  it('resposta perdida no meio do envio: reenvia e o servidor continua com uma OP só', async () => {
    const id = await lancarOpCompleta();
    servidor.perderResposta = true;
    await sincronizar();
    expect(servidor.ops.size).toBe(1); // entrou no servidor…
    expect(lerEstado().ops[0]._sujo).toBe(true); // …mas o aparelho não ficou sabendo

    await sincronizar();
    expect(servidor.ops.size).toBe(1);
    expect(servidor.ops.get(id)!.op.fotos).toHaveLength(2);
    expect(servidor.arquivos.size).toBe(2);
    expect(lerEstado().ops).toHaveLength(1);
    expect(lerEstado().ops[0]._sujo).toBe(false);
  });

  it('alteração feita durante o envio continua pendente e vai na rodada seguinte', async () => {
    const { id } = novaOp();
    escolherProduto(id, SALMAO);
    let soltar!: () => void;
    servidor.segurar = new Promise((ok) => { soltar = ok; });
    const rodada = sincronizar();
    await new Promise((r) => setTimeout(r, 20));
    contarRetrabalho(id, 'ruga', 1); // toque "+1" enquanto o envio está no ar
    soltar();
    servidor.segurar = null;
    await rodada;

    expect(lerEstado().ops[0]._sujo).toBe(true);
    expect(servidor.ops.get(id)!.op.retrabalho?.ruga).toBe(0);
    await sincronizar();
    expect(lerEstado().ops[0]._sujo).toBe(false);
    expect(servidor.ops.get(id)!.op.retrabalho?.ruga).toBe(1);
  });

  it('parada e foto removidas saem do servidor; foto removida antes do envio nem sobe', async () => {
    const { id } = novaOp();
    escolherProduto(id, SALMAO);
    adicionarParada(id, 'Outro', 7);
    await adicionarFoto(id, 'tela', foto());
    await sincronizar();
    expect(servidor.ops.get(id)!.op.paradas).toHaveLength(1);
    expect(servidor.arquivos.size).toBe(1);

    const op = lerEstado().ops[0];
    removerParada(id, op.paradas[0].id);
    await removerFoto(id, op.fotos[0].id);
    await adicionarFoto(id, 'tela', foto());
    await removerFoto(id, lerEstado().ops[0].fotos[0].id);
    await sincronizar();

    expect(servidor.ops.get(id)!.op.paradas).toHaveLength(0);
    expect(servidor.ops.get(id)!.op.fotos).toHaveLength(0);
    expect(servidor.arquivos.size).toBe(0);
    expect(servidor.chamadas.enviarFoto).toBe(1);
    expect(await bancoLocal.todasFotos()).toHaveLength(0);
  });
});

describe('conflito entre aparelhos', () => {
  it('OP alterada por outro aparelho substitui a deste, se aqui não há alteração pendente', async () => {
    const { id } = novaOp();
    escolherProduto(id, SALMAO);
    await sincronizar();
    const outra = { ...servidor.ops.get(id)!.op, caixas: 50, alterado_em: new Date(Date.now() + 5000).toISOString() };
    servidor.gravarDeFora(outra);
    await sincronizar();
    expect(lerEstado().ops[0]).toMatchObject({ caixas: 50, _sujo: false });
  });

  it('vence a edição mais recente: a deste aparelho, se for a última', async () => {
    const { id } = novaOp();
    escolherProduto(id, SALMAO);
    await sincronizar();
    servidor.gravarDeFora({ ...servidor.ops.get(id)!.op, caixas: 50, alterado_em: new Date(Date.now() - 60000).toISOString() });
    alterarOp(id, { caixas: 70 });
    await sincronizar();
    expect(servidor.ops.get(id)!.op.caixas).toBe(70);
    expect(lerEstado().ops[0]).toMatchObject({ caixas: 70, _sujo: false });
  });

  it('vence a edição mais recente: a do servidor, se a deste aparelho for mais velha', async () => {
    const { id } = novaOp();
    escolherProduto(id, SALMAO);
    await sincronizar();
    alterarOp(id, { caixas: 70 });
    servidor.gravarDeFora({ ...servidor.ops.get(id)!.op, caixas: 50, alterado_em: new Date(Date.now() + 60000).toISOString() });
    await sincronizar();
    expect(servidor.ops.get(id)!.op.caixas).toBe(50);
    expect(lerEstado().ops[0]).toMatchObject({ caixas: 50, _sujo: false });
  });
});

describe('critério 5: operador e OP fechada', () => {
  it('o aplicativo não deixa o operador alterar OP fechada', async () => {
    const id = await lancarOpCompleta();
    alterarOp(id, { caixas: 1 });
    contarRetrabalho(id, 'peso', 1);
    expect(lerEstado().ops[0]).toMatchObject({ caixas: 110, status: 'fechada' });
    expect(lerEstado().ops[0].retrabalho?.peso).toBe(0);
  });

  it('se a OP foi encerrada por outra pessoa, a alteração do operador é recusada e vale a do servidor', async () => {
    const { id } = novaOp();
    escolherProduto(id, SALMAO);
    await sincronizar();
    servidor.gravarDeFora({ ...servidor.ops.get(id)!.op, status: 'fechada', caixas: 110, alterado_em: new Date(Date.now() - 60000).toISOString() });
    alterarOp(id, { caixas: 1 }); // este aparelho ainda acha que está aberta
    await sincronizar();
    expect(servidor.ops.get(id)!.op).toMatchObject({ status: 'fechada', caixas: 110 });
    expect(lerEstado().ops[0]).toMatchObject({ status: 'fechada', caixas: 110, _sujo: false });
  });

  it('P&D altera OP fechada', async () => {
    const id = await lancarOpCompleta();
    await sincronizar();
    servidor.papel = 'pd';
    await definirPerfil({ ...OPERADOR, papel: 'pd' });
    alterarOp(id, { caixas: 111 });
    await sincronizar();
    expect(servidor.ops.get(id)!.op).toMatchObject({ status: 'fechada', caixas: 111 });
    expect(lerEstado().ops[0]._sujo).toBe(false);
  });
});

describe('modo local (sem servidor)', () => {
  it('carrega o catálogo e o histórico da especificação na primeira vez', async () => {
    await bancoLocal.fechar();
    globalThis.indexedDB = new IDBFactory();
    await iniciarLoja({ servidor: null });
    const e = lerEstado();
    expect(e.produtos).toHaveLength(118);
    expect(e.ops.filter((o) => o.origem === 'planilha')).toHaveLength(15);
    expect(e.receitas).toHaveLength(1);
    expect(e.perfil?.papel).toBe('admin');
    await iniciarLoja({ servidor: null }); // de novo: não duplica
    expect(lerEstado().ops).toHaveLength(15);
  });

  it('aparelho com o catálogo antigo recebe os SKUs e campos novos sem perder o que já tinha', async () => {
    await bancoLocal.fechar();
    globalThis.indexedDB = new IDBFactory();
    // Como a versão anterior gravava: 2 produtos, sem derivação, um deles com embalagens por caixa informada e inativo.
    await bancoLocal.gravar('produtos', [
      { codigo: '24616701063781-975', descricao: 'F. SALMON PREM PEDACOS S/E 600GR SKIN PREMIUM', molde: '2x1', peso_nominal_kg: 0.6, embalagens_por_caixa: 12, ativo: false },
      { codigo: 'XX-1', descricao: 'PRODUTO INCLUÍDO NO APARELHO', molde: '3x1', peso_nominal_kg: null, embalagens_por_caixa: null, ativo: true },
    ]);
    await iniciarLoja({ servidor: null });
    const produtos = lerEstado().produtos;
    expect(produtos).toHaveLength(119); // os 118 da planilha + o incluído no aparelho
    expect(produtos.find((p) => p.codigo === '24616701063781-975')).toMatchObject({
      derivacao: 'FRESCATTO CXA 09', peso_caixa_kg: 9, especie: 'SALMON', embalagens_por_caixa: 12, ativo: false,
    });
    expect(produtos.find((p) => p.codigo === 'XX-1')).toMatchObject({ derivacao: null, molde: '3x1' });
    expect(await bancoLocal.ler('versao_semente')).toBe(VERSAO_SEMENTE);
  });

  it('escolher produto: peso fixo preenche embalagens por caixa; PDV deixa vazio; SKU sem molde mantém o da OP', async () => {
    await bancoLocal.fechar();
    globalThis.indexedDB = new IDBFactory();
    await iniciarLoja({ servidor: null });
    const produtos = lerEstado().produtos;
    const { id } = novaOp();
    escolherProduto(id, produtos.find((p) => p.codigo === '10068093246591-964')!); // 500 g, caixa de 7,5 kg
    expect(lerEstado().ops.find((o) => o.id === id)).toMatchObject({ molde: '2x1', peso_nominal_kg: 0.5, embalagens_por_caixa: 15 });
    escolherProduto(id, produtos.find((p) => p.codigo === '06042002001341-1058')!); // PDV
    expect(lerEstado().ops.find((o) => o.id === id)).toMatchObject({ molde: '3x1', peso_nominal_kg: null, embalagens_por_caixa: null });
    escolherProduto(id, produtos.find((p) => p.codigo === '0938907200103M-815')!); // sem molde no catálogo
    expect(lerEstado().ops.find((o) => o.id === id)).toMatchObject({ molde: '3x1', produto_codigo: '0938907200103M-815' });
    const op = lerEstado().ops.find((o) => o.id === id)!;
    expect(validarEncerramento(op, calcular(op, lerEstado().moldes)).faltas).toContain('embalagens por caixa (produto de peso variável)');
  });
});
