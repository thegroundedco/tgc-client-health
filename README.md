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

**Deploy target (not yet live):** https://thegroundedco.github.io/tgc-client-health/

See `docs/superpowers/specs/2026-08-20-tgc-client-health-design.md` for the design
and the phase roadmap.

## Development

Requires Node.js LTS.

```bash
npm install
cp .env.example .env.local   # fill in from Supabase → Project Settings → API
npm run dev
```

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

## Database

Migrations live in `supabase/migrations/` and are applied with the Supabase CLI:

```bash
npx supabase@latest login                     # interactive; needs a real terminal
npx supabase@latest link --project-ref <ref>
npx supabase@latest db push --linked
npx supabase@latest gen types typescript --linked > src/types/database.ts
```

Never run `db reset`, and never pass `--force`. This project has one Supabase
project and it holds real data.

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

Runs `scripts/verify-privileges.sql` against the linked project and asserts, in
Postgres, both halves of the boundary:

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

It writes nothing. The one write it attempts is an `insert` the policy is meant
to refuse, inside a block that rolls the statement back even if the refusal stops
happening.

**What it needs in order to run:**

- a **linked** project — `npx supabase@latest link --project-ref <ref>` once; the
  link is stored in `supabase/.temp/`, which is gitignored, so a fresh clone must
  link again;
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
  of `scripts/verify-privileges.sql` is what verifies that claim; treat a failure
  there as a security incident rather than a broken test.
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
