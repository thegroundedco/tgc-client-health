# Slice 2 Step 3 — the `profiles` select widening

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let any active user read every profile row, so step 4's owner picker can list
people by name and Slice 1's card footer can eventually name who submitted a check-in.

**Architecture:** One migration adding a *second* SELECT policy on `public.profiles`.
Postgres OR-combines permissive policies for the same command, so `profiles_select_own`
stays and nothing is dropped. Then the watchers that describe the old boundary are moved,
including one assertion that would otherwise report a false violation and one that would
pass vacuously.

**Tech Stack:** Postgres 17.6 on Supabase, Vitest 4.

**Spec:** `docs/superpowers/specs/2026-08-23-phase-1-slice-2-design.md` §8 (the widening,
verbatim, including the paragraph naming what it exposes) and §9's testing table. Parent
spec `docs/superpowers/specs/2026-08-20-tgc-client-health-design.md` §7.

## Global Constraints

- **No database commands.** Not `db:push`, not `verify:privileges`, not `verify:capability`,
  not `gen types`. `npm test` **does** run `src/lib/rls.test.ts`, which reaches staging with
  the anonymous key; that one is expected.
- **`npm test` does not typecheck.** Run `npm run build` separately.
- **A test that reads the filesystem cannot live under `src/`.** `tsconfig.app.json` has no
  node types, so it passes `npm test` and fails `npm run build`. Filesystem tests go in
  `tests/`, importing `../src/...ts` **with the extension**. See `src/styles/tokenRules.ts:15`.
  The step 2 plan got this wrong and cost a file move.
- **Read the file before writing the step that edits it.**
- **A number in prose needs the command that produced it run in the same breath as the
  sentence containing it.**
- **Every new guard must be proved able to fail.**
- **Do not write a sentence you have not verified.**

## This is a widening, and the plan says so before it says anything else

§8 is unusually blunt and the bluntness is the point:

> **What this actually exposes:** every active user can read every profile's `email`,
> `full_name`, `role` and `is_active`. That is the staff list, including who is an admin.

This is the right trade for a five-person agency tool. It is still a widening, and the
migration's own comment must say so, so that nobody reading the schema in a year mistakes
it for a bug fix. **The write surface does not move**: `authenticated` keeps column-level
`UPDATE` on `full_name` and nothing else, so nobody can promote themselves. Section 2 of
`verify-privileges.sql` already asserts that in five directions and this step must not
touch it.

## Three things measured before this plan was written

1. **The one app read of `profiles` is already filtered.** `src/auth/useProfile.ts:38-41`
   is `.from('profiles').select('*').eq('id', userId).maybeSingle()`. The widening cannot
   turn that into a multi-row result, so **no application code changes in this step.** Had
   it been a bare `.single()`, this migration would have broken the app's front door.
2. **`profiles_select_own` must stay, and not for the reason you would guess.** It is *not*
   needed for the inactive-account screen: `src/appState.ts:49` is
   `if (!profile || !profile.is_active)`, so a missing row and an inactive row already
   collapse to the same `pending` state. It stays because `profiles_update_own` needs a
   SELECT policy to make the row visible — the create-profiles migration says "An update
   needs a select policy too, or it silently affects zero rows" — and an inactive user
   renaming themselves must not silently no-op. Dropping it would also couple "read your own
   profile" to holding a capability, which is a different guarantee than the one being asked
   for.
3. **§9's testing table has an error, and this plan does not follow it.** It says the
   widening means "an active user reads more than one profile row; **an inactive one reads
   zero**". With both policies present an inactive user reads exactly **one** row — their
   own, via `profiles_select_own` — because `has_capability` is false for them but
   `auth.uid() = id` is true. Zero would only be right if this step replaced the own-row
   policy, and §8 says "a second policy". The assertion written below is
   *exactly their own row and no others*. Flagged here rather than silently diverging.

---

## File structure

| File | Responsibility |
|---|---|
| `supabase/migrations/<generated>_widen_profiles_select.sql` | **Create.** The second SELECT policy, and the comment recording that this is a deliberate widening. |
| `tests/profilesWidening.test.ts` | **Create.** Node, no database. Pins the policy text, that it gates on `view_scores`, and that nothing is dropped. |
| `scripts/verify-privileges.sql` | **Modify.** §4's profiles comment, §10a2's new profile-count precondition, §10b's profiles assertion (currently reports a FALSE VIOLATION after this change), 10c and 10d's messages, §10e's policy list, and a new 10g for the inactive subject. |
| `src/board/cardSummary.ts:41-44` | **Modify.** A comment that becomes false: it says another person's profile is unreadable. |

