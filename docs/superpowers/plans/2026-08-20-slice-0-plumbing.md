# Slice 0: Plumbing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the full stack end-to-end — a signed-in user loads a deployed page, sees a client, saves a pillar score to Postgres, and reloads to find it still there.

**Architecture:** Static Vite + React + TypeScript SPA talking directly to Supabase over HTTPS. Auth is magic-link email. Row-level security in Postgres is the access boundary; the browser holds only a publishable key. Schema changes are SQL migration files applied by the Supabase CLI against the hosted project. GitHub Actions builds and publishes to GitHub Pages.

**Tech Stack:** Vite, React, TypeScript, `@supabase/supabase-js`, Vitest, Supabase CLI (via `npx`), GitHub Actions, GitHub Pages.

**Spec:** `docs/superpowers/specs/2026-08-20-tgc-client-health-design.md`

## Why this slice exists

v1 died on storage friction, not on features. Every table, screen, and permission in
Phase 1 sits on top of the plumbing built here. Proving that plumbing on the real
deploy target *before* building features means that when something breaks later, the
foundation is not a suspect.

Slice 0 is deliberately not throwaway: the `profiles`, `clients`, and `checkins`
tables created here are the real Phase 1 tables. What Slice 0 omits is capabilities,
admin screens, client lifecycle, and the rubric — not schema it would have to undo.

## Global Constraints

Copied verbatim from the spec. Every task's requirements implicitly include these.

**Identifiers and types**
- Lowercase `snake_case` for all database identifiers. No quoted mixed-case.
- `bigint generated always as identity` primary keys, except `profiles`, which takes
  its `uuid` from `auth.users`.
- `text` not `varchar(n)`; `timestamptz` not `timestamp`; `numeric` for money.
- Index every foreign key column and every column referenced in an RLS policy.

**Row-level security — non-negotiable rules**
- Enable RLS on every table in `public`.
- Every policy names its role explicitly: `to authenticated` (or `to anon`). Never
  use `auth.role()` — it is deprecated, and it passes for anonymous sign-ins.
- `to authenticated` alone is authentication without authorization. Always pair it
  with a predicate in `using`.
- `update` policies need **both** `using` and `with check`, or a user can reassign a
  row to someone else.
- An `update` also requires a `select` policy — without one it silently affects zero
  rows and reports no error.
- Views, if any, must be created `with (security_invoker = true)`; views otherwise
  bypass RLS.
- `security definer` functions live in the `private` schema, always check
  `(select auth.uid())` in the body, and have `execute` revoked from `public`, `anon`,
  and `authenticated`. Never add `security definer` to make a permission error go away.
- Newly created tables are not necessarily exposed to the Data API. Grant `anon` and
  `authenticated` explicitly, and pair every grant with RLS.
- Wrap `auth.uid()` and helper calls in a subselect — `(select auth.uid())` — so
  Postgres evaluates them once per statement instead of once per row.

**Authorization data**
- Role and capability data live in `public.profiles` and `public.permission_overrides`.
- **Never** read authorization from `user_metadata` / `raw_user_meta_data` — it is
  user-editable. If JWT claims are ever needed, use `app_metadata`.

**Keys**
- The browser gets the **publishable** key only. The secret / `service_role` key never
  appears in client code, in `git`, or in any `VITE_`-prefixed variable — Vite inlines
  every `VITE_` variable into the shipped bundle.

**Brand tokens** (exact values, spec §9)
- `--ink: #1F1F1F`, `--paper: #FBF7EB`, `--teal: #83C1C0`, `--blush: #FFB3AB`,
  `--red: #F9423A`, `--amber: #E8A33D`
- Typeface: **Archivo** (Google Fonts, variable — weight 100–900, width 62–125)
- Health bands: Healthy 18–25 (teal), Watch 11–17 (amber), At risk 0–10 (red)
- Every band badge carries its **text label**. Colour is never the only signal.

**Scoring**
- Five pillars: `relationship`, `delivery`, `financial`, `sentiment`, `growth`.
- Each is 1–5, or null. A check-in missing any pillar has a **null** total, never a
  low one.

**Dependencies**
- Pin exact versions (no `^` or `~`) and commit `package-lock.json`.

## Human prerequisites

These cannot be done by an agent. Confirm both before starting Task 1.

- [ ] **Node.js LTS installed** from nodejs.org (macOS Apple Silicon `.pkg`).
      Verify: `node -v` and `npm -v` both print a version.
- [ ] **Supabase project created** at supabase.com/dashboard, named
      `tgc-client-health`, database password saved somewhere safe.
      From **Project Settings → API**, have the project URL and publishable key ready.

## A correction to the spec, and why

The spec says RLS is "enabled and forced". This plan enables RLS but does **not** use
`force row level security`, because forcing it subjects the table owner to policies —
which breaks the `security definer` trigger that creates a profile row when someone
signs up, since that trigger runs as the owner.

The security property still holds: `anon` and `authenticated` never bypass RLS whether
or not it is forced. Forcing only affects the owner, and the owner is not reachable
from the browser. Task 3 verifies this directly rather than assuming it.

---

### Task 1: Scaffold the project

**Files:**
- Create: `package.json`, `package-lock.json`, `vite.config.ts`, `tsconfig.json`,
  `tsconfig.node.json`, `index.html`, `src/main.tsx`, `src/App.tsx`, `.gitignore`,
  `README.md`
- Delete: `src/App.css`, `src/index.css`, `public/vite.svg`, `src/assets/react.svg`

**Interfaces:**
- Consumes: nothing (first task)
- Produces: a buildable Vite React TS app; `npm run build` and `npm run dev` scripts;
  Vitest available as `npm test`

