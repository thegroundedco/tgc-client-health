# Slice 3 — Users Admin and Pre-authorised Invitations — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin pre-authorise someone by email so their first sign-in activates them automatically, and manage roles and active status for everyone else, from a screen in the app.

**Architecture:** An `allowed_emails` invitation table gated on `manage_users`; the existing `security definer` signup trigger consumes an invitation on first sign-in; and a three-part write path on `profiles` — a `manage_users` policy for *which rows*, a column grant for *which columns*, and a `BEFORE UPDATE` trigger for *who, and not themselves* — because Postgres has no per-column RLS.

**Tech Stack:** Postgres 17.6 on Supabase, React 19 + TypeScript + Vite, vitest, oxlint, Supabase CLI via `npx`.

**Spec:** `docs/superpowers/specs/2026-08-25-phase-1-slice-3-users-admin-design.md` — read it before Task 1. §6 carries the security argument; every task below assumes it.

## Global Constraints

- **Branch:** `slice-3-users-admin`. **Never push mid-branch** — a push to `main` deploys Pages.
- **Staging first, always.** `npm run db:which` must print staging before any `db:push` or verifier. Production is Task 9 and nothing before it.
- **Every new table in `public` opens with `revoke all on <table> from anon, authenticated;`** before any grant. Pre-2026-04-28 projects inherit `grant all` default privileges.
- **`security definer` helpers live in `private`**, never `public`. Every one gets `revoke execute ... from public, anon` — naming `public` is load-bearing, not belt-and-braces.
- **Trigger functions need no `EXECUTE` grant.** Trigger-function execute is checked at `CREATE TRIGGER` time against the creator. Policy-referenced functions are the opposite and MUST be granted to `authenticated`.
- **`supabase db query` returns only the LAST statement's rows**, and a `NOTICE` is invisible through it. Every verifier ends with an echoing `SELECT`. Passing evidence is exit 0 plus that SELECT.
- **`format('%s', <boolean>)` emits `t`**, which parses as a column reference. Use `%L::boolean`.
- **`npm test` does not typecheck.** Run `npm run build` separately before believing anything is green.
- **No backups are proven yet.** The org moved to Pro on 2026-08-25; confirm a backup exists before trusting it.
- **Migration filenames:** always `npx --yes supabase@latest migration new <name>`. Never invent a timestamp.

---

### Task 1: The `allowed_emails` invitation table

**Files:**
- Create: `supabase/migrations/<generated>_create_allowed_emails.sql`
- Modify: `src/types/database.ts` (regenerated)
- Modify: `tests/capabilities.test.ts`

**Interfaces:**
- Produces: table `public.allowed_emails(email text pk, role text, created_by uuid, created_at timestamptz)`; policies `allowed_emails_{select,insert,update,delete}_manage_users`.
- Consumes: `private.has_capability(text)` from `20260824160306_has_capability.sql`.

- [ ] **Step 1: Create the migration file**

```bash
npx --yes supabase@latest migration new create_allowed_emails
```

- [ ] **Step 2: Write the migration**

Paste into the generated file:

```sql
-- Pre-authorised sign-ins. Slice 3 design §5.1.
--
-- An invitation is a ROW, not a message. Nothing here sends email. A row means:
-- when this address first signs in, give it this role and activate it
-- immediately, so the admin is not in the critical path.
--
-- The table means exactly one thing -- invited, not yet arrived -- because
-- private.handle_new_user DELETES the row as it consumes it (Task 2). There is
-- no consumed state and therefore no way for the two lists on the screen to
-- disagree about a person.

create table public.allowed_emails (
  email      text primary key check (email = lower(email)),
  role       text not null default 'viewer'
             check (role in ('admin', 'account_manager', 'viewer')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.allowed_emails is
  'Pre-authorised sign-ins. private.handle_new_user consumes and deletes a row on first sign-in, applying its role and activating the account.';

comment on column public.allowed_emails.email is
  'Lowercase, enforced by check constraint rather than by convention. handle_new_user matches on lower(new.email); enforcing the stored side too means the two halves cannot drift into a match that silently never happens.';

comment on column public.allowed_emails.created_by is
  'Set null on profile delete, following clients.owner_id: losing a person must never delete the record. Dies with the row when the invitation is consumed -- Slice 3 design §5.2 records that as an accepted cost.';

alter table public.allowed_emails enable row level security;

-- The standing rule for every new table in public. Projects created before
-- Supabase's 2026-04-28 change carry
--   alter default privileges in schema public grant all on tables to anon, authenticated;
-- so this table is born fully writable by both browser roles no matter how
-- narrow the explicit grants below are. Revoke must come first: revoking a
-- table-level privilege also revokes it on every column.
revoke all on public.allowed_emails from anon, authenticated;

-- anon gets nothing. An unauthenticated caller has no business reading a list of
-- people who have been invited.
grant select, insert, update, delete on public.allowed_emails to authenticated;

-- All four gate on manage_users, which only `admin` holds. Each is wrapped in a
-- subselect so Postgres evaluates it once per statement rather than once per row.
create policy allowed_emails_select_manage_users
  on public.allowed_emails
  for select
  to authenticated
  using ((select private.has_capability('manage_users')));

create policy allowed_emails_insert_manage_users
  on public.allowed_emails
  for insert
  to authenticated
  with check ((select private.has_capability('manage_users')));

-- An update needs a select policy too, or the row is invisible to the statement
-- and the update silently affects nothing. The select policy above is what makes
-- this reachable.
create policy allowed_emails_update_manage_users
  on public.allowed_emails
  for update
  to authenticated
  using ((select private.has_capability('manage_users')))
  with check ((select private.has_capability('manage_users')));

create policy allowed_emails_delete_manage_users
  on public.allowed_emails
  for delete
  to authenticated
  using ((select private.has_capability('manage_users')));
```

- [ ] **Step 3: Confirm the CLI is aimed at staging, then push**

```bash
npm run db:which
npm run db:push
```

Expected: `db:which` names `tgc-client-health-staging`. If it names production, STOP and relink.

- [ ] **Step 4: Verify the table landed with RLS on and anon holding nothing**

```bash
npx --yes supabase@latest db query --linked -f /dev/stdin <<'SQL'
select
  c.relrowsecurity                                            as rls_enabled,
  has_table_privilege('anon',          'public.allowed_emails', 'SELECT') as anon_select,
  has_table_privilege('authenticated', 'public.allowed_emails', 'INSERT') as auth_insert,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'allowed_emails')        as policies
from pg_class c where c.oid = 'public.allowed_emails'::regclass;
SQL
```

Expected: `rls_enabled = t`, `anon_select = f`, `auth_insert = t`, `policies = 4`.

- [ ] **Step 5: Regenerate the database types**

```bash
npx --yes supabase@latest gen types typescript --linked > src/types/database.ts
npm run build
```

Expected: build passes and `src/types/database.ts` now contains an `allowed_emails` entry.

