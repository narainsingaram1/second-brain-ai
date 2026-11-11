-- Original résumé files live outside workspace snapshots. Uploading a new version never replaces
-- an old application's file. Only the owning authenticated account can upload or read it.
do $$
begin
  -- PostgreSQL-only development/test installations may not have Supabase Storage installed.
  if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then return; end if;
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('career-resumes', 'career-resumes', false, 5242880,
      array['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
    on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'career_resumes_read_own') then
    create policy career_resumes_read_own on storage.objects for select to authenticated
      using (bucket_id = 'career-resumes' and split_part(name, '/', 1) = (select auth.uid())::text);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'career_resumes_insert_own') then
    create policy career_resumes_insert_own on storage.objects for insert to authenticated
      with check (bucket_id = 'career-resumes' and split_part(name, '/', 1) = (select auth.uid())::text);
  end if;
end;
$$;
