-- Diário da Linha Skin — armazenamento das fotos (bucket privado fotos-op).
--
-- Caminho de cada arquivo: <id da OP>/<id da foto>.jpg
-- O aplicativo exibe as fotos com endereços assinados de curta duração.
-- Quem está ativo envia e vê; só P&D e administrador apagam arquivos.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fotos-op', 'fotos-op', false, 5242880, array['image/jpeg'])
on conflict (id) do nothing;

create policy fotos_op_ver on storage.objects for select to authenticated
  using (bucket_id = 'fotos-op' and (select public.usuario_ativo()));

create policy fotos_op_enviar on storage.objects for insert to authenticated
  with check (bucket_id = 'fotos-op' and (select public.usuario_ativo()));

create policy fotos_op_apagar on storage.objects for delete to authenticated
  using (bucket_id = 'fotos-op' and (select public.papel_atual()) in ('pd','admin'));
