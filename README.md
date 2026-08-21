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
```

Switch target deliberately, one command at a time, and never leave production
linked:

```bash
npx supabase@latest link --project-ref <ref>   # Supabase → Project Settings
                                               #   → General → Reference ID
npm run db:which                               # confirm before doing anything
```

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
