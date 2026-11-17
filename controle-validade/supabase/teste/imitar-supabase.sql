-- Imita o mínimo do Supabase num PostgreSQL comum, só para testar o instalar.sql:
-- os papéis, auth.users e auth.uid() (que lê o usuário da sessão, como o Supabase faz a cada pedido).
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'casa-um@exemplo.com'),
  ('22222222-2222-2222-2222-222222222222', 'casa-dois@exemplo.com');
