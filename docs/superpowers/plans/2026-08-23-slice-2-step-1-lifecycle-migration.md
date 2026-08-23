# Slice 2 Step 1 — The Client Lifecycle Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `clients` the three lifecycle columns the parent spec requires, a constraint
that makes a churn date unskippable, and a unique index that stops the same client existing
twice — so that when a client leaves, *when* and *why* can be recorded at all.

**Architecture:** One migration. One Vitest text guard against drift, which needs no
database. One SQL check that reads the **live** constraint out of `pg_constraint` and
evaluates it against all 32 combinations of its inputs, which the owner runs.

**Tech Stack:** Postgres 17.6 on Supabase, `supabase` CLI via `npx`, Vitest 4.

**Spec:** `docs/superpowers/specs/2026-08-23-phase-1-slice-2-design.md` §3 (the export
precondition), §5 (the migration, verbatim), §9 (testing), §10 decisions 2, 3, 4 and 5.

## Global Constraints

- **No database commands.** Not `db:push`, not `verify:privileges`, not `gen types`, not
  the new script this plan adds. Write the SQL, read it, and hand the run to the owner.
  Every one of them touches a live project.
- **`npm test` does not typecheck.** Run `npm run build` separately.
- **Read the file before writing the step that edits it.** Nine defects in Slice 1 step 4
  were caught this way; five were in that plan's own first draft.
- **A number in prose needs the command that produced it run in the same breath as the
  sentence containing it.** The only two false claims that reached a commit in step 4 were
  counts typed from memory in the gap between running the gates and writing the summary.
- **Every new guard must be proved able to fail.** Delete or mutate its subject, watch it
  go red, restore. A test that still passes when its subject is gone is worth nothing.
- **Do not write a sentence you have not verified.** If a step here asks you to state
  something you cannot check, stop and report it rather than writing it.

## The precondition this plan does not satisfy

**The owner exports `clients` and `checkins` as CSV before the migration is applied.**
Spec §3. Writing the migration does not need it; applying it does, and applying it is the
owner's action either way. **Nothing in this plan applies anything.** If you find yourself
about to run a database command, that is the error.

---

## File structure

| File | Responsibility |
|---|---|
| `supabase/migrations/<generated>_add_client_lifecycle.sql` | **Create.** The three columns, two constraints, one unique index. |
| `tests/clientLifecycle.test.ts` | **Create.** Node, no database. Pins the migration's constraint text and index so a later edit has to change this file and think about it. |
| `scripts/verify-lifecycle.sql` | **Create.** Reads the live constraint from the catalogue and evaluates it over all 32 input combinations. Owner runs it. |
| `package.json` | **Modify.** Add `verify:lifecycle`. |
| `README.md` | **Modify.** Document the new columns, the reason codes, and `verify:lifecycle`. |

---

### Task 1: The migration, and a guard against it drifting

**Files:**
- Create: `supabase/migrations/<generated>_add_client_lifecycle.sql`
- Create: `tests/clientLifecycle.test.ts`

**Interfaces:** none consumed by later tasks in this step. Step 4's screen depends on these
columns existing and on `src/types/database.ts` being regenerated — which is the owner's
action, recorded in the handoff at the end of this plan.

- [x] **Step 1: Create the migration file with the CLI, so the timestamp is right**

```bash
npx --yes supabase@latest migration new add_client_lifecycle
```

This writes an empty timestamped file under `supabase/migrations/` and touches no
database — `migration new` is local file creation only. Report the filename it generated;
do not invent a timestamp by hand, because the ordering of migrations is the filename.

- [x] **Step 2: Write the migration**

Read `supabase/migrations/20260821021840_create_clients_and_checkins.sql` first — the
`clients` table, its existing `status` check constraint, and the comment style. This
migration must read as though it were written by the same hand.

