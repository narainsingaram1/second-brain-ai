-- Per-record cloud storage. Each task, note, event, course item and so on is its own row with its own
-- revision, so a save sends only what changed and two devices conflict only when they edit the same
-- record. The `brains` row keeps small preferences and the open conversation.
--
-- Rollout: additive. Accounts move to the new layout when an updated client calls
-- migrate_brain_to_records(); until then save_brain keeps working as before.

alter table public.brains add column if not exists layout smallint not null default 1 check (layout in (1, 2));

create sequence if not exists public.brain_record_seq;

create table if not exists public.brain_records (
  user_id uuid not null references auth.users(id) on delete cascade,
  collection text not null,
  id text not null check (length(id) between 1 and 200),
  data jsonb,
  revision bigint not null check (revision > 0),
  seq bigint not null,
  -- Creation order, never changed by edits, so lists keep a stable order after reload.
  ord bigint not null,
  deleted boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, collection, id),
  constraint brain_record_shape check ((deleted and data is null) or (not deleted and jsonb_typeof(data) = 'object')),
  constraint brain_record_size check (data is null or octet_length(data::text) <= 1048576)
);
create index if not exists brain_records_user_seq on public.brain_records (user_id, seq);
alter table public.brain_records enable row level security;
revoke all on public.brain_records from public, anon, authenticated;
grant select on public.brain_records to authenticated;
create policy brain_records_read_own on public.brain_records for select to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.record_collections()
returns text[] language sql immutable set search_path = '' as $$
  select array['tasks','goals','habits','journalEntries','knowledgeItems','events','trackerItems','workspaces',
    'noteFolders','conversations','study.courses','study.folders','study.documents','study.decks','study.quizzes','memory']
$$;

-- The same per-entity rules save_brain applies to whole collections, applied to one record.
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
      and coalesce(p_data->>'template','') in ('career','academic','blank')
      and coalesce(p_data->>'color','') in ('purple','blue','green','amber','rose')
      and jsonb_typeof(p_data->'notes') = 'string' and length(p_data->>'notes') <= 200000
      and jsonb_typeof(p_data->'createdAt') = 'string';
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
  end if;
  return true;
end;
$$;

-- Keys that may remain in the brains row once an account uses records.
create or replace function public.preference_keys()
returns text[] language sql immutable set search_path = '' as $$
  select array['chatHistory','sections','subsections','conversationId','selectedModel','theme','taskAppearance',
    'dailyBrief','auditLog','preferences']
$$;

-- A tab that loaded before the upgrade still sends whole collections through save_brain. Refuse it
-- rather than let it overwrite the moved records with an outdated copy.
create or replace function public.brains_guard_layout()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.layout = 2 and new.layout = 2 and exists (
    select 1 from jsonb_object_keys(new.state) k where not (k = any(public.preference_keys()))
  ) then
    raise exception 'This workspace was upgraded. Reload the app to continue.' using errcode = '40001';
  end if;
  return new;
end;
$$;
drop trigger if exists brains_guard_layout on public.brains;
create trigger brains_guard_layout before update on public.brains
  for each row execute function public.brains_guard_layout();

-- Lists the app shows newest first; their snapshot arrays start with the newest entry.
create or replace function public.newest_first_collections()
returns text[] language sql immutable set search_path = '' as $$
  select array['tasks','goals','journalEntries','knowledgeItems','conversations']
$$;

-- Atomically moves every collection out of the snapshot into records. Safe to call repeatedly.
create or replace function public.migrate_brain_to_records()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  row_state jsonb;
  row_layout smallint;
  coll text;
  source jsonb;
  item jsonb;
  item_id text;
  next_seq bigint;
  moved integer := 0;
begin
  if owner_id is null then raise exception 'Not authorized' using errcode = '42501'; end if;
  select state, layout into row_state, row_layout from public.brains where user_id = owner_id for update;
  if not found then
    insert into public.brains (user_id, state, revision, layout) values (owner_id, '{}'::jsonb, 1, 2)
    on conflict (user_id) do nothing;
    return jsonb_build_object('layout', 2, 'moved', 0);
  end if;
  if row_layout = 2 then return jsonb_build_object('layout', 2, 'moved', 0); end if;

  foreach coll in array public.record_collections() loop
    if coll = 'memory' then
      if jsonb_typeof(row_state->'agentMemory') = 'object' then
        next_seq := nextval('public.brain_record_seq');
        insert into public.brain_records (user_id, collection, id, data, revision, seq, ord)
        values (owner_id, 'memory', 'agent', row_state->'agentMemory', 1, next_seq, next_seq)
        on conflict do nothing;
        moved := moved + 1;
      end if;
      continue;
    end if;
    source := case when coll like 'study.%' then row_state->'study'->substr(coll, 7) else row_state->coll end;
    if jsonb_typeof(source) is distinct from 'array' then continue; end if;
    -- Insert oldest first so creation order matches the snapshot order.
    for item in select e.value from jsonb_array_elements(source) with ordinality e(value, n)
        order by case when coll = any(public.newest_first_collections()) then -e.n else e.n end loop
      if jsonb_typeof(item) is distinct from 'object' then continue; end if;
      item_id := item->>'id';
      -- Entries without a usable ID keep their content under a stable derived one.
      if item_id is null or length(item_id) not between 1 and 200 then
        item_id := 'legacy-' || md5(item::text);
        item := item || jsonb_build_object('id', item_id);
      end if;
      next_seq := nextval('public.brain_record_seq');
      insert into public.brain_records (user_id, collection, id, data, revision, seq, ord)
      values (owner_id, coll, item_id, item, 1, next_seq, next_seq)
      on conflict do nothing;
      moved := moved + 1;
    end loop;
  end loop;

  update public.brains set
    state = (select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) from jsonb_each(row_state) where key = any(public.preference_keys())),
    layout = 2, revision = revision + 1, updated_at = now()
  where user_id = owner_id;
  return jsonb_build_object('layout', 2, 'moved', moved);
