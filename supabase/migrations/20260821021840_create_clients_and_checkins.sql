-- The two tables that carry the actual business data: the clients we look after
-- and the monthly health check-in for each. These are the real Phase 1 tables,
-- not Slice 0 scaffolding.

create table public.clients (
  id bigint generated always as identity primary key,
  name text not null,
  owner_id uuid references public.profiles (id) on delete set null,
  status text not null default 'active'
    check (status in ('active', 'paused', 'cancelled', 'former')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.clients.owner_id is
  'The account manager responsible. Nullable, and set null on profile delete: '
  'losing a person must never delete the client history.';

create index clients_owner_id_idx on public.clients (owner_id);
create index clients_status_idx on public.clients (status);

create table public.checkins (
  id bigint generated always as identity primary key,
  client_id bigint not null references public.clients (id) on delete cascade,
  -- The first day of the month, as a real date, so Postgres does the
  -- calendar arithmetic instead of string manipulation.
  -- Cast to timestamp explicitly: date_trunc(text, timestamptz) is only
  -- stable, and a check constraint requires an immutable expression.
  period date not null check (period = date_trunc('month', period::timestamp)::date),
  relationship smallint check (relationship between 1 and 5),
  delivery smallint check (delivery between 1 and 5),
  financial smallint check (financial between 1 and 5),
  sentiment smallint check (sentiment between 1 and 5),
  growth smallint check (growth between 1 and 5),
  -- Null when any pillar is unscored: incomplete must never read as low.
  -- Generated rather than written by the client, so the total cannot drift
  -- from the pillars it is meant to summarise, and null-propagation through
  -- `+` is what enforces the "incomplete has no score" rule in the database
  -- itself rather than only in TypeScript.
  total_score smallint generated always as (
    (relationship + delivery + financial + sentiment + growth)::smallint
  ) stored,
  notes text,
  submitted_by uuid references public.profiles (id) on delete set null,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, period)
);

comment on column public.checkins.total_score is
  'Null whenever any pillar is null. A missing pillar must never read as a low '
  'score: a false "at risk" is as harmful as a false "healthy".';

create index checkins_client_id_idx on public.checkins (client_id);
create index checkins_period_idx on public.checkins (period);
create index checkins_submitted_by_idx on public.checkins (submitted_by);

create trigger clients_touch_updated_at
  before update on public.clients
  for each row execute function private.touch_updated_at();

create trigger checkins_touch_updated_at
  before update on public.checkins
  for each row execute function private.touch_updated_at();

alter table public.clients enable row level security;
alter table public.checkins enable row level security;

-- Step 1 of the standing convention in
-- 20260820232223_revoke_public_function_defaults.sql: revoke BEFORE any grant.
--
-- This is not defensive noise. This project predates Supabase's 2026-04-28
-- default-privileges change, so schema public still carries
--   alter default privileges ... grant all on tables to anon, authenticated
-- for owning role supabase_admin. 20260820230559 revoked the equivalent row for
-- role postgres -- the role these migrations connect as -- but the
-- public/supabase_admin/r row CANNOT be revoked from this project (attempting it
-- fails with 42501: permission denied to change default privileges, measured).
-- So "new tables in public are born closed" is only true of tables postgres
-- created, and a bare grant is only safe if you already know which role ran the
-- CREATE. The revoke is correct either way, and a no-op when the default already
-- handled it.
--
-- It must come first, because revoking a table-level privilege also revokes it
-- on every column -- a revoke placed after a column-level grant would silently
-- undo it. That exact ordering mistake is what left public.profiles writable in
-- 20260820225355 and needed 20260820225903 to repair.
revoke all on public.clients from anon, authenticated;
revoke all on public.checkins from anon, authenticated;

-- anon gets nothing on either table. Client health data is not public.
grant select, insert, update on public.clients to authenticated;
grant select, insert, update on public.checkins to authenticated;
-- No delete for either: a client is retired by setting status, and a check-in is
-- corrected by editing it. Nothing the browser can do should destroy history.
--
-- No sequence grants needed, and this was measured rather than assumed: an
-- identity column advances its sequence internally through the table's INSERT
-- privilege, unlike `serial`, which does require usage on the sequence. The ACL
-- on both identity sequences is reported in the task report.

-- Slice 0 gate: an active account. Task 7 of the Phase 1 plan replaces these
-- with capability checks. The active-account requirement stays.
--
-- security definer so the check does not depend on the caller's own read access
-- to public.profiles, and so it cannot be defeated by a future narrowing of the
-- profiles select policy. It takes no arguments, reads only the calling user's
-- own row, and returns a single boolean, so definer rights leak nothing: the
-- caller already knows whether their own account is active.
create function private.is_active_user()
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and is_active
  );
