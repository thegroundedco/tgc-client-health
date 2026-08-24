# TGC Client Health

Monthly client-health check-ins for The Grounded Company's account management team.

## Status

**Slice 0 — half proven.** Precisely:

- **Proven, locally, end to end.** Signed in with a real magic link to the real
  Supabase project, saw a client, saved a score from a browser, reloaded, and the
  score was still there and attributed to the real auth user id. Postgres
  row-level security is the only thing standing between a signed-in account and
  the data, and it is asserted by `npm run verify:privileges` (see below).
- **Not proven: the deploy.** At the time of writing nothing has been pushed, the
  GitHub repository is empty, and the published page has never been loaded. The
  workflows in `.github/workflows/` have never run. The URL below is the
  *intended* address, not a working one.

This section is deliberately literal. A README that says "proven end to end" when
half of it is untested is the single most expensive kind of wrong here, because
it is the artifact that gets trusted at face value later.

**Live:** https://thegroundedco.github.io/tgc-client-health/

See `docs/superpowers/specs/2026-08-20-tgc-client-health-design.md` for the design
and the phase roadmap. If you are standing this project up from nothing, read
**"Rebuilding this project from scratch"** below — it is the ordered version of
everything else in this file.

## Development

Requires Node.js LTS.

```bash
npm install
cp .env.example .env.local   # fill in from Supabase → Project Settings → API
npm run dev
```

`.env.local` points at **staging**, never production — see "Two Supabase
projects" below. The deployed site reaches production through GitHub Actions
secrets, which is the only path to it.

## Tests

```bash
npm test                                    # the whole local suite
npx vitest run src/lib/rls.test.ts --mode development   # security tests only
```

`npm test` runs the full local suite, including `src/lib/rls.test.ts`. That file
talks to the real Supabase project with the anonymous key to prove an
unauthenticated caller is refused, so it needs `.env.local` (copy
`.env.example` and fill it in from Supabase → Project Settings → API). If
`.env.local` is missing, `npm test` fails loudly and on purpose — it will not
skip quietly and report green having verified nothing about the security
boundary. This is why CI runs a narrower command:

```bash
npx vitest run --exclude '**/rls.test.ts'
```

CI has no credentials and is not meant to have any — this repository is
public, so a live database credential does not belong in it — so CI excludes
`rls.test.ts` entirely and runs only the logic-only files (`env.test.ts`,
`errorText.test.ts`, `startupError.test.ts`, `appState.test.ts`, `score.test.ts`,
`month.test.ts`). Locally, with `.env.local` present, `npm test` runs 60 tests
across 7 files; CI runs 45 of those across 6 files. The 15-test, one-file gap is
`rls.test.ts`, run only by a human with real credentials, never by CI.

`npm test` does **not** type-check. `npm run build` is `tsc -b && vite build`, so
that is the type check; for a clean one without build caching, run
`npx tsc -p tsconfig.app.json --noEmit`.

## Deploying

Push to `main`. `.github/workflows/deploy.yml` runs the test suite, then builds,
then publishes to GitHub Pages. The build job **depends on** the test job, so a
failing suite stops the deploy rather than racing it.

Three things must be configured on GitHub before the first deploy works. None of
them live in this repository, and none of them can be checked by any test here.

1. **Pages source must be set to "GitHub Actions".** Repository → Settings →
   Pages → Build and deployment → Source → *GitHub Actions*. With the default
   ("Deploy from a branch") the workflow succeeds and publishes nothing.