- [ ] **Step 6: Write the failing drift test**

Append inside the existing `describe('the role presets', ...)` block in `tests/capabilities.test.ts`:

```ts
  it('permits the same roles in the allowed_emails check constraint', () => {
    // The third source. Role names now live in ROLE_CAPABILITIES, in the
    // has_capability CASE, and in the check constraint on allowed_emails.role.
    // A role added to two of the three would let an admin invite somebody to a
    // role the permission model does not know, and the failure would arrive as
    // a constraint violation at invite time rather than at build time.
    const constraintSql = migration('_create_allowed_emails.sql')
    const arm = constraintSql.match(/check \(role in \(([^)]*)\)\)/s)
    expect(arm, "the role check constraint in the allowed_emails migration").not.toBeNull()
    const fromSql = [...arm![1].matchAll(/'([a-z_]+)'/g)].map((match) => match[1])
    expect(fromSql.toSorted()).toEqual([...ROLES].toSorted())
  })
```

- [ ] **Step 7: Run it and watch it fail for the right reason**

```bash
npx vitest run tests/capabilities.test.ts -t 'allowed_emails check constraint'
```

Expected: PASS immediately, because Step 2 already wrote the constraint. **That is the wrong outcome for a test you cannot see fail.** Prove it can fail: temporarily change `'viewer'` to `'viewerr'` in the migration, re-run, confirm FAIL, then change it back and re-run to confirm PASS. A drift guard that has never failed is not a guard.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations src/types/database.ts tests/capabilities.test.ts
git commit -m "feat(slice-3): add the allowed_emails invitation table

An invitation is a row, not a message. Gated on manage_users in all four
directions, RLS on, anon holding nothing, and the standing revoke-before-grant
for a project that inherits `grant all` default privileges.

The role check constraint becomes a third source for role names, and
capabilities.test.ts now reads it -- so a role added to two of the three
places fails the build rather than surfacing as a constraint violation at
invite time."
```

---

### Task 2: The signup trigger consumes an invitation

**Files:**
- Create: `supabase/migrations/<generated>_invitation_on_signup.sql`
- Create: `scripts/verify-invites.sql`
- Modify: `package.json` (scripts)

**Interfaces:**
- Consumes: `public.allowed_emails` from Task 1.
- Produces: `private.handle_new_user()` sets `role` and `is_active = true` on an invitation hit and deletes the invitation; unchanged behaviour on a miss.

- [ ] **Step 1: Create the migration file**

```bash
npx --yes supabase@latest migration new invitation_on_signup
```

- [ ] **Step 2: Write the migration**

```sql
-- handle_new_user becomes conditional. Slice 3 design §5.2.
--
-- The MISS path is byte-for-byte the old behaviour: viewer, inactive, pending
-- screen. That is deliberate and load-bearing. It is how somebody who signs in
-- without an invitation is still reachable by an admin, and it is the only route
-- open to an account that already existed before this migration -- no trigger
-- will ever fire for those again.
--
-- create or replace, so the existing on_auth_user_created trigger keeps pointing
-- at it. Postgres preserves the function's ACL across a replace; the revoke below
-- is repeated anyway so this file states the whole privilege picture rather than
-- depending on a previous migration being read alongside it.
--
-- Still security definer, because the signing-up user has no rights on profiles
-- yet -- and now also none on allowed_emails, which is gated on manage_users.
-- The function owner bypasses RLS, which is what lets the lookup succeed.
-- search_path is empty, so every name below is schema-qualified.

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  invited public.allowed_emails%rowtype;
begin
  -- lower() on the incoming side as well as the stored side. The check
  -- constraint guarantees the stored half; auth.users.email casing is not
  -- something this function controls.
  select * into invited
    from public.allowed_emails
   where email = lower(new.email);

  if found then
    insert into public.profiles (id, email, role, is_active)
    values (new.id, new.email, invited.role, true);

    -- Consumed, not marked. The table then means exactly one thing.
    delete from public.allowed_emails where email = invited.email;
  else
    -- Unchanged: role defaults to 'viewer', is_active defaults to false.
    insert into public.profiles (id, email)
    values (new.id, new.email);
  end if;

  return new;
end;
$$;

revoke execute on function private.handle_new_user() from public, anon, authenticated;
```

- [ ] **Step 3: Push to staging**

```bash
npm run db:which && npm run db:push
```

- [ ] **Step 4: Write the verifier**

Create `scripts/verify-invites.sql`:

```sql
-- Proves the DEPLOYED signup path applies an invitation and ignores a
-- non-invitation. Run with `npm run verify:invites`. Slice 3 design §8.
--
-- STAGING ONLY. This inserts into auth.users, which is a real account on a real
-- project. npm run db:which is wired into the script for that reason.
--
-- Both directions are checked in one run, because "the hit path works" and "the
-- miss path still defaults to inactive viewer" are separate claims and the
-- second is the one that keeps an uninvited stranger out.

do $$
declare
  hit_id     uuid := gen_random_uuid();
  miss_id    uuid := gen_random_uuid();
  hit_email  text;
  miss_email text;
  got_role   text;
  got_active boolean;
  leftover   bigint;
  problems   text[] := '{}';
begin
  hit_email  := 'verify-invites-hit-'  || replace(hit_id::text,  '-', '') || '@example.test';
  miss_email := 'verify-invites-miss-' || replace(miss_id::text, '-', '') || '@example.test';

  insert into public.allowed_emails (email, role) values (hit_email, 'account_manager');

  -- The columns Supabase's auth.users requires. If Postgres complains about a
  -- NOT NULL column not listed here, add it -- the schema is Supabase's, not
  -- this project's, and it changes between platform versions.
  insert into auth.users (
    instance_id, id, aud, role, email,
    encrypted_password, email_confirmed_at,
    created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data
  ) values
    ('00000000-0000-0000-0000-000000000000', hit_id, 'authenticated', 'authenticated', hit_email,
     '', now(), now(), now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb),
    ('00000000-0000-0000-0000-000000000000', miss_id, 'authenticated', 'authenticated', miss_email,
     '', now(), now(), now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb);

  ----------------------------------------------------------------------------
  -- The hit: invited role applied, account activated, invitation consumed.
  ----------------------------------------------------------------------------
  select role, is_active into got_role, got_active
    from public.profiles where id = hit_id;

  if got_role is distinct from 'account_manager' then
    problems := problems || format(
      'an INVITED signup got role %L, expected account_manager -- handle_new_user is not reading allowed_emails.role',
      got_role)::text;
  end if;

  if got_active is distinct from true then
    problems := problems || format(
      'an INVITED signup got is_active %L::boolean, expected true -- the invitation did not activate the account, so the admin is still in the critical path',
      got_active)::text;
  end if;

  select count(*) into leftover from public.allowed_emails where email = hit_email;
  if leftover <> 0 then
    problems := problems || format(
      'the invitation for an INVITED signup was not consumed (%s row(s) left) -- allowed_emails no longer means "invited, not yet arrived" and the screen will show the person twice',
      leftover)::text;
  end if;

  ----------------------------------------------------------------------------
  -- The miss: unchanged behaviour. This is the half that keeps strangers out.
  ----------------------------------------------------------------------------
  select role, is_active into got_role, got_active
    from public.profiles where id = miss_id;

  if got_role is distinct from 'viewer' then
    problems := problems || format(
      'an UNINVITED signup got role %L, expected viewer -- the miss path is no longer the old behaviour',
      got_role)::text;
  end if;

  if got_active is distinct from false then
    problems := problems || format(
      'an UNINVITED signup got is_active %L::boolean, expected false -- SIGNING UP NOW GRANTS ACCESS, which is the vulnerability profiles.is_active exists to prevent',
      got_active)::text;
  end if;

  ----------------------------------------------------------------------------
  -- Cleanup, before any raise, so a failure does not leave test accounts behind.
  -- profiles first: profiles_id_fkey references auth.users and is not declared
  -- cascading, so deleting the user first would fail on the dependent row.
  ----------------------------------------------------------------------------
  delete from public.profiles      where id    in (hit_id, miss_id);
  delete from auth.users           where id    in (hit_id, miss_id);
  delete from public.allowed_emails where email in (hit_email, miss_email);

  if array_length(problems, 1) is not null then
    raise exception E'verify:invites FAILED\n\n  - %', array_to_string(problems, E'\n  - ');
  end if;

  raise notice 'verify:invites OK -- an invited signup is activated with its invited role and the invitation is consumed; an uninvited signup is still an inactive viewer';
