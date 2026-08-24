-- The permission model, finally enforced. Parent spec §7.1 names four
-- capabilities and gives each role a preset; §7.2 says "the database enforces
-- them" and "UI hiding is convenience; the database refusing is the security".
--
-- Until this migration, the database enforced none of it. All six policies on
-- public.clients and public.checkins gated on private.is_active_user(), which
-- answers exactly one question: does the caller have a profile row with
-- is_active? So an active `viewer` -- whose only preset capability is
-- view_scores -- could insert and update check-ins, and could create and rename
-- clients. Nothing was exploitable, because production has one user and he is an
-- admin; it was the second account manager that would have made it real.
--
-- ORDER IN THIS FILE IS LOAD-BEARING:
--   1. create has_capability AND grant it, before any policy names it;
--   2. replace the six policies;
--   3. drop is_active_user last.
-- Postgres enforces part of that: a policy referencing a function depends on it,
-- so step 3 fails rather than breaking anything if a reference is left behind.
--
-- The three view_scores conversions are behaviour-neutral today: every preset
-- includes view_scores, so an active user reads exactly what they read before.
-- They are converted anyway, because a policy asking "are you active" while the
-- model says "do you hold this capability" IS the gap, and it reappears the
-- first time a role is added that should not read scores.

----------------------------------------------------------------------------
-- 1. The function
----------------------------------------------------------------------------

-- security definer so the check does not depend on the caller's own read access
-- to public.profiles, and so it cannot be defeated by a future narrowing of the
-- profiles select policy. `set search_path = ''` so every name below is
-- schema-qualified and nothing resolves through a caller-controlled path.
--
-- The CAPABILITY is a parameter; the SUBJECT never is. The caller is resolved
-- from (select auth.uid()) inside the function. A version taking a user_id would
-- let any signed-in browser enumerate everybody's permissions, which is the
-- whole reason parent spec §7.2 states this rule explicitly.
--
-- The parameter is named `wanted` rather than `capability` so it cannot be
-- captured by a same-named column if public.profiles ever gains one. Qualifying
-- it as has_capability.capability would express the same intent, but whether a
-- `language sql` function may qualify a parameter by function name was not
-- verified on this Postgres -- and a name that cannot collide needs no
-- qualification. The signature the rest of the system depends on is (text)
-- either way.
--
-- Role presets only. permission_overrides does not exist yet -- it is Slice 3,
-- which changes THIS FUNCTION BODY and no policy. That is the entire reason the
-- function is built now instead of writing `role in (...)` into six policies and
-- rewriting them later against live data.
create function private.has_capability(wanted text)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.is_active
      and wanted = any (
        case p.role
          when 'admin' then array[
            'view_scores', 'edit_scores', 'manage_clients', 'manage_users']
          when 'account_manager' then array[
            'view_scores', 'edit_scores', 'manage_clients']
          when 'viewer' then array[
            'view_scores']
          else array[]::text[]
        end
      )
  );
$$;

-- THE GRANTS ARE NOT THE OBVIOUS ONES, and this comment is carried over from
-- is_active_user because the measurement behind it still applies.
--
-- `public` in the revoke is load-bearing, not belt-and-braces: Postgres grants
-- EXECUTE on every new function to PUBLIC, and no ALTER DEFAULT PRIVILEGES on
-- this project suppresses it (see 20260820232429 for those measurements), so
-- `anon` reaches the function implicitly unless `public` is named.
--
-- The grant to `authenticated` is MANDATORY. Postgres checks EXECUTE on a
-- policy-referenced function at query time against the role running the query,
-- not against the table owner. Revoking it from `authenticated` -- which is what
-- Supabase's own RLS guidance recommends for definer helpers -- makes every
-- policy below fail 42501 for every signed-in user. A total outage, not a
-- degraded read. Measured on this project (Postgres 17.6, 2026-08-21); the
-- transcript is in 20260821021840_create_clients_and_checkins.sql.
--
-- `authenticated` still gets no USAGE on schema private, so this function is
-- reachable only through the policies that name it: a policy stores the function
-- by OID and needs only EXECUTE at run time, while calling it by name needs
-- USAGE on its schema. authenticated is therefore SUBJECT TO this function
-- without being able to call it.
revoke execute on function private.has_capability(text) from public, anon;
grant execute on function private.has_capability(text) to authenticated;

----------------------------------------------------------------------------
-- 2. The six policies
----------------------------------------------------------------------------

-- Dropped and recreated rather than ALTER POLICY, so the whole predicate is
-- visible in this file for review rather than only the delta. The file is one
-- transaction, so there is no window in which a table has RLS on and no policy.
--
-- Renamed as well as re-pointed. `clients_insert_active_users` would be an
-- actively wrong name for a policy gating on manage_clients, and a wrong name in
-- a schema is a false comment with a longer half-life than one in code.
--
-- Each is wrapped in a subselect so Postgres evaluates it once per statement
-- rather than once per row.

drop policy clients_select_active_users on public.clients;
drop policy clients_insert_active_users on public.clients;
drop policy clients_update_active_users on public.clients;

create policy clients_select_view_scores
  on public.clients
  for select
  to authenticated
  using ((select private.has_capability('view_scores')));

create policy clients_insert_manage_clients
  on public.clients
  for insert
  to authenticated
  with check ((select private.has_capability('manage_clients')));

-- An update needs a select policy too, or the row is invisible to the statement
-- and the update silently affects nothing. clients_select_view_scores above is
-- what makes this reachable.
create policy clients_update_manage_clients
  on public.clients
  for update
  to authenticated
  using ((select private.has_capability('manage_clients')))
  with check ((select private.has_capability('manage_clients')));

drop policy checkins_select_active_users on public.checkins;
drop policy checkins_insert_active_users on public.checkins;
drop policy checkins_update_active_users on public.checkins;

create policy checkins_select_view_scores
  on public.checkins
  for select
  to authenticated
  using ((select private.has_capability('view_scores')));

create policy checkins_insert_edit_scores
  on public.checkins
  for insert
  to authenticated
  with check ((select private.has_capability('edit_scores')));

create policy checkins_update_edit_scores
  on public.checkins
  for update
  to authenticated
  using ((select private.has_capability('edit_scores')))
  with check ((select private.has_capability('edit_scores')));

----------------------------------------------------------------------------
-- 3. The old helper
----------------------------------------------------------------------------

-- Last, and only now that nothing references it. An unused security definer
-- function is privilege-escalation surface with no policy justifying it, and two
-- overlapping helpers is how enforcement drifts from the model in the first
-- place. If this statement fails, a policy still references it -- fix the
-- reference, do not add `cascade`.
drop function private.is_active_user();
