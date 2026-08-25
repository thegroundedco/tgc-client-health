-- The admin write path on public.profiles. Slice 3 design §6.
--
-- POSTGRES HAS NO PER-COLUMN ROW LEVEL SECURITY. That is the fact this whole
-- file bends around, so it is stated first.
--
-- 20260820225903_restrict_profiles_grants.sql established that `authenticated`
-- holds column-level UPDATE on full_name and nothing else, and that this narrow
-- grant -- not any policy -- is the STRUCTURAL reason a user cannot promote
-- themselves. verify-privileges.sql section 2 pins it in five directions.
--
-- This migration grants role and is_active. Done alone, that reopens exactly the
-- vulnerability that repair closed: permissive policies OR-combine, and
-- profiles_update_own already permits a user to update their own row, so the
-- moment `authenticated` can write `role`, anyone can set their own to 'admin'.
--
-- So the grant never travels alone. Three pieces, one transaction:
--   the POLICY decides which ROWS      (another person's, for an admin)
--   the GRANT decides which COLUMNS    (role, is_active)
--   the TRIGGER decides WHO, and not themselves
--
-- Splitting them across migrations would create a window in which the grant
-- exists and the guard does not. There is no such window in one file.

----------------------------------------------------------------------------
-- 1. The policy -- which rows
----------------------------------------------------------------------------

-- Without this, profiles_update_own permits only your OWN row, so an admin
-- cannot write to anybody else's record at all and the whole screen is inert.
--
-- using AND with check, or a row could be reassigned.
--
-- Deliberately NO self-exclusion here. The trigger owns that rule, in one place.
-- Expressing it in both would be two mechanisms to keep in agreement, which is
-- the drift this schema keeps designing against -- and it would not add
-- protection, because dropping the trigger re-enables self-promotion through
-- profiles_update_own regardless of what this policy says.
create policy profiles_update_manage_users
  on public.profiles
  for update
  to authenticated
  using ((select private.has_capability('manage_users')))
  with check ((select private.has_capability('manage_users')));

----------------------------------------------------------------------------
-- 2. The grant -- which columns
----------------------------------------------------------------------------

grant update (role, is_active) on public.profiles to authenticated;

----------------------------------------------------------------------------
-- 3. The trigger -- who, and not themselves
----------------------------------------------------------------------------

-- SECURITY DEFINER IS MANDATORY, and not for the usual reason. A security
-- invoker trigger runs as `authenticated`, and calling private.has_capability
-- BY NAME requires USAGE on schema private -- which authenticated deliberately
-- does not have. That absence is the property letting policies reference the
-- function while no role can call it. Under definer the function resolves as its
-- owner, who has USAGE.
--
-- auth.uid() still returns the real caller under definer: it reads a
-- request-level setting, not the current role.
create function private.guard_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
begin
  -- Nothing privileged changed. full_name edits and updated_at touches fall
  -- straight through, so profiles_update_own keeps working exactly as before.
  if new.role is not distinct from old.role
     and new.is_active is not distinct from old.is_active then
    return new;
  end if;

  -- NO AUTHENTICATED CALLER means this is direct SQL: a migration, service_role,
  -- or a repair run from a terminal. All three already bypass RLS entirely, so
  -- guarding them would add no security while removing the only recovery path
  -- that exists on a project whose backups are not yet proven. This exemption is
  -- what makes a mistake here survivable.
  if caller is null then
    return new;
  end if;

  if not (select private.has_capability('manage_users')) then
    raise exception 'insufficient privilege to change role or is_active'
      using errcode = '42501';
  end if;

  -- ONE CLAUSE, TWO GUARANTEES. Self-promotion becomes structurally impossible
  -- again, so the widened grant above does not reintroduce the 20260820225903
  -- vulnerability. And lockout becomes provably impossible: nobody can demote
  -- themselves, and only an admin holds manage_users, so admin A may demote
  -- admin B but B -- now without the capability -- cannot demote A. At least one
  -- active admin always survives, with no counting logic anywhere.
  --
  -- The cost, stated in the design and worth repeating where it bites: with
  -- exactly one admin, that admin's own row cannot be changed by anybody.
  if new.id = caller then
    raise exception 'cannot change your own role or active status'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

-- No EXECUTE grant, matching handle_new_user and touch_updated_at. Trigger
-- function execute is checked at CREATE TRIGGER time against the creator, not at
-- fire time against the caller -- measured on this project. The revoke names
-- `public` because Postgres grants EXECUTE to PUBLIC on every new function.
revoke execute on function private.guard_profile_privileges() from public, anon, authenticated;

-- Fires before profiles_touch_updated_at (g sorts before t), which is
-- incidental: the guard neither reads nor writes updated_at.
create trigger profiles_guard_privileges
  before update on public.profiles
  for each row execute function private.guard_profile_privileges();