end $$;

-- Echoed, because a NOTICE is invisible through `supabase db query` and this
-- SELECT is the only visible artifact of a pass. Zero rows here is the correct
-- and expected result: the run cleans up after itself, so anything left behind
-- is a cleanup bug worth seeing.
select email, role, created_at
  from public.allowed_emails
 where email like 'verify-invites-%'
 order by email;
```

- [ ] **Step 5: Add the npm script**

In `package.json`, beside the other verifiers:

```json
"verify:invites": "npm run db:which && npx --yes supabase@latest db query --linked -f scripts/verify-invites.sql",
```

- [ ] **Step 6: Run it and confirm it passes**

```bash
npm run verify:invites
```

Expected: exit 0, and the echoed SELECT returns zero rows. If Postgres rejects the `auth.users` insert for a missing NOT NULL column, add that column to the insert and re-run — the message names it.

- [ ] **Step 7: Prove the verifier can fail**

Temporarily change `'account_manager'` to `'viewer'` in the `insert into public.allowed_emails` line, re-run, and confirm it FAILS naming the role mismatch. Change it back and confirm PASS. A verifier nobody has seen fail proves nothing.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations scripts/verify-invites.sql package.json
git commit -m "feat(slice-3): consume an invitation on first sign-in

handle_new_user now looks up lower(new.email) in allowed_emails. On a hit it
applies the invited role, activates the account and deletes the invitation; on
a miss it does byte-for-byte what it did before.

The miss path is the load-bearing half. It is what keeps an uninvited signup an
inactive viewer, and it is the only route open to accounts that existed before
this migration -- no trigger fires for those again.

verify:invites checks both directions against the deployed trigger and cleans
up after itself. Staging only: it inserts real rows into auth.users."
```

---

### Task 3: The admin write path on `profiles`

**Files:**
- Create: `supabase/migrations/<generated>_profiles_admin_write_path.sql`
- Modify: `scripts/verify-privileges.sql`

**Interfaces:**
- Produces: policy `profiles_update_manage_users`; `grant update (role, is_active) on public.profiles to authenticated`; `private.guard_profile_privileges()` + trigger `profiles_guard_privileges`.
- Error contract consumed by Task 4: the guard raises SQLSTATE `42501` with message `cannot change your own role or active status` or `insufficient privilege to change role or is_active`.

**All three pieces MUST land in one migration.** A migration that grants the columns without the guard leaves a window in which any signed-in user can promote themselves through `profiles_update_own`. One file is one transaction; that is the point.

- [ ] **Step 1: Create the migration file**

```bash
npx --yes supabase@latest migration new profiles_admin_write_path
```

- [ ] **Step 2: Write the migration**

```sql
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
```

- [ ] **Step 3: Push to staging**

```bash
npm run db:which && npm run db:push
```

- [ ] **Step 4: Prove the guard behaves, by hand, before touching the verifier**

```bash
npx --yes supabase@latest db query --linked -f /dev/stdin <<'SQL'
do $$
declare
  admin_id uuid;
  failed   boolean := false;
begin
  select id into admin_id from public.profiles where role = 'admin' and is_active limit 1;
  if admin_id is null then
    raise exception 'no active admin on this project -- run scripts/activate-staging-profile.sql first';
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', admin_id, 'role', 'authenticated', 'aud', 'authenticated')::text, true);
  set local role authenticated;

  begin
    update public.profiles set role = 'viewer' where id = admin_id;
  exception when insufficient_privilege then
    failed := true;
  end;

  reset role;

  if not failed then
    raise exception 'AN ADMIN CHANGED THEIR OWN ROLE -- the guard is not firing';
  end if;
  raise notice 'guard OK -- an admin cannot change their own role';
end $$;
select 'guard probe complete' as result;
SQL
```

Expected: exit 0 and `guard probe complete`. A non-zero exit means the guard is wrong — stop and fix before continuing.

- [ ] **Step 5: Re-aim section 2 of `verify-privileges.sql`**

**This is the largest review risk in the slice.** Section 2 currently asserts that `role` and `is_active` are NOT grantable to `authenticated`. This migration deliberately grants both, so **that assertion is supposed to fail now**.

**Do not delete or relax it. Re-aim it.** Open `scripts/verify-privileges.sql`, find section 2, and change the claim from *"these columns are ungrantable"* to *"these columns are granted, AND the guard trigger exists to condition them"*, keeping `full_name` asserted as before. Add a comment recording why it changed and pointing at this migration. Assert the trigger's existence explicitly:

```sql
  -- The grant on role and is_active is only safe because the guard exists.
  -- Asserting the grant without asserting the guard would turn this section from
  -- a regression guard into a rubber stamp for the vulnerability it was written
  -- to catch. Slice 3 design §6.
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.profiles'::regclass
       and tgname  = 'profiles_guard_privileges'
       and not tgisinternal
  ) then
    problems := problems || 'public.profiles has column-level UPDATE granted on role and is_active but NO profiles_guard_privileges trigger -- every signed-in user can promote themselves to admin through profiles_update_own. This is the 20260820225903 vulnerability, reopened.'::text;
  end if;
```

- [ ] **Step 6: Add the live probes to section 10**

