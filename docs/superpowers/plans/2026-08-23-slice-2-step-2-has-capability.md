# Slice 2 Step 2 — `has_capability`, and the enforcement that was never there

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the database enforce the role presets it has never enforced. Today all six
policies on `clients` and `checkins` ask "is this account active", so an active `viewer`
can write check-ins and create clients. After this step every policy asks for the
capability it actually means.

**Architecture:** One migration: create `private.has_capability(text)`, grant it, replace
all six policies, then drop `private.is_active_user()`. One TypeScript copy of the role
presets for the UI, tied to the SQL by a drift guard. Then the two files that watch the
boundary — `scripts/verify-privileges.sql` and `src/lib/rls.test.ts` — updated to watch
the new one.

**Tech Stack:** Postgres 17.6 on Supabase, Vitest 4.

**Spec:** `docs/superpowers/specs/2026-08-23-phase-1-slice-2-design.md` §1 (fourth reason —
read it before starting), §6 (the function and the conversion table), §9, §10 decisions 1
and 7. Parent spec §7.1 (presets) and §7.2 (the grant rules, measured on this project).

## Global Constraints

- **No database commands.** Not `db:push`, not `verify:privileges`, not `verify:lifecycle`,
  not `gen types`. `npm test` **does** run `src/lib/rls.test.ts`, which reaches staging
  with the anonymous key — that one is expected and is how task 3 is verified.
- **`npm test` does not typecheck.** Run `npm run build` separately.
- **Read the file before writing the step that edits it.** Nine defects in Slice 1 step 4
  were caught this way.
- **A number in prose needs the command that produced it run in the same breath as the
  sentence containing it.**
- **Every new guard must be proved able to fail.**
- **Do not write a sentence you have not verified.** If a step asks you to state something
  you cannot check, stop and report it.

## Why this step is the dangerous one, stated before any code

This project has already measured what a wrongly-scoped policy-referenced function costs:
**Postgres checks `EXECUTE` on a policy-referenced function at query time against the role
running the query.** Revoking it from `authenticated` makes every policy naming it fail
`42501` for every signed-in user — a total outage, not a degraded read. Parent spec §7.2
has the transcript.

So the order inside the migration is not a preference:

1. Create `has_capability` **and grant it to `authenticated`** — before any policy names it.
2. Replace the six policies.
3. Drop `is_active_user` **last**.

Postgres enforces part of this for you: a policy expression referencing a function creates
a dependency, so dropping `is_active_user` while a policy still references it **fails**
rather than silently breaking anything. That is a safety net, not a substitute for the
order.

`supabase db push` wraps each migration file in a transaction, so there is never a moment
where a table has RLS enabled and no policy — and if any statement fails, none of it
applied. **Do not add `create index concurrently` or anything else that cannot run in a
transaction to this file.**

---

## File structure

| File | Responsibility |
|---|---|
| `supabase/migrations/<generated>_has_capability.sql` | **Create.** The function, its grants, the six replacement policies, and the drop. |
| `tests/hasCapability.test.ts` | **Create.** Node, no database. Pins the function body, the grants, the six policy predicates, and the drop — and that the order inside the file is right. |
| `src/lib/capabilities.ts` | **Create.** The role presets in TypeScript, for hiding UI. No React, no Supabase. |
| `src/lib/capabilities.test.ts` | **Create.** Node. Asserts the TS presets and the SQL arrays are the same, by reading the migration. |
| `scripts/verify-privileges.sql` | **Modify.** §9's allowlist, §10e's policy names, §10's behaviour assertions, and one message naming an old policy. |
| `src/lib/rls.test.ts` | **Modify.** Repoint the anon-RPC probe from `is_active_user` to `has_capability`. |

---

### Task 1: The migration

**Files:**
- Create: `supabase/migrations/<generated>_has_capability.sql`
- Create: `tests/hasCapability.test.ts`

**Interfaces produced:** `private.has_capability(wanted text) returns boolean`, and six
policies named in the table below. Task 2 reads the preset arrays out of this migration;
task 3 asserts these policy names.

- [ ] **Step 1: Generate the file**

```bash
npx --yes supabase@latest migration new has_capability
```

