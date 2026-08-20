# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.

## Verifying the security boundary

The browser is untrusted and ships its own source, so row-level security and the
Postgres grants behind it are the entire access boundary of this application. Two
checks assert it, and both talk to the real Supabase project — there is no local
database.

```bash
npm test                  # includes src/lib/rls.test.ts
npm run verify:privileges # asserts the grant matrix; exits non-zero on a violation
```

### `npm test`

`src/lib/rls.test.ts` drives the live project with the anonymous key and asserts
that an unauthenticated caller is refused at the **privilege** layer — HTTP 401,
SQLSTATE `42501`, `permission denied for table profiles` — for select, insert,
update and delete alike. Asserting the error rather than merely "no rows came
back" is deliberate: an empty result set is equally consistent with `anon` holding
full table privileges and RLS quietly filtering, which is a state this table has
actually been in.

It needs `.env.local` (copy `.env.example`). Without it the security cases cannot
run, so the suite fails with an explicit message rather than skipping quietly — a
green run that verified nothing is worse than a red one.

### `npm run verify:privileges`

Runs `scripts/verify-privileges.sql` against the linked project. It asserts the
privilege matrix that `npm test` structurally cannot reach, because every test
there uses the anonymous client while the boundary that matters most is what a
*signed-in* user can write:

- `authenticated` may update `profiles.full_name` and **nothing** else — in
  particular not `role` or `is_active`, which would let a user promote themselves
  to an active admin
- `authenticated` holds no table-level `UPDATE`, which would silently make the
  column-level grant above meaningless, since Postgres privileges are additive
- `anon` holds nothing at all on `public.profiles`, at table or column level
- across **every** table in `public`, no browser-reachable role holds a privilege
  outside the allowlist in that file
- every table in `public` has RLS enabled, and `profiles` does not have it *forced*
  (forcing it would break the `security definer` signup trigger)
- no function in `public` is executable by `anon` or `authenticated`

Widening any of this means editing the allowlist in
`scripts/verify-privileges.sql` on purpose, in a diff a reviewer can see. That is
the point: the original vulnerability here was inherited silently from Supabase's
legacy default privileges, not written by anyone.

Run it after any migration that touches grants, policies, or schema `public`.
