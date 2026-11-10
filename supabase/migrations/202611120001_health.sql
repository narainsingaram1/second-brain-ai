-- Health workspace: Apple Health data stored as one record per day (collection healthDays), a "health"
-- workspace template, and per-account tokens that let the phone push data without a signed-in session.
-- Additive: every existing record stays valid.

create or replace function public.record_collections()
returns text[] language sql immutable set search_path = '' as $$
  select array['tasks','goals','habits','journalEntries','knowledgeItems','events','trackerItems','workspaces','healthDays',
    'noteFolders','conversations','study.courses','study.folders','study.documents','study.decks','study.quizzes','memory']
$$;

create or replace function public.valid_record(p_collection text, p_id text, p_data jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
begin
  if not (p_collection = any(public.record_collections())) or jsonb_typeof(p_data) is distinct from 'object' then
    return false;
  end if;
  if p_collection = 'memory' then
    return p_id = 'agent' and public.valid_agent_memory(p_data);
  end if;
  if p_data->>'id' is distinct from p_id or length(p_id) not between 1 and 200 then return false; end if;
  if octet_length(p_data::text) > (case when p_collection = 'conversations' then 1048576 else 524288 end) then return false; end if;
  if p_collection = 'workspaces' then
    return jsonb_typeof(p_data->'name') = 'string' and length(btrim(p_data->>'name')) between 1 and 80
      and jsonb_typeof(p_data->'description') = 'string' and length(p_data->>'description') <= 300
      and coalesce(p_data->>'template','') in ('career','academic','health','blank')
      and coalesce(p_data->>'color','') in ('purple','blue','green','amber','rose')
      and jsonb_typeof(p_data->'notes') = 'string' and length(p_data->>'notes') <= 200000
      and jsonb_typeof(p_data->'createdAt') = 'string'
      and (not (p_data ? 'health') or jsonb_typeof(p_data->'health') = 'object');
  elsif p_collection = 'trackerItems' then
    return jsonb_typeof(p_data->'title') = 'string'
      and coalesce(p_data->>'kind','') in ('leetcode','job_application')
      and jsonb_typeof(p_data->'fields') = 'object' and jsonb_typeof(p_data->'history') = 'object'
      and (not (p_data ? 'workspaceId') or jsonb_typeof(p_data->'workspaceId') = 'string');
  elsif p_collection = 'events' then
    return jsonb_typeof(p_data->'title') = 'string' and length(btrim(p_data->>'title')) between 1 and 300
      and coalesce(p_data->>'kind','') in ('meeting','event','class','appointment')
      and coalesce(p_data->>'date','') ~ '^\d{4}-\d{2}-\d{2}$'
      and (not (p_data ? 'startTime') or coalesce(p_data->>'startTime','') ~ '^([01]\d|2[0-3]):[0-5]\d$')
      and (not (p_data ? 'endTime') or coalesce(p_data->>'endTime','') ~ '^([01]\d|2[0-3]):[0-5]\d$')
      and (not (p_data ? 'link') or coalesce(p_data->>'link','') ~* '^https?://')
      and (not (p_data ? 'attendees') or jsonb_typeof(p_data->'attendees') = 'array')
      and (not (p_data ? 'notes') or length(p_data->>'notes') <= 20000);
  elsif p_collection = 'healthDays' then
    return coalesce(p_data->>'date','') ~ '^\d{4}-\d{2}-\d{2}$'
      and p_id = 'health-' || (p_data->>'date')
      and jsonb_typeof(p_data->'metrics') = 'object'
      and jsonb_typeof(p_data->'updatedAt') = 'string'
      and not exists (select 1 from jsonb_each(p_data->'metrics') m where jsonb_typeof(m.value) is distinct from 'number')
      and (not (p_data ? 'workouts') or (jsonb_typeof(p_data->'workouts') = 'array' and jsonb_array_length(p_data->'workouts') <= 30))
      and (not (p_data ? 'tags') or (jsonb_typeof(p_data->'tags') = 'array' and jsonb_array_length(p_data->'tags') <= 20))
      and (not (p_data ? 'note') or (jsonb_typeof(p_data->'note') = 'string' and length(p_data->>'note') <= 2000))
      and octet_length(p_data::text) <= 32768;
  end if;
  return true;
end;
$$;

-- One sync token per account. Only its SHA-256 is stored; the token itself is shown once when created.
-- People can see when their phone last synced and revoke the token; creating one goes through the RPC.
-- The sync endpoint uses the service role only to find which account a token belongs to.
create table if not exists public.health_sync_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  hint text not null check (length(hint) <= 8),
  created_at timestamptz not null default now(),
  last_sync_at timestamptz,
  last_sync_days integer,
  last_sync_source text check (length(last_sync_source) <= 80)
);
alter table public.health_sync_tokens enable row level security;
revoke all on public.health_sync_tokens from public, anon, authenticated;
grant select (user_id, hint, created_at, last_sync_at, last_sync_days, last_sync_source), delete on public.health_sync_tokens to authenticated;
create policy health_sync_tokens_read_own on public.health_sync_tokens for select to authenticated
  using ((select auth.uid()) = user_id);
create policy health_sync_tokens_delete_own on public.health_sync_tokens for delete to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.set_health_sync_token(p_token_hash text, p_hint text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
begin
  if owner_id is null then raise exception 'Not authorized' using errcode = '42501'; end if;
  insert into public.health_sync_tokens (user_id, token_hash, hint)
  values (owner_id, p_token_hash, p_hint)
  on conflict (user_id) do update set token_hash = excluded.token_hash, hint = excluded.hint, created_at = now(),
    last_sync_at = null, last_sync_days = null, last_sync_source = null;
end;
$$;
revoke all on function public.set_health_sync_token(text, text) from public, anon, authenticated;
grant execute on function public.set_health_sync_token(text, text) to authenticated;

do $$
begin
  if exists (select from pg_roles where rolname = 'service_role') then
    grant select, update on public.health_sync_tokens to service_role;
  end if;
end;
$$;
