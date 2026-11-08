-- Google Calendar and Gmail connections. The refresh token is stored encrypted in user_secrets (name
-- 'google'); this table holds what the app may show: which account, which permissions, and whether the
-- connection still works. Everything is owner-only and written by the server acting as the user.

alter table public.user_secrets drop constraint if exists user_secrets_name_check;
alter table public.user_secrets add constraint user_secrets_name_check check (name in ('openrouter', 'google'));

create table if not exists public.connections (
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('google')),
  account_email text not null check (length(account_email) between 3 and 320),
  scopes text[] not null check (array_length(scopes, 1) between 1 and 20),
  status text not null default 'active' check (status in ('active', 'needs_reconnect')),
  connected_at timestamptz not null default now(),
  last_used_at timestamptz,
  last_error text check (length(last_error) <= 500),
  primary key (user_id, provider)
);
alter table public.connections enable row level security;
revoke all on public.connections from public, anon, authenticated;
grant select, insert, update, delete on public.connections to authenticated;
create policy connections_own on public.connections for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
