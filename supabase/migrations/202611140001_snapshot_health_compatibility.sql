-- Health also works on installations that still save whole snapshots.
-- Keep ownership, revisions, schema checks and the removal of the aggregate size cap.
begin;
alter table public.brains drop constraint if exists brain_size;

create or replace function public.save_brain(p_state jsonb, p_revision bigint, p_owner_id uuid)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid := auth.uid();
  clean_state jsonb;
  field text;
  entry jsonb;
  new_revision bigint;
begin
  if owner_id is null or owner_id is distinct from p_owner_id then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if p_revision is null or p_revision < 0 or p_revision >= 9007199254740991
     or p_state is null or jsonb_typeof(p_state) <> 'object'
 then
    raise exception 'Invalid workspace' using errcode = '22023';
  end if;
  foreach field in array array['tasks','goals','habits','journalEntries','knowledgeItems','chatHistory','sections'] loop
    if jsonb_typeof(p_state -> field) is distinct from 'array' then
      raise exception 'Invalid workspace field' using errcode = '22023';
    end if;
  end loop;
  if jsonb_typeof(p_state -> 'subsections') is distinct from 'object' then
    raise exception 'Invalid subsections' using errcode = '22023';
  end if;
  if p_state ? 'agentMemory' and not public.valid_agent_memory(p_state->'agentMemory') then
    raise exception 'Invalid agent memory or memory limit exceeded' using errcode = '22023';
  end if;
  -- Optional for older clients; explicit empty arrays mean intentional deletion.
  foreach field in array array['workspaces','trackerItems','events'] loop
    if p_state ? field and jsonb_typeof(p_state->field) is distinct from 'array' then
      raise exception 'Invalid workspace collection' using errcode = '22023';
    end if;
  end loop;
  if p_state ? 'workspaces' then
    if jsonb_array_length(p_state->'workspaces') > 200 then
      raise exception 'Too many workspaces' using errcode = '22023';
    end if;
    for entry in select * from jsonb_array_elements(p_state->'workspaces') loop
      if jsonb_typeof(entry) is distinct from 'object'
         or jsonb_typeof(entry->'id') is distinct from 'string' or length(entry->>'id') not between 1 and 100
         or jsonb_typeof(entry->'name') is distinct from 'string' or length(btrim(entry->>'name')) not between 1 and 80
         or jsonb_typeof(entry->'description') is distinct from 'string' or length(entry->>'description') > 300
         or coalesce(entry->>'template','') not in ('career','academic','health','blank')
         or coalesce(entry->>'color','') not in ('purple','blue','green','amber','rose')
         or jsonb_typeof(entry->'notes') is distinct from 'string' or length(entry->>'notes') > 200000
         or jsonb_typeof(entry->'createdAt') is distinct from 'string'
         or (entry ? 'health' and jsonb_typeof(entry->'health') is distinct from 'object') then
        raise exception 'Invalid workspace page' using errcode = '22023';
      end if;
    end loop;
    if (select count(*) from jsonb_array_elements(p_state->'workspaces')) <>
       (select count(distinct e->>'id') from jsonb_array_elements(p_state->'workspaces') e) then
      raise exception 'Duplicate workspace IDs' using errcode = '22023';
    end if;
  end if;
  if p_state ? 'trackerItems' then
    for entry in select * from jsonb_array_elements(p_state->'trackerItems') loop
      if jsonb_typeof(entry) is distinct from 'object'
         or jsonb_typeof(entry->'id') is distinct from 'string' or length(entry->>'id') not between 1 and 100
         or jsonb_typeof(entry->'title') is distinct from 'string'
         or coalesce(entry->>'kind','') not in ('leetcode','job_application')
         or jsonb_typeof(entry->'fields') is distinct from 'object'
         or jsonb_typeof(entry->'history') is distinct from 'object'
         or (entry ? 'workspaceId' and jsonb_typeof(entry->'workspaceId') is distinct from 'string') then
        raise exception 'Invalid tracker entry' using errcode = '22023';
      end if;
    end loop;
    if (select count(*) from jsonb_array_elements(p_state->'trackerItems')) <>
       (select count(distinct e->>'id') from jsonb_array_elements(p_state->'trackerItems') e) then
      raise exception 'Duplicate tracker IDs' using errcode = '22023';
    end if;
  end if;
  if p_state ? 'study' then
    if jsonb_typeof(p_state->'study') is distinct from 'object' then
      raise exception 'Invalid study collection' using errcode = '22023';
    end if;
    foreach field in array array['courses','folders','documents','decks','quizzes'] loop
      if p_state->'study' ? field and jsonb_typeof(p_state->'study'->field) is distinct from 'array' then
        raise exception 'Invalid study collection' using errcode = '22023';
      end if;
    end loop;
  end if;
  if p_state ? 'events' then
    if jsonb_array_length(p_state->'events') > 2000 then
      raise exception 'Too many events' using errcode = '22023';
    end if;
    for entry in select * from jsonb_array_elements(p_state->'events') loop
      if jsonb_typeof(entry) is distinct from 'object'
         or jsonb_typeof(entry->'id') is distinct from 'string' or length(entry->>'id') not between 1 and 100
         or jsonb_typeof(entry->'title') is distinct from 'string' or length(btrim(entry->>'title')) not between 1 and 300
         or coalesce(entry->>'kind','') not in ('meeting','event','class','appointment')
         or coalesce(entry->>'date','') !~ '^\d{4}-\d{2}-\d{2}$'
         or (entry ? 'startTime' and coalesce(entry->>'startTime','') !~ '^([01]\d|2[0-3]):[0-5]\d$')
         or (entry ? 'endTime' and coalesce(entry->>'endTime','') !~ '^([01]\d|2[0-3]):[0-5]\d$')
         or (entry ? 'link' and coalesce(entry->>'link','') !~* '^https?://')
         or (entry ? 'attendees' and jsonb_typeof(entry->'attendees') is distinct from 'array')
         or (entry ? 'notes' and length(entry->>'notes') > 20000) then
        raise exception 'Invalid calendar event' using errcode = '22023';
      end if;
    end loop;
    if (select count(*) from jsonb_array_elements(p_state->'events')) <>
       (select count(distinct e->>'id') from jsonb_array_elements(p_state->'events') e) then
      raise exception 'Duplicate event IDs' using errcode = '22023';
    end if;
  end if;
  -- Snapshot-only installations must accept the same Health data as record storage.
  if p_state ? 'healthDays' then
    if jsonb_typeof(p_state->'healthDays') is distinct from 'array' then
      raise exception 'Invalid health collection' using errcode = '22023';
    end if;
    for entry in select * from jsonb_array_elements(p_state->'healthDays') loop
      if jsonb_typeof(entry) is distinct from 'object'
         or coalesce(entry->>'date','') !~ '^\d{4}-\d{2}-\d{2}$'
         or entry->>'id' is distinct from 'health-' || (entry->>'date')
         or jsonb_typeof(entry->'metrics') is distinct from 'object'
         or jsonb_typeof(entry->'updatedAt') is distinct from 'string'
         or octet_length(entry::text) > 32768 then
        raise exception 'Invalid health day' using errcode = '22023';
      end if;
      if exists (select 1 from jsonb_each(entry->'metrics') m where jsonb_typeof(m.value) is distinct from 'number') then
        raise exception 'Invalid health metrics' using errcode = '22023';
      end if;
      if entry ? 'workouts' then
        if jsonb_typeof(entry->'workouts') is distinct from 'array' or jsonb_array_length(entry->'workouts') > 30 then
          raise exception 'Invalid health workouts' using errcode = '22023';
        end if;
      end if;
      if entry ? 'tags' then
        if jsonb_typeof(entry->'tags') is distinct from 'array' or jsonb_array_length(entry->'tags') > 20 then
          raise exception 'Invalid health tags' using errcode = '22023';
        end if;
      end if;
      if entry ? 'note' and (jsonb_typeof(entry->'note') is distinct from 'string' or length(entry->>'note') > 2000) then
        raise exception 'Invalid health note' using errcode = '22023';
      end if;
    end loop;
    if jsonb_array_length(p_state->'healthDays') <> (select count(distinct e->>'id') from jsonb_array_elements(p_state->'healthDays') e) then
      raise exception 'Duplicate health day IDs' using errcode = '22023';
    end if;
  end if;
  if p_state ? 'preferences' and jsonb_typeof(p_state->'preferences') is distinct from 'object' then
    raise exception 'Invalid preferences' using errcode = '22023';
  end if;
  -- Allowlist the workspace schema; credentials and account metadata are never persisted.
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into clean_state
  from jsonb_each(p_state)
  where key = any(array['tasks','goals','habits','journalEntries','knowledgeItems','chatHistory','sections','subsections',
    'noteFolders','conversationId','conversations','selectedModel','theme','taskAppearance','agentMemory','workspaces','trackerItems','events','study','dailyBrief','auditLog','healthDays','preferences']);
  if p_revision = 0 then
    insert into public.brains (user_id, state, revision)
    values (owner_id, clean_state, 1)
    on conflict (user_id) do nothing
    returning revision into new_revision;
  else
    -- Older clients omit new collections; preserve them without changing revision semantics.
    update public.brains set state = clean_state || (
      select coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
      from jsonb_each(state)
      where key = any(array['agentMemory','workspaces','trackerItems','events','study','healthDays','preferences']) and not (p_state ? key)
    ),
      revision = revision + 1, updated_at = now()
    where user_id = owner_id and revision = p_revision
    returning revision into new_revision;
  end if;
  if new_revision is null then
    raise exception 'Workspace changed on another device' using errcode = '40001';
  end if;
  return new_revision;
end;
$$;
revoke all on function public.save_brain(jsonb, bigint, uuid) from public, anon, authenticated;
grant execute on function public.save_brain(jsonb, bigint, uuid) to authenticated;


commit;
