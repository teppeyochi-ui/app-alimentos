// Ações da Administração: catálogo, pesos de filme, receita padrão e usuários.
// Com servidor, grava lá e baixa de novo; em modo local, grava só no aparelho.

import { bancoLocal } from './banco-local';
import { lerEstado, lerServidor, receberCadastros } from './loja';
import { classificar } from './servidor';
import { sincronizar } from './sincronizacao';
import type { Molde, MoldeInfo, Perfil, Produto, ReceitaPadrao } from './tipos';

function mensagem(e: unknown): string {
  const erro = classificar(e);
  if (erro.tipo === 'rede') return 'Sem conexão. A administração precisa de internet.';
  if (erro.tipo === 'permissao') return 'Só o administrador pode alterar este cadastro.';
  if (erro.tipo === 'sessao') return 'Sua sessão expirou. Entre de novo.';
  if (/administrador ativo/i.test(erro.message)) return 'Precisa existir pelo menos um administrador ativo.';
  return erro.message;
}

/** Roda a ação no servidor (ou no aparelho, em modo local). Devolve null ou a mensagem de erro. */
async function gravar(noServidor: () => Promise<void>, noAparelho: () => Promise<void>): Promise<string | null> {
  try {
    if (lerServidor()) {
      await noServidor();
      await sincronizar({ cadastros: true });
    } else {
      await noAparelho();
    }
    return null;
  } catch (e) {
    return mensagem(e);
  }
}

const atuais = () => {
  const { produtos, moldes, receitas, perfis } = lerEstado();
  return { produtos, moldes, receitas, perfis };
};

/** Inclui ou altera produtos (pelo código). */
export function salvarProdutos(novos: Produto[]): Promise<string | null> {
  return gravar(
    () => lerServidor()!.salvarProdutos(novos),
    async () => {
      const porCodigo = new Map(lerEstado().produtos.map((p) => [p.codigo, p]));
      for (const p of novos) porCodigo.set(p.codigo, p);
      const produtos = [...porCodigo.values()].sort((a, b) => a.codigo.localeCompare(b.codigo));
      await receberCadastros({ ...atuais(), produtos });
    },
  );
}

/** Grava no catálogo o molde confirmado para o SKU (deixa de pedir confirmação). */
export function confirmarMolde(produto: Produto, molde: Molde): Promise<string | null> {
  return salvarProdutos([{ ...produto, molde, molde_a_confirmar: false }]);
}

export function salvarMolde(molde: MoldeInfo): Promise<string | null> {
  return gravar(
    () => lerServidor()!.salvarMolde(molde),
    () => receberCadastros({ ...atuais(), moldes: lerEstado().moldes.map((m) => (m.molde === molde.molde ? molde : m)) }),
  );
}

/** A receita nova entra como linha nova; as anteriores ficam como histórico. */
export function incluirReceita(receita: Omit<ReceitaPadrao, 'id'>): Promise<string | null> {
  return gravar(
    () => lerServidor()!.incluirReceita(receita),
    async () => {
      const id = Math.max(0, ...lerEstado().receitas.map((r) => r.id)) + 1;
      await receberCadastros({ ...atuais(), receitas: [...lerEstado().receitas, { ...receita, id }] });
    },
  );
}

export function salvarPerfil(perfil: Perfil): Promise<string | null> {
  return gravar(
    () => lerServidor()!.salvarPerfil(perfil),
    async () => {
      await bancoLocal.gravar('perfis', lerEstado().perfis.map((p) => (p.id === perfil.id ? perfil : p)));
    },
  );
}