end;
$$;
revoke all on function public.migrate_brain_to_records() from public, anon, authenticated;
grant execute on function public.migrate_brain_to_records() to authenticated;

-- Saves the preferences snapshot of an upgraded account. The revision check is the same as save_brain.
create or replace function public.save_brain_prefs(p_state jsonb, p_revision bigint)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  new_revision bigint;
begin
  if owner_id is null then raise exception 'Not authorized' using errcode = '42501'; end if;
  if p_state is null or jsonb_typeof(p_state) <> 'object' or octet_length(p_state::text) > 2097152
     or p_revision is null or p_revision < 1
     or (p_state ? 'chatHistory' and jsonb_typeof(p_state->'chatHistory') <> 'array')
     or (p_state ? 'sections' and jsonb_typeof(p_state->'sections') <> 'array')
     or (p_state ? 'subsections' and jsonb_typeof(p_state->'subsections') <> 'object')
     or (p_state ? 'preferences' and jsonb_typeof(p_state->'preferences') <> 'object') then
    raise exception 'Invalid preferences' using errcode = '22023';
  end if;
  update public.brains set
    state = (select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) from jsonb_each(p_state) where key = any(public.preference_keys())),
    revision = revision + 1, updated_at = now()
  where user_id = owner_id and revision = p_revision and layout = 2
  returning revision into new_revision;
  if new_revision is null then
    raise exception 'Preferences changed on another device' using errcode = '40001';
  end if;
  return new_revision;
end;
$$;
revoke all on function public.save_brain_prefs(jsonb, bigint) from public, anon, authenticated;
grant execute on function public.save_brain_prefs(jsonb, bigint) to authenticated;

-- Writes a batch of record changes. Each change applies only if the record is still at the revision the
-- caller last saw; otherwise the current row is returned as a conflict and the rest of the batch still
-- applies. Invalid data rejects the whole batch.
create or replace function public.save_records(p_changes jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  change jsonb;
  coll text;
  rid text;
  base bigint;
  payload jsonb;
  next_seq bigint;
  result_row public.brain_records;
  saved jsonb := '[]'::jsonb;
  conflicts jsonb := '[]'::jsonb;
begin
  if owner_id is null then raise exception 'Not authorized' using errcode = '42501'; end if;
  if not exists (select 1 from public.brains where user_id = owner_id and layout = 2) then
    raise exception 'Workspace has not been upgraded' using errcode = '55000';
  end if;
  if jsonb_typeof(p_changes) is distinct from 'array' or jsonb_array_length(p_changes) > 500 then
    raise exception 'Invalid change batch' using errcode = '22023';
  end if;
  for change in select * from jsonb_array_elements(p_changes) loop
    coll := change->>'collection';
    rid := change->>'id';
    base := (change->>'baseRevision')::bigint;
    payload := change->'data';
    if jsonb_typeof(change) is distinct from 'object' or coll is null or rid is null or base is null or base < 0
       or not (coll = any(public.record_collections())) then
      raise exception 'Invalid change' using errcode = '22023';
    end if;
    if payload = 'null'::jsonb then payload := null; end if;
    if payload is not null and not public.valid_record(coll, rid, payload) then
      raise exception 'Invalid record % %', coll, rid using errcode = '22023';
    end if;
    result_row := null;
    if base = 0 then
      if payload is null then continue; end if; -- Deleting a record the server never had.
      next_seq := nextval('public.brain_record_seq');
      insert into public.brain_records (user_id, collection, id, data, revision, seq, ord)
      values (owner_id, coll, rid, payload, 1, next_seq, next_seq)
      on conflict do nothing
      returning * into result_row;
    else
      update public.brain_records set
        data = payload, deleted = payload is null, revision = revision + 1,
        seq = nextval('public.brain_record_seq'), updated_at = now()
      where user_id = owner_id and collection = coll and id = rid and revision = base
      returning * into result_row;
    end if;
    if result_row.id is not null then
      saved := saved || jsonb_build_object('collection', coll, 'id', rid, 'revision', result_row.revision, 'seq', result_row.seq, 'deleted', result_row.deleted);
    else
      select * into result_row from public.brain_records where user_id = owner_id and collection = coll and id = rid;
      conflicts := conflicts || jsonb_build_object('collection', coll, 'id', rid,
        'current', case when result_row.id is null then null else jsonb_build_object(
          'data', result_row.data, 'revision', result_row.revision, 'seq', result_row.seq, 'deleted', result_row.deleted) end);
    end if;
  end loop;
  return jsonb_build_object('saved', saved, 'conflicts', conflicts);
end;
$$;
revoke all on function public.save_records(jsonb) from public, anon, authenticated;
grant execute on function public.save_records(jsonb) to authenticated;