```sql
-- The client lifecycle columns from parent spec §6.1, which the original clients
-- migration did not build. Until this lands, a client who leaves can be marked
-- `cancelled` and nothing else -- not when, not why -- and those two facts are
-- only available on the day it happens.

alter table public.clients
  add column ended_on date,
  add column end_reason_code text,
  add column end_reason_note text;

comment on column public.clients.ended_on is
  'The date the client relationship ended. Required whenever status is cancelled '
  'or former, and forbidden otherwise: see clients_lifecycle_coherent.';

comment on column public.clients.end_reason_code is
  'Why they left, from a fixed list, so reasons are countable across clients. '
  'The note beside it carries the nuance a code cannot.';

-- Bidirectional on purpose, and this is the half the parent spec does not state.
-- §6.1 requires ended_on whenever status is cancelled or former. This also
-- forbids all three columns when the status is active or paused: an active
-- client carrying an end date is not a state anybody meant to create, and
-- leaving it representable means reporting has to invent a meaning for it later.
--
-- The cost, paid by the clients admin screen: reactivating a client has to clear
-- all three columns in the SAME statement, or this constraint refuses the
-- update. Slice 2 design §7 rule 2.
--
-- end_reason_code is required on churn and end_reason_note is not. A coded
-- reason alone loses the story and free text alone cannot be counted, but only
-- the countable half can be made mandatory without inviting a full stop typed
-- to get past a form.
alter table public.clients add constraint clients_lifecycle_coherent check (
  case
    when status in ('cancelled', 'former')
      then ended_on is not null and end_reason_code is not null
    else ended_on is null and end_reason_code is null and end_reason_note is null
  end
);

-- Text plus a check constraint, exactly as `status` is stored on this same
-- table, so the table stays internally consistent and no new object gains its
-- own grants and RLS policy.
alter table public.clients add constraint clients_end_reason_code_known check (
  end_reason_code is null or end_reason_code in (
    'price', 'scope_fit', 'in_housed', 'went_quiet',
    'project_completed', 'agency_initiated', 'other'
  )
);

-- On lower(name), not name. "Colorfil" and "colorfil" are the same client, and a
-- case-sensitive index would let both exist -- which is the duplicate this index
-- is for. `C.R. Plastics` and `CRP` are still two rows to Postgres; no index can
-- fix that and this one does not pretend to.
--
-- THIS CAN FAIL TO CREATE. If the target already holds two names differing only
-- in case, the migration aborts, which is the correct outcome. That is why this
-- goes to staging first and why the owner checks the row count before applying
-- it to production.
create unique index clients_name_unique on public.clients (lower(name));
```

- [x] **Step 3: Write the drift guard, and run it**

Create `tests/clientLifecycle.test.ts`. This is the cheap half: it pins the migration's
text so an edit has to change this file too. **It does not prove Postgres enforces
anything** — nothing without a database can, and `npm run verify:lifecycle` is what does.
Say that in the file, in those terms, and do not overstate it.

Model it on `tests/generatedColumn.test.ts`, which does the same job for the generated
column. Read that file first.

```ts
import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// What this test does and does not do. It pins the text of the lifecycle
// constraint, the reason-code list and the unique index, so an edit to the
// migration has to change this file too and think about it. It does NOT prove
// Postgres enforces any of it -- nothing without a database can. That is
// `npm run verify:lifecycle`, which reads the live constraint out of
// pg_constraint and evaluates it over all 32 combinations of its inputs.
const MIGRATIONS = 'supabase/migrations'

function migration(suffix: string): string {
  const names = readdirSync(MIGRATIONS).filter((name) => name.endsWith(suffix))
  // Exactly one, or the assertions below could be reading a file nobody meant.
  expect(names, `migrations ending in ${suffix}`).toHaveLength(1)
  return readFileSync(`${MIGRATIONS}/${names[0]}`, 'utf8')
}

const LIFECYCLE = `alter table public.clients add constraint clients_lifecycle_coherent check (
  case
    when status in ('cancelled', 'former')
      then ended_on is not null and end_reason_code is not null
    else ended_on is null and end_reason_code is null and end_reason_note is null
  end
);`

const REASON_CODES = [
  'price',
  'scope_fit',
  'in_housed',
  'went_quiet',
  'project_completed',
  'agency_initiated',
  'other',
]

describe('the client lifecycle migration', () => {
  const sql = migration('_add_client_lifecycle.sql')

  it('adds the three columns the parent spec requires', () => {
    for (const column of ['ended_on date', 'end_reason_code text', 'end_reason_note text']) {
      expect(sql).toContain(`add column ${column}`)
    }
  })

  it('still has the constraint verify:lifecycle was written against', () => {
    expect(sql).toContain(LIFECYCLE)
  })

  it('offers exactly the seven reason codes, and no others', () => {
    for (const code of REASON_CODES) {
      expect(sql, code).toContain(`'${code}'`)
    }
    // The count as well as the membership: an eighth code added without thought
    // would pass a membership-only check.
    const listed = sql.match(/end_reason_code in \(([^)]*)\)/s)
    expect(listed, 'the reason-code list').not.toBeNull()
    expect(listed![1].match(/'[a-z_]+'/g)).toHaveLength(REASON_CODES.length)
  })

  it('indexes lower(name), so case cannot make a duplicate', () => {
    expect(sql).toContain('create unique index clients_name_unique on public.clients (lower(name))')
  })

  it('does not delete or drop anything', () => {
    // A migration on the table holding the real roster, against a database with
    // no backups. Comments stripped first: this asserts about statements, not
    // about prose that mentions dropping.
    const statements = sql.replaceAll(/--[^\n]*/g, '')
    expect(statements).not.toMatch(/\bdrop\b/i)
    expect(statements).not.toMatch(/\bdelete\b/i)
    expect(statements).not.toMatch(/\btruncate\b/i)
  })
})
```