$$;

-- MEASURED CORRECTION to the plan, which specified
--   revoke execute on function private.is_active_user()
--     from public, anon, authenticated;
-- and nothing else. That revoke list is what Supabase's own RLS guidance
-- recommends, and on this Postgres it breaks every policy below.
--
-- Postgres checks EXECUTE on a function referenced by a row-security policy at
-- QUERY time, against the role running the query -- not against the table owner.
-- Probed on this database (in a rolled-back transaction) with a definer function
-- in `private` carrying exactly the revoke above, a table granted SELECT to
-- authenticated, and a policy `using ((select private.probe_true()))`:
--
--   set local role authenticated; select count(*) from public.probe_tbl;
--   -> ERROR 42501: permission denied for function probe_true
--
-- Every read, insert and update below would have failed that way for every
-- signed-in user. Re-probed with the grant as written here: the same select
-- returned its row.
--
-- So: revoke from PUBLIC and anon, then grant EXECUTE to authenticated only.
-- PUBLIC stays in the revoke list because Postgres itself grants EXECUTE on
-- every new function to PUBLIC and no ALTER DEFAULT PRIVILEGES on this project
-- could suppress it -- see 20260820232429 for those measurements. Without the
-- PUBLIC revoke, anon would reach this function through PUBLIC.
--
-- Schema `private` deliberately gets NO usage grant, and that is what keeps this
-- narrow. A policy expression stores the function by OID and so needs only
-- EXECUTE at run time, but calling it by name needs USAGE on its schema. Probed:
--
--   set local role authenticated; select private.is_active_user();
--   -> ERROR 42501: permission denied for schema private
--
-- authenticated can therefore be *subject to* this function without being able
-- to call it. It is also unreachable over the Data API for a second, independent
-- reason: PostgREST exposes only the schemas in its config, and `private` is not
-- one of them.
revoke execute on function private.is_active_user() from public, anon;
grant execute on function private.is_active_user() to authenticated;

-- Every policy names its role explicitly and pairs it with a predicate; every
-- update policy carries both using and with check, so a row cannot be written
-- into a state the writer could not have read. auth.uid() and the helper are
-- wrapped in a subselect so they are evaluated once per statement rather than
-- once per row.
create policy clients_select_active_users
  on public.clients
  for select
  to authenticated
  using ((select private.is_active_user()));

create policy clients_insert_active_users
  on public.clients
  for insert
  to authenticated
  with check ((select private.is_active_user()));

-- An update needs a select policy too, or the row is invisible to the statement
-- and the update silently affects nothing. clients_select_active_users above is
-- that policy.
create policy clients_update_active_users
  on public.clients
  for update
  to authenticated
  using ((select private.is_active_user()))
  with check ((select private.is_active_user()));

create policy checkins_select_active_users
  on public.checkins
  for select
  to authenticated
  using ((select private.is_active_user()));

create policy checkins_insert_active_users
  on public.checkins
  for insert
  to authenticated
  with check ((select private.is_active_user()));

create policy checkins_update_active_users
  on public.checkins
  for update
  to authenticated
  using ((select private.is_active_user()))
  with check ((select private.is_active_user()));
