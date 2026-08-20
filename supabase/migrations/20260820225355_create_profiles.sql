-- Private schema for security definer helpers. Nothing here is reachable
-- from the browser.
create schema if not exists private;
revoke all on schema private from public;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  role text not null default 'viewer'
    check (role in ('admin', 'account_manager', 'viewer')),
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.profiles.is_active is
  'Defaults to false: signing up must not grant access. An admin activates.';

create index profiles_role_idx on public.profiles (role);

alter table public.profiles enable row level security;

-- Data API exposure is a separate concern from RLS. Without these grants the
-- table is unreachable; without RLS the grants would expose everything.
grant usage on schema public to anon, authenticated;
grant select on public.profiles to authenticated;

-- Narrow write surface: a user may rename themselves and nothing else.
-- Column-level grants make this structural rather than a UI convention.
grant update (full_name) on public.profiles to authenticated;

create policy profiles_select_own
  on public.profiles
  for select
  to authenticated
  using ((select auth.uid()) = id);

-- An update needs a select policy too, or it silently affects zero rows.
-- Both using and with check are required, or a row could be reassigned.
create policy profiles_update_own
  on public.profiles
  for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- Creates the profile row on signup. Security definer because the signing-up
-- user has no rights on profiles yet. Lives in private, takes no user input,
-- and writes only the row for the user being created.
create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$;

revoke execute on function private.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

create function private.touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke execute on function private.touch_updated_at() from public, anon, authenticated;

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function private.touch_updated_at();