Run: `npx vitest run tests/clientLifecycle.test.ts` — expected PASS, 5 tests.

- [x] **Step 4: Prove each assertion can fail**

One at a time, restore after each, and report the red count for each:

1. Change `ended_on date` to `ended_on timestamptz` in the migration.
2. Flip one `is not null` to `is null` in the constraint.
3. Add an eighth reason code to the list.
4. Change `lower(name)` to `name` in the index.
5. Append `drop table public.clients;` to the migration. **This must go red** — it is the
   assertion standing between this plan and the worst possible outcome.

Then confirm `git diff supabase/` is empty before continuing.

- [x] **Step 5: Commit**

```bash
npm run build && npm test && npm run lint
git status --short
git add supabase/migrations tests/clientLifecycle.test.ts
git commit -m "feat(db): add the client lifecycle columns, unapplied"
```

The commit message must say **unapplied**. A migration in the repo and a migration in the
database are different facts, and the second one is the owner's.

---

### Task 2: Prove the constraint permits exactly what it should

**Files:**
- Create: `scripts/verify-lifecycle.sql`
- Modify: `package.json`
- Modify: `README.md`

**Interfaces:** none. This is a check the owner runs.

**Why this exists rather than a handful of named cases.** The standing lesson from Slice 1
is that a hand-picked state list is not verification of a state machine — twelve
hand-picked states passed while two Critical bugs shipped. This constraint's entire input
space is 4 statuses × ended_on present or not × code present or not × note present or not
= **32 combinations**, which is small enough to check all of. The technique is the one
`scripts/score-parity.mjs` already uses: read the **live** predicate out of the catalogue
and evaluate it, so the thing under test is what is deployed rather than a copy of what was
intended.

- [ ] **Step 1: Write the script**

Read `scripts/verify-privileges.sql`'s header and `scripts/score-parity.mjs`'s generated
output first, for the house style: a `do $$` block, `raise exception` on failure listing
every violation, `raise notice` on success.

```sql
-- Proves the deployed clients_lifecycle_coherent constraint permits exactly the
-- combinations it is meant to, over its whole input space.
--
-- Run with `npm run verify:lifecycle`. Nothing is inserted and no sequence
-- advances: the constraint's expression is read out of pg_constraint and
-- evaluated over a VALUES list, the same way scripts/score-parity.mjs checks the
-- total_score generated column.
--
-- The two parties to the comparison are the constraint as DEPLOYED and the rule
-- as restated in `expected` below. They are written from the same intent but not
-- from each other, so a typo in either one shows up here.

do $$
declare
  expression text;
  violations text[] := '{}';
  row_count  bigint;
begin
  select regexp_replace(pg_get_constraintdef(c.oid), '^CHECK\s*', '')
    into strict expression
    from pg_constraint c
   where c.conrelid = 'public.clients'::regclass
     and c.conname = 'clients_lifecycle_coherent';

  execute format($fmt$
    select count(*)
      from (values
        %s
      ) as v(status, ended_on, end_reason_code, end_reason_note, expected)
     where (%s) is distinct from v.expected
  $fmt$,
    -- All 32 combinations, with the rule restated: a churned status requires a
    -- date and a code; any other status forbids all three.
    (select string_agg(
       format('(%L, %L, %L, %L, %L)',
              s.status, e.ended_on, c2.code, n.note,
              case
                when s.status in ('cancelled', 'former')
                  then e.ended_on is not null and c2.code is not null
                else e.ended_on is null and c2.code is null and n.note is null
              end),
       ', ')
     from (values ('active'), ('paused'), ('cancelled'), ('former')) as s(status)
     cross join (values (null::date), ('2026-08-01'::date)) as e(ended_on)
     cross join (values (null::text), ('price'::text)) as c2(code)
     cross join (values (null::text), ('a note'::text)) as n(note)),
    expression)
  into row_count;

  if row_count <> 0 then
    violations := violations || format(
      'clients_lifecycle_coherent disagrees with its intent on %s of 32 combinations',
      row_count)::text;
  end if;

  if array_length(violations, 1) is not null then
    raise exception E'verify:lifecycle FAILED:\n  - %', array_to_string(violations, E'\n  - ');
  end if;

  -- Says only what was actually checked. The reason-code list is not verified
  -- here; the select below prints both constraint definitions so a reader can
  -- see it, and tests/clientLifecycle.test.ts pins it in CI.
  raise notice 'verify:lifecycle OK -- all 32 combinations of the lifecycle constraint agree with its intent';
end $$;

-- The evidence, because a NOTICE is easy to miss in the SQL editor and
-- "Success. No rows returned" looks identical to having done nothing.
select conname, pg_get_constraintdef(oid) as definition
  from pg_constraint
 where conrelid = 'public.clients'::regclass
   and conname in ('clients_lifecycle_coherent', 'clients_end_reason_code_known')
 order by conname;
```

