// Servidor de mentira para os testes: guarda as OPs em memória e segue as
// mesmas regras da função salvar_op e das políticas do banco.

import { ErroServidor, type Cadastros, type OpDoServidor, type ResultadoSalvar, type Servidor } from '../../src/lib/servidor';
import type { Op, OpLocal, Papel } from '../../src/lib/tipos';

export class ServidorFalso implements Servidor {
  ops = new Map<string, { op: Op; sincronizado_em: string }>();
  arquivos = new Map<string, number>(); // caminho → tamanho
  papel: Papel = 'operador';
  /** Sem conexão: toda chamada falha antes de chegar. */
  semRede = false;
  /** A próxima gravação entra no servidor, mas a resposta se perde. */
  perderResposta = false;
  /** Se definido, salvarOp espera esta promessa antes de responder. */
  segurar: Promise<void> | null = null;
  chamadas = { salvarOp: 0, enviarFoto: 0, baixarOps: 0 };
  cadastros: Cadastros = { produtos: [], moldes: [], receitas: [], perfis: [] };
  private relogio = Date.parse('2026-11-12T12:00:00Z');

  private rede(): void {
    if (this.semRede) throw new ErroServidor('rede', 'Failed to fetch');
  }
  private agora(): string {
    this.relogio += 1000;
    return new Date(this.relogio).toISOString();
  }
  private podeAlterar(atual: Op | undefined, novoStatus: string): boolean {
    if (this.papel === 'admin') return true;
    if (this.papel === 'pd') return atual?.status !== 'cancelada' && novoStatus !== 'cancelada';
    return (!atual || atual.status === 'aberta') && novoStatus !== 'cancelada';
  }

  async salvarOp(local: OpLocal): Promise<ResultadoSalvar> {
    this.rede();
    this.chamadas.salvarOp++;
    if (this.segurar) await this.segurar;
    const { _sujo, _paradas_removidas, _fotos_removidas, ...op } = local;
    void _sujo;
    const guardada = this.ops.get(op.id);
    if (guardada?.op.alterado_em) {
      if (guardada.op.alterado_em === op.alterado_em) return 'igual';
      if (guardada.op.alterado_em > (op.alterado_em ?? '')) return 'ignorada';
    }
    if (!this.podeAlterar(guardada?.op, op.status)) throw new ErroServidor('permissao', 'new row violates row-level security policy');
    // Paradas e fotos se somam; só saem as removidas.
    const paradas = new Map((guardada?.op.paradas ?? []).map((p) => [p.id, p]));
    for (const p of op.paradas) paradas.set(p.id, p);
    for (const id of _paradas_removidas) paradas.delete(id);
    const fotos = new Map((guardada?.op.fotos ?? []).map((f) => [f.id, f]));
    for (const f of op.fotos) fotos.set(f.id, f);
    for (const id of _fotos_removidas) fotos.delete(id);
    this.ops.set(op.id, {
      op: structuredClone({ ...op, paradas: [...paradas.values()], fotos: [...fotos.values()] }),
      sincronizado_em: this.agora(),
    });
    if (this.perderResposta) {
      this.perderResposta = false;
      throw new ErroServidor('rede', 'Failed to fetch');
    }
    return 'gravada';
  }

  async baixarOps(desde: string | null): Promise<OpDoServidor[]> {
    this.rede();
    this.chamadas.baixarOps++;
    return [...this.ops.values()]
      .filter((l) => !desde || l.sincronizado_em > desde)
      .map((l) => structuredClone(l));
  }

  async baixarOp(id: string): Promise<Op | null> {
    this.rede();
    const l = this.ops.get(id);
    return l ? structuredClone(l.op) : null;
  }

  async baixarCadastros(): Promise<Cadastros> {
    this.rede();
    return structuredClone(this.cadastros);
  }

  async enviarFoto(caminho: string, blob: Blob): Promise<void> {
    this.rede();
    this.chamadas.enviarFoto++;
    this.arquivos.set(caminho, blob.size);
  }

  async apagarFotos(caminhos: string[]): Promise<void> {
    for (const c of caminhos) this.arquivos.delete(c);
  }

  async urlFoto(): Promise<string | null> { return null; }
  async lerTelas() { return { telas: [], valores: {}, duvidas: '' }; }
  async baixarHistorico() { return []; }
  async analisarOp() {
    return { nota_aparencia: null, defeitos: [], diagnostico: '', sugestoes: [], confianca: 'baixa' as const, limitacoes: '' };
  }
  async salvarProdutos(): Promise<void> {}
  async salvarMolde(): Promise<void> {}
  async incluirReceita(): Promise<void> {}
  async salvarPerfil(): Promise<void> {}

  /** Outro aparelho gravou esta OP direto no servidor. */
  gravarDeFora(op: Op): void {
    this.ops.set(op.id, { op: structuredClone(op), sincronizado_em: this.agora() });
  }
}
