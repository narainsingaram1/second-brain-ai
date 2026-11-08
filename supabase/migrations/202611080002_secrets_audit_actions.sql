-- Server-side foundations: encrypted provider credentials, an append-only audit trail, actions that wait
-- for the user's approval, and a per-account embedding cache for the server agent. The server calls
-- these with the signed-in user's own token, so every row is protected by row-level security and no
-- service-role key is involved.

-- Provider credentials, encrypted by the server (AES-256-GCM, key held only in the server environment).
-- The ciphertext is useless without that key; the browser only ever sees `hint` (the last 4 characters).
create table if not exists public.user_secrets (
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (name in ('openrouter')),
  ciphertext text not null check (length(ciphertext) <= 4096),
  iv text not null check (length(iv) <= 64),
  key_version smallint not null check (key_version > 0),
  hint text not null check (length(hint) <= 8),
  updated_at timestamptz not null default now(),
  primary key (user_id, name)
);
alter table public.user_secrets enable row level security;
revoke all on public.user_secrets from public, anon, authenticated;
grant select, insert, update, delete on public.user_secrets to authenticated;
create policy user_secrets_own on public.user_secrets for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Append-only record of what changed and who changed it. Clients can read their own history and add to
-- it through append_audit(), but nobody can edit or delete an entry (account deletion cascades).
create table if not exists public.audit_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  at timestamptz not null default now(),
  actor text not null check (actor in ('user','assistant','system')),
  action text not null check (length(action) between 1 and 100),
  entity_type text check (length(entity_type) <= 50),
  entity_id text check (length(entity_id) <= 200),
  title text check (length(title) <= 300),
  action_id uuid,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object' and octet_length(metadata::text) <= 16384)
);
create index if not exists audit_events_user_at on public.audit_events (user_id, at desc);
alter table public.audit_events enable row level security;
revoke all on public.audit_events from public, anon, authenticated;
grant select on public.audit_events to authenticated;
create policy audit_events_read_own on public.audit_events for select to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.append_audit(p_actor text, p_action text, p_entity_type text, p_entity_id text,
  p_title text, p_action_id uuid default null, p_metadata jsonb default '{}'::jsonb)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  new_id bigint;
begin
  if owner_id is null then raise exception 'Not authorized' using errcode = '42501'; end if;
  insert into public.audit_events (user_id, actor, action, entity_type, entity_id, title, action_id, metadata)
  values (owner_id, p_actor, p_action, p_entity_type, p_entity_id, left(p_title, 300), p_action_id, coalesce(p_metadata, '{}'::jsonb))
  returning id into new_id;
  return new_id;
