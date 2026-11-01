-- Retain user-selected task icons and accent colors in the private workspace.
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
  -- Allowlist the workspace schema; credentials and account metadata are never persisted.
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into clean_state
  from jsonb_each(p_state)
  where key = any(array['tasks','goals','habits','journalEntries','knowledgeItems','chatHistory','sections','subsections',
    'noteFolders','conversationId','conversations','selectedModel','theme','taskAppearance','dailyBrief','auditLog']);
  if p_revision = 0 then
    insert into public.brains (user_id, state, revision)
    values (owner_id, clean_state, 1)
    on conflict (user_id) do nothing
    returning revision into new_revision;
  else
    update public.brains set state = clean_state, revision = revision + 1, updated_at = now()
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
