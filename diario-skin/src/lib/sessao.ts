// Login (Supabase Auth). O perfil do usuário fica guardado no aparelho, para
// o aplicativo abrir e funcionar sem internet depois do primeiro acesso.

import { MODO_LOCAL } from './config';
import { definirPerfil, lerEstado } from './loja';
import { perfilDaLinha, supabase } from './servidor';
import { definirVerificadorDeSessao, sincronizar } from './sincronizacao';

const SEM_REDE = /failed to fetch|networkerror|load failed|fetch failed/i;

/** Mensagens do serviço de login, em português. */
function traduzir(erro: { message?: string; code?: string } | null): string {
  const codigo = erro?.code ?? '';
  const msg = erro?.message ?? '';
  if (SEM_REDE.test(msg)) return 'Sem conexão. O primeiro acesso precisa de internet.';
  switch (codigo) {
    case 'invalid_credentials': return 'E-mail ou senha incorretos.';
    case 'email_not_confirmed': return 'Confirme seu e-mail pelo link que enviamos e tente de novo.';
    case 'user_already_exists':
    case 'email_exists': return 'Já existe uma conta com este e-mail. Use "Entrar".';
    case 'weak_password': return 'Senha fraca: use pelo menos 8 caracteres.';
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit': return 'Muitas tentativas. Aguarde um minuto e tente de novo.';
    case 'otp_expired': return 'Código vencido ou incorreto. Peça um novo.';
    case 'signup_disabled': return 'A criação de contas está desativada. Fale com o administrador.';
    case 'email_address_invalid':
    case 'validation_failed': return 'Confira o e-mail digitado.';
    default: break;
  }
  if (/invalid login credentials/i.test(msg)) return 'E-mail ou senha incorretos.';
  if (/token has expired|otp/i.test(msg)) return 'Código vencido ou incorreto. Peça um novo.';
  return msg || 'Não foi possível concluir. Tente de novo.';
}

/** Endereço do aplicativo, sem âncora: para onde o link do e-mail volta. */
const enderecoDoApp = (): string => window.location.origin + window.location.pathname;

async function carregarPerfil(uid: string, email: string | undefined): Promise<void> {
  const { data, error } = await supabase().from('perfis').select('*').eq('id', uid).maybeSingle();
  if (error) {
    // Sem rede: segue com o perfil guardado no aparelho, se for do mesmo usuário.
    if (lerEstado().perfil?.id !== uid) console.warn('Perfil indisponível:', error.message);
    return;
  }
  const perfil = data
    ? perfilDaLinha(data)
    : { id: uid, nome: email?.split('@')[0] ?? 'Sem nome', papel: 'operador' as const, ativo: false };
  await definirPerfil(perfil);
  if (perfil.ativo) void sincronizar({ cadastros: true });
}

export function iniciarSessao(): void {
  if (MODO_LOCAL) return;
  const sb = supabase();
  definirVerificadorDeSessao(async () => {
    const { data } = await sb.auth.getSession();
    return data.session != null;
  });
  sb.auth.onAuthStateChange((evento, sessao) => {
    // Fora do retorno do evento, como a biblioteca recomenda (evita travar a fila interna dela).
    setTimeout(() => {
      if (evento === 'SIGNED_OUT') {
        void definirPerfil(null);
      } else if (sessao?.user && (evento === 'SIGNED_IN' || evento === 'INITIAL_SESSION' || evento === 'USER_UPDATED')) {
        void carregarPerfil(sessao.user.id, sessao.user.email);
      }
      // Sem sessão por falta de rede (token vencido offline): o perfil guardado continua valendo.
    }, 0);
  });
}

export async function verificarLiberacao(): Promise<void> {
  const { data } = await supabase().auth.getUser();
  if (data.user) await carregarPerfil(data.user.id, data.user.email);
}

/** Cada função devolve null se deu certo, ou a mensagem de erro. */
export async function entrarComSenha(email: string, senha: string): Promise<string | null> {
  try {
    const { error } = await supabase().auth.signInWithPassword({ email: email.trim(), password: senha });
    return error ? traduzir(error) : null;
  } catch (e) {
    return traduzir(e as Error);
  }
}

export async function criarConta(nome: string, email: string, senha: string): Promise<{ erro: string | null; confirmar: boolean }> {
  try {
    const { data, error } = await supabase().auth.signUp({
      email: email.trim(),
      password: senha,
      options: { data: { nome: nome.trim() }, emailRedirectTo: enderecoDoApp() },
    });
    if (error) return { erro: traduzir(error), confirmar: false };
    // Sem sessão = o projeto exige confirmar o e-mail antes de entrar.
    return { erro: null, confirmar: !data.session };
  } catch (e) {
    return { erro: traduzir(e as Error), confirmar: false };
  }
}

/** Envia por e-mail um link de acesso (e um código de 6 dígitos, se o modelo do e-mail incluir). */
export async function pedirLink(email: string, nome?: string): Promise<string | null> {
  try {
    const { error } = await supabase().auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: enderecoDoApp(), data: nome?.trim() ? { nome: nome.trim() } : undefined },
    });
    return error ? traduzir(error) : null;
  } catch (e) {
    return traduzir(e as Error);
  }
}

export async function entrarComCodigo(email: string, codigo: string): Promise<string | null> {
  try {
    const { error } = await supabase().auth.verifyOtp({ email: email.trim(), token: codigo.trim(), type: 'email' });
    return error ? traduzir(error) : null;
  } catch (e) {
    return traduzir(e as Error);
  }
}

export async function sair(): Promise<void> {
  if (MODO_LOCAL) return;
  // scope 'local': encerra só neste aparelho e funciona mesmo sem rede.
  await supabase().auth.signOut({ scope: 'local' }).catch(() => {});
  await definirPerfil(null);
}
