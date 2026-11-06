-- Academic workspaces: courses, folders, document metadata, flashcard decks and quizzes join the
-- revisioned snapshot under one `study` object. Extracted document text is too large for the 2 MB
-- snapshot, so it lives in its own owner-only table, one row per document.
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
     or octet_length(p_state::text) > 2097152 then
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
         or coalesce(entry->>'template','') not in ('career','academic','blank')
         or coalesce(entry->>'color','') not in ('purple','blue','green','amber','rose')
         or jsonb_typeof(entry->'notes') is distinct from 'string' or length(entry->>'notes') > 200000
         or jsonb_typeof(entry->'createdAt') is distinct from 'string' then
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
  -- Allowlist the workspace schema; credentials and account metadata are never persisted.
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into clean_state
  from jsonb_each(p_state)
  where key = any(array['tasks','goals','habits','journalEntries','knowledgeItems','chatHistory','sections','subsections',
    'noteFolders','conversationId','conversations','selectedModel','theme','taskAppearance','agentMemory','workspaces','trackerItems','events','study','dailyBrief','auditLog']);
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
      where key = any(array['agentMemory','workspaces','trackerItems','events','study']) and not (p_state ? key)
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

-- Extracted text of uploaded course documents. Owner-only; never part of the revisioned snapshot.
create table if not exists public.study_documents (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null check (length(id) between 1 and 100),
  hash text not null check (length(hash) <= 128),
  content text not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, id),
  constraint study_document_size check (octet_length(content) <= 3145728)
);
alter table public.study_documents enable row level security;
revoke all on public.study_documents from public, anon, authenticated;
grant select, insert, update, delete on public.study_documents to authenticated;
create policy study_documents_own on public.study_documents for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