---

### Task 1: The migration

**Files:**
- Create: `supabase/migrations/<generated>_widen_profiles_select.sql`
- Create: `tests/profilesWidening.test.ts`

**Interfaces produced:** a policy named `profiles_select_active_users` on `public.profiles`.
Task 2 asserts that name in §10e.

- [ ] **Step 1: Generate the file**

```bash
npx --yes supabase@latest migration new widen_profiles_select
```

Local file creation only. Report the filename. It must sort **after**
`20260824160306_has_capability.sql`, because it references `private.has_capability`.

- [ ] **Step 2: Read the two files this builds on**

`supabase/migrations/20260820225355_create_profiles.sql` — the grants, both existing
policies and the comment above `profiles_update_own`. Then
`supabase/migrations/20260824160306_has_capability.sql`, for the house comment style and
because the new policy calls that function.

- [ ] **Step 3: Write the migration**

```sql
-- Lets any ACTIVE user read every profile row. Slice 2 design §8.
--
-- THIS IS A WIDENING, NOT A FIX, and this comment exists so that nobody reading
-- the schema later mistakes it for one. Before this, `profiles_select_own`
-- restricted SELECT to your own row. After it, every active user can read every
-- profile's email, full_name, role and is_active -- which is the staff list,
-- including who is an admin. That is the right trade for a five-person agency
-- tool and it is a deliberate choice, made once, here.
--
-- WHAT DOES NOT MOVE: the write surface. `authenticated` still holds
-- column-level UPDATE on full_name and nothing else, so nobody can promote
-- themselves or activate their own account. Section 2 of
-- scripts/verify-privileges.sql asserts that in five directions.
--
-- WHY IT IS NEEDED: the clients admin screen's owner picker (Slice 2 §7) lists
-- active profiles by name, and Slice 1 §10 item 7 recorded that the board's card
-- footer could not name who submitted a check-in for exactly this reason. The
-- footer is NOT changed in this step -- Slice 2 §8 defers it to the first slice
-- that touches the board again.
--
-- A SECOND POLICY, not a replacement, and the distinction is load-bearing.
-- Postgres OR-combines permissive policies for the same command, so a row is
-- readable if EITHER policy allows it. profiles_select_own stays because
-- profiles_update_own needs a SELECT policy to make the row visible at all --
-- see the comment above it in 20260820225355_create_profiles.sql, "An update
-- needs a select policy too, or it silently affects zero rows" -- and because
-- reading your own profile should not become conditional on holding a
-- capability. An INACTIVE user therefore still reads exactly one row: their own.
--
-- Gated on view_scores rather than on "is the account active" because that is
-- what every other read in this schema now asks, and the whole point of
-- 20260824160306 was to stop policies asking a question the permission model
-- does not have. Every role preset includes view_scores, so today this admits
-- every active user; the first role that should not read scores will also not
-- read the staff list, which is the correct coupling.
create policy profiles_select_active_users
  on public.profiles
  for select
  to authenticated
  using ((select private.has_capability('view_scores')));
```

Nothing else. No grants (the table-level `grant select on public.profiles to authenticated`
from `20260820225355` already covers reads; what changes is which rows RLS returns), no
index (`has_capability` looks up `profiles` by primary key), and **no drop**.

- [ ] **Step 4: Write the drift guard**

Create `tests/profilesWidening.test.ts`, modelled on `tests/hasCapability.test.ts` — read
that first, and reuse its `migration()` and `withoutComments()` helpers by copying them, as
`clientLifecycle.test.ts` and `hasCapability.test.ts` already each carry their own copy.

Assertions, at minimum:

1. The policy is created, on `public.profiles`, `for select`, `to authenticated`.
2. It gates on `private.has_capability('view_scores')` — assert the capability by name, so
   regating it on `manage_users` fails.
3. It is wrapped in a subselect: the text contains
   `using ((select private.has_capability('view_scores')))`.