2. **Two repository secrets, by exact name.** Repository → Settings → Secrets and
   variables → Actions → New repository secret:

   | Secret | Value |
   |---|---|
   | `VITE_SUPABASE_URL` | Supabase → Project Settings → API → Project URL |
   | `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase → Project Settings → API → **publishable** key |

   The names must match character for character; Vite only inlines variables it
   is asked for by name, and a typo reads as "not set".
3. **The two Auth redirect URLs** below, or sign-in fails silently.

### What a missing secret looks like

`vite build` only *inlines* `import.meta.env.*` — it never reads the values — so
a missing or misspelled secret **cannot fail the build**. CI goes green, the
deploy succeeds, and the shipped page throws when it loads.

That failure used to produce a blank white page whose only diagnosis was the
browser console. It no longer does: `src/main.tsx` loads the app through a
dynamic `import()` so it can catch the throw, and `src/lib/startupError.ts`
writes onto the page which setting is missing and where to set it. If the
published page says a required setting is missing, fix the secret above and
re-run the **deploy** workflow from the Actions tab — there is nothing to change
in the code.

### What a silent grep looks like

Checking whether a deploy had picked up its secrets once meant fetching the shipped
JavaScript bundle into a shell variable and grepping it for an expected value. The
grep produced no output, and no output was read as "the secrets did not deploy" —
which was false; they had deployed correctly.

**The mechanism was never pinned down, and it is not guessed at here.** The bundle
involved no longer exists to inspect, and re-checking the same shape of check against
the current build's bundle does not reproduce a silent grep. So the interesting
failure here is not grep's behaviour — it is the reasoning: silence was read as a
negative result with no way to tell "found nothing because nothing is wrong" apart
from "found nothing because the check itself stopped working."

The rule, and it does not depend on ever knowing the mechanism: write the response
to a file, grep the file, **and assert a positive expected count.** A check that can
only ever produce silence-or-a-match can never tell those two cases apart, so make
it require finding something specific and fail loudly when it does not. More
generally, and this is the project's governing lesson: **a check that fails silently
is the same bug as a save that succeeds silently.** Both report success by producing
nothing, and both are invisible to the person relying on them.

## Configuration that is not in this repository

Everything in this section is Supabase or GitHub project configuration. There is
no `supabase/config.toml` here, so **none of it is in version control**, no
migration recreates it, and no test can catch it drifting. It is written down
here because this is the only durable place for it. If this project is ever
rebuilt, restored, or pointed at a different Supabase project, this is the
checklist.

### Auth redirect URLs (required, or sign-in fails silently)

Supabase dashboard → Authentication → URL Configuration → **Redirect URLs**. Both
must be registered:

```
http://localhost:5173/tgc-client-health/
https://thegroundedco.github.io/tgc-client-health/
```

The trailing slash and the `/tgc-client-health/` path both matter — that path is
`base` in `vite.config.ts`, because GitHub Pages serves project sites from a
subdirectory.

The failure mode is nasty and worth recognising: requesting a magic link
**succeeds**, the email **arrives**, and clicking the link lands on Supabase's
own error page or bounces to the site root without a session. Nothing in the app
logs anything, because the app is never reached. If sign-in "does nothing", check
this list first.

Also set **Site URL** to `https://thegroundedco.github.io/tgc-client-health/`.

### PostgREST's exposed schemas (part of the security posture)

Supabase dashboard → Project Settings → API → **Exposed schemas**. It must list
`public` and `graphql_public`, and it must **not** list `private`.

This is load-bearing, not cosmetic. Migration
`20260821021840_create_clients_and_checkins.sql` cites it as one of *two
independent* reasons the `private` schema is unreachable from a browser — the
other being that no browser role holds `USAGE` on it. Adding `private` to that
list would expose every `security definer` helper in it as a callable RPC, and it
would not appear in any git diff. `src/lib/rls.test.ts` has two tests that probe
the live API for exactly this (a 406 `PGRST106` for `Accept-Profile: private`,
and a 404 `PGRST202` for `rpc/is_active_user`); they are the only tripwire on a
setting no migration can pin.

### Activating the first admin

`public.profiles.is_active` defaults to **false** — signing up must not grant
access — and **nothing in the app can change it**. There is no UI, by design:
`authenticated` holds a column-level `UPDATE` on `full_name` and on nothing else,
so a signed-in user cannot promote or activate themselves even by bypassing the
app. Phase 1 adds a users admin panel; until then activation is raw SQL.

Run this in the Supabase dashboard → SQL Editor (which runs with administrative
rights), replacing the address:

```sql
update public.profiles
set is_active = true,
    role = 'admin'
where email = 'you@thegroundedcompany.com';
```

The account must have signed in at least once first — the profile row is created
by a trigger on `auth.users`, so there is nothing to update until then. Before
activation, signing in works and shows the "access pending" screen with no data,
which is the intended behaviour, not a fault.

This path depends on `service_role` (and the table owner) keeping full access to
the three tables — see Security notes.

### Activating a profile on staging

Staging needs the same treatment, and it has its own wrinkle: its profile row
does not exist until somebody signs in against staging itself, at
`http://localhost:5173` with `.env.local` pointing at it. Once that is done:

```bash
npm run db:which        # must print tgc-client-health-staging
npx --yes supabase@latest db query --linked -f scripts/activate-staging-profile.sql
```

