-- Training: workout sessions (collection workouts) and training plans such as Push / Pull / Legs
-- (collection workoutPlans), kept in the Health workspace. Additive: every existing record stays valid.

create or replace function public.record_collections()
returns text[] language sql immutable set search_path = '' as $$
  select array['tasks','goals','habits','journalEntries','knowledgeItems','events','trackerItems','workspaces','healthDays',
    'workouts','workoutPlans','noteFolders','routines','conversations','study.courses','study.folders','study.documents','study.decks','study.quizzes','memory']
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
  elsif p_collection = 'routines' then
    return jsonb_typeof(p_data->'name') = 'string' and length(btrim(p_data->>'name')) between 1 and 80
      and jsonb_typeof(p_data->'instructions') = 'string' and length(btrim(p_data->>'instructions')) between 1 and 4000
      and coalesce(p_data->>'frequency','') in ('daily','weekdays','weekly','monthly')
      and coalesce(p_data->>'time','') ~ '^([01]\d|2[0-3]):[0-5]\d$'
      and coalesce(p_data->>'onlyIf','') in ('always','overdue_tasks','due_today','due_soon','events_today')
      and coalesce(p_data->>'mode','') in ('act','suggest')
      and jsonb_typeof(p_data->'enabled') = 'boolean' and jsonb_typeof(p_data->'notify') = 'boolean'
      and jsonb_typeof(p_data->'timeZone') = 'string' and length(p_data->>'timeZone') between 1 and 64
      and (not (p_data ? 'days') or (jsonb_typeof(p_data->'days') = 'array' and jsonb_array_length(p_data->'days') between 1 and 7))
      and (not (p_data ? 'dayOfMonth') or (jsonb_typeof(p_data->'dayOfMonth') = 'number' and (p_data->>'dayOfMonth')::numeric between 1 and 31))
      and octet_length(p_data::text) <= 16384;
  elsif p_collection = 'workouts' then
    return coalesce(p_data->>'date','') ~ '^\d{4}-\d{2}-\d{2}$'
      and jsonb_typeof(p_data->'name') = 'string' and length(btrim(p_data->>'name')) between 1 and 120
      and jsonb_typeof(p_data->'exercises') = 'array' and jsonb_array_length(p_data->'exercises') <= 60
      and not exists (select 1 from jsonb_array_elements(p_data->'exercises') e
        where jsonb_typeof(e) is distinct from 'object' or jsonb_typeof(e->'name') is distinct from 'string'
          or jsonb_typeof(e->'exerciseId') is distinct from 'string'
          or jsonb_typeof(e->'sets') is distinct from 'array' or jsonb_array_length(e->'sets') > 50)
      and (not (p_data ? 'durationMin') or jsonb_typeof(p_data->'durationMin') = 'number')
      and (not (p_data ? 'note') or (jsonb_typeof(p_data->'note') = 'string' and length(p_data->>'note') <= 4000))
      and jsonb_typeof(p_data->'updatedAt') = 'string'
      and octet_length(p_data::text) <= 131072;
  elsif p_collection = 'workoutPlans' then
    return jsonb_typeof(p_data->'name') = 'string' and length(btrim(p_data->>'name')) between 1 and 80
      and jsonb_typeof(p_data->'active') = 'boolean'
      and jsonb_typeof(p_data->'days') = 'array' and jsonb_array_length(p_data->'days') <= 14
      and not exists (select 1 from jsonb_array_elements(p_data->'days') d
        where jsonb_typeof(d) is distinct from 'object' or jsonb_typeof(d->'name') is distinct from 'string'
          or jsonb_typeof(d->'exercises') is distinct from 'array' or jsonb_array_length(d->'exercises') > 30)
      and jsonb_typeof(p_data->'updatedAt') = 'string'
      and octet_length(p_data::text) <= 65536;
  end if;
  return true;
end;
$$;
