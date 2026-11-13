// Função de borda "ler-telas": recebe as fotos das telas da IHM e devolve os
// parâmetros lidos. A chave da Anthropic fica só aqui, no servidor
// (segredo ANTHROPIC_API_KEY); o aplicativo nunca a vê.
//
// Entrada:  POST { "fotos": [ { "tipo": "image/jpeg", "base64": "..." }, ... ] }  (até 3)
// Saída:    { "telas": [417, 414, 412], "valores": { "t_dome": 225, ... }, "duvidas": "" }
//
// Só usuários ativos do aplicativo podem chamar.

import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import { ErroLeitura, lerTelas, validarFotos } from './leitura.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

/** Confere, com o próprio token de quem chamou, se é um usuário ativo que lança (o gestor só consulta). */
async function usuarioAtivo(req: Request): Promise<boolean> {
  const autorizacao = req.headers.get('Authorization');
  if (!autorizacao) return false;
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: autorizacao } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await sb.rpc('papel_atual');
  return !error && (data === 'operador' || data === 'pd' || data === 'admin');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ erro: 'Use POST.' }, 405);

  try {
    if (!(await usuarioAtivo(req))) return json({ erro: 'Acesso não liberado.' }, 403);

    const chave = Deno.env.get('ANTHROPIC_API_KEY');
    if (!chave) return json({ erro: 'Leitura automática não configurada (falta ANTHROPIC_API_KEY).' }, 503);

    const fotos = validarFotos(await req.json().catch(() => null));
    const leitura = await lerTelas(new Anthropic({ apiKey: chave }), fotos);
    return json(leitura);
  } catch (e) {
    if (e instanceof ErroLeitura) return json({ erro: e.message }, e.status);
    if (e instanceof Anthropic.RateLimitError) return json({ erro: 'Muitas leituras seguidas. Tente daqui a pouco.' }, 429);
    if (e instanceof Anthropic.AuthenticationError) {
      console.error('Chave da Anthropic recusada.');
      return json({ erro: 'Leitura automática não configurada (chave recusada).' }, 503);
    }
    if (e instanceof Anthropic.BadRequestError) {
      console.error('Pedido recusado pela API:', e.message);
      return json({ erro: 'As fotos não puderam ser lidas.' }, 422);
    }
    if (e instanceof Anthropic.APIError) {
      console.error(`Erro da API (${e.status}):`, e.message);
      return json({ erro: 'Serviço de leitura indisponível. Tente de novo.' }, 502);
    }
    console.error(e);
    return json({ erro: 'Erro inesperado na leitura.' }, 500);
  }
});
