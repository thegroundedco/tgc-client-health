# TGC Client Health

Monthly client-health check-ins for The Grounded Company's account management team.

**Live:** https://thegroundedco.github.io/tgc-client-health/

## Status

Slice 0 complete — auth, database, and deploy proven end to end. See
`docs/superpowers/specs/2026-08-20-tgc-client-health-design.md` for the design and
the phase roadmap.

## Development

Requires Node.js LTS.

```bash
npm install
cp .env.example .env.local   # fill in from Supabase → Project Settings → API
npm run dev
```

## Tests

```bash
npm test                                    # logic tests
npx vitest run src/lib/rls.test.ts --mode development   # RLS tests, need .env.local
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
`rls.test.ts` entirely and runs only the four logic-only files (`env.test.ts`,
`appState.test.ts`, `score.test.ts`, `month.test.ts`). Locally, with
`.env.local` present, `npm test` runs 45 tests across 5 files; CI runs 32 of
those across 4 files. The 13-test, one-file gap is `rls.test.ts`, run only by a
human with real credentials, never by CI.

## Database

Migrations live in `supabase/migrations/` and are applied with the Supabase CLI:

```bash
npx supabase@latest link --project-ref <ref>
npx supabase@latest db push
npx supabase@latest gen types typescript --linked > src/types/database.ts
```

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

### `npm run verify:privileges` — a manual pre-deploy gate, not a CI check

```bash
npm run verify:privileges
```

Runs `scripts/verify-privileges.sql` against the linked project and asserts
the grant matrix directly in Postgres: that `anon` and `authenticated` hold
nothing beyond an explicit allowlist on every table in `public`, that RLS is
enabled (but not forced — see Security notes) everywhere, and that no function
in `public` or `private` is executable by a browser role outside what its
policies require. It is the check most likely to catch a migration that
reopened the table-privilege trap above.

It is **not** wired into CI, deliberately. It needs a Supabase access token
with live-project access, and this is a public repository — storing a
credential that can read and alter the live database in CI is a bigger risk
than the guard is worth, especially with `pull_request` triggers in play. Run
it yourself, by hand, before every deploy that touches a migration.

## Security notes

- The browser receives only the **publishable** key. The secret key must never appear
  in a `VITE_` variable — Vite inlines those into the public bundle.
- Row-level security in Postgres is the access boundary, not the UI.
- New accounts are created inactive. An admin activates them.
- RLS is enabled on every table but deliberately not *forced*: forcing it would
  also subject the table owner (`postgres`) and `service_role` to the
  policies, which would break the `security definer` signup trigger and any
  server-side administrative access.