- [ ] **Step 1: Confirm the toolchain exists**

```bash
cd /Users/josh/Downloads/CLAUDE/tgc-client-health
node -v && npm -v
```

Expected: two version numbers. If either says "command not found", stop — the human
prerequisite above is not met.

- [ ] **Step 2: Scaffold Vite into the existing directory**

The directory already contains `.git` and `docs/`, so scaffold in place with `.`:

```bash
npm create vite@latest . -- --template react-ts
```

If it warns the directory is not empty, choose to continue without overwriting
(`docs/` and `.git` must survive). Verify afterwards that `docs/` still exists.

- [ ] **Step 3: Install dependencies and pin them**

```bash
npm install
npm pkg get dependencies devDependencies
```

Then remove every `^` and `~` from `package.json` so versions are exact, and
reinstall to regenerate the lockfile:

```bash
npm install
git status --short   # package-lock.json must be present and unignored
```

- [ ] **Step 4: Add Vitest**

```bash
npm install -D vitest@latest
npm pkg set scripts.test="vitest run"
npm pkg set scripts.test:watch="vitest"
```

Pin the installed `vitest` version to exact in `package.json`, then `npm install`.

- [ ] **Step 5: Configure Vite for a GitHub Pages subpath**

Replace `vite.config.ts` with:

```ts
// defineConfig must come from vitest/config, not vite — the `test` key is not
// part of Vite's own config type and TypeScript will reject it.
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// GitHub Pages serves project sites from /<repo-name>/, so assets must be
// requested from that prefix. A leading and trailing slash are both required.
export default defineConfig({
  plugins: [react()],
  base: '/tgc-client-health/',
  test: {
    environment: 'node',
  },
})
```

There is deliberately no client-side router in this project. Screens are selected by
React state, which avoids GitHub Pages' need for a `404.html` fallback on deep links.

- [ ] **Step 6: Strip the template's styling and demo content**

```bash
rm -f src/App.css src/index.css public/vite.svg
rm -rf src/assets
```

Replace `src/App.tsx` with:

```tsx
export default function App() {
  return <h1>TGC Client Health</h1>
}
```

Replace `src/main.tsx` with:

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

const root = document.getElementById('root')
if (!root) throw new Error('index.html is missing <div id="root">')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

Edit `index.html`: set `<title>TGC Client Health</title>` and delete the
`<link rel="icon" ... vite.svg>` line.

- [ ] **Step 7: Write `.gitignore`**

```gitignore
node_modules
dist
*.local
.env
.env.*
!.env.example
.DS_Store
.vscode
supabase/.temp
```

`.env*` is ignored except the example, so no real key can be committed by accident.

- [ ] **Step 8: Verify the build works**

```bash
npm run build
```

Expected: PASS — writes to `dist/` with no TypeScript errors.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore: scaffold Vite React TypeScript app

Base path set for GitHub Pages project-site hosting. Dependencies
pinned to exact versions with the lockfile committed. No router by
design, so Pages needs no SPA fallback."
```

---

### Task 2: Supabase client with fail-loud configuration

**Files:**
- Create: `src/lib/env.ts`, `src/lib/env.test.ts`, `src/lib/supabase.ts`,
  `.env.example`, `.env.local`
- Modify: `package.json` (add `@supabase/supabase-js`)

**Interfaces:**
- Consumes: Task 1's build setup
- Produces:
  - `readSupabaseConfig(source: Record<string, string | undefined>): SupabaseConfig`
    where `type SupabaseConfig = { url: string; publishableKey: string }` — throws
    `Error` with a remediation message when either value is missing or blank
  - `supabase: SupabaseClient` — the single shared client instance

- [ ] **Step 1: Install the Supabase client**

```bash
npm install @supabase/supabase-js@latest
```

Pin it to the exact installed version in `package.json` and rerun `npm install`.
Record the version in the commit message — it matters when debugging later.

- [ ] **Step 2: Write the failing test**

Create `src/lib/env.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { readSupabaseConfig } from './env'