Local file creation only. Report the filename. It must sort **after**
`20260823213144_add_client_lifecycle.sql`.

- [ ] **Step 2: Read the two files this replaces**

`supabase/migrations/20260821021840_create_clients_and_checkins.sql` — specifically
`private.is_active_user()`, its `revoke`/`grant` pair and the long MEASURED CORRECTION
comment beneath it, and all six policies. The new migration must read as the same hand
wrote it, and the correction comment's *reasoning* has to survive into the new file even
though the function does not.

- [ ] **Step 3: Write the migration**

```sql
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
-- this project suppresses it, so `anon` reaches the function implicitly unless
-- `public` is named.
--
-- The grant to `authenticated` is MANDATORY. Postgres checks EXECUTE on a
-- policy-referenced function at query time against the role running the query,
-- not against the table owner. Revoking it from `authenticated` -- which is what
-- Supabase's own RLS guidance recommends for definer helpers -- makes every
-- policy below fail 42501 for every signed-in user. A total outage, not a
-- degraded read. Measured on this project (Postgres 17.6, 2026-08-21).
--
-- `authenticated` still gets no USAGE on schema private, so this function is
-- reachable only through the policies that name it.
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
```

**The three `view_scores` conversions are behaviour-neutral today** — every preset includes
`view_scores`, so an active user reads exactly what they read before. They are converted
anyway, because a policy asking "are you active" while the model says "do you hold this
capability" is the gap itself, and it reappears the first time a role is added that should
not read scores. State that in the report; do not claim the reads changed.

- [ ] **Step 4: Write the drift guard**

Create `tests/hasCapability.test.ts`, modelled on `tests/clientLifecycle.test.ts` — read
that first. It pins text and **order**; it proves nothing about what Postgres does.

Assertions, at minimum:

1. The function is `security definer` **and** `set search_path = ''` **and** `stable`.
2. It resolves the subject from `(select auth.uid())` and **never** takes a user id: assert
   the signature is exactly `has_capability(wanted text)` — one parameter, of type text.
3. `revoke execute ... from public, anon;` is present — assert `public` specifically, since
   that is the load-bearing half.
4. `grant execute ... to authenticated;` is present. **Prove this one can fail by deleting
   the grant line** — it is the outage.
5. All six new policy names exist, and none of the six old `_active_users` names does.
6. Each of the six predicates names the right capability — a table-driven test, so a
   mixed-up pair (say `checkins_insert` gating on `view_scores`) fails.
7. **Order:** the index of the `create function` is before the index of the first
   `create policy`, and the index of `drop function private.is_active_user` is after the
   last `create policy`. This is the assertion that catches the outage-shaped edit.
8. Nothing is dropped except the six policies and the one function — comments stripped
   first, then assert the exact set of `drop` statements.

- [ ] **Step 5: Prove it can fail**

One at a time, restore each, report the red count:

1. Delete the `grant execute ... to authenticated` line. **Expect red.**
2. Move the `drop function private.is_active_user();` to the top of the file. **Expect red**
   — this is the ordering assertion earning its place.
3. Change `checkins_insert_edit_scores`'s predicate to `'view_scores'`.
4. Change the signature to `has_capability(subject uuid, wanted text)`.
5. Remove `set search_path = ''`.
6. Add `drop table public.clients;`.

- [ ] **Step 6: Commit**

```bash
npm run build && npm test && npm run lint
git add supabase/migrations tests/hasCapability.test.ts
git commit -m "feat(db): enforce the role presets with has_capability, unapplied"
```

`unapplied` in the message, as in step 1.

---

### Task 2: The role presets in TypeScript, tied to the SQL

**Files:**
- Create: `src/lib/capabilities.ts`
- Create: `src/lib/capabilities.test.ts`

**Interfaces:**
- Consumes: the preset arrays inside task 1's migration, read as text.
- Produces: `type Capability`, `type Role`, `ROLE_CAPABILITIES: Record<Role, readonly Capability[]>`, `can(role: Role, capability: Capability): boolean`. Step 4's screen uses `can` to decide what to render.