end;
$$;
revoke all on function public.append_audit(text, text, text, text, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.append_audit(text, text, text, text, text, uuid, jsonb) to authenticated;

-- Actions the assistant proposed that need the user's decision before they run. The hash covers the exact
-- payload: approving one version of an action never authorizes a different one. Execution is claimed
-- atomically, so an approved action runs at most once.
create table if not exists public.agent_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id text check (length(conversation_id) <= 200),
  message_id text check (length(message_id) <= 200),
  tool text not null check (length(tool) between 1 and 100),
  tier text not null check (tier in ('internal','external_reversible','external_irreversible')),
  summary text not null check (length(summary) between 1 and 2000),
  reason text not null check (length(reason) between 1 and 500),
  payload jsonb not null check (octet_length(payload::text) <= 262144),
  -- SHA-256 of the canonical jsonb text, set by propose_action (clients cannot write this table).
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'proposed' check (status in ('proposed','approved','rejected','executing','executed','failed')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours',
  decided_at timestamptz,
  executed_at timestamptz,
  result jsonb check (result is null or octet_length(result::text) <= 65536)
);
create index if not exists agent_actions_user_status on public.agent_actions (user_id, status, created_at desc);
alter table public.agent_actions enable row level security;
revoke all on public.agent_actions from public, anon, authenticated;
grant select on public.agent_actions to authenticated;
create policy agent_actions_read_own on public.agent_actions for select to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.propose_action(p_tool text, p_tier text, p_summary text, p_reason text, p_payload jsonb,
  p_conversation_id text default null, p_message_id text default null)
returns public.agent_actions language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  created public.agent_actions;
begin
  if owner_id is null then raise exception 'Not authorized' using errcode = '42501'; end if;
  if (select count(*) from public.agent_actions where user_id = owner_id and status = 'proposed' and expires_at > now()) >= 50 then
    raise exception 'Too many actions are waiting for approval' using errcode = '54000';
  end if;
  insert into public.agent_actions (user_id, conversation_id, message_id, tool, tier, summary, reason, payload, payload_hash)
  values (owner_id, p_conversation_id, p_message_id, p_tool, p_tier, p_summary, p_reason, p_payload,
    encode(sha256(convert_to(p_payload::text, 'UTF8')), 'hex'))
  returning * into created;
  perform public.append_audit('assistant', 'proposed', null, null, left(p_summary, 300), created.id, jsonb_build_object('tool', p_tool, 'tier', p_tier));
  return created;
end;
$$;
revoke all on function public.propose_action(text, text, text, text, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.propose_action(text, text, text, text, jsonb, text, text) to authenticated;

-- The user's decision. Only a pending, unexpired action whose payload matches what the user saw.
create or replace function public.decide_action(p_id uuid, p_decision text, p_payload_hash text)
returns public.agent_actions language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  decided public.agent_actions;
begin
  if owner_id is null then raise exception 'Not authorized' using errcode = '42501'; end if;
  if p_decision not in ('approve','reject') then raise exception 'Invalid decision' using errcode = '22023'; end if;
  update public.agent_actions set
    status = case when p_decision = 'approve' then 'approved' else 'rejected' end, decided_at = now()
  where id = p_id and user_id = owner_id and status = 'proposed' and expires_at > now() and payload_hash = p_payload_hash
  returning * into decided;
  if decided.id is null then
    raise exception 'This action is no longer waiting for a decision, has expired, or changed' using errcode = '40001';
  end if;
  perform public.append_audit('user', case when p_decision = 'approve' then 'approved' else 'rejected' end, null, null, left(decided.summary, 300), decided.id, '{}'::jsonb);
  return decided;
end;
$$;
revoke all on function public.decide_action(uuid, text, text) from public, anon, authenticated;
grant execute on function public.decide_action(uuid, text, text) to authenticated;

-- Moves an approved action to executing exactly once. A second caller gets nothing back.
create or replace function public.claim_action(p_id uuid)
returns public.agent_actions language plpgsql security definer set search_path = '' as $$
declare
  claimed public.agent_actions;
begin
  if auth.uid() is null then raise exception 'Not authorized' using errcode = '42501'; end if;
  update public.agent_actions set status = 'executing'
  where id = p_id and user_id = auth.uid() and status = 'approved' and expires_at > now()
  returning * into claimed;
  if claimed.id is null then raise exception 'This action is not approved or has already run' using errcode = '40001'; end if;
  return claimed;
end;
$$;
revoke all on function public.claim_action(uuid) from public, anon, authenticated;
grant execute on function public.claim_action(uuid) to authenticated;

create or replace function public.complete_action(p_id uuid, p_ok boolean, p_result jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  done public.agent_actions;
begin
  if auth.uid() is null then raise exception 'Not authorized' using errcode = '42501'; end if;
  update public.agent_actions set status = case when p_ok then 'executed' else 'failed' end, executed_at = now(), result = p_result
  where id = p_id and user_id = auth.uid() and status = 'executing'
  returning * into done;
  if done.id is null then raise exception 'Action is not executing' using errcode = '40001'; end if;
  perform public.append_audit('system', case when p_ok then 'executed' else 'failed' end, null, null, left(done.summary, 300), done.id,
    jsonb_build_object('tool', done.tool));
end;
$$;
revoke all on function public.complete_action(uuid, boolean, jsonb) from public, anon, authenticated;
grant execute on function public.complete_action(uuid, boolean, jsonb) to authenticated;

-- Embedding cache for server-side search, keyed by content hash (the same keys the browser cache uses).
create table if not exists public.passage_embeddings (
  user_id uuid not null references auth.users(id) on delete cascade,
  key text not null check (length(key) <= 128),
  vector real[] not null check (array_length(vector, 1) between 1 and 4096),
  created_at timestamptz not null default now(),
  primary key (user_id, key)
);
alter table public.passage_embeddings enable row level security;
revoke all on public.passage_embeddings from public, anon, authenticated;
grant select, insert, update, delete on public.passage_embeddings to authenticated;
create policy passage_embeddings_own on public.passage_embeddings for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
