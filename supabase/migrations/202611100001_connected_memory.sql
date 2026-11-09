-- Connected memory: memories can name the people and things they are about, link to each other and to
-- records, count repeat mentions and keep what they said before a correction. Adds two categories.
-- Additive: every existing memory stays valid. The app stays usable without it (see legacyMemoryRecord),
-- but saves connections and the new categories only once this has been applied.
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
    if exists(select 1 from jsonb_object_keys(e) k where k not in ('id','topic','category','content','sources','createdAt','updatedAt','expiresAt','pinned','origin','mentions','entities','related','records','history')) then return false; end if;
    if jsonb_typeof(e->'id') is distinct from 'string' or length(e->>'id') not between 1 and 100
       or jsonb_typeof(e->'topic') is distinct from 'string' or length(btrim(e->>'topic')) not between 1 and 120
       or jsonb_typeof(e->'content') is distinct from 'string' or length(btrim(e->>'content')) not between 1 and 1000
       or coalesce(e->>'category','') not in ('preference','fact','project','decision','lesson','person','goal')
       or jsonb_typeof(e->'pinned') is distinct from 'boolean'
       or jsonb_typeof(e->'sources') is distinct from 'array'
       or jsonb_typeof(e->'createdAt') is distinct from 'string'
       or jsonb_typeof(e->'updatedAt') is distinct from 'string' then return false; end if;
    if jsonb_array_length(e->'sources') > 8 then return false; end if;
    if e ? 'origin' and e->'origin' is distinct from '"auto"'::jsonb then return false; end if;
    if e ? 'mentions' and (jsonb_typeof(e->'mentions') is distinct from 'number' or (e->>'mentions')::numeric < 1 or (e->>'mentions')::numeric > 100000) then return false; end if;
    if e ? 'entities' and (jsonb_typeof(e->'entities') is distinct from 'array' or jsonb_array_length(e->'entities') > 12
       or exists(select 1 from jsonb_array_elements(e->'entities') x where jsonb_typeof(x) is distinct from 'string' or length(x#>>'{}') not between 1 and 80)) then return false; end if;
    if e ? 'related' and (jsonb_typeof(e->'related') is distinct from 'array' or jsonb_array_length(e->'related') > 12
       or exists(select 1 from jsonb_array_elements(e->'related') x where jsonb_typeof(x) is distinct from 'string' or length(x#>>'{}') not between 1 and 100)) then return false; end if;
    if e ? 'records' and (jsonb_typeof(e->'records') is distinct from 'array' or jsonb_array_length(e->'records') > 12
       or exists(select 1 from jsonb_array_elements(e->'records') x where jsonb_typeof(x) is distinct from 'object'
         or coalesce(x->>'type','') not in ('task','goal','habit','journal','knowledge','tracker','event','course','document','deck','quiz')
         or jsonb_typeof(x->'id') is distinct from 'string' or length(x->>'id') not between 1 and 200
         or exists(select 1 from jsonb_object_keys(x) k where k not in ('type','id')))) then return false; end if;
    if e ? 'history' then
      if jsonb_typeof(e->'history') is distinct from 'array' or jsonb_array_length(e->'history') > 3
         or exists(select 1 from jsonb_array_elements(e->'history') x where jsonb_typeof(x) is distinct from 'object'
           or jsonb_typeof(x->'content') is distinct from 'string' or length(x->>'content') not between 1 and 1000
           or jsonb_typeof(x->'until') is distinct from 'string'
           or exists(select 1 from jsonb_object_keys(x) k where k not in ('content','until'))) then return false; end if;
      perform (x->>'until')::timestamptz from jsonb_array_elements(e->'history') x;
    end if;
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
