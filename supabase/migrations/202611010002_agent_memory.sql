-- Bounded, per-account agent memory remains inside the revisioned private snapshot.
create or replace function public.valid_agent_memory(m jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare e jsonb; s jsonb; stamp timestamptz;
begin
  if jsonb_typeof(m) is distinct from 'object' or m->'version' is distinct from '1'::jsonb
     or jsonb_typeof(m->'enabled') is distinct from 'boolean'
     or jsonb_typeof(m->'automaticLearning') is distinct from 'boolean'
     or jsonb_typeof(m->'entries') is distinct from 'array'
     or jsonb_typeof(m->'suppressed') is distinct from 'array'
     or octet_length(m::text) > 262144 then return false; end if;
  if exists(select 1 from jsonb_object_keys(m) k where k not in ('version','enabled','automaticLearning','entries','suppressed')) then return false; end if;
  if jsonb_array_length(m->'entries') > 500 then return false; end if;
  if (select count(*) from jsonb_array_elements(m->'entries')) <> (select count(distinct x->>'id') from jsonb_array_elements(m->'entries') x)
     or (select count(*) from jsonb_array_elements(m->'entries')) <> (select count(distinct lower(regexp_replace(btrim(x->>'topic'),'\s+',' ','g'))) from jsonb_array_elements(m->'entries') x) then return false; end if;
  for e in select * from jsonb_array_elements(m->'entries') loop
    if jsonb_typeof(e) is distinct from 'object' then return false; end if;
    if exists(select 1 from jsonb_object_keys(e) k where k not in ('id','topic','category','content','sources','createdAt','updatedAt','expiresAt','pinned')) then return false; end if;
    if jsonb_typeof(e->'id') is distinct from 'string' or length(e->>'id') not between 1 and 100
       or jsonb_typeof(e->'topic') is distinct from 'string' or length(btrim(e->>'topic')) not between 1 and 120
       or jsonb_typeof(e->'content') is distinct from 'string' or length(btrim(e->>'content')) not between 1 and 1000
       or coalesce(e->>'category','') not in ('preference','fact','project','decision','lesson')
       or jsonb_typeof(e->'pinned') is distinct from 'boolean'
       or jsonb_typeof(e->'sources') is distinct from 'array'
       or jsonb_typeof(e->'createdAt') is distinct from 'string'
       or jsonb_typeof(e->'updatedAt') is distinct from 'string' then return false; end if;
    if jsonb_array_length(e->'sources') > 8 then return false; end if;
    stamp := (e->>'createdAt')::timestamptz; stamp := (e->>'updatedAt')::timestamptz;
    if e ? 'expiresAt' then
      if jsonb_typeof(e->'expiresAt') is distinct from 'string' then return false; end if;
      stamp := (e->>'expiresAt')::timestamptz;
    end if;
    for s in select * from jsonb_array_elements(e->'sources') loop
      if jsonb_typeof(s) is distinct from 'object' then return false; end if;
      if exists(select 1 from jsonb_object_keys(s) k where k not in ('conversationId','messageId','excerpt')) then return false; end if;
      if jsonb_typeof(s->'conversationId') is distinct from 'string' or length(s->>'conversationId') > 100
         or jsonb_typeof(s->'messageId') is distinct from 'string' or length(s->>'messageId') not between 1 and 100
         or jsonb_typeof(s->'excerpt') is distinct from 'string' or length(s->>'excerpt') > 500 then return false; end if;
    end loop;
  end loop;
  for s in select * from jsonb_array_elements(m->'suppressed') loop
    if jsonb_typeof(s) is distinct from 'object' then return false; end if;
    if exists(select 1 from jsonb_object_keys(s) k where k not in ('topicHash','sourceIds','forgottenAt')) then return false; end if;
    if jsonb_typeof(s->'topicHash') is distinct from 'string' or (s->>'topicHash') !~ '^[a-f0-9]{1,16}$'
       or jsonb_typeof(s->'sourceIds') is distinct from 'array' or jsonb_typeof(s->'forgottenAt') is distinct from 'string' then return false; end if;
    if jsonb_array_length(s->'sourceIds') > 8 or exists(select 1 from jsonb_array_elements(s->'sourceIds') x where jsonb_typeof(x) is distinct from 'string' or length(x#>>'{}') > 100) then return false; end if;
    stamp := (s->>'forgottenAt')::timestamptz;
  end loop;
  -- Guard common credentials in retained text; this does not replace source authorization.
  if m::text ~* '(sk-[a-z0-9_-]{12,}|sb_secret_[a-z0-9_-]+|eyJ[a-z0-9_-]{10,}\.[a-z0-9_-]+\.[a-z0-9_-]+|Bearer\s+\S+|(password|api[ _-]?key|access[ _-]?token|secret)\s*[:=]\s*\S{4,}|-----BEGIN[^-]*PRIVATE KEY)' then return false; end if;
  return true;
exception when others then return false;
end;
$$;

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
  -- Allowlist the workspace schema; credentials and account metadata are never persisted.
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into clean_state
  from jsonb_each(p_state)
  where key = any(array['tasks','goals','habits','journalEntries','knowledgeItems','chatHistory','sections','subsections',
    'noteFolders','conversationId','conversations','selectedModel','theme','taskAppearance','agentMemory','dailyBrief','auditLog']);
  if p_revision = 0 then
    insert into public.brains (user_id, state, revision)
    values (owner_id, clean_state, 1)
    on conflict (user_id) do nothing
    returning revision into new_revision;
  else
    update public.brains set state = case when p_state ? 'agentMemory' then clean_state
      else clean_state || case when state ? 'agentMemory' then jsonb_build_object('agentMemory', state->'agentMemory') else '{}'::jsonb end end,
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