The script raises if it matched no row, and lists the addresses it did find —
because an `update` with a `where` clause that matches nothing succeeds
silently, and "nobody has signed in yet" would otherwise be indistinguishable
from "done". The address it looks for is a literal at the top of the file; the
Supabase account is registered on an alias, so if the exception names a
different address, that is the one to use.

Until this is run, staging has no active profile and none of its policies are
exercised by anything.

### Seeding the first client

There is **no client-creation UI in Slice 0.** The only write the application
code performs is the check-in upsert in `src/board/Board.tsx`; the other
`.insert(` calls under `src/` are all denial probes in `src/lib/rls.test.ts`,
which assert that a write is *refused*. The clients admin screen arrives in
Phase 1. Until then a first client is created with SQL, in the Supabase
dashboard → SQL Editor:

```sql
insert into public.clients (name, owner_id)
values (
  'First Client Ltd',
  (select id from public.profiles where email = 'you@thegroundedcompany.com')
);
```

`owner_id` is optional — it is nullable, and set to null rather than cascading if
the profile is ever deleted, because losing a person must never delete the client
history. Drop it from the statement if you do not want an owner yet.

The board reads clients with `status = 'active'`, which is the default, so the row
appears on reload. Then click **Score all 3s** on it: that writes the first
check-in, which is what makes section 10's check-in assertions meaningful rather
than trivially true against an empty table.

### Seeding the real roster, and why it is not a committed file

**This repository is public.** A seed migration, a `seed.sql`, or a test fixture
holding the agency's client list would put those names somewhere searchable, and
would leave them in git history permanently even if a later commit removed them.
So the roster is split in two:

- `clients.local.txt` — gitignored, one client per line, typed once. Never
  committed, and `git check-ignore clients.local.txt` should always name a rule.
- `scripts/seed-clients.mjs` — committed and reviewable, and contains no names.

```bash
node scripts/seed-clients.mjs      # -> scripts/.clients.generated.sql (gitignored)
```

Then paste the generated file into the Supabase dashboard → SQL Editor. It is
**not** a CLI command on purpose: the roster belongs in production, and
`npm run db:which` now exits non-zero on production, so every `&&` chain refuses
it. The dashboard editor runs with administrative rights, which is what a seed
needs and is also why RLS is not consulted.

Format is `Name` or `Name | status`, with status defaulting to `active` and
limited to the four the check constraint allows — `active`, `paused`,
`cancelled`, `former`. There is **no `inactive`**: a client who leaves is
`former`, and they keep their row so their check-in history survives them.

**The generated SQL is safe to run twice**, which matters more than it sounds:
`public.clients` has **no unique constraint on `name`**, so a plain `INSERT` run
twice produces a duplicate of every client with no error at all. Each row is
guarded by a `not exists` on the name instead, existing rows are left untouched
(a client somebody paused does not get set back to active by a re-run), and the
block raises — rolling the insert back — if the expected number of roster rows is
not present afterwards. It ends with a `select`, because `NOTICE` output is easy
to miss and "Success. No rows returned" looks identical to having done nothing.

The generator refuses, rather than warns, on: an empty input, a duplicated name,
a status outside the four, an empty name, and a control character (which is a
data-quality guard, not an injection guard — a name pasted out of a spreadsheet
can carry a tab that then sits invisibly inside it forever). `npm test` covers
all of it with deliberately fake fixtures.

**Two things this does not do.** It does not add the missing unique index on
`clients.name` — that is a migration, and the clients admin screen in Slice 2 is
where duplicate prevention belongs. And it does not remove the placeholder
`Test Client`: `checkins.client_id` is `on delete cascade`, so deleting a client
silently deletes its check-ins, and this project has no backups.

## Rebuilding this project from scratch

Every piece below is documented in its own section. What is easy to get wrong is
the **order** — several steps only work once an earlier one has happened, and two
of them fail silently if skipped. This is the order.

1. **Create a Supabase project.** Note the **Reference ID** (Project Settings →
   General) and the **Project URL** and **publishable key** (Project Settings →
   API).
2. **`npm install`**, then `cp .env.example .env.local` and fill in the URL and
   the publishable key. Never the secret key — see Security notes.
3. **`npx supabase@latest login`** (interactive: it opens a browser and waits, so
   it needs a real terminal), then
   `npx supabase@latest link --project-ref <ref>`.
4. **`npx supabase@latest db push --linked`** — creates the schema, grants,
   policies and helpers. Never `db reset`, never `--force`.
5. **Register the two Auth redirect URLs and the Site URL** ("Auth redirect URLs"
   above). Skip this and sign-in fails *silently*: the email arrives and the link
   goes nowhere.
