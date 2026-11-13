// Banco do aparelho (IndexedDB). Tudo que o usuário lança é gravado aqui
// primeiro; o envio ao servidor acontece depois, quando houver conexão.

import { openDB, type IDBPDatabase } from 'idb';
import type { OpLocal } from './tipos';

const NOME = 'diario-skin';
const VERSAO = 1;

/** Foto guardada no aparelho. Os bytes ficam como ArrayBuffer (mais compatível que Blob no IndexedDB). */
export interface FotoGuardada {
  id: string;
  op_id: string;
  caminho: string;
  dados: ArrayBuffer;
  enviada: boolean;
  criado_em: string;
}

let conexao: Promise<IDBPDatabase> | null = null;

function abrir(): Promise<IDBPDatabase> {
  conexao ??= openDB(NOME, VERSAO, {
    upgrade(db) {
      db.createObjectStore('ops', { keyPath: 'id' });
      db.createObjectStore('fotos', { keyPath: 'id' });
      db.createObjectStore('kv');
    },
  });
  return conexao;
}

export const bancoLocal = {
  async todasOps(): Promise<OpLocal[]> {
    return (await abrir()).getAll('ops');
  },

  async gravarOps(ops: OpLocal[]): Promise<void> {
    if (!ops.length) return;
    const tx = (await abrir()).transaction('ops', 'readwrite');
    for (const op of ops) void tx.store.put(op);
    await tx.done;
  },

  async todasFotos(): Promise<FotoGuardada[]> {
    return (await abrir()).getAll('fotos');
  },

  async lerFoto(id: string): Promise<FotoGuardada | undefined> {
    return (await abrir()).get('fotos', id);
  },

  async gravarFoto(foto: FotoGuardada): Promise<void> {
    await (await abrir()).put('fotos', foto);
  },

  async apagarFoto(id: string): Promise<void> {
    await (await abrir()).delete('fotos', id);
  },

  async ler<T>(chave: string): Promise<T | undefined> {
    return (await abrir()).get('kv', chave);
  },

  async gravar(chave: string, valor: unknown): Promise<void> {
    await (await abrir()).put('kv', valor, chave);
  },

  async apagar(chave: string): Promise<void> {
    await (await abrir()).delete('kv', chave);
  },

  /** Só para os testes: fecha e esquece a conexão. */
  async fechar(): Promise<void> {
    if (conexao) (await conexao).close();
    conexao = null;
  },
};

/** Pede ao navegador para não descartar os dados do aparelho quando faltar espaço. */
export function pedirArmazenamentoPersistente(): void {
  try {
    void navigator.storage?.persist?.();
  } catch {
    /* sem suporte: segue sem */
  }
}
