-- Saves only the preference fields that changed, merged into the stored ones, under the same revision check as
-- save_brain_prefs. Without it every edit re-uploaded every preference field, including the whole active chat,
-- because each edit adds an audit entry. save_brain_prefs stays for clients that loaded before this migration.
create or replace function public.save_brain_prefs_patch(p_changes jsonb, p_removed text[], p_revision bigint)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  new_revision bigint;
begin
  if owner_id is null then raise exception 'Not authorized' using errcode = '42501'; end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' or p_removed is null
     or p_revision is null or p_revision < 1
     or (p_changes ? 'chatHistory' and jsonb_typeof(p_changes->'chatHistory') <> 'array')
     or (p_changes ? 'sections' and jsonb_typeof(p_changes->'sections') <> 'array')
     or (p_changes ? 'subsections' and jsonb_typeof(p_changes->'subsections') <> 'object')
     or (p_changes ? 'preferences' and jsonb_typeof(p_changes->'preferences') <> 'object') then
    raise exception 'Invalid preferences' using errcode = '22023';
  end if;
  update public.brains set
    state = (select coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
             from jsonb_each((coalesce(state, '{}'::jsonb) - p_removed) || p_changes)
             where key = any(public.preference_keys())),
    revision = revision + 1, updated_at = now()
  where user_id = owner_id and revision = p_revision and layout = 2
  returning revision into new_revision;
  if new_revision is null then
    raise exception 'Preferences changed on another device' using errcode = '40001';
  end if;
  return new_revision;
end;
$$;
revoke all on function public.save_brain_prefs_patch(jsonb, text[], bigint) from public, anon, authenticated;
grant execute on function public.save_brain_prefs_patch(jsonb, text[], bigint) to authenticated;