6. **Check the exposed schemas** are `public, graphql_public` and do not include
   `private` ("PostgREST's exposed schemas" above).
7. **`npm run dev`**, open <http://localhost:5173/tgc-client-health/>, and sign in
   once with your own email. This creates your `profiles` row via the signup
   trigger. You will land on "access pending" — that is correct, not a fault.
8. **Activate yourself** with the SQL in "Activating the first admin". Reload; you
   are in.
9. **Seed one client** with the SQL in "Seeding the first client". Reload; the
   board shows it.
10. **Click "Score all 3s"** on that client. That is the first check-in.
11. **`npm run verify:privileges`.** It should pass now. Run before steps 8–10 it
    reports *unmet preconditions* instead — which is correct, and is not a
    security finding.
12. **Configure GitHub:** Pages source = "GitHub Actions", plus the two Actions
    secrets, both under Settings ("Deploying" above).
13. **Push to `main`.** The deploy workflow runs the tests, then builds, then
    publishes.
14. **Load the published page and sign in there too.** The second redirect URL
    from step 5 is what makes that work; this is the step that proves the deployed
    half, which as of this writing is still unproven.

Steps 1, 5, 6, 8, 9 and 12 are the ones no code in this repository can do for you,
and the ones no test can check. They are why the "Configuration that is not in
this repository" section exists.

If the Supabase project is a *different* one from the one the committed types were
generated against, also re-run
`npx supabase@latest gen types typescript --linked > src/types/database.ts`.

## Two Supabase projects

There are two, both under the same account, both `us-west-2`:

| Environment | Reached by | Holds |
|---|---|---|
| `tgc-client-health` | the deployed site only, via GitHub Actions secrets | real client data |
| `tgc-client-health-staging` | `.env.local`, local `npm run dev`, the live-credential tests, every experiment | throwaway rows |

**Which one a CLI command hits is invisible.** It is one gitignored file,
`supabase/.temp/project-ref`, and no CLI command prints it before acting. A silent
mislink means running migrations — or `verify:privileges`, which probes the write
path for real and advances `clients_id_seq` — against production while believing
it is staging.

So every database command goes through a wrapper that prints the target first:

```bash
npm run db:which        # prints the linked project's name, ref and region,
                        #   and shouts if it is not named 'staging'
npm run db:push         # db:which, then db push --linked
npm run verify:privileges   # db:which, then the assertions
npm run verify:capability   # db:which, then the preset table, no rows needed
```

Switch target deliberately, one command at a time, and never leave production
linked:

```bash
npx supabase@latest link --project-ref <ref>   # Supabase → Project Settings
                                               #   → General → Reference ID
npm run db:which                               # confirm before doing anything
```

**One migration can abort rather than apply.** The unique index on
`lower(clients.name)` fails to create if the target already holds two names
differing only in case. Check before applying it anywhere that matters:

```sql
select lower(name), count(*) from public.clients group by 1 having count(*) > 1;
```

Zero rows means it will apply. Rows mean the duplicates have to be resolved first
— and an aborted migration is the correct outcome, not a fault.

**There are no backups.** The free plan includes no automated backups and no
point-in-time recovery. `supabase db dump` is not available here either — it
requires Docker, which is absent, and it writes a **zero-byte file** on failure
rather than erroring usefully. Until a working export exists, the fallback is the
dashboard SQL editor's CSV download. Do not automate a dump into GitHub Actions:
this repository is public and workflow artifacts on public repositories are
downloadable by anyone.

## Database

Migrations live in `supabase/migrations/`:

```bash
npx supabase@latest login    # interactive; needs a real terminal, not an agent
npm run db:push
npx supabase@latest gen types typescript --linked > src/types/database.ts
```

Never run `db reset`, and never pass `--force`. One of these two projects holds
real data and the guard against hitting it is a printed name, not a safety net.

### `src/types/database.ts` is generated — do not hand-edit it

`gen types` overwrites the file, so any correction made by hand disappears at the
next run. One known inaccuracy to be aware of rather than patch:

- **`checkins.total_score` is typed as writable** (it appears in `Insert` and
  `Update`). It is not. It is a generated column, and Postgres rejects any
  attempt to write it with `428C9 cannot insert a non-DEFAULT value into column
  "total_score"`. Never include it in an `insert` or `upsert` payload; write the
  five pillar columns and read the total back.

### The client lifecycle columns, and the constraint that governs them