Following the existing `set_config` + `set local role authenticated` idiom in that section, add, as a **viewer**: cannot select `allowed_emails`; cannot insert into `allowed_emails`; cannot change own `role`; cannot change own `is_active`; **can** still update own `full_name`. And as an **admin**: can insert and delete an `allowed_emails` row; **cannot** change own `role`; **cannot** change own `is_active`.

The `full_name` probe is the regression guard proving the trigger did not break `profiles_update_own` — without it, a guard that raises on every update would look like a pass everywhere else.

- [ ] **Step 7: Run the verifiers**

```bash
npm run verify:privileges
npm run verify:capability
npm run verify:invites
```

Expected: all exit 0. Note `verify:privileges` does real writes and advances `clients_id_seq` — it must be aimed at staging.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations scripts/verify-privileges.sql
git commit -m "feat(slice-3): open the admin write path on profiles, guarded

Policy, grant and trigger in one transaction, because a migration granting the
columns without the guard leaves a window in which any signed-in user can
promote themselves through profiles_update_own.

The trigger is security definer of necessity: an invoker trigger runs as
authenticated, which has no USAGE on schema private and so cannot call
has_capability by name. It exempts callers with a null auth.uid() -- direct SQL
already bypasses RLS, so guarding it would only remove the recovery path.

verify-privileges section 2 is RE-AIMED, not relaxed: role and is_active are now
granted, so the old assertion had to change, and it now asserts the guard trigger
exists alongside the grant."
```

---

### Task 4: `userForm.ts` — every decision the screen makes, without React

**Files:**
- Create: `src/users/userForm.ts`
- Create: `tests/userForm.test.ts`

**Interfaces:**
- Produces: `AdminProfile`, `Invitation`, `InviteDraft`, `PROFILE_COLUMNS`, `INVITATION_COLUMNS`, `ASSIGNABLE_ROLES`, `ROLE_LABELS`, `roleLabel()`, `normalizeEmail()`, `invitePayload()`, `inviteProblems()`, `writeFailureText()`, `sortProfiles()`, `sortInvitations()`, `SELF_EDIT_TEXT`, `UPDATE_MATCHED_NOTHING_TEXT`, and re-uses `WriteState`/`StatusLine` shapes from `clients/clientForm.ts` by importing the types.

This file must not import `../lib/supabase` — that module reads `VITE_` config at module scope and throws when it is absent, and CI runs vitest with no `VITE_` env. Same constraint as `clientForm.ts`.

- [ ] **Step 1: Write the failing tests**

Create `tests/userForm.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  ASSIGNABLE_ROLES,
  inviteProblems,
  invitePayload,
  normalizeEmail,
  roleLabel,
  sortProfiles,
  writeFailureText,
} from '../src/users/userForm.ts'
import type { AdminProfile } from '../src/users/userForm.ts'

const profile = (over: Partial<AdminProfile>): AdminProfile => ({
  id: 'p1', email: 'a@example.com', full_name: null,
  role: 'viewer', is_active: true, updated_at: '2026-08-25T00:00:00Z', ...over,
})

describe('normalizeEmail', () => {
  it('lowercases and trims, because the check constraint requires lowercase', () => {
    expect(normalizeEmail('  Nick@TheGroundedCompany.COM ')).toBe('nick@thegroundedcompany.com')
  })
})

describe('inviteProblems', () => {
  it('refuses an empty address', () => {
    expect(inviteProblems({ email: '   ', role: 'viewer' }, [])).toEqual([
      { field: 'email', text: 'An invitation needs an email address.' },
    ])
  })

  it('refuses an address that already has an account, and says where to go instead', () => {
    const existing = [profile({ email: 'nick@thegroundedcompany.com' })]
    const problems = inviteProblems({ email: 'Nick@TheGroundedCompany.com', role: 'viewer' }, existing)
    expect(problems).toHaveLength(1)
    expect(problems[0].field).toBe('email')
    expect(problems[0].text).toContain('already has an account')
  })

  it('accepts a fresh address', () => {
    expect(inviteProblems({ email: 'new@example.com', role: 'admin' }, [])).toEqual([])
  })

  it('refuses a role the permission model does not know', () => {
    const problems = inviteProblems({ email: 'new@example.com', role: 'sales' }, [])
    expect(problems.map((p) => p.field)).toContain('role')
  })
})

describe('invitePayload', () => {
  it('normalizes the address, because the check constraint refuses uppercase', () => {
    expect(invitePayload({ email: ' New@Example.COM ', role: 'viewer' }))
      .toEqual({ email: 'new@example.com', role: 'viewer' })
  })
})

describe('writeFailureText', () => {
  it('translates the guard trigger self-edit refusal', () => {
    const text = writeFailureText('cannot change your own role or active status', 'you')
    expect(text).toContain('own access')
    expect(text).toContain('another admin')
  })

  it('translates a duplicate invitation', () => {
    expect(writeFailureText('duplicate key value violates unique constraint "allowed_emails_pkey"', 'a@b.com'))
      .toContain('already invited')
  })

  it('translates an RLS refusal into a sentence about permission', () => {
    expect(writeFailureText('new row violates row-level security policy', 'a@b.com'))
      .toContain('not allowed')
  })

  it('passes an unrecognised message through rather than swallowing it', () => {
    expect(writeFailureText('some novel database complaint', 'a@b.com'))
      .toContain('some novel database complaint')
  })
})

describe('sortProfiles', () => {
  it('puts inactive accounts first, because they are the ones needing action', () => {
    const rows = [
      profile({ id: '1', email: 'active@x.com', is_active: true }),
      profile({ id: '2', email: 'pending@x.com', is_active: false }),
    ]
    expect(sortProfiles(rows).map((r) => r.id)).toEqual(['2', '1'])
  })

  it('does not mutate its argument, because React compares by identity', () => {
    const rows = [profile({ id: '1', is_active: true }), profile({ id: '2', is_active: false })]
    const before = [...rows]
    sortProfiles(rows)
    expect(rows).toEqual(before)
  })
})

