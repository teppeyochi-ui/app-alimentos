// Configuração lida das variáveis VITE_* (arquivo .env; ver .env.example).

const url = (import.meta.env.VITE_SUPABASE_URL ?? '').trim();
const chave = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim();

export const SUPABASE_URL = url;
export const SUPABASE_CHAVE = chave;

/**
 * Sem servidor configurado, o aplicativo roda em modo local: tudo funciona,
 * mas os dados ficam só neste aparelho e não há login.
 */
export const MODO_LOCAL = !url || !chave;