`clients` carries `ended_on`, `end_reason_code` and `end_reason_note` alongside
`status`. `clients_lifecycle_coherent` makes them coherent in **both**
directions:

- `status` in (`cancelled`, `former`) — `ended_on` and `end_reason_code` are
  **required**. The churn date cannot be skipped.
- `status` in (`active`, `paused`) — all three are **required to be null**. An
  active client carrying an end date is not a state anybody meant to create.

The second half has a consequence worth knowing before you write SQL by hand:
**reactivating a churned client must clear all three columns in the same
statement**, or the constraint refuses the update.

`end_reason_code` is one of `price`, `scope_fit`, `in_housed`, `went_quiet`,
`project_completed`, `agency_initiated`, `other` — a fixed list so reasons are
countable across clients, with the note carrying the nuance a code cannot.

There is also a unique index on `lower(name)`, because "Colorfil" and "colorfil"
are the same client. It does not and cannot catch `C.R. Plastics` against `CRP`.

### Standing convention: every new table starts closed

This project predates Supabase's "new tables are not exposed by default"
change, so schema `public` still carries default privileges that grant
everything to `anon` and `authenticated` on any new object — and one of the two
roles that grants that (`public/supabase_admin`) cannot be revoked from this
project; attempting it fails with `42501: permission denied to change default
privileges`. Because of that, every migration that creates a table in `public`
must open with:

```sql
revoke all on <table> from anon, authenticated;
```

before any `grant`, and before `enable row level security`. The revoke must
come first — revoking a table-level privilege also revokes it at the column
level, so a revoke written after a column grant would silently undo that
grant. This is the same rule enforced by `npm run verify:privileges` below;
the full reasoning lives in
`supabase/migrations/20260820232223_revoke_public_function_defaults.sql`.

The equivalent rule for **functions**, which is narrower than it looks:

```sql
revoke execute on function <fn> from public, anon;   -- then grant back deliberately
```

A new function in **any** schema — including `private` — is born
`PUBLIC`-executable. Measured on this project: `create function private.x()`
yields `proacl = NULL`, and Postgres then applies its own hardcoded
`acldefault('f', owner)`, which contains a grant of `EXECUTE` to `PUBLIC`;
`has_function_privilege('anon', 'private.x()', 'EXECUTE')` is **true**. No
`ALTER DEFAULT PRIVILEGES` on this project suppresses it. Putting a function in
`private` does not close it — it only stops it being reachable *by name*, because
calling `private.x()` also needs `USAGE` on the schema, which no browser role
has. So the explicit revoke is required wherever the function lives.

Who to grant `EXECUTE` back to depends on how the function is reached, and the
two cases point in **opposite** directions:

| Reached via | `EXECUTE` checked when | Against whom | Grant `authenticated` needs |
|---|---|---|---|
| a row-security **policy** | every query | the querying role | `EXECUTE` **must** be granted, or every signed-in query fails `42501` |
| a **trigger** | at `CREATE TRIGGER` | the trigger's creator (`postgres`) | **none** — do not grant it |

Both halves are measured on this project and both matter. Granting a trigger
function to `authenticated` is not a broken deploy — it is a callable
`security definer` function, which is the escalation surface `private` exists to
prevent. Spec §7.2 has the transcripts.

### `npm run verify:privileges` — a manual pre-deploy gate, not a CI check

```bash
npm run verify:privileges
```

Runs `db:which` first, then `scripts/verify-privileges.sql` against the linked
project. Point it at **staging**: it probes the write path for real, so each run
advances `clients_id_seq` on whatever it is aimed at. It asserts, in Postgres,
both halves of the boundary:

- **Grants** (sections 1–9): that `anon` and `authenticated` hold nothing beyond
  an explicit allowlist on every table and sequence in `public`, that the
  `authenticated` write surface on `profiles` is exactly `full_name`, that RLS is
  enabled but not forced on every table, and that no function in `public` or
  `private` is executable by a browser role outside what its policies require —
  in both directions, so a *missing* grant that would take the app down fails too.
- **Policy behaviour** (section 10): it becomes the `authenticated` role and runs
  real queries. An active account sees every row it should; a subject with no
  `profiles` row sees zero rows on `clients`, `checkins` and `profiles` and is
  refused an `insert`; `authenticated` with no JWT claims sees zero rows; and the
  policies themselves still exist and are still scoped `to authenticated`. This
  is the only automated evidence anywhere that the RLS predicates work — the
  Vitest suite can only use the anonymous key, which is refused before any policy
  is consulted.
