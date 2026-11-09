-- Talking to the assistant over Telegram. A row links one account to one private chat. People can see and
-- remove their own link and change its settings; only the server (service role) can bind a chat, so nobody
-- can point an account at a chat they did not prove they own. The webhook and reminder job use the service
-- role only to find the account and to send; everything the assistant does still runs as that user under RLS.

create table if not exists public.telegram_links (
  user_id uuid primary key references auth.users(id) on delete cascade,
  chat_id bigint unique,
  username text check (length(username) <= 64),
  -- SHA-256 of a one-time code from the Connect link; the code itself is never stored.
  link_code_hash text unique check (link_code_hash ~ '^[0-9a-f]{64}$'),
  link_code_expires_at timestamptz,
  time_zone text not null default 'UTC' check (length(time_zone) between 1 and 64),
  brief_enabled boolean not null default true,
  brief_hour smallint not null default 8 check (brief_hour between 0 and 23),
  alerts_enabled boolean not null default true,
  -- Telegram redelivers updates it is unsure about; each is handled once.
  last_update_id bigint not null default 0,
  linked_at timestamptz
);
alter table public.telegram_links enable row level security;
revoke all on public.telegram_links from public, anon, authenticated;
grant select, delete on public.telegram_links to authenticated;
create policy telegram_links_read_own on public.telegram_links for select to authenticated
  using ((select auth.uid()) = user_id);
create policy telegram_links_delete_own on public.telegram_links for delete to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.begin_telegram_link(p_code_hash text, p_time_zone text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
begin
  if owner_id is null then raise exception 'Not authorized' using errcode = '42501'; end if;
  insert into public.telegram_links (user_id, link_code_hash, link_code_expires_at, time_zone)
  values (owner_id, p_code_hash, now() + interval '10 minutes', coalesce(p_time_zone, 'UTC'))
  on conflict (user_id) do update set link_code_hash = excluded.link_code_hash,
    link_code_expires_at = excluded.link_code_expires_at, time_zone = excluded.time_zone;
end;
$$;
revoke all on function public.begin_telegram_link(text, text) from public, anon, authenticated;
grant execute on function public.begin_telegram_link(text, text) to authenticated;

create or replace function public.set_telegram_prefs(p_time_zone text, p_brief_enabled boolean, p_brief_hour integer, p_alerts_enabled boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Not authorized' using errcode = '42501'; end if;
  update public.telegram_links set time_zone = coalesce(p_time_zone, time_zone), brief_enabled = coalesce(p_brief_enabled, brief_enabled),
    brief_hour = coalesce(p_brief_hour, brief_hour), alerts_enabled = coalesce(p_alerts_enabled, alerts_enabled)
  where user_id = auth.uid();
end;
$$;
revoke all on function public.set_telegram_prefs(text, boolean, integer, boolean) from public, anon, authenticated;
grant execute on function public.set_telegram_prefs(text, boolean, integer, boolean) to authenticated;

-- What was sent, so no reminder goes out twice and replies can refer to it. Server only.
create table if not exists public.telegram_notifications (
  user_id uuid not null references auth.users(id) on delete cascade,
  key text not null check (length(key) <= 300),
  body text not null check (length(body) <= 8000),
  sent_at timestamptz not null default now(),
  primary key (user_id, key)
);
create index if not exists telegram_notifications_sent on public.telegram_notifications (sent_at);
alter table public.telegram_notifications enable row level security;
revoke all on public.telegram_notifications from public, anon, authenticated;

do $$
begin
  if exists (select from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on public.telegram_links, public.telegram_notifications to service_role;
  end if;
end;
$$;
