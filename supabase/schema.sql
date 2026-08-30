-- MVPoisk Accounts v2 (Telegram + TV pairing)
-- Run once in Supabase Dashboard -> SQL Editor.
-- Safe to re-run.

create extension if not exists pgcrypto;

-- One compact cloud state row per MVPoisk account.
create table if not exists public.mvpoisk_user_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null default '{"version":1,"profile":null,"watchLater":[],"favorites":[],"history":[]}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.mvpoisk_user_state enable row level security;
revoke all on public.mvpoisk_user_state from anon;
grant select, insert, update, delete on public.mvpoisk_user_state to authenticated;

drop policy if exists "mvpoisk users read own state" on public.mvpoisk_user_state;
drop policy if exists "mvpoisk users insert own state" on public.mvpoisk_user_state;
drop policy if exists "mvpoisk users update own state" on public.mvpoisk_user_state;
drop policy if exists "mvpoisk users delete own state" on public.mvpoisk_user_state;

create policy "mvpoisk users read own state"
on public.mvpoisk_user_state
for select to authenticated
using ((select auth.uid()) = user_id);

create policy "mvpoisk users insert own state"
on public.mvpoisk_user_state
for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy "mvpoisk users update own state"
on public.mvpoisk_user_state
for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "mvpoisk users delete own state"
on public.mvpoisk_user_state
for delete to authenticated
using ((select auth.uid()) = user_id);

create or replace function public.mvpoisk_set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists mvpoisk_user_state_updated_at on public.mvpoisk_user_state;
create trigger mvpoisk_user_state_updated_at
before update on public.mvpoisk_user_state
for each row execute function public.mvpoisk_set_updated_at();

-- TV pairing/device sessions. The browser never talks to this table directly.
-- Only the Cloudflare Worker uses it with the Supabase service_role key.
create table if not exists public.mvpoisk_tv_devices (
  id uuid primary key default gen_random_uuid(),
  pair_code text not null unique,
  claim_secret_hash text not null,
  device_token_hash text not null unique,
  device_name text not null default 'MVPoisk TV',
  user_id uuid references auth.users(id) on delete cascade,
  profile jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','approved','revoked')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  approved_at timestamptz,
  last_seen_at timestamptz,
  revoked_at timestamptz
);

create index if not exists mvpoisk_tv_devices_user_id_idx on public.mvpoisk_tv_devices(user_id);
create index if not exists mvpoisk_tv_devices_status_idx on public.mvpoisk_tv_devices(status);
create index if not exists mvpoisk_tv_devices_last_seen_idx on public.mvpoisk_tv_devices(last_seen_at desc);

alter table public.mvpoisk_tv_devices enable row level security;
revoke all on public.mvpoisk_tv_devices from anon, authenticated;
-- Intentionally no anon/authenticated policies: service_role only.

-- Optional size guard for a single account state (~1.5 MB).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'mvpoisk_state_reasonable_size'
  ) then
    alter table public.mvpoisk_user_state
      add constraint mvpoisk_state_reasonable_size
      check (octet_length(state::text) < 1572864);
  end if;
end $$;