- **The admin path** (section 11): that `service_role` can still reach all three
  tables, because if it cannot, no account can ever be activated again.

**It commits nothing, but it is not quite true that it writes nothing.** The one
write it attempts is an `insert` the policy is meant to refuse, inside a block
that rolls the statement back even if the refusal ever stops happening — so no
row can survive either outcome. What does survive is the identity sequence:
Postgres allocates the next `id` before the policy rejects the row, and a
sequence does not roll back (that is what makes it safe under concurrency). So
`clients_id_seq` advances by one on every run, and its `last_value` runs ahead of
`max(id)` — measured 15 against 4 at the time of writing. That is cosmetic; ids
are opaque and nothing depends on them being contiguous. It is written down here
so that nobody later reads a gap in the ids as evidence that rows were deleted.

**Two different failures, and it matters which one you got.** The script
distinguishes them, and so should you:

- **`verify:privileges FAILED with N violation(s)`** — a security finding. Treat
  it as an incident: something is reachable that should not be, or a grant the
  app depends on has gone missing.
- **`verify:privileges COULD NOT VERIFY the read path — N precondition(s)
  unmet`** — *not* a security finding, and the message says so explicitly. It
  means the database does not yet hold enough data to exercise a check: no
  activated account, no clients, or no check-ins. This is the **expected** result
  on a freshly created or freshly rebuilt project. Work through the list (each
  item names what to do) and re-run.

Both exit non-zero, deliberately: a check that could not run must never read as a
check that passed.

**What it needs in order to run:**

- a **linked** project — `npx supabase@latest link --project-ref <ref>` once,
  where `<ref>` is the Reference ID under Supabase → Project Settings → General;
  the link is stored in `supabase/.temp/`, which is gitignored, so a fresh clone
  must link again;
- an **authenticated Supabase CLI session**. The script goes through the
  Management API, not a direct database connection, so it needs an access token,
  not a database password. `npx supabase@latest login` is **interactive** — it
  opens a browser and waits — so it needs a real terminal and cannot be done from
  a script or an agent session. Alternatively set `SUPABASE_ACCESS_TOKEN` in the
  environment.

It is **not** wired into CI, deliberately. It needs an access token with
live-project rights, and this is a public repository — storing a credential that
can read and alter the live database in CI is a bigger risk than the guard is
worth, especially with `pull_request` triggers in play. Run it yourself, by hand,
before every deploy that touches a migration.

### `npm run verify:score`

Proves the total on screen and the total in the database are the same number.
Generates every one of the 7,776 pillar combinations (1–5 and unscored, five
pillars), computes each expected total with the real `totalScore()` from
`src/lib/score.ts`, then reads the **live** `total_score` expression out of
Postgres's catalogue and evaluates it against all of them. Any disagreement
raises an exception naming the chunk.

Nothing is inserted and no sequence advances: the expression is evaluated over
a `VALUES` list, not over rows in a table. Unlike `verify:privileges` it needs
no data in the database — an empty `checkins` table is fine, because only the
column's definition is read.

The generated file is written fresh on every run and is gitignored, so a stale
file from an earlier `score.ts` can never be the thing that passes. `db:which`
runs between the generate and the query, and it now **exits non-zero** on
production, so the `&&` chain is a real gate rather than a printed warning.

`tests/generatedColumn.test.ts` is the cheap half of this and runs in
`npm test`. It pins the migration's expression as text, so drift is caught in
CI — it does **not** prove Postgres and JavaScript agree. Only the command
above does that, and only against a database. `tests/scoreParity.test.ts` is
the other half of the cheap side: it checks the generator itself covers all
7,776 combinations exactly once with totals that plain addition agrees with,
because the "all 7776 combinations agree" line the command prints is generated
from the same list it describes.

### `npm run verify:lifecycle`

Proves the **deployed** `clients_lifecycle_coherent` constraint permits exactly
what it is meant to, over its whole input space: four statuses × an end date
present or not × a reason code present or not × a note present or not = **32
combinations**. It reads the live expression out of `pg_constraint` and evaluates
it over a `VALUES` list, so what is tested is what is deployed rather than a copy
of what was intended — the same technique `verify:score` uses on the generated
column.

Nothing is inserted and no sequence advances. It asserts the combination count as
well as the result, so "0 disagreements" cannot read as success when the reason is
that nothing was compared.

