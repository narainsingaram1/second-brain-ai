-- Images pasted into notes live outside note text so autosaves stay small. Each object is named
-- <account id>/<content hash>.<ext>, so the same image is stored once and never changes.
-- Only the owning authenticated account can upload or read its images.
do $$
begin
  -- PostgreSQL-only development/test installations may not have Supabase Storage installed.
  if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then return; end if;
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('note-images', 'note-images', false, 10485760, array['image/webp','image/png','image/jpeg','image/gif'])
    on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'note_images_read_own') then
    create policy note_images_read_own on storage.objects for select to authenticated
      using (bucket_id = 'note-images' and split_part(name, '/', 1) = (select auth.uid())::text);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'note_images_insert_own') then
    create policy note_images_insert_own on storage.objects for insert to authenticated
      with check (bucket_id = 'note-images' and split_part(name, '/', 1) = (select auth.uid())::text);
  end if;
end;
$$;