**Why a second copy exists at all, and why it is safe.** The UI has to hide what a person
cannot do — parent spec §7.1 — and the browser cannot ask Postgres cheaply on every render.
So the presets exist twice, which is a drift risk, and the test below is the whole
mitigation: it reads the arrays out of the migration and asserts they are the same sets.
**The UI copy is never the enforcement.** `can()` decides what to draw; the policies decide
what happens. Say that in the file.

- [ ] **Step 1: Write the failing test**

`src/lib/capabilities.test.ts`, node environment. It must:

1. Read the migration file, extract the three preset arrays with a regex per role, and
   assert each equals `ROLE_CAPABILITIES[role]` **as a set and by length**.
2. Assert the four capability names are exactly parent spec §7.1's Phase 1 four:
   `view_scores`, `edit_scores`, `manage_clients`, `manage_users`.
3. Assert `can('viewer', 'edit_scores')` is false and `can('viewer', 'view_scores')` is
   true — the specific pair that is wrong in the database today.
4. Assert every role in the TS map appears in the migration and vice versa, so adding a
   fourth role to one side fails.

- [ ] **Step 2: Run it, watch it fail, implement, watch it pass**

`src/lib/capabilities.ts` holds the type union, the map, and `can`. No React, no Supabase —
it must be importable in the node environment without touching the client, which throws
when VITE_ config is absent (CI runs vitest with no VITE_ env).

- [ ] **Step 3: Prove it can fail**

Remove `edit_scores` from `account_manager` in the TS map only, and confirm red. Then
remove it from the migration only, and confirm red. Both directions, because a
one-directional check would let the SQL grow a capability the UI never learns about.

- [ ] **Step 4: Commit**

```bash
npm run build && npm test && npm run lint
git add src/lib/capabilities.ts src/lib/capabilities.test.ts
git commit -m "feat(auth): the role presets in TypeScript, pinned to the migration"
```

---

### Task 3: Move the two watchers onto the new function

**Files:**
- Modify: `scripts/verify-privileges.sql`
- Modify: `src/lib/rls.test.ts`

**Why this is its own task.** These two files are the only automated evidence the privilege
boundary works. Task 1 changes the boundary; until this task lands, both files describe a
boundary that no longer exists — and §10e in particular would fail for a *good* reason
(the policies it names are gone) in a way that looks like a finding.

- [ ] **Step 1: Read the four places in `verify-privileges.sql` that name the old world**

```bash
grep -n 'is_active_user\|_active_users' scripts/verify-privileges.sql
```

**Measured 2026-08-23: 21 matches — 12 of `is_active_user` and 11 of `_active_users`.**
They fall in four areas: §9's function allowlist (and its comment), §10e's
`expected (tbl, policy)` VALUES list, one `problems` message that names
`clients_select_active_users`, and several explanatory comments that describe the old
boundary. **Report the count you actually get.** If it is not 21, the file has changed
since this plan was written — read why before editing anything.

- [ ] **Step 2: Update §9's allowlist and §10e's policy list**

§9 sweeps every function in `private` against an explicit allowlist and fails **in both
directions** — an unlisted EXECUTE for a browser role, and a listed grant that has gone
missing. The entry is `'<signature>|<role>'`, and §9c casts the signature half with
`::regprocedure`, so **the argument type must be spelled**:

```
'private.is_active_user()|authenticated'   ->   'private.has_capability(text)|authenticated'
```

Verified against the file 2026-08-23: the existing entry is exactly
`'private.is_active_user()|authenticated'` and §9c does `r.fn::regprocedure`. Carry the
comment above it across too — it explains why the grant is mandatory, and that reasoning
outlives the function it currently names.

§10e's list becomes the six new names. Leave `profiles_select_own` and
`profiles_update_own` alone — the profiles widening is step 3.

- [ ] **Step 3: Add the assertion that would have failed on today's schema**

This is the point of the whole step, so it gets its own check in §10: **become
`authenticated` with a viewer's claims and assert an `insert` on `checkins` is refused.**
Follow §10's existing pattern — `set local role` plus a synthetic `request.jwt.claims`,
inside a block that rolls back, per the standing rule that a mutation used as a probe must
be wrapped in a `DO` block ending in `raise exception` rather than left to commit.