Only **6 of the 32** combinations are legal, and that is the intent worth
checking by eye rather than by test: `active` and `paused` require all three
lifecycle columns to be null; `cancelled` and `former` require both `ended_on`
and `end_reason_code`, with `end_reason_note` optional.

It distinguishes two failures, like `verify:privileges`. **`COULD NOT VERIFY`**
means the constraints are not on the table — normally that the migration has not
been applied to this project — and is not a finding. **`FAILED`** means the
deployed expression disagrees with its stated intent, and prints the expression.
Both exit non-zero.

`tests/clientLifecycle.test.ts` is the cheap half and runs in `npm test`. It pins
the migration's constraint text, the seven reason codes (membership **and**
count), and the unique index — so drift is caught in CI. It does **not** prove
Postgres enforces any of it.

### `npm run verify:capability`

Proves the **deployed** `private.has_capability` gives the right answer for every
role and every capability: four roles × four capabilities = **16 combinations**.
It reads the `CASE` out of `pg_proc.prosrc` and evaluates it over a `VALUES`
list, so what is tested is what is deployed — the same technique
`verify:lifecycle` uses on a check constraint.

The fourth role is `sales`, which no preset knows. It must answer false for
everything, which is what exercises the function's `else array[]::text[]` branch.
That value is unreachable while `profiles.role` carries its check constraint; the
branch exists so that adding a role to the constraint and forgetting the `CASE`
fails closed, and an unexercised fail-closed branch is only an intention.

Nothing is inserted and no sequence advances, and unlike `verify:privileges` it
needs **no rows in any table** — which is the reason it exists. Section 10f of
`verify:privileges` checks the same guarantee the right way round, by becoming
`authenticated` with a viewer's claims and watching a real `insert` be refused,
but it needs an active profile row per role. Neither database has one, so on a
project with a single admin 10f reports `COULD NOT VERIFY` and the preset table
would otherwise go unexercised.

**It covers only the preset table.** The `exists (...)` wrapper around it — the
`auth.uid()` lookup and the `is_active` test — is not exercised, because that
needs a subject and a profile row. So a function that answers correctly per role
could still be wired to the wrong subject and this would pass. Sections 10b–10d
of `verify:privileges` are what cover the wiring. **Neither file is sufficient
alone**, and that is stated at the top of both.

It distinguishes the same two failures. **`COULD NOT VERIFY`** means the function
is absent (normally: the migration is not applied here) or has been rewritten
into a shape the script cannot read — the second one is not a pass, and the
script says so rather than shrugging. **`FAILED`** means somebody holds a
capability their role should not, or is denied one it should, and it prints the
deployed `CASE`. Both exit non-zero.

A passing run echoes the function's identity arguments, `security definer`,
`stable`, and the two grants that matter: `authenticated_execute` must be
**true** — a policy-referenced definer function that `authenticated` cannot
execute fails `42501` for every signed-in user — and `anon_execute` must be
**false**. Those two are *asserted*, in both directions, by section 9 of
`verify:privileges`; here they are printed beside the answers they govern.

`tests/hasCapability.test.ts` and `tests/capabilities.test.ts` are the cheap half
and run in `npm test`. The first pins the migration's function body, its grants,
the six policy predicates and the **order** of the three sections — creating and
granting the function before any policy names it, and dropping the old helper
after the last one. The second pins `src/lib/capabilities.ts` against the
migration's presets in both directions, because the UI keeps a second copy to
decide what to draw.

## The board's show-archived toggle

The board is the month's check-in grid, so by default it shows only `active`
clients — the ones a check-in is expected for. **Show N archived** reveals the
rest: `paused`, `cancelled` and `former`, sorted after the active roster.

The parent spec names only `former` as hidden behind this toggle. It reveals all
three because the board has only ever read `active`, so `paused` and `cancelled`
were invisible with no way at all to see them — and the clients admin screen
already tells the reader that a paused client is "Off the board."

Two things the toggle deliberately does not do:

- **It never changes the progress line.** That line reads "N of M check-ins
  submitted this month", and M is the count of *active* clients whatever the
  toggle says. A former client cannot owe a check-in, and can still hold one
  from when they were active, so both halves of that fraction filter on status.
  `useBoard` computes them; `clients.length` is the wrong denominator and there
  is a test that fails if it is used.
- **It does not make an archived client scorable.** Their card shows its status
  and its past scores, but the name is text rather than a link, and the card
  says why. This is a UI-only guard and it is the only one there is:
  `checkins_insert_edit_scores` gates on the `edit_scores` capability and
  carries **no status predicate**, so Postgres would accept a check-in for a
  client who left. Before this toggle the board never drew such a client, so the
  path did not exist.