describe('ASSIGNABLE_ROLES and roleLabel', () => {
  it('offers all three roles, admin included', () => {
    expect([...ASSIGNABLE_ROLES].toSorted()).toEqual(['account_manager', 'admin', 'viewer'])
  })

  it('hands an unrecognised role straight back rather than relabelling it', () => {
    expect(roleLabel('sales')).toBe('sales')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run tests/userForm.test.ts
```

Expected: FAIL — cannot resolve `../src/users/userForm.ts`.

- [ ] **Step 3: Write `src/users/userForm.ts`**

```ts
import type { WriteState } from '../clients/clientForm'
import { ROLES } from '../lib/capabilities'

// Every decision the users admin screen makes, with no React and no Supabase
// client in sight -- the src/clients/clientForm.ts pattern, and for the same
// reason: the rules are not ternaries in JSX, and this file has to be importable
// by a test running with no VITE_ env. It must never import ../lib/supabase,
// which reads config at module scope and throws when it is absent.

export type { WriteState }

export type AdminProfile = {
  id: string
  email: string
  full_name: string | null
  // `string`, not Role, because that is what the column is: text with a check
  // constraint. Narrowing here would be a claim this code cannot verify.
  role: string
  is_active: boolean
  updated_at: string
}

export type Invitation = {
  email: string
  role: string
  created_at: string
}

export type InviteDraft = {
  email: string
  role: string
}

// The literal beside the type, so supabase-js infers the row shape from the
// string and a mistyped column fails `npm run build` rather than surfacing at
// runtime as undefined. Same pattern as CLIENT_COLUMNS.
export const PROFILE_COLUMNS = 'id, email, full_name, role, is_active, updated_at'
export const INVITATION_COLUMNS = 'email, role, created_at'

// All three, admin included -- Slice 3 design §7 and the decision recorded in
// §9. Derived from ROLES so a fourth role cannot be offered here without the
// permission model learning it first.
export const ASSIGNABLE_ROLES: readonly string[] = ROLES

export const ROLE_LABELS: Record<string, string> = {
  admin: 'Admin',
  account_manager: 'Account manager',
  viewer: 'Viewer',
}

export const ROLE_HINTS: Record<string, string> = {
  admin: 'Everything, including managing people and their access.',
  account_manager: 'Scores check-ins and manages the client roster.',
  viewer: 'Reads the board. Changes nothing.',
}

// Hands an unrecognised value straight back, for the same reason statusLabel
// does: a role this screen does not know is a row written outside it, and
// relabelling would hide that rather than surface it.
export function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role
}

// The check constraint on allowed_emails.email is `email = lower(email)`, so an
// uppercase address is refused by the database. Normalising here means the
// refusal never happens rather than being explained after a round trip.
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase()
}

export type InviteProblem = { field: 'email' | 'role'; text: string }

// Every problem returned here is one the database would refuse, or one it would
// silently accept and then never act on. The second kind matters most: inviting
// an address that already has a profile succeeds at the database and then sits
// inert forever, because no trigger will fire for it again.
export function inviteProblems(
  draft: InviteDraft,
  profiles: readonly AdminProfile[],
): InviteProblem[] {
  const problems: InviteProblem[] = []
  const email = normalizeEmail(draft.email)

  if (email === '') {
    problems.push({ field: 'email', text: 'An invitation needs an email address.' })
  } else if (profiles.some((profile) => normalizeEmail(profile.email) === email)) {
    problems.push({
      field: 'email',
      text: `${email} already has an account, so an invitation would never be used. Change their role in the people list instead.`,
    })
  }

  if (!ASSIGNABLE_ROLES.includes(draft.role)) {
    problems.push({
      field: 'role',
      text: `"${draft.role}" is not a role this tool knows, so it cannot be invited.`,
    })
  }

  return problems
}

export function invitePayload(draft: InviteDraft) {
  return { email: normalizeEmail(draft.email), role: draft.role }
}

// The guard trigger's two messages, verbatim from
// <generated>_profiles_admin_write_path.sql. Matched as substrings because
// Postgres prefixes nothing to a `raise exception ... using errcode` message,
// but supabase-js may wrap it.
const SELF_EDIT_MESSAGE = 'cannot change your own role or active status'
const NOT_ADMIN_MESSAGE = 'insufficient privilege to change role or is_active'

export const SELF_EDIT_TEXT =
  'You cannot change your own access. That is deliberate: it is what makes it impossible to lock every admin out of the tool. Another admin can change it for you.'

// An UPDATE that matched no row. profiles_update_manage_users is
// `using (...) with check (...)`, so a caller without manage_users has the row
// filtered out by USING rather than raising: zero rows, no error, and PostgREST
// answers PGRST116. Deliberately no invitation to retry -- every retry is
// refused identically.
export const UPDATE_MATCHED_NOTHING_TEXT =
  'That change was not applied, and nothing was changed. The database matched no account to update, which is what happens when the account signed in here is no longer allowed to manage users. Ask another admin.'

export function writeFailureText(message: string, subject: string): string {
  const tail = ' Nothing was changed.'

  if (message.includes(SELF_EDIT_MESSAGE)) return `${SELF_EDIT_TEXT}${tail}`

  if (message.includes(NOT_ADMIN_MESSAGE)) {
    return `Your account is not allowed to change anyone's access. Ask an admin.${tail}`
  }

  if (message.includes('allowed_emails_pkey')) {
    return `${subject} has already been invited. The existing invitation still works.${tail}`
  }

  if (message.includes('allowed_emails_email_check')) {
    return `That address could not be stored. Addresses are held in lowercase.${tail}`
  }

  if (message.includes('allowed_emails_role_check')) {
    return `That is not a role this tool knows.${tail}`
  }

  if (message.includes('permission denied') || message.includes('row-level security')) {
    return `Your account is not allowed to do that. Ask an admin.${tail}`
  }

  return `${message}.${tail}`
}

// Inactive first: those are the accounts waiting on somebody, and this screen
// exists to unblock them. Then by label, so the order is stable.
export function sortProfiles(rows: readonly AdminProfile[]): AdminProfile[] {
  return [...rows].sort(
    (a, b) =>
      Number(a.is_active) - Number(b.is_active) ||
      a.email.localeCompare(b.email),
  )
}

// Oldest first: an invitation that has been sitting longest is the one most
// likely to have gone astray.
export function sortInvitations(rows: readonly Invitation[]): Invitation[] {
  return [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at))
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run tests/userForm.test.ts
npm run build
```

Expected: all PASS, build clean.

- [ ] **Step 5: Commit**

```bash
git add src/users/userForm.ts tests/userForm.test.ts
git commit -m "feat(slice-3): add userForm, the screen's decisions without React

Follows clientForm.ts, including its constraint against importing lib/supabase
so the tests run with no VITE_ env.

Two rules here are not cosmetic. normalizeEmail lowercases because the
allowed_emails check constraint refuses anything else, so the refusal never
happens rather than being explained after a round trip. And inviteProblems
refuses an address that already has a profile -- the database accepts that row
happily and then never acts on it, because no signup trigger fires for an
existing account."
```

---

### Task 5: `useUsers.ts` — the one place this screen talks to the database

**Files:**
- Create: `src/users/useUsers.ts`

**Interfaces:**
- Consumes: everything Task 4 produces; `supabase` from `../lib/supabase`; `describeError` from `../lib/errorText`.
- Produces: `useUsers(): UseUsers` with `{ status, loadError, profiles, invitations, inviteState, editState, editStateFor, reload, invite, revokeInvite, setRole, setActive, resetInvite, resetEdit }`.

- [ ] **Step 1: Write the hook**

Create `src/users/useUsers.ts`, following `useClients.ts` exactly — the `isCancelled` parameter shape, the `inFlight` refs, `describeError` before `writeFailureText`, and `.maybeSingle()` rather than `.single()` on every update:

```ts
import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { describeError } from '../lib/errorText'
import { CONCURRENT_SAVE_TEXT } from '../clients/clientForm'
import {
  INVITATION_COLUMNS,
  PROFILE_COLUMNS,
  UPDATE_MATCHED_NOTHING_TEXT,
  invitePayload,
  sortInvitations,
  sortProfiles,
  writeFailureText,
} from './userForm'
import type { AdminProfile, InviteDraft, Invitation, WriteState } from './userForm'

export type UseUsers = {
  status: 'loading' | 'ready' | 'error'
  loadError: string | null
  profiles: AdminProfile[]
  invitations: Invitation[]
  inviteState: WriteState
  editState: WriteState
  // Which profile editState is ABOUT. Same reason as useClients' editStateFor:
  // one state per screen, controls per row, so without the id a confirmation for
  // one person renders beside another.
  editStateFor: string | null
  reload: () => void
  invite: (draft: InviteDraft) => void
  revokeInvite: (email: string) => void
  setRole: (id: string, role: string) => void
  setActive: (id: string, isActive: boolean) => void
  resetInvite: () => void
  resetEdit: () => void
}

export function useUsers(): UseUsers {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [profiles, setProfiles] = useState<AdminProfile[]>([])
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [inviteState, setInviteState] = useState<WriteState>({ kind: 'idle' })
  const [editState, setEditState] = useState<WriteState>({ kind: 'idle' })
  const [editStateFor, setEditStateFor] = useState<string | null>(null)

  const inviteInFlight = useRef(false)
  const editInFlight = useRef(false)

  const load = useCallback(async (isCancelled: () => boolean = () => false) => {
    setStatus('loading')
    try {
      const profileResult = await supabase
        .from('profiles')
        .select(PROFILE_COLUMNS)
        .order('email')

      if (isCancelled()) return
      if (profileResult.error) {
        setLoadError(describeError(profileResult.error))
        setStatus('error')
        return
      }

      // Readable only by manage_users. A non-admin reaching this screen gets an
      // empty list rather than an error, because RLS filters rows instead of
      // raising -- which is why the screen is drawn behind can() at all.
      const inviteResult = await supabase
        .from('allowed_emails')
        .select(INVITATION_COLUMNS)
        .order('created_at')

      if (isCancelled()) return
      if (inviteResult.error) {
        setLoadError(describeError(inviteResult.error))
        setStatus('error')
        return
      }

      setLoadError(null)
      setProfiles(sortProfiles(profileResult.data))
      setInvitations(sortInvitations(inviteResult.data))
      setStatus('ready')
    } catch (thrown) {
      if (isCancelled()) return
      setLoadError(describeError(thrown))
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void load(() => cancelled)
    return () => { cancelled = true }
  }, [load])

  const invite = useCallback((draft: InviteDraft) => {
    if (inviteInFlight.current) {
      setInviteState({ kind: 'failed', message: CONCURRENT_SAVE_TEXT })
      return
    }
    inviteInFlight.current = true
    setInviteState({ kind: 'saving' })

    void (async () => {
      const payload = invitePayload(draft)
      try {
        const { data, error } = await supabase
          .from('allowed_emails')
          .insert(payload)
          .select(INVITATION_COLUMNS)
          .single()

        if (error) {
          setInviteState({ kind: 'failed', message: writeFailureText(describeError(error), payload.email) })
          return
        }

        setInvitations((current) => sortInvitations([...current, data]))
        setInviteState({ kind: 'saved', at: data.created_at, what: `${payload.email} invited` })
      } catch (thrown) {
        setInviteState({ kind: 'failed', message: writeFailureText(describeError(thrown), payload.email) })
      } finally {
        inviteInFlight.current = false
      }
    })()
  }, [])

  const revokeInvite = useCallback((email: string) => {
    if (inviteInFlight.current) {
      setInviteState({ kind: 'failed', message: CONCURRENT_SAVE_TEXT })
      return
    }
    inviteInFlight.current = true
    setInviteState({ kind: 'saving' })

    void (async () => {
      try {
        const { error } = await supabase.from('allowed_emails').delete().eq('email', email)
        if (error) {
          setInviteState({ kind: 'failed', message: writeFailureText(describeError(error), email) })
          return
        }
        setInvitations((current) => current.filter((row) => row.email !== email))
        setInviteState({ kind: 'saved', at: new Date().toISOString(), what: `Invitation for ${email} revoked` })
      } catch (thrown) {
        setInviteState({ kind: 'failed', message: writeFailureText(describeError(thrown), email) })
      } finally {
        inviteInFlight.current = false
      }
    })()
  }, [])

  // One writer for both privileged columns, because both go through the same
  // policy, the same grant and the same guard trigger, and every failure branch
  // reads identically. Two near-identical copies would be two places to get the
  // PGRST116 handling wrong.
  const writeProfile = useCallback(
    (id: string, patch: { role: string } | { is_active: boolean }, what: string) => {
      const report = (next: WriteState) => {
        setEditStateFor(id)
        setEditState(next)
      }

      if (editInFlight.current) {
        report({ kind: 'failed', message: CONCURRENT_SAVE_TEXT })
        return
      }
      editInFlight.current = true
      report({ kind: 'saving' })

      void (async () => {
        try {
          const { data, error } = await supabase
            .from('profiles')
            .update(patch)
            .eq('id', id)
            .select(PROFILE_COLUMNS)
            // .maybeSingle(), not .single(). Two distinct failure shapes reach
            // here and only one is an error: the guard trigger RAISES 42501 with
            // a message, while a caller without manage_users has the row filtered
            // out by USING and gets zero rows and no error at all. .single()
            // would turn the second into PGRST116, which no branch translates.
            .maybeSingle()

          if (error) {
            report({ kind: 'failed', message: writeFailureText(describeError(error), id) })
            return
          }

          if (data === null) {
            report({ kind: 'failed', message: UPDATE_MATCHED_NOTHING_TEXT })
            return
          }

          setProfiles((current) => sortProfiles(current.map((row) => (row.id === id ? data : row))))
          report({ kind: 'saved', at: data.updated_at, what })
        } catch (thrown) {
          report({ kind: 'failed', message: writeFailureText(describeError(thrown), id) })
        } finally {
          editInFlight.current = false
        }
      })()
    },
    [],
  )

  const setRole = useCallback(
    (id: string, role: string) => writeProfile(id, { role }, 'Role changed'),
    [writeProfile],
  )

  const setActive = useCallback(
    (id: string, isActive: boolean) =>
      writeProfile(id, { is_active: isActive }, isActive ? 'Account activated' : 'Account deactivated'),
    [writeProfile],
  )

  return {
    status, loadError, profiles, invitations,
    inviteState, editState, editStateFor,
    reload: () => void load(),
    invite, revokeInvite, setRole, setActive,
    resetInvite: () => setInviteState({ kind: 'idle' }),
    resetEdit: () => setEditState({ kind: 'idle' }),
  }
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run build
```

Expected: clean. If `allowed_emails` is unknown to the types, Task 1 Step 5 did not regenerate them — go back and do it.

- [ ] **Step 3: Commit**

```bash
git add src/users/useUsers.ts
git commit -m "feat(slice-3): add useUsers, the screen's only database seam

Mirrors useClients: the isCancelled parameter rather than a closed-over let,
in-flight refs for presses inside one round trip, and describeError before
writeFailureText so an empty message never renders as nothing.

One writer serves role and is_active because both cross the same policy, grant
and guard. It uses maybeSingle() deliberately: the guard raises 42501 with a
message, while a caller without manage_users is filtered out by USING and gets
zero rows and no error -- single() would collapse the second into a PGRST116
nobody can read."
```

---

### Task 6: The users admin screen

**Files:**
- Create: `src/users/UsersAdmin.tsx`, `src/users/InviteForm.tsx`, `src/users/UsersAdmin.module.css`

**Interfaces:**
- Consumes: `useUsers()` from Task 5; everything Task 4 produces.
- Produces: `<UsersAdmin onBack={() => void} currentUserId={string} />`.

- [ ] **Step 1: Build `InviteForm.tsx`**

```tsx
import { useState } from 'react'
import { ASSIGNABLE_ROLES, ROLE_HINTS, ROLE_LABELS, inviteProblems } from './userForm'
import type { AdminProfile, InviteDraft, WriteState } from './userForm'

type Props = {
  profiles: readonly AdminProfile[]
  state: WriteState
  onInvite: (draft: InviteDraft) => void
}

const EMPTY: InviteDraft = { email: '', role: 'viewer' }

export function InviteForm({ profiles, state, onInvite }: Props) {
  const [draft, setDraft] = useState<InviteDraft>(EMPTY)
  const problems = inviteProblems(draft, profiles)
  const saving = state.kind === 'saving'

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        // Checked here as well as on the disabled button: a form submits on
        // Enter in a text field, which does not consult the button.
        if (saving || problems.length > 0) return
        onInvite(draft)
        setDraft(EMPTY)
      }}
    >
      <label htmlFor="invite-email" className="t-label">Email address</label>
      <input
        id="invite-email"
        type="email"
        value={draft.email}
        disabled={saving}
        onChange={(event) => setDraft({ ...draft, email: event.target.value })}
      />

      <label htmlFor="invite-role" className="t-label">Role</label>
      <select
        id="invite-role"
        value={draft.role}
        disabled={saving}
        onChange={(event) => setDraft({ ...draft, role: event.target.value })}
      >
        {ASSIGNABLE_ROLES.map((role) => (
          <option key={role} value={role}>{ROLE_LABELS[role] ?? role}</option>
        ))}
      </select>
      <p className="t-small">{ROLE_HINTS[draft.role] ?? ''}</p>

      {/* Shown, not merely used to disable the button. A control that is dead
          for a reason nobody states is the defect this project keeps finding. */}
      {problems.map((problem) => (
        <p key={problem.field} className="t-small">{problem.text}</p>
      ))}

      <button className="button" type="submit" disabled={saving || problems.length > 0}>
        {saving ? 'Inviting…' : 'Invite'}
      </button>
    </form>
  )
}
```

- [ ] **Step 2: Build `UsersAdmin.tsx`**

```tsx
import { formatSavedAt } from '../lib/month'
import { InviteForm } from './InviteForm'
import { useUsers } from './useUsers'
import { ASSIGNABLE_ROLES, ROLE_LABELS, roleLabel } from './userForm'
import styles from './UsersAdmin.module.css'

type Props = { onBack: () => void; currentUserId: string }

export function UsersAdmin({ onBack, currentUserId }: Props) {
  const admin = useUsers()
  const writing = admin.inviteState.kind === 'saving' || admin.editState.kind === 'saving'

  // Disabled while either write is in flight, matching ClientsAdmin: leaving
  // unmounts this screen and the write then lands with nobody left to read its
  // confirmation -- a write that worked looking exactly like one that did not.
  const back = (
    <nav className={styles.nav}>
      <button className="button button--quiet" disabled={writing} type="button" onClick={onBack}>
        Board
      </button>
    </nav>
  )

  const masthead = (
    <div className="masthead">
      <p className="t-eyebrow">People</p>
      <h2 className="t-header">Access</h2>
    </div>
  )

  if (admin.status === 'loading') {
    return <>{back}{masthead}<p className="t-body">Loading…</p></>
  }

  if (admin.status === 'error') {
    return <>{back}{masthead}<p className="t-body">{admin.loadError}</p></>
  }

  return (
    <>
      {back}
      {masthead}

      <section>
        <h3 className="t-subhead">People</h3>
        <ul>
          {admin.profiles.map((row) => {
            const isSelf = row.id === currentUserId
            return (
              <li key={row.id}>
                <p className="t-body">{row.full_name?.trim() || row.email}</p>
                <p className="t-small">{row.email}</p>

                <select
                  aria-label={`Role for ${row.email}`}
                  value={row.role}
                  disabled={isSelf || writing}
                  onChange={(event) => admin.setRole(row.id, event.target.value)}
                >
                  {/* The stored role is offered even when it is not one of the
                      three, so a row written outside this screen still shows
                      what it holds instead of silently reading as a viewer. */}
                  {(ASSIGNABLE_ROLES.includes(row.role)
                    ? ASSIGNABLE_ROLES
                    : [...ASSIGNABLE_ROLES, row.role]
                  ).map((role) => (
                    <option key={role} value={role}>{ROLE_LABELS[role] ?? role}</option>
                  ))}
                </select>

                <button
                  className="button button--quiet"
                  type="button"
                  disabled={isSelf || writing}
                  onClick={() => admin.setActive(row.id, !row.is_active)}
                >
                  {row.is_active ? 'Deactivate' : 'Activate'}
                </button>

                {isSelf && (
                  <p className="t-small">
                    You cannot change your own access. That is what makes it
                    impossible to lock every admin out. Another admin can.
                  </p>
                )}

                {admin.editStateFor === row.id && admin.editState.kind === 'failed' && (
                  <p className="t-small">{admin.editState.message}</p>
                )}
                {admin.editStateFor === row.id && admin.editState.kind === 'saved' && (
                  <p className="t-small">
                    {admin.editState.what} {formatSavedAt(admin.editState.at)}.
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      </section>

      <section>
        <h3 className="t-subhead">Invited — not yet signed in</h3>

        {/* An explicit empty state. A blank region reads as a failed load, which
            is this project's signature defect wearing a new mask. */}
        {admin.invitations.length === 0 ? (
          <p className="t-body prose">
            Nobody is waiting. Invite someone below and they will have access the
            first time they sign in.
          </p>
        ) : (
          <ul>
            {admin.invitations.map((row) => (
              <li key={row.email}>
                <p className="t-body">{row.email}</p>
                <p className="t-small">
                  {roleLabel(row.role)} · invited {formatSavedAt(row.created_at)}
                </p>
                <button
                  className="button button--quiet"
                  type="button"
                  disabled={writing}
                  onClick={() => admin.revokeInvite(row.email)}
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        )}

        <InviteForm
          profiles={admin.profiles}
          state={admin.inviteState}
          onInvite={admin.invite}
        />

        {admin.inviteState.kind === 'failed' && (
          <p className="t-small">{admin.inviteState.message}</p>
        )}
        {admin.inviteState.kind === 'saved' && (
          <p className="t-small">
            {admin.inviteState.what} {formatSavedAt(admin.inviteState.at)}.
          </p>
        )}
      </section>
    </>
  )
}
```

Create `src/users/UsersAdmin.module.css` with `.nav` and `.adminLink` rules copied from `src/clients/ClientsAdmin.module.css` so spacing matches the clients screen.

**Why your own row is inert:** it must agree with the guard trigger exactly. The database refuses the write either way — this is the convenience half of §7.2, and a control that is drawn and then fails when pressed is worse than one that was never drawn.

- [ ] **Step 3: Disable navigation while a write is in flight**

```tsx
const writing = admin.inviteState.kind === 'saving' || admin.editState.kind === 'saving'
```

Pass `disabled={writing}` to the Board button, matching `ClientsAdmin`'s reasoning: leaving unmounts the screen and the write lands with nobody to read its confirmation.

- [ ] **Step 4: Typecheck and lint**

```bash
npm run build && npm run lint
```

- [ ] **Step 5: Commit**

```bash
git add src/users/
git commit -m "feat(slice-3): add the users admin screen

Two lists that cannot overlap, because the signup trigger consumes an
invitation: people come from profiles, invitations from allowed_emails.

Your own row is drawn inert, matching the guard trigger exactly. UI hiding is
convenience and the database refusing is the security -- but a control that is
drawn and then fails when pressed is worse than one that was never drawn."
```

---

### Task 7: Wire the screen into the board

**Files:**
- Modify: `src/board/Board.tsx`

- [ ] **Step 1: Add the state and the branch**

Beside `showingClients`, add `const [showingUsers, setShowingUsers] = useState(false)`, and an early return mirroring the `ClientsAdmin` branch. It does **not** need `board.reload()` on the way back: nothing on this screen changes a client or a check-in.

- [ ] **Step 2: Add the link, gated on `manage_users`**

```tsx
// The second caller of can() in the application. Convenience, not security:
// a non-admin reaching this screen reads an empty invitation list and has
// every write refused by profiles_update_manage_users and the guard trigger.
const usersLink = can(profile.role, 'manage_users') ? (
  <nav className={styles.adminLink}>
    <button className="button button--quiet" onClick={() => setShowingUsers(true)} type="button">
      People
    </button>
  </nav>
) : null
```

Include it beside `adminLink` in **every** early return, for the same reason `adminLink` is: a failed read or an empty board must not strand an admin.

- [ ] **Step 3: Pass the current user's id**

`<UsersAdmin onBack={() => setShowingUsers(false)} currentUserId={profile.id} />` — this is what makes the self-edit row inert.

- [ ] **Step 4: Verify**

```bash
npm test && npm run build && npm run lint
```

- [ ] **Step 5: Commit**

```bash
git add src/board/Board.tsx
git commit -m "feat(slice-3): reach the users admin from the board

Gated on manage_users, and included in every early return for the same reason
the clients link is: a failed read is not a reason to strand an admin."
```

---

### Task 8: Prove it on staging, including a real sign-in

**A broken definer grant is a total outage that NO catalogue assertion detects.** Only a real sign-in finds it. This task is not optional and cannot be replaced by a verifier.

- [ ] **Step 1: Confirm the target and push everything**

```bash
npm run db:which && npm run db:push
```

- [ ] **Step 2: Run every verifier**

```bash
npm run verify:privileges && npm run verify:capability && npm run verify:invites && npm run verify:lifecycle && npm run verify:score
```

Expected: all exit 0.

- [ ] **Step 3: Sign in to staging for real**

```bash
npm run dev
```

Sign in at `http://localhost:5173` against staging. **Confirm the board loads with data.** A blank board or a permission error here is the definer-grant outage, and it is the whole reason this step exists.

- [ ] **Step 4: Exercise the screen end to end**

Open **People**. Confirm: your own row's controls are disabled with the reason shown; inviting a fresh address adds it to the invited list; revoking removes it; inviting an address that already has a profile is refused with the "already has an account" sentence before any request is sent.

- [ ] **Step 5: Prove the invitation actually works**

Invite a second address you control, sign in as it in a private window, and confirm it lands **straight on the board** rather than the pending screen — and that the invitation has disappeared from the invited list. That single test is the entire feature.

- [ ] **Step 6: Commit anything the exercise changed, and stop**

Do not proceed to Task 9 without Josh's explicit go-ahead. Production is his call.

---

### Task 9: Production

- [ ] **Step 1: Get explicit approval.** Confirm with Josh before touching production.

- [ ] **Step 2: Confirm a backup exists.** Supabase Dashboard → Database → Backups on `tgc-client-health-production`. A fresh Pro upgrade does not backfill. If there is no backup, say so and stop.

- [ ] **Step 3: Relink to production, push, and relink back to staging immediately.**

```bash
npx --yes supabase@latest link --project-ref jizavsawtbkmvzllxhtk
npm run db:which   # MUST now name production
npx --yes supabase@latest db push --linked
```

- [ ] **Step 4: Verify against production**

```bash
npm run verify:privileges && npm run verify:capability
```

Do **not** run `verify:invites` against production — it inserts real rows into `auth.users`.

- [ ] **Step 5: Sign in to the deployed site and confirm the board loads.**

- [ ] **Step 6: Activate Adam.** He has been on the pending screen since 2026-08-24. This is the first thing the new screen is for, and it needs no email at all — he already has an account.

- [ ] **Step 6b: Before inviting anyone NEW on production, check SMTP.** Spec §3: custom SMTP is not configured, and delivery to a non-team address currently works in a way Supabase documents as not working. Activating an existing account is unaffected. **Sending a first invitation to somebody who has never signed in depends on that undocumented behaviour**, and its failure mode is an email that silently never arrives. Configure custom SMTP (Google Workspace: `smtp.gmail.com:465`, app password, then raise the 30/hour default under Authentication → Rate Limits) before relying on it, or invite one address you control first and confirm the link lands.

- [ ] **Step 7: Relink to staging.**

```bash
npx --yes supabase@latest link --project-ref dexsdhtpfsswgiytxntl
npm run db:which   # MUST name staging
```

**Never leave production linked.**

- [ ] **Step 8: Merge and push.** Pushing to `main` deploys Pages, so this is the last action and it needs Josh's go-ahead.
