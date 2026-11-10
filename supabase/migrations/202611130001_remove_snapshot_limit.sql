-- Remove the app's aggregate 2 MiB snapshot cap, including the preferences snapshot.
-- Patch the installed functions so older snapshot-only deployments retain their current
-- validation rules. Ownership, revisions, per-record limits and grants are unchanged.
begin;

alter table public.brains drop constraint if exists brain_size;

do $$
declare
  signature text;
  function_id regprocedure;
  definition text;
begin
  foreach signature in array array[
    'public.save_brain(jsonb,bigint,uuid)',
    'public.save_brain_prefs(jsonb,bigint)'
  ] loop
    function_id := to_regprocedure(signature);
    -- The preferences RPC is absent on snapshot-only installations.
    if function_id is null then
      if signature = 'public.save_brain(jsonb,bigint,uuid)' then
        raise exception 'Missing save_brain: apply the account migration first';
      end if;
      continue;
    end if;
    definition := pg_get_functiondef(function_id);
    definition := replace(definition, 'or octet_length(p_state::text) > 2097152', '');
    execute definition;
  end loop;
end;
$$;

commit;