4. **Nothing is dropped at all** — comments stripped first, then assert the statements
   contain no `drop`, no `delete`, no `truncate`, no `alter policy`. The whole design of
   this step is additive, and an edit that turned it into a replacement would silently
   remove the own-row read.
5. `profiles_select_own` and `profiles_update_own` are **not mentioned in any statement** —
   they may be discussed in comments, which is why the stripping matters.

- [ ] **Step 5: Prove it can fail**

One at a time, restore each, report the red count:

1. Change the capability to `'manage_users'`. **Expect red.**
2. Add `drop policy profiles_select_own on public.profiles;`. **Expect red** — this is the
   assertion that matters most, because that edit is the plausible mistake.
3. Remove the `to authenticated` clause.
4. Unwrap the subselect to `using (private.has_capability('view_scores'))`.

- [ ] **Step 6: Commit**

```bash
npm run build && npm test && npm run lint
git add supabase/migrations tests/profilesWidening.test.ts
git commit -m "feat(db): let active users read every profile, unapplied"
```

`unapplied` in the message, as in step 2's task 1.

---

### Task 2: Move the watchers, and fix the two assertions this breaks

**Files:**
- Modify: `scripts/verify-privileges.sql`
- Modify: `src/board/cardSummary.ts`

**Why this is its own task.** Task 1 changes what an active user can read. Until this task
lands, `verify-privileges.sql` **reports a false violation** — and separately, the check the
spec asks for would pass while proving nothing. Both are described below with the exact
current text.

- [ ] **Step 1: Read the places that describe the old boundary**

```bash
grep -n 'count(\*) into n_seen from public.profiles' scripts/verify-privileges.sql
grep -n 'profiles_select_own' scripts/verify-privileges.sql
grep -n 'authenticated may read its own row' scripts/verify-privileges.sql
```

**Measured 2026-08-24, on the file as step 2 left it.** Three separate greps rather than one,
because the three things being edited share no substring — the first draft of this plan used
a single pattern that did not match the §4 comment at all, and claimed four assertion sites
where there are three.

- **Three** `count(*) into n_seen from public.profiles` sites: **659** (10b, the one that
  becomes a false violation), **708** (10c), **775** (10d).