Add alongside it: an active `account_manager`'s `checkins` insert **succeeds**, and their
`clients` insert **succeeds**; an active `viewer`'s `clients` insert is **refused**. The
positive cases matter as much as the negative ones — §9's second direction exists because
the failure that locks everyone out is the one nobody tests for.

Preconditions, reported as COULD NOT VERIFY rather than as findings, following the file's
existing two-failure design: these checks need a profile row with each role to exist. On a
project with only an admin, say so and skip rather than inventing rows.

- [ ] **Step 4: Repoint the anon-RPC probe**

`src/lib/rls.test.ts` has `it('cannot call private.is_active_user() as an RPC')`, which
POSTs to `/rest/v1/rpc/is_active_user` and expects `404` / `PGRST202` because the function
lives in `private` and PostgREST resolves against `public`.

**After task 1 that test passes for the wrong reason** — the function no longer exists at
all, so a 404 proves nothing about schema exposure. That is precisely the "a test that
still passes when its subject is deleted is worth nothing" defect. Repoint it at
`has_capability`, keep the reasoning comment, and note in the file that the probe survived
a rename of its subject and had to be moved deliberately.

- [ ] **Step 5: Run what you can, and be explicit about what you cannot**

```bash
npm test        # includes rls.test.ts, which reaches staging with the anon key
npm run build
npm run lint
```

`verify-privileges.sql` **cannot be run here** — it is a database command and it probes the
write path for real, advancing `clients_id_seq`. Read the SQL you wrote. If it is malformed,
that is a fix round after the owner's first run, not a failure of this task.

- [ ] **Step 6: Commit**

```bash
git add scripts/verify-privileges.sql src/lib/rls.test.ts
git commit -m "test(db): move the privilege watchers onto has_capability"
```

---

## The owner's sequence

Step 1's migration must be applied first — filename order makes that automatic, but
`verify:lifecycle` should be green before this one goes anywhere.

1. **Staging**: `npm run db:which` (expect staging) → `npm run db:push` →
   **`npm run verify:privileges`**. That is the run that matters: it becomes
   `authenticated` and exercises the new policies for real. Expect COULD NOT VERIFY on the
   role-specific checks if staging has no viewer or account_manager profile.
2. **Sign in on staging if you have not** — `scripts/activate-staging-profile.sql`. Staging
   has never had an active profile, so no policy has ever been exercised there, and this is
   the step where that stops being acceptable.
3. **Production**: `ALLOW_PRODUCTION=1 npm run db:push`, then
   `ALLOW_PRODUCTION=1 npm run verify:privileges`.
4. **Check you can still use the app.** Sign in on the deployed site and open a check-in.
   The one failure mode this step can have is the outage described at the top, and it looks
   like every read returning nothing.
5. **Push.**

## Self-review

**Spec coverage.** §6's function, verbatim including the four grant rules → Task 1. §6's
conversion table, all six rows → Task 1. §6's "is_active_user is then dropped" and its
three referencing places → Task 1 and Task 3. §9's "has_capability's grants, both
directions" → Task 3 step 2. §9's "has_capability's answers" and "a viewer cannot write" →
Task 3 step 3. §10 decision 1 (build it now) and 7 (drop the old helper) → the migration's
own comments. The UI's need for the presets → Task 2, with the drift guard that keeps the
two copies honest.

**Not covered here, deliberately.** The `profiles` select widening is step 3; §10e's
profiles entries are left alone. Nothing in this step touches a screen.

**Placeholder scan.** No TBDs. The migration filename is generated, not invented. Task 3
step 1 asks for the actual grep count before editing rather than trusting this plan's
"four areas".

**Two risks this plan does not remove.** First, `verify-privileges.sql` cannot be run by
the implementer, so its new assertions are unexercised until the owner's first run —
stated in Task 3 step 5 rather than papered over. Second, and more important: **the
positive half of this change is only verified by the owner signing in.** Every negative
assertion can pass while the app is unusable, because a policy that denies everything
denies the viewer's insert too. Step 4 of the owner's sequence is not a formality; it is
the only check that distinguishes "correctly enforced" from "broken for everyone".