describe('readSupabaseConfig', () => {
  it('returns url and key when both are present', () => {
    const config = readSupabaseConfig({
      VITE_SUPABASE_URL: 'https://example.supabase.co',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
    })
    expect(config).toEqual({
      url: 'https://example.supabase.co',
      publishableKey: 'sb_publishable_test',
    })
  })

  it('throws naming the missing variable when the url is absent', () => {
    expect(() =>
      readSupabaseConfig({ VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test' }),
    ).toThrow(/VITE_SUPABASE_URL/)
  })

  it('throws naming the missing variable when the key is absent', () => {
    expect(() =>
      readSupabaseConfig({ VITE_SUPABASE_URL: 'https://example.supabase.co' }),
    ).toThrow(/VITE_SUPABASE_PUBLISHABLE_KEY/)
  })

  it('treats whitespace-only values as missing', () => {
    expect(() =>
      readSupabaseConfig({
        VITE_SUPABASE_URL: '   ',
        VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
      }),
    ).toThrow(/VITE_SUPABASE_URL/)
  })

  it('rejects a secret key pasted into the publishable slot', () => {
    expect(() =>
      readSupabaseConfig({
        VITE_SUPABASE_URL: 'https://example.supabase.co',
        VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_oops',
      }),
    ).toThrow(/secret/i)
  })
})
```

The last test is the one that matters most. A secret key in a `VITE_` variable gets
inlined into the public bundle, which would hand every visitor full database access.
Failing the build is the only acceptable response.

- [ ] **Step 3: Run the test to verify it fails**

```bash
npm test
```

Expected: FAIL — cannot resolve `./env`.

- [ ] **Step 4: Write the implementation**

Create `src/lib/env.ts`:

```ts
export type SupabaseConfig = {
  url: string
  publishableKey: string
}

function required(source: Record<string, string | undefined>, name: string): string {
  const value = source[name]
  if (!value || value.trim() === '') {
    throw new Error(
      `Missing ${name}. Copy .env.example to .env.local and fill in the values ` +
        `from your Supabase dashboard under Project Settings → API.`,
    )
  }
  return value.trim()
}

export function readSupabaseConfig(
  source: Record<string, string | undefined>,
): SupabaseConfig {
  const url = required(source, 'VITE_SUPABASE_URL')
  const publishableKey = required(source, 'VITE_SUPABASE_PUBLISHABLE_KEY')

  // Vite inlines every VITE_-prefixed variable into the shipped bundle, so a
  // secret key here would be readable by anyone who opens the page.
  if (/^sb_secret_/.test(publishableKey) || /service_role/.test(publishableKey)) {
    throw new Error(
      'VITE_SUPABASE_PUBLISHABLE_KEY looks like a secret key. Secret keys must ' +
        'never be exposed to the browser. Use the publishable key instead.',
    )
  }

  return { url, publishableKey }
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
npm test
```

Expected: PASS — all five cases.

- [ ] **Step 6: Create the shared client**

Create `src/lib/supabase.ts`:

```ts
import { createClient } from '@supabase/supabase-js'
import { readSupabaseConfig } from './env'

const config = readSupabaseConfig(
  import.meta.env as unknown as Record<string, string | undefined>,
)

// One client for the whole app. Multiple instances race each other over the
// stored session and cause spurious sign-outs.
export const supabase = createClient(config.url, config.publishableKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // The magic-link callback returns tokens in the URL fragment; the client
    // needs to read and clear them on load.
    detectSessionInUrl: true,
  },
})
```

- [ ] **Step 7: Write the env files**

Create `.env.example` (committed, no real values):

```dotenv
# From Supabase dashboard → Project Settings → API
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_your_key_here
```

Create `.env.local` (gitignored) with the real values from the dashboard.

**Note on key naming:** Supabase has moved from `anon` / `service_role` keys to
`publishable` / `secret` keys, and which pair a project shows depends on when it was
created. Use whatever the dashboard labels as safe for browser use. Do not guess from
this document — read the dashboard.

- [ ] **Step 8: Verify the real config loads**

```bash
npm run build
```

Expected: PASS. If it throws the "Missing VITE_..." error, `.env.local` is wrong —
that is the error working correctly.

- [ ] **Step 9: Confirm no secret leaked into the bundle**

```bash
grep -rE 'sb_secret_|service_role' dist/ && echo "LEAK FOUND — STOP" || echo "clean"
```

Expected: `clean`.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: add Supabase client with fail-loud config validation

Rejects a secret key in the publishable slot, since every VITE_
variable is inlined into the public bundle. Single shared client
instance to avoid session races."
```

---

### Task 3: The `profiles` table, signup trigger, and RLS

**Files:**
- Create: `supabase/migrations/<timestamp>_create_profiles.sql`
- Create: `src/types/database.ts` (generated)

**Interfaces:**
- Consumes: Task 2's `supabase` client
- Produces:
  - `public.profiles` — columns `id uuid`, `email text`, `full_name text`,
    `role text`, `is_active boolean`, `created_at timestamptz`,
    `updated_at timestamptz`
  - `private.handle_new_user()` — trigger function on `auth.users` insert
  - Generated TypeScript types at `src/types/database.ts`

- [ ] **Step 1: Check current Supabase guidance before writing SQL**

Supabase's API conventions change between versions. Before writing the migration,
fetch `https://supabase.com/changelog.md` and scan for `breaking-change` entries
affecting auth triggers, RLS, or the Data API. Follow any that apply.

- [ ] **Step 2: Link the CLI to the hosted project**

```bash
npx supabase@latest --version
npx supabase@latest login
npx supabase@latest link --project-ref <your-project-ref>
```

The project ref is the subdomain of the project URL. `link` will ask for the database
password saved during project creation.

Discover flags with `--help` rather than assuming them:

```bash
npx supabase@latest link --help
npx supabase@latest migration --help
```

- [ ] **Step 3: Create an empty migration file**

Never hand-invent a migration filename — the timestamp format matters:

```bash
npx supabase@latest migration new create_profiles
```

Note the path it prints.

- [ ] **Step 4: Write the migration**

Into the file just created:

```sql
-- Private schema for security definer helpers. Nothing here is reachable
-- from the browser.
create schema if not exists private;
revoke all on schema private from public;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  role text not null default 'viewer'
    check (role in ('admin', 'account_manager', 'viewer')),
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.profiles.is_active is
  'Defaults to false: signing up must not grant access. An admin activates.';

create index profiles_role_idx on public.profiles (role);

alter table public.profiles enable row level security;

-- Data API exposure is a separate concern from RLS. Without these grants the
-- table is unreachable; without RLS the grants would expose everything.
grant usage on schema public to anon, authenticated;
grant select on public.profiles to authenticated;

-- Narrow write surface: a user may rename themselves and nothing else.
-- Column-level grants make this structural rather than a UI convention.
grant update (full_name) on public.profiles to authenticated;

create policy profiles_select_own
  on public.profiles
  for select
  to authenticated
  using ((select auth.uid()) = id);

-- An update needs a select policy too, or it silently affects zero rows.
-- Both using and with check are required, or a row could be reassigned.
create policy profiles_update_own
  on public.profiles
  for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- Creates the profile row on signup. Security definer because the signing-up
-- user has no rights on profiles yet. Lives in private, takes no user input,
-- and writes only the row for the user being created.
create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$;

revoke execute on function private.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

create function private.touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke execute on function private.touch_updated_at() from public, anon, authenticated;

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function private.touch_updated_at();
```

Note: `is_active` and `role` carry no update grant, so a user cannot promote or
activate themselves even though they can update their own row.

- [ ] **Step 5: Apply the migration**

```bash
npx supabase@latest db push
npx supabase@latest migration list
```

Expected: the migration appears as applied both locally and remotely.

- [ ] **Step 6: Run the advisors**

```bash
npx supabase@latest db advisors --help
npx supabase@latest db advisors
```

Expected: no errors on `public.profiles`. If the CLI is older than v2.81.3 this
command will not exist — use the dashboard's Advisors page instead. Fix anything it
reports before continuing.

- [ ] **Step 7: Generate TypeScript types**

```bash
npx supabase@latest gen types typescript --linked > src/types/database.ts
head -30 src/types/database.ts
```

Expected: a `Database` type containing `profiles`.

- [ ] **Step 8: Verify RLS blocks an unauthenticated read**

Create `src/lib/rls.test.ts`:

```ts
import { createClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'

// Reads the same .env.local the app uses. These tests hit the real project;
// they are the only way to know the policies actually work.
//
// Vite deliberately skips .env.local when mode is 'test', which is why these
// tests are run with `--mode development`. The values arrive on
// import.meta.env, not process.env.
const env = import.meta.env as unknown as Record<string, string | undefined>
const url = env.VITE_SUPABASE_URL
const key = env.VITE_SUPABASE_PUBLISHABLE_KEY

describe.runIf(url && key)('RLS with no session', () => {
  const anon = createClient(url!, key!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  it('returns no profile rows to an unauthenticated caller', async () => {
    const { data, error } = await anon.from('profiles').select('id')
    // Either an explicit denial or an empty set is acceptable. Rows are not.
    expect(error ? [] : data).toEqual([])
  })
})
```

Run it with the env file loaded:

```bash
npx vitest run src/lib/rls.test.ts --mode development
```

Expected: PASS. If it returns rows, a policy is wrong — stop and fix it before
building anything on top.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: add profiles table with signup trigger and RLS

New accounts are created inactive with the viewer role, so signing up
grants no access until an admin activates. Column-level grants mean a
user can rename themselves but cannot change role or is_active.
Verified that an unauthenticated caller reads zero rows."
```

---

### Task 4: Magic-link sign in, session, and the pending-access screen

**Files:**
- Create: `src/auth/useSession.ts`, `src/auth/SignIn.tsx`,
  `src/auth/PendingAccess.tsx`, `src/auth/useProfile.ts`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `supabase` from `src/lib/supabase.ts`; `Database` from `src/types/database.ts`
- Produces:
  - `useSession(): { session: Session | null; status: 'loading' | 'ready' }`
  - `useProfile(session): { profile: Profile | null; status: 'loading' | 'ready' | 'error'; error: string | null }`
    where `Profile = Database['public']['Tables']['profiles']['Row']`
  - `<SignIn />`, `<PendingAccess email={string} onSignOut={() => void} />`

- [ ] **Step 1: Add the redirect URL to Supabase**

In the dashboard under **Authentication → URL Configuration**, add both:

- `http://localhost:5173/tgc-client-health/` (local development)
- the eventual Pages URL, `https://<user>.github.io/tgc-client-health/`

A magic link whose redirect is not on this allowlist silently fails to sign the user
in. Set both now so Task 6 does not have to debug it.

- [ ] **Step 2: Write the session hook**

Create `src/auth/useSession.ts`:

```ts
import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

export function useSession() {
  const [session, setSession] = useState<Session | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready'>('loading')

  useEffect(() => {
    let cancelled = false

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return
      setSession(data.session)
      setStatus('ready')
    })

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      setStatus('ready')
    })

    return () => {
      cancelled = true
      subscription.subscription.unsubscribe()
    }
  }, [])

  return { session, status }
}
```

- [ ] **Step 3: Write the profile hook**

Create `src/auth/useProfile.ts`:

```ts
import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { Database } from '../types/database'

export type Profile = Database['public']['Tables']['profiles']['Row']

export function useProfile(session: Session | null) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!session) {
      setProfile(null)
      setStatus('ready')
      return
    }

    let cancelled = false
    setStatus('loading')

    supabase
      .from('profiles')
      .select('*')
      .eq('id', session.user.id)
      .maybeSingle()
      .then(({ data, error: queryError }) => {
        if (cancelled) return
        if (queryError) {
          // Distinguish "cannot reach the database" from "no data". Conflating
          // the two is what made v1 impossible to diagnose.
          setError(queryError.message)
          setStatus('error')
          return
        }
        setProfile(data)
        setStatus('ready')
      })

    return () => {
      cancelled = true
    }
  }, [session])

  return { profile, status, error }
}
```

- [ ] **Step 4: Write the sign-in screen**

Create `src/auth/SignIn.tsx`:

```tsx
import { useState } from 'react'
import { supabase } from '../lib/supabase'

export function SignIn() {
  const [email, setEmail] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [message, setMessage] = useState('')

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setState('sending')
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin + import.meta.env.BASE_URL },
    })
    if (error) {
      setState('error')
      setMessage(error.message)
      return
    }
    setState('sent')
  }

  if (state === 'sent') {
    return (
      <main>
        <h1>Check your email</h1>
        <p>We sent a sign-in link to {email}. Open it on this device.</p>
      </main>
    )
  }

  return (
    <main>
      <h1>TGC Client Health</h1>
      <form onSubmit={submit}>
        <label htmlFor="email">Work email</label>
        <input
          id="email"
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <button type="submit" disabled={state === 'sending'}>
          {state === 'sending' ? 'Sending…' : 'Email me a sign-in link'}
        </button>
      </form>
      {state === 'error' && <p role="alert">Could not send the link: {message}</p>}
    </main>
  )
}
```

- [ ] **Step 5: Write the pending-access screen**

Create `src/auth/PendingAccess.tsx`:

```tsx
type Props = {
  email: string
  onSignOut: () => void
}

export function PendingAccess({ email, onSignOut }: Props) {
  return (
    <main>
      <h1>Access pending</h1>
      <p>
        You are signed in as {email}, but your account has not been activated yet.
        An administrator needs to grant you access.
      </p>
      <button type="button" onClick={onSignOut}>
        Sign out
      </button>
    </main>
  )
}
```

This is a dead end by design, not an error. A stranger who requests a magic link
reaches exactly here and sees no data.

- [ ] **Step 6: Wire the four states into App**

Replace `src/App.tsx`:

```tsx
import { supabase } from './lib/supabase'
import { useSession } from './auth/useSession'
import { useProfile } from './auth/useProfile'
import { SignIn } from './auth/SignIn'
import { PendingAccess } from './auth/PendingAccess'

export default function App() {
  const { session, status: sessionStatus } = useSession()
  const { profile, status: profileStatus, error } = useProfile(session)

  if (sessionStatus === 'loading') return <main>Loading…</main>
  if (!session) return <SignIn />
  if (profileStatus === 'loading') return <main>Loading…</main>

  if (profileStatus === 'error') {
    return (
      <main>
        <h1>Cannot reach the database</h1>
        <p role="alert">{error}</p>
        <p>Your data is safe. Try again in a moment.</p>
      </main>
    )
  }

  if (!profile || !profile.is_active) {
    return (
      <PendingAccess
        email={session.user.email ?? 'unknown'}
        onSignOut={() => void supabase.auth.signOut()}
      />
    )
  }

  return (
    <main>
      <h1>TGC Client Health</h1>
      <p>Signed in as {profile.email}</p>
      <button type="button" onClick={() => void supabase.auth.signOut()}>
        Sign out
      </button>
    </main>
  )
}
```

The four states are distinct and named: loading, not signed in, cannot reach the
database, and not permitted. None of them renders as an empty dashboard.

- [ ] **Step 7: Verify end to end, by hand**

```bash
npm run dev
```

Open `http://localhost:5173/tgc-client-health/`, enter your email, open the emailed
link. Expected: the **Access pending** screen, because `is_active` defaults to false.

Then activate yourself and make yourself an admin, in the dashboard SQL editor:

```sql
update public.profiles
set is_active = true, role = 'admin'
where email = 'josh@thegroundedcompany.com';
```

Reload. Expected: the signed-in view showing your email.

This is the moment Slice 0 exists to prove — a real login against a real database.

- [ ] **Step 8: Verify the build still compiles**

```bash
npm run build && npm test
```

Expected: both PASS.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: add magic-link auth with distinct failure states

Loading, signed out, database unreachable, and not-yet-activated are
four separate screens. v1 rendered a failed read as an empty
dashboard, which made it impossible to tell a broken tool from an
empty month."
```

---

### Task 5: Clients, check-ins, and one saved score

**Files:**
- Create: `supabase/migrations/<timestamp>_create_clients_and_checkins.sql`
- Create: `src/lib/score.ts`, `src/lib/score.test.ts`, `src/lib/month.ts`,
  `src/lib/month.test.ts`, `src/board/Board.tsx`
- Modify: `src/App.tsx`, `src/types/database.ts` (regenerated)

**Interfaces:**
- Consumes: `Profile`, `supabase`
- Produces:
  - `public.clients`, `public.checkins`
  - `PILLARS: readonly ['relationship','delivery','financial','sentiment','growth']`
  - `bandFor(total: number | null): 'healthy' | 'watch' | 'at_risk' | 'incomplete'`
  - `totalScore(pillars: Partial<Record<Pillar, number | null>>): number | null`
  - `currentPeriod(): string` — `YYYY-MM-01`
  - `<Board profile={Profile} />`

- [ ] **Step 1: Create the migration file**

```bash
npx supabase@latest migration new create_clients_and_checkins
```

- [ ] **Step 2: Write the migration**

```sql
create table public.clients (
  id bigint generated always as identity primary key,
  name text not null,
  owner_id uuid references public.profiles (id) on delete set null,
  status text not null default 'active'
    check (status in ('active', 'paused', 'cancelled', 'former')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index clients_owner_id_idx on public.clients (owner_id);
create index clients_status_idx on public.clients (status);

create table public.checkins (
  id bigint generated always as identity primary key,
  client_id bigint not null references public.clients (id) on delete cascade,
  -- The first day of the month, as a real date, so Postgres does the
  -- calendar arithmetic instead of string manipulation.
  -- Cast to timestamp explicitly: date_trunc(text, timestamptz) is only
  -- stable, and a check constraint requires an immutable expression.
  period date not null check (period = date_trunc('month', period::timestamp)::date),
  relationship smallint check (relationship between 1 and 5),
  delivery smallint check (delivery between 1 and 5),
  financial smallint check (financial between 1 and 5),
  sentiment smallint check (sentiment between 1 and 5),
  growth smallint check (growth between 1 and 5),
  -- Null when any pillar is unscored: incomplete must never read as low.
  total_score smallint generated always as (
    (relationship + delivery + financial + sentiment + growth)::smallint
  ) stored,
  notes text,
  submitted_by uuid references public.profiles (id) on delete set null,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, period)
);

create index checkins_client_id_idx on public.checkins (client_id);
create index checkins_period_idx on public.checkins (period);
create index checkins_submitted_by_idx on public.checkins (submitted_by);

create trigger clients_touch_updated_at
  before update on public.clients
  for each row execute function private.touch_updated_at();

create trigger checkins_touch_updated_at
  before update on public.checkins
  for each row execute function private.touch_updated_at();

alter table public.clients enable row level security;
alter table public.checkins enable row level security;

grant select, insert, update on public.clients to authenticated;
grant select, insert, update on public.checkins to authenticated;
-- No sequence grants needed: identity columns advance their sequence
-- internally, unlike serial, which does require usage on the sequence.

-- Slice 0 gate: an active account. Task 7 of the Phase 1 plan replaces these
-- with capability checks. The active-account requirement stays.
create function private.is_active_user()
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and is_active
  );
$$;

revoke execute on function private.is_active_user() from public, anon, authenticated;

create policy clients_select_active_users
  on public.clients
  for select
  to authenticated
  using ((select private.is_active_user()));

create policy clients_insert_active_users
  on public.clients
  for insert
  to authenticated
  with check ((select private.is_active_user()));

create policy clients_update_active_users
  on public.clients
  for update
  to authenticated
  using ((select private.is_active_user()))
  with check ((select private.is_active_user()));

create policy checkins_select_active_users
  on public.checkins
  for select
  to authenticated
  using ((select private.is_active_user()));

create policy checkins_insert_active_users
  on public.checkins
  for insert
  to authenticated
  with check ((select private.is_active_user()));

create policy checkins_update_active_users
  on public.checkins
  for update
  to authenticated
  using ((select private.is_active_user()))
  with check ((select private.is_active_user()));
```

- [ ] **Step 3: Apply, check advisors, regenerate types**

```bash
npx supabase@latest db push
npx supabase@latest db advisors
npx supabase@latest gen types typescript --linked > src/types/database.ts
```

Expected: applied, no advisor errors, types now include `clients` and `checkins`.

- [ ] **Step 4: Write the failing tests for scoring and months**

Create `src/lib/score.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { PILLARS, bandFor, totalScore } from './score'

describe('totalScore', () => {
  it('sums all five pillars', () => {
    expect(totalScore({ relationship: 5, delivery: 4, financial: 3, sentiment: 4, growth: 2 })).toBe(18)
  })

  it('returns null when a pillar is missing', () => {
    expect(totalScore({ relationship: 5, delivery: 4, financial: 3, sentiment: 4 })).toBeNull()
  })

  it('returns null when a pillar is explicitly null', () => {
    expect(totalScore({ relationship: 5, delivery: 4, financial: 3, sentiment: 4, growth: null })).toBeNull()
  })

  it('names exactly the five spec pillars in order', () => {
    expect(PILLARS).toEqual(['relationship', 'delivery', 'financial', 'sentiment', 'growth'])
  })
})

describe('bandFor', () => {
  it('bands 18 and above as healthy', () => {
    expect(bandFor(18)).toBe('healthy')
    expect(bandFor(25)).toBe('healthy')
  })

  it('bands 11 to 17 as watch', () => {
    expect(bandFor(11)).toBe('watch')
    expect(bandFor(17)).toBe('watch')
  })

  it('bands 10 and below as at risk', () => {
    expect(bandFor(10)).toBe('at_risk')
    expect(bandFor(5)).toBe('at_risk')
  })

  it('reports an unscored check-in as incomplete, never at risk', () => {
    expect(bandFor(null)).toBe('incomplete')
  })
})
```

Create `src/lib/month.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { addMonths, formatPeriod, periodFor } from './month'

describe('periodFor', () => {
  it('normalises any date to the first of its month', () => {
    expect(periodFor(new Date(2026, 7, 20))).toBe('2026-08-01')
  })

  it('pads single-digit months', () => {
    expect(periodFor(new Date(2026, 0, 5))).toBe('2026-01-01')
  })
})

describe('addMonths', () => {
  it('steps back across a year boundary', () => {
    expect(addMonths('2026-01-01', -1)).toBe('2025-12-01')
  })

  it('steps forward across a year boundary', () => {
    expect(addMonths('2026-12-01', 1)).toBe('2027-01-01')
  })

  it('steps back twelve months to the same month a year earlier', () => {
    expect(addMonths('2026-08-01', -12)).toBe('2025-08-01')
  })
})

describe('formatPeriod', () => {
  it('renders a human label', () => {
    expect(formatPeriod('2026-08-01')).toBe('August 2026')
  })
})
```

- [ ] **Step 5: Run the tests to verify they fail**

```bash
npm test
```

Expected: FAIL — cannot resolve `./score` and `./month`.

- [ ] **Step 6: Implement scoring**

Create `src/lib/score.ts`:

```ts
export const PILLARS = [
  'relationship',
  'delivery',
  'financial',
  'sentiment',
  'growth',
] as const

export type Pillar = (typeof PILLARS)[number]

export type Band = 'healthy' | 'watch' | 'at_risk' | 'incomplete'

export function totalScore(
  pillars: Partial<Record<Pillar, number | null>>,
): number | null {
  let sum = 0
  for (const pillar of PILLARS) {
    const value = pillars[pillar]
    // An incomplete check-in has no score. Treating a missing pillar as
    // zero would report a healthy client as at risk.
    if (value === null || value === undefined) return null
    sum += value
  }
  return sum
}

export function bandFor(total: number | null): Band {
  if (total === null) return 'incomplete'
  if (total >= 18) return 'healthy'
  if (total >= 11) return 'watch'
  return 'at_risk'
}

export const BAND_LABELS: Record<Band, string> = {
  healthy: 'Healthy',
  watch: 'Watch',
  at_risk: 'At risk',
  incomplete: 'Not scored',
}
```

- [ ] **Step 7: Implement month handling**

Create `src/lib/month.ts`:

```ts
// A period is always the first day of a month, formatted YYYY-MM-01, which is
// what the checkins.period date column stores.
export function periodFor(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}-01`
}

export function currentPeriod(): string {
  return periodFor(new Date())
}

export function addMonths(period: string, delta: number): string {
  const [year, month] = period.split('-').map(Number)
  // Constructing from parts lets Date normalise the year rollover for us.
  return periodFor(new Date(year, month - 1 + delta, 1))
}

export function formatPeriod(period: string): string {
  const [year, month] = period.split('-').map(Number)
  return new Date(year, month - 1, 1).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  })
}
```

- [ ] **Step 8: Run the tests to verify they pass**

```bash
npm test
```

Expected: PASS — all cases in both files.

- [ ] **Step 9: Commit the logic**

```bash
git add -A
git commit -m "feat: add clients and checkins tables with scoring logic

total_score is a generated column so it cannot drift from its pillars,
and it is null when any pillar is unscored. bandFor reports that as
'incomplete' rather than 'at risk'."
```

- [ ] **Step 10: Build the minimal board**

Create `src/board/Board.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { BAND_LABELS, PILLARS, bandFor } from '../lib/score'
import { currentPeriod, formatPeriod } from '../lib/month'
import type { Profile } from '../auth/useProfile'

type ClientRow = { id: number; name: string }
type CheckinRow = { client_id: number; total_score: number | null }

type Props = { profile: Profile }

export function Board({ profile }: Props) {
  const [clients, setClients] = useState<ClientRow[] | null>(null)
  const [checkins, setCheckins] = useState<CheckinRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const period = currentPeriod()

  async function load() {
    const clientResult = await supabase
      .from('clients')
      .select('id, name')
      .eq('status', 'active')
      .order('name')

    if (clientResult.error) {
      setError(clientResult.error.message)
      return
    }

    const checkinResult = await supabase
      .from('checkins')
      .select('client_id, total_score')
      .eq('period', period)

    if (checkinResult.error) {
      setError(checkinResult.error.message)
      return
    }

    // Never write after a failed read. Both succeeded, so this is safe.
    setError(null)
    setClients(clientResult.data)
    setCheckins(checkinResult.data)
  }

  useEffect(() => {
    void load()
  }, [period])

  async function scoreAllThrees(clientId: number) {
    setSaving(true)
    const pillars = Object.fromEntries(PILLARS.map((pillar) => [pillar, 3]))
    const { error: saveError } = await supabase.from('checkins').upsert(
      {
        client_id: clientId,
        period,
        ...pillars,
        submitted_by: profile.id,
        submitted_at: new Date().toISOString(),
      },
      { onConflict: 'client_id,period' },
    )
    setSaving(false)
    if (saveError) {
      setError(`Could not save: ${saveError.message}`)
      return
    }
    await load()
  }

  if (error) {
    return (
      <section>
        <h2>Cannot reach the database</h2>
        <p role="alert">{error}</p>
        <button type="button" onClick={() => void load()}>
          Try again
        </button>
      </section>
    )
  }

  if (clients === null) return <p>Loading…</p>

  if (clients.length === 0) {
    return (
      <section>
        <h2>No active clients yet</h2>
        <p>Add one in the Supabase dashboard to see it here.</p>
      </section>
    )
  }

  return (
    <section>
      <h2>{formatPeriod(period)}</h2>
      <ul>
        {clients.map((client) => {
          const checkin = checkins.find((row) => row.client_id === client.id)
          const total = checkin?.total_score ?? null
          const band = bandFor(total)
          return (
            <li key={client.id}>
              <strong>{client.name}</strong>{' '}
              <span>
                {total === null ? '—' : `${total}/25`} · {BAND_LABELS[band]}
              </span>{' '}
              <button
                type="button"
                disabled={saving}
                onClick={() => void scoreAllThrees(client.id)}
              >
                Score all 3s
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
```

The "Score all 3s" button is scaffolding that proves a write reaches Postgres. The
real check-in screen replaces it in Phase 1.

- [ ] **Step 11: Render the board for active users**

In `src/App.tsx`, replace the final signed-in `return` block with:

```tsx
  return (
    <main>
      <h1>TGC Client Health</h1>
      <p>Signed in as {profile.email}</p>
      <button type="button" onClick={() => void supabase.auth.signOut()}>
        Sign out
      </button>
      <Board profile={profile} />
    </main>
  )
```

Add the import: `import { Board } from './board/Board'`

- [ ] **Step 12: Seed one client and verify the round trip**

In the dashboard SQL editor:

```sql
insert into public.clients (name) values ('Test Client');
```

Then:

```bash
npm run dev
```

Click **Score all 3s**. Expected: the row shows `15/25 · Watch`. **Reload the page.**
Expected: still `15/25 · Watch`.

That reload is the whole point of Slice 0 — the data survived the browser.

- [ ] **Step 13: Verify RLS still denies anonymous access to the new tables**

Add to `src/lib/rls.test.ts`, inside the existing `describe.runIf` block:

```ts
  it('returns no client rows to an unauthenticated caller', async () => {
    const { data, error } = await anon.from('clients').select('id')
    expect(error ? [] : data).toEqual([])
  })

  it('returns no checkin rows to an unauthenticated caller', async () => {
    const { data, error } = await anon.from('checkins').select('id')
    expect(error ? [] : data).toEqual([])
  })

  it('refuses an unauthenticated insert', async () => {
    const { error } = await anon.from('clients').insert({ name: 'Should not exist' })
    expect(error).not.toBeNull()
  })
```

```bash
npx vitest run src/lib/rls.test.ts --mode development
```

Expected: PASS. Then confirm nothing was written:

```sql
select count(*) from public.clients where name = 'Should not exist';
```

Expected: `0`.

- [ ] **Step 14: Commit**

```bash
git add -A
git commit -m "feat: read clients and save a score end to end

Proves the round trip: a signed-in user writes a check-in to Postgres
and it survives a reload. Verified anonymous callers can neither read
nor insert."
```

---

### Task 6: Deploy to GitHub Pages with CI

**Files:**
- Create: `.github/workflows/deploy.yml`, `.github/workflows/test.yml`
- Modify: `README.md`

**Interfaces:**
- Consumes: everything above
- Produces: a live URL serving the built app; CI that runs tests on every push

- [ ] **Step 1: Decide the repository visibility**

GitHub Pages on a **private** repository requires a paid GitHub plan. Public is free,
and safe here — no secrets are committed, and all data sits behind Supabase auth.
This is an open item in the spec; confirm with the user before pushing.

- [ ] **Step 2: Create the repository and push**

Without `gh` installed, create it through the web UI at github.com/new, named
`tgc-client-health`, then:

```bash
git remote add origin https://github.com/<user>/tgc-client-health.git
git branch -M main
git push -u origin main
```

- [ ] **Step 3: Add the build secrets**

In the repo under **Settings → Secrets and variables → Actions**, add two
**repository secrets**:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

These are baked into the public bundle at build time, so they are not secret in any
real sense — they live here to keep them out of the source, not to hide them. This is
also precisely why the secret key must never be among them.

- [ ] **Step 4: Write the test workflow**

Create `.github/workflows/test.yml`:

```yaml
name: test

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: lts/*
          cache: npm
      - run: npm ci
      # Excludes rls.test.ts, which needs live project credentials.
      - run: npx vitest run --exclude '**/rls.test.ts'
      - run: npm run build
        env:
          VITE_SUPABASE_URL: ${{ secrets.VITE_SUPABASE_URL }}
          VITE_SUPABASE_PUBLISHABLE_KEY: ${{ secrets.VITE_SUPABASE_PUBLISHABLE_KEY }}
```

- [ ] **Step 5: Write the deploy workflow**

Create `.github/workflows/deploy.yml`:

```yaml
name: deploy

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: lts/*
          cache: npm
      - run: npm ci
      - run: npm run build
        env:
          VITE_SUPABASE_URL: ${{ secrets.VITE_SUPABASE_URL }}
          VITE_SUPABASE_PUBLISHABLE_KEY: ${{ secrets.VITE_SUPABASE_PUBLISHABLE_KEY }}
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 6: Enable Pages**

In the repo under **Settings → Pages**, set **Source** to **GitHub Actions**.

- [ ] **Step 7: Push and watch it deploy**

```bash
git add -A
git commit -m "ci: build, test, and deploy to GitHub Pages"
git push
```

Watch the Actions tab. Expected: both workflows green, and the deploy job printing a
`https://<user>.github.io/tgc-client-health/` URL.

- [ ] **Step 8: Verify the deployed app, and confirm the redirect allowlist**

Open the Pages URL. Expected: the sign-in screen with no console errors.

Confirm `https://<user>.github.io/tgc-client-health/` is in the Supabase
**Authentication → URL Configuration** allowlist from Task 4 Step 1. Then sign in
from the deployed URL and confirm the board loads with the seeded client.

**A magic link that lands on a non-allowlisted URL fails silently** — no error, just
a page that never signs in. If sign-in appears to do nothing, check this first.

- [ ] **Step 9: Write the README**

Replace `README.md`:

```markdown
# TGC Client Health

Monthly client-health check-ins for The Grounded Company's account management team.

**Live:** https://<user>.github.io/tgc-client-health/

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

## Database

Migrations live in `supabase/migrations/` and are applied with the Supabase CLI:

```bash
npx supabase@latest link --project-ref <ref>
npx supabase@latest db push
npx supabase@latest gen types typescript --linked > src/types/database.ts
```

## Security notes

- The browser receives only the **publishable** key. The secret key must never appear
  in a `VITE_` variable — Vite inlines those into the public bundle.
- Row-level security in Postgres is the access boundary, not the UI.
- New accounts are created inactive. An admin activates them.
```

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "docs: document setup, tests, and security constraints"
git push
```

---

## Definition of done

Slice 0 is complete when all of these are true:

- [ ] `npm test` passes, and `npx vitest run src/lib/rls.test.ts --mode development` passes
- [ ] Both GitHub Actions workflows are green
- [ ] The Pages URL serves the app
- [ ] Signing in from the **deployed** URL with a magic link works
- [ ] A new, unactivated account reaches **Access pending** and sees no data
- [ ] Scoring a client persists across a page reload
- [ ] An anonymous caller can neither read nor insert any table
- [ ] `grep -rE 'sb_secret_|service_role' dist/` finds nothing

## What Slice 0 will teach us

Deliberately unresolved here, and answered by doing the work:

1. Whether the project exposes `publishable`/`secret` or legacy `anon`/`service_role`
   keys, which fixes the naming used from here on.
2. The installed Supabase CLI version, which determines whether `db advisors` and
   `db query` exist.
3. Whether free-tier inactivity pausing is a practical nuisance for a monthly-cadence
   tool, and whether a keep-warm ping is worth adding.
4. Real magic-link delivery time and reliability to a Google Workspace address.

The Phase 1 plan should be written after this slice is green, so it can rely on the
answers rather than guessing at them.