- `profiles_select_own` named at **662** (10b's message), **711** (10c's message) and
  **797** (§10e's `expected` list).
- §4's allowlist comment at **211**.

**Report the line numbers you actually get.** Task 1 does not touch this file, but Slice 2
step 2 rewrote large parts of it, so these have moved recently. For orientation: the file
holds 52 references to `public.profiles` in total, most of them in prose.

- [ ] **Step 2: Declare the profile total and add its precondition**

This is the vacuity guard, and without it this whole step is unverified. Add beside
`n_clients_total`:

```sql
  n_profiles_total bigint;
```

Then, in 10a2 beside the existing clients and checkins counts:

```sql
  select count(*) into n_profiles_total from public.profiles;

  -- THE WIDENING CANNOT BE CHECKED WITH ONE PROFILE ROW, and this is the exact
  -- vacuity this file exists to prevent. With a single row, "an active user sees
  -- all 1 of 1 rows" is TRUE under profiles_select_own alone -- so 10b below
  -- would pass identically whether or not
  -- <generated>_widen_profiles_select.sql was ever applied. Production held
  -- exactly one profile when that migration was written.
  if n_profiles_total < 2 then
    preconditions := preconditions || format(
      'public.profiles holds %s row(s), so the profiles widening went UNEXERCISED -- with one row, "sees every profile" and "sees only its own" are the same assertion, and 10b passes either way. This needs a second account to exist (README: "Activating the first admin" describes making one active)',
      n_profiles_total)::text;
  end if;
```

- [ ] **Step 3: Fix 10b, which currently reports a FALSE VIOLATION**

The current text, verbatim:

```sql
      select count(*) into n_seen from public.profiles;
      if n_seen <> 1 then
        problems := problems || format(
          'an active user sees %s rows in public.profiles, expected exactly their own -- profiles_select_own is wrong in one direction or the other',
          n_seen)::text;
      end if;
```

`<> 1` is the old guarantee. After task 1 an active user sees **every** row, so on any
database with two or more profiles this reports a violation for a change that is working
correctly. Replace it with:

```sql
      select count(*) into n_seen from public.profiles;
      if n_seen <> n_profiles_total then
        problems := problems || format(
          'an active user sees %s of %s rows in public.profiles -- profiles_select_active_users is denying rows the Slice 2 step 3 widening is meant to expose, so step 4 owner picker will be empty',
          n_seen, n_profiles_total)::text;
      end if;
```

- [ ] **Step 4: Update 10c's and 10d's messages, and keep their assertions**

Both assert a subject sees **zero** profile rows — 10c a subject with no profile row, 10d a
claim-less request. **Both remain correct after the widening**: `has_capability` is false for
them and `auth.uid() = id` matches nothing. Only the messages name one policy where two now
apply. In 10c:

```sql
        'a user with NO profile row sees %s row(s) in public.profiles -- neither profiles_select_own nor profiles_select_active_users is gating correctly, and any signed-in account reads the staff list',
```

Leave 10d's wording, which names no policy.

- [ ] **Step 5: Add 10g — the inactive subject**

§9's testing table asks for this and states its expectation wrongly (see "Three things
measured", item 3). The correct assertion is **exactly one row, their own**:

```sql
  -- 10g. An INACTIVE account. This is the subject the widening is scoped
  --      against: has_capability returns false for it, so
  --      profiles_select_active_users admits nothing, while
  --      profiles_select_own still admits its own row. So the answer is exactly
  --      ONE, not zero.
  --
  --      Slice 2 design §9 says "an inactive one reads zero". That is wrong,
  --      and asserting it would have failed a correct schema: zero would only
  --      hold if this step had REPLACED profiles_select_own, and §8 says "a
  --      second policy". Recorded here rather than diverging silently.
  --
  --      It also proves the widening is not simply "any signed-in user": an
  --      inactive account reading the staff list would be the actual defect
  --      this policy could have, and nothing else in this file would see it.
  select id into inactive_uid
  from public.profiles
  where not is_active
  order by created_at
  limit 1;

  if inactive_uid is null then
    preconditions := preconditions || 'public.profiles contains no INACTIVE row, so the check that an inactive account cannot read the staff list went UNEXERCISED -- new accounts are created inactive, so this becomes checkable the first time somebody signs up and is not activated'::text;
  else
    begin
      perform set_config(
        'request.jwt.claims',
        json_build_object('sub', inactive_uid, 'role', 'authenticated', 'aud', 'authenticated')::text,
        true);
      set local role authenticated;

      select count(*) into n_seen from public.profiles;
      if n_seen <> 1 then
        problems := problems || format(
          'an INACTIVE account sees %s row(s) in public.profiles, expected exactly 1 (its own, via profiles_select_own) -- if this is more than 1, profiles_select_active_users is admitting inactive accounts and an unapproved signup reads the staff list; if it is 0, profiles_update_own can no longer see the row it updates',
          n_seen)::text;
      end if;

      select count(*) into n_seen from public.clients;
      if n_seen <> 0 then
        problems := problems || format(
          'an INACTIVE account sees %s row(s) in public.clients -- has_capability is admitting an account with is_active false',
          n_seen)::text;
      end if;

      reset role;
    exception when others then
      problems := problems || format(
        'the inactive-account check could not run: %s %s -- whether an inactive account reads the staff list is UNVERIFIED',
        sqlstate, sqlerrm)::text;
    end;
  end if;
```

Declare `inactive_uid uuid;` beside `viewer_uid` and `am_uid`.

- [ ] **Step 6: Update §4's comment and §10e's list**

§4 line 211 currently reads:

```sql
        -- public.profiles: authenticated may read its own row (RLS-scoped) and
        -- rename itself via a column-level grant that needs no table-level entry.
```

It becomes, since "its own row" is no longer the whole truth:

```sql
        -- public.profiles: authenticated may read its own row and -- since the
        -- Slice 2 step 3 widening -- every other profile too, when active. Which
        -- rows are reachable is RLS's job (profiles_select_own OR
        -- profiles_select_active_users); this entry only says SELECT exists at
        -- all. The narrow WRITE surface is asserted in section 2 and has NOT
        -- moved: full_name only, by column grant.
```

§10e's `expected` list gains one row, leaving the other two alone:

```sql
        ('profiles', 'profiles_select_own'),
        ('profiles', 'profiles_select_active_users'),
        ('profiles', 'profiles_update_own'),
```

- [ ] **Step 7: Fix the comment in `cardSummary.ts` that becomes false**

`src/board/cardSummary.ts:41-44` currently reads:

```ts
    // "you" or the role, never a name: profiles_select_own makes another
    // person's profile unreadable, so a name here would have to be invented.
    // Recorded in spec §10 item 7.
    const who = checkin.submitted_by === viewerId ? 'you' : 'another account manager'
```

After task 1 the stated reason is no longer true, and a false comment outlives a false
line of code. Replace the comment only — **the behaviour does not change in this step**,
because Slice 2 §8 defers the footer to the first slice that touches the board again:

```ts
    // "you" or the role, never a name -- and as of Slice 2 step 3 that is a
    // CHOICE rather than a constraint. profiles_select_active_users made other
    // people's profiles readable, so the name is now available; wiring it up
    // needs the board to fetch profiles, which Slice 2 §8 defers to the first
    // slice that touches the board again. Until then this sentence is honest
    // about what it knows. Originally recorded as Slice 1 spec §10 item 7.
    const who = checkin.submitted_by === viewerId ? 'you' : 'another account manager'
```

Run `npx vitest run src/board/cardSummary.test.ts` afterwards: it must still pass
unchanged, which is the evidence that only a comment moved.

- [ ] **Step 8: Run what you can, and be explicit about what you cannot**

```bash
npm test
npm run build
npm run lint
```

`verify-privileges.sql` **cannot be run here.** Check its `begin`/`end` nesting offline
instead — a tokenizer that handles `$$` and doubled single quotes, per the note in the step
2 ledger; a naive regex miscounts because `end;` also terminates a `CASE` expression. Report
the final depth.

- [ ] **Step 9: Commit**

```bash
git add scripts/verify-privileges.sql src/board/cardSummary.ts
git commit -m "test(db): move the profiles watchers onto the widening"
```

---

## The owner's sequence

`ALLOW_PRODUCTION=1` **does not switch the linked project**, it only lowers the guard, and
this CLI build has no interactive picker — so a relink with `--project-ref` comes first.
One `db:push` was wasted learning that in step 2.

1. **Staging**: `npm run db:which` (expect staging) → `npm run db:push` →
   `npm run verify:privileges`.
2. **Production**: relink, `npm run db:which` (expect the shout),
   `ALLOW_PRODUCTION=1 npm run db:push`, `ALLOW_PRODUCTION=1 npm run verify:privileges`.
3. **Relink to staging.** Never leave production linked.
4. **Sign in on the deployed site.** The board and the check-in screen must behave exactly
   as before — this step changes no screen. If anything differs, that is the finding.
5. **Push.**

**Expect `COULD NOT VERIFY` on both databases, and expect it to say the widening went
unexercised.** Production held exactly one profile row as of 2026-08-24, and staging held
none. That precondition is not a defect: it is this file refusing to claim it checked
something it could not. The widening becomes verifiable the day a second person has an
account — which is also the day it starts to matter.

## Self-review

**Spec coverage.** §8's policy, verbatim → Task 1 step 3. §8's "what this actually exposes"
paragraph → the migration's comment, because the schema is where a future reader looks.
§8's "the write surface does not move" → asserted already by §2 of `verify-privileges.sql`,
and Task 2 step 6 states that it must not be touched. §8's "once this lands, the card footer
can name the person… neither is in this slice's scope" → Task 2 step 7 updates the comment
and deliberately leaves the behaviour. §9's "an active user reads more than one profile row"
→ Task 2 steps 2 and 3, with the precondition that makes it non-vacuous. §9's "an inactive
one reads zero" → **contradicted, deliberately, with the reasoning in the file** — Task 2
step 5 asserts exactly one.

**Not covered here, deliberately.** The clients admin screen is step 4; the owner picker is
its consumer and needs nothing further from the database after this. The card footer naming
a person is deferred by §8 itself. No application code changes: the only `profiles` read is
already filtered by `.eq('id', userId)`.

**Placeholder scan.** No TBDs. The migration filename is generated. Task 2 step 1 asks for
the real line numbers rather than trusting this plan's measurement.

**One risk this plan does not remove.** The widening's positive half — "an active user sees
more than one profile" — **cannot be verified on either database today**, because neither
holds two profile rows. Task 2 step 2 makes that visible instead of letting 10b pass
vacuously, which is the most this step can do. The first real verification of this migration
happens when a second account exists.
