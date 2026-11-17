/*
 * nuvem-config.js — Endereço e chave pública do projeto da casa no Supabase.
 *
 * Com os dois preenchidos, todo aparelho que abrir o app já sabe onde fica a nuvem: basta entrar com
 * a conta da casa em Ajustes → Nuvem. Vazios, o app pede o endereço e a chave em cada aparelho.
 *
 * As duas informações são públicas por natureza (vão dentro do app publicado). Quem protege os dados
 * são a conta da casa e as regras do banco (supabase/instalar.sql). Use a chave "publishable" (ou a
 * "anon"); nunca a chave secreta (service_role).
 */
window.NUVEM = {
  url: '',
  chave: '',
};