The toggle is not remembered across a reload. A refresh returns to the working
view, the same choice the board makes for its other navigation.

## The clients admin screen

Reached from the board by anyone whose role preset includes `manage_clients` --
today an admin or an account manager. It adds a client, renames one, assigns an
owner, and gives a departing client an end date and a coded reason.

The button is hidden from a viewer, and that is convenience rather than
security. What actually stops a viewer changing a client is
`clients_insert_manage_clients` and `clients_update_manage_clients` in Postgres.
A viewer who reached the screen would have every write refused -- but the two
policies refuse in **different ways**, and the screen says something different
for each:

- **Adding** is refused with a raised error. `WITH CHECK` fails, Postgres
  answers `new row violates row-level security policy`, and the screen shows
  "Your account is not allowed to change clients. Ask an admin." plus its usual
  promise that nothing was changed and pressing save again costs nothing.
- **Renaming, re-assigning and retiring** are refused by *filtering the row
  away*. `clients_update_manage_clients` is `using (...) with check (...)`, so
  the USING clause simply excludes the row: zero rows are updated and **no error
  is raised at all**. The screen treats that as its own outcome -- "That change
  was not applied, and nothing was changed. The database matched no client to
  update, which is what happens when the account signed in here is no longer
  allowed to change clients. Ask an admin." -- and deliberately does *not* invite
  a retry, because every retry would be refused identically.

Neither case shows Postgres's own words. The second is the one worth knowing
about: before this was handled, an update refused this way surfaced PostgREST's
`JSON object requested, multiple (or no) rows returned` with an invitation to
try again. It does not need a viewer to reach the hidden button, either -- an
admin deactivating or demoting an account while its holder has this screen open
produces exactly the same refusal, because the browser holds the profile it read
at sign-in.

**There is no delete, and there will not be one.** `checkins.client_id` is
`on delete cascade` and this project has no backups, so deleting a client would
silently destroy that client's entire check-in history. `former` is how a client
goes away, and a former client stays visible on this screen -- that is the reason
the screen reads every row while the board reads only the active ones.

Three refusals come from the database and are worth knowing by name, because the
screen translates them rather than repeating them:

- Two clients whose names differ only in case cannot both exist --
  `clients_name_unique`, a unique index on `lower(name)`.
- A cancelled or former client must have an end date and a coded reason, and an
  active or paused one must have none of the three -- `clients_lifecycle_coherent`.
  This is why reactivating a client clears all three columns in the same update,
  and why the form warns before it does.
- The reason must be one of seven -- `clients_end_reason_code_known`.

`npm run verify:lifecycle` proves the second and third of those are what is
actually deployed, by reading the constraints out of `pg_constraint` and
evaluating them over all 32 combinations of their inputs.

## Security notes

- The browser receives only the **publishable** key. The secret key must never appear
  in a `VITE_` variable — Vite inlines those into the public bundle.
- Row-level security in Postgres is the access boundary, not the UI. Section 10
  of `scripts/verify-privileges.sql` is what verifies that claim. Treat a
  **violation** there as a security incident rather than a broken test — but read
  the heading first: a run that reports unmet **preconditions** has found no
  violation at all and simply had too little data to check something. The two are
  reported separately for exactly this reason.
- New accounts are created inactive. An admin activates them, with SQL (above).
- RLS is enabled on every table but deliberately not *forced*: forcing it would
  also subject the table owner (`postgres`) and `service_role` to the
  policies, which would break the `security definer` signup trigger and any
  server-side administrative access.
- **`service_role`'s access is now declared, not inherited.** It holds everything
  on all three tables, and until
  `20260821040500_declare_service_role_grants.sql` that grant existed only
  because a default-privileges row inherited from this project's vintage happened
  to supply it — no migration had ever asked for it. It is the admin activation
  path, so a project whose inherited default differed would produce tables the
  documented recovery route could not touch. The migration declares it
  explicitly; section 11 of `verify-privileges.sql` asserts it is still there.
  Neither is redundant, and neither should be deleted for looking redundant.
- The `private` schema is unreachable from a browser for **two independent**
  reasons: no browser role holds `USAGE` on it, and PostgREST does not expose it.
  Both are asserted — the first in `verify-privileges.sql` §9a, the second by two
  tests in `src/lib/rls.test.ts` — because the second one is dashboard
  configuration that no diff would show changing.