**Read the generated SQL before believing it.** If `pg_get_constraintdef` returns a form
this cannot evaluate, that is a fix round, not a failure of the task — report what it
actually returned.

- [ ] **Step 2: Wire it up**

`package.json`, beside the other two verifiers:

```json
"verify:lifecycle": "npm run db:which && npx --yes supabase@latest db query --linked -f scripts/verify-lifecycle.sql"
```

`db:which` first, and it now exits non-zero on production, so this cannot reach production
without `ALLOW_PRODUCTION=1`.

- [ ] **Step 3: Do NOT run it. Confirm the target instead**

```bash
npm run db:which
```

Expected: `tgc-client-health-staging`. That is the whole of what you run. `verify:lifecycle`
itself is a database command and belongs to the owner.

- [ ] **Step 4: Document all three in the README**

Read the existing `### npm run verify:score` section and match it. Add:

- a `### npm run verify:lifecycle` section saying what it proves, that it inserts nothing,
  and that `tests/clientLifecycle.test.ts` is the cheap half which catches drift and does
  **not** prove Postgres enforces anything;
- the three new columns and the seven reason codes, under the Database section;
- one sentence in the two-projects section: the unique index can abort the migration if the
  target holds two names differing only in case.

- [ ] **Step 5: Commit**

```bash
npm run build && npm test && npm run lint
git add scripts/verify-lifecycle.sql package.json README.md
git commit -m "test(db): prove the lifecycle constraint over its whole input space"
```

---

## The owner's sequence, in order

Nothing above touches a database. This is what does, and it is all his:

1. **Export.** Dashboard → SQL Editor → `select * from public.clients;` and
   `select * from public.checkins;` → Download CSV on each. Spec §3.
2. **Check for a case-collision on production** before applying anything:
   `select lower(name), count(*) from public.clients group by 1 having count(*) > 1;`
   Expect zero rows. If not, the unique index will abort the migration and the duplicates
   have to be resolved first.
3. **Staging.** `npm run db:which` (expect staging) → `npm run db:push` →
   `npm run verify:lifecycle` → `npm run verify:privileges`.
4. **Production.** `ALLOW_PRODUCTION=1 npm run db:push`, deliberately, having read step 2's
   result. Then `ALLOW_PRODUCTION=1 npm run verify:lifecycle`.
5. **Regenerate the types**, which step 4's screen needs and which cannot be hand-edited:
   `npx supabase@latest gen types typescript --linked > src/types/database.ts`, then commit
   the result. Aim it at whichever project is linked; the schema is the same on both.
6. **Push.**

## Self-review

**Spec coverage.** §5's three columns → Task 1. §5's bidirectional constraint → Task 1,
proved over its whole input space in Task 2. §5's reason-code list → Task 1, count and
membership both. §5's `lower(name)` index → Task 1, with the abort case documented in the
owner's sequence. §3's export precondition → the handoff, and stated as unsatisfied by this
plan. §9's "a Vitest text guard pinning the constraint" → Task 1 step 3, with its limits
stated in the file rather than implied away.

**Not covered here, deliberately.** `has_capability` and the policy conversion are step 2 —
this step changes no policy and no grant, which is why `verify:privileges` needs no edit
(its column-level assertions are all on `profiles`, and the `clients` grant is table-level,
so new columns are already inside it — read from the script 2026-08-23).

**Placeholder scan.** No TBDs. The migration filename is generated by the CLI rather than
invented, and the step says to report what it generated.

**One risk this plan does not remove.** `verify:lifecycle` compares the deployed constraint
against a restatement of the same intent, written by the same author on the same day. It
catches a typo in either and would not catch a shared misunderstanding of what the rule
should be. The rule is six lines and is stated in three places — the spec, the migration's
comment, and the script — precisely so that a shared misunderstanding has three chances to
look wrong to a reader.
