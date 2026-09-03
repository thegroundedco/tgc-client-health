# Slice 6c — Revenue Data Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the per-client-per-month revenue history the Revenue page has been saying it needs, an admin-only entry screen that can reach back six months, and the one report that works from a single month — concentration.

**Architecture:** One new table keyed `(client_id, period)`, two new capabilities in the existing `has_capability` function, pure arithmetic in `revenueMath.ts` and formatting in `money.ts` (the `tenureMath` pattern), a `useRevenue` read seam (the `useTenure` pattern), entry as a third Admin section, and the report on Revenue.

**Tech Stack:** React 19, TypeScript, Vite, CSS Modules, Vitest + Testing Library + jsdom, Supabase JS, Postgres 17.6.

**Spec:** `docs/superpowers/specs/2026-09-03-slice-6c-revenue-data-model-design.md`

## Global Constraints

- **Never write to a live database.** Migration files are authored here; applying them is the owner's job, staging first. No task runs `supabase db push`, `apply_migration`, or `execute_sql`.
- `src/styles/tokens.css` is the only file permitted a colour literal or typeface name. `tests/tokens.test.ts` and `tests/brandLayering.test.ts` enforce it.
- Components may reference SEMANTIC tokens only, never the BRAND layer.
- Every type role a component names must be defined in a global stylesheet. `tests/typeRoles.test.ts` enforces it. The defined roles are `t-display`, `t-score`, `t-header`, `t-subhead`, `t-eyebrow`, `t-body`, `t-caption`, `t-label`.
- Money is **integer cents** everywhere, from the column to the component prop. A number of dollars never exists as a variable.
- **A missing row is not a zero** (spec §3.3). Any total, share or count that treats an absent client-month as `0` is a defect, not a simplification.
- `share()` returns a **fraction in [0, 1]**, never a pre-multiplied percentage.
- `rate()` returns `null` below `MIN_RATE_PERIODS = 13`.
- The migration opens with `revoke all on public.client_month_revenue from anon, authenticated;` before its grants.
- Reuse `src/lib/month.ts` for every period operation. Do not add a second set of month helpers.
- Comments are discursive and name the defect they prevent. Match the density of the file you are editing.
- `npm test`, `npm run lint` and `npm run build` all green before any commit. **`npm test` does not typecheck** — `npm run build` is the only thing that runs `tsc`.
- Commits are lowercase, specific, and say why rather than what. Stage explicit paths; never `git commit -a`.

---

### Task 1: The migration, the capability map, and the drift guard

**Files:**
- Create: `supabase/migrations/20260903120000_revenue_capabilities.sql`
- Modify: `src/lib/capabilities.ts:31` (the `Capability` union), `:38-43` (`CAPABILITIES`), `:45-49` (`ROLE_CAPABILITIES`)
- Modify: `tests/capabilities.test.ts:17-21` (the `migration()` helper), `:41-51` (the count assertion)
- Test: `tests/capabilities.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `Capability` gains `'view_revenue' | 'edit_revenue'`. `CAPABILITIES` has six entries. `can(role, 'view_revenue')` is true for `admin` and `account_manager`; `can(role, 'edit_revenue')` is true for `admin` only.

**There is a trap in this task and it is the reason it comes first.** `tests/capabilities.test.ts` reads the role presets out of the migration whose filename ends `_has_capability.sql`, and its `migration()` helper asserts `toHaveLength(1)`. This task replaces the function body, so:

- Naming the new migration `*_has_capability.sql` makes that assertion fail — two matches.
- Naming it anything else leaves the guard reading the **old** file, which still lists four capabilities, so it compares six against four and fails.

Either way the guard goes red, which is correct — it is doing its job. The fix is to make `migration()` read the **newest** match rather than requiring exactly one, because migrations are timestamp-prefixed and the last one applied is the current definition.

- [ ] **Step 1: Change the drift guard to read the newest matching migration**

In `tests/capabilities.test.ts`, replace the `migration()` helper:

```ts
// The NEWEST migration matching the suffix, not the only one. Migrations are
// timestamp-prefixed, so a lexicographic sort puts the most recent last, and
// the most recent definition of a thing is the one the database is running.
//
// This used to assert there was exactly one match, which was true until a
// second migration replaced private.has_capability. That assertion would have
// forced the choice between a filename that breaks the count and a filename
// that leaves this test reading a superseded definition -- reporting the
// capabilities of last week's database as though they were today's.
function migration(suffix: string): string {
  const names = readdirSync(MIGRATIONS).filter((name) => name.endsWith(suffix)).toSorted()
  expect(names, `migrations ending in ${suffix}`).not.toHaveLength(0)
  return readFileSync(`${MIGRATIONS}/${names.at(-1)}`, 'utf8')
}
```

- [ ] **Step 2: Update the count assertion to six**

Replace the body of `it('offers exactly the four Phase 1 capabilities')`, renaming it:

```ts
  it('offers exactly the six capabilities the model defines', () => {
    // The count as well as the membership. Phase 1 had four; slice 6c adds the
    // revenue pair. A seventh added without thought would pass a
    // membership-only check.
    expect([...CAPABILITIES].toSorted()).toEqual([
      'edit_revenue',
      'edit_scores',
      'manage_clients',
      'manage_users',
      'view_revenue',
      'view_scores',
    ])
  })
```

- [ ] **Step 3: Run the guard and watch it fail for the right reason**

Run: `npx vitest run tests/capabilities.test.ts`
Expected: FAIL. The count assertion fails because `CAPABILITIES` still holds four, and the per-role comparisons fail because `capabilities.ts` and the migration disagree. Read the output and confirm the failures name the capability sets — not a missing file, which would mean Step 1 broke the helper.

- [ ] **Step 4: Write the migration**

Create `supabase/migrations/20260903120000_revenue_capabilities.sql`:

```sql
-- Slice 6c. The revenue history the Revenue page has been saying it needs, plus
-- the two capabilities that gate it.
--
-- ORDER IS LOAD-BEARING: the function is replaced BEFORE the policies that name
-- the new capabilities are created. A policy referencing a capability the
-- function does not know would not error -- has_capability simply returns false
-- -- so the failure would be a table nobody can read, discovered by a person
-- rather than by Postgres.

----------------------------------------------------------------------------
-- 1. The capability function, replaced
----------------------------------------------------------------------------

-- create or replace, not drop and create: the three policies from
-- 20260824160306_has_capability.sql store this function by OID and would be
-- dropped with it. Replacing keeps the OID and every existing policy intact.
--
-- The signature, the security definer, the empty search_path and the grants are
-- unchanged and are not restated -- replace preserves them. The reasoning for
-- each is in 20260824160306_has_capability.sql and has not changed.
--
-- account_manager gets view_revenue but NOT edit_revenue. That is the first
-- capability in this model where a non-viewer role reads without writing, and
-- it is the owner's decision of 2026-09-03: admins edit, account managers view,
-- viewers see no revenue at all.
create or replace function private.has_capability(wanted text)
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
            'view_scores', 'edit_scores', 'manage_clients', 'manage_users',
            'view_revenue', 'edit_revenue']
          when 'account_manager' then array[
            'view_scores', 'edit_scores', 'manage_clients',
            'view_revenue']
          when 'viewer' then array[
            'view_scores']
          else array[]::text[]
        end
      )
  );
$$;

----------------------------------------------------------------------------
-- 2. The table
----------------------------------------------------------------------------

create table public.client_month_revenue (
  client_id       bigint  not null references public.clients(id) on delete restrict,
  period          date    not null check (period = date_trunc('month', period)::date),
  retainer_cents  integer not null default 0 check (retainer_cents >= 0),
  project_cents   integer not null default 0 check (project_cents >= 0),
  entered_by      uuid    references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (client_id, period)
);

-- on delete RESTRICT, deliberately unlike checkins.client_id, which cascades.
-- Deleting a client there destroys its check-in history silently and the newest
-- backup is up to a day old. Financial history must refuse rather than vanish:
-- the delete fails loudly and the operator sets status = 'former' instead,
-- which is the reversible action they wanted anyway. A reviewer should not
-- "fix" this to match its neighbour.
comment on constraint client_month_revenue_client_id_fkey on public.client_month_revenue is
  'restrict, not cascade: revenue history refuses to vanish with a deleted client.';

-- Integer CENTS. 4000.10 has no exact binary floating-point representation, and
-- a retention figure summed from a hundred such values drifts invisibly until
-- somebody reconciles against an invoice. integer not bigint: the ceiling is
-- $21,474,836.47 per client-month, four orders of magnitude above anything this
-- agency bills -- naming a limit that cannot be reached is how a reader learns
-- the unit is cents.
comment on column public.client_month_revenue.retainer_cents is
  'Recurring monthly amount, in CENTS. Retention math reads this one.';
comment on column public.client_month_revenue.project_cents is
  'Variable project or overage billing for this month, in CENTS. Real revenue, but not expected to repeat.';

-- The existence of a row is data. A row with project_cents = 0 means "entered;
-- billed nothing". No row at all means "nobody has said yet". Collapsing those
-- makes an unfilled month read as a client billing nothing, which on a page
-- measuring churn reads as churn. Same rule as checkins.legacy_total_score
-- being null whenever a pillar is null.
comment on table public.client_month_revenue is
  'One row per client per month. A MISSING ROW IS NOT A ZERO: absent means unentered, not unbilled.';

----------------------------------------------------------------------------
-- 3. Privileges
----------------------------------------------------------------------------

-- Before the grants, per the standing rule for every new table in public: on
-- this project a new table can be born writable by anon and authenticated, and
-- the fixing migration for the original project ran before either of the
-- current ones could be inspected.
revoke all on public.client_month_revenue from anon, authenticated;
grant select, insert, update on public.client_month_revenue to authenticated;

alter table public.client_month_revenue enable row level security;

-- Three policies, not four. There is no delete policy and that is the intent:
-- removing a month is not an operation the screen offers, and a month entered
-- in error is corrected by editing it. With no policy, delete is refused for
-- everyone -- the desired behaviour, needing no additional machinery.
create policy client_month_revenue_select_view_revenue
  on public.client_month_revenue
  for select
  to authenticated
  using ((select private.has_capability('view_revenue')));

create policy client_month_revenue_insert_edit_revenue
  on public.client_month_revenue
  for insert
  to authenticated
  with check ((select private.has_capability('edit_revenue')));

-- An update needs a select policy too, or the row is invisible to the statement
-- and the update silently affects nothing. The select policy above is what
-- makes this reachable -- and note it gates on view_revenue, which an account
-- manager holds, so the SELECT half succeeds for them and the update half does
-- not. That asymmetry is the point.
create policy client_month_revenue_update_edit_revenue
  on public.client_month_revenue
  for update
  to authenticated
  using ((select private.has_capability('edit_revenue')))
  with check ((select private.has_capability('edit_revenue')));
```

- [ ] **Step 5: Update the capability map**

In `src/lib/capabilities.ts`:

```ts
export type Capability =
  | 'view_scores'
  | 'edit_scores'
  | 'manage_clients'
  | 'manage_users'
  | 'view_revenue'
  | 'edit_revenue'

// Phase 1's four plus slice 6c's revenue pair. Exported so the test can assert
// the count, not only the membership: a seventh capability is a change to the
// permission model and should have to be made in more than one place.
export const CAPABILITIES: readonly Capability[] = [
  'view_scores',
  'edit_scores',
  'manage_clients',
  'manage_users',
  'view_revenue',
  'edit_revenue',
]

// account_manager reads revenue and does not write it -- the first capability
// in this model where a role that is not `viewer` views without editing. Owner's
// decision, 2026-09-03.
export const ROLE_CAPABILITIES: Record<Role, readonly Capability[]> = {
  admin: [
    'view_scores',
    'edit_scores',
    'manage_clients',
    'manage_users',
    'view_revenue',
    'edit_revenue',
  ],
  account_manager: ['view_scores', 'edit_scores', 'manage_clients', 'view_revenue'],
  viewer: ['view_scores'],
}
```

- [ ] **Step 6: Add the read-without-write assertion**

Append to the `describe('the role presets')` block in `tests/capabilities.test.ts`:

```ts
  it('lets an account manager read revenue and refuses them the write', () => {
    // The asymmetry slice 6c introduces, and the one a careless test misses by
    // checking only the admin path. If these ever agree, either the screen is
    // showing an AM an entry control it will refuse, or admins have lost the
    // ability to enter revenue -- and nothing else in this suite would say so.
    expect(can('account_manager', 'view_revenue')).toBe(true)
    expect(can('account_manager', 'edit_revenue')).toBe(false)
    expect(can('admin', 'edit_revenue')).toBe(true)
    expect(can('viewer', 'view_revenue')).toBe(false)
  })
```

- [ ] **Step 7: Run the guard and watch it pass**

Run: `npx vitest run tests/capabilities.test.ts`
Expected: PASS, all assertions. The per-role comparison now reads the new migration and matches `capabilities.ts`.

- [ ] **Step 8: Prove the drift guard still catches drift**

Temporarily delete `'view_revenue'` from the `account_manager` arm of the CASE in the new migration. Run `npx vitest run tests/capabilities.test.ts` and confirm it FAILS. Restore the line exactly and re-run to confirm it passes. Record both outputs in your report — a guard nobody has seen fail is a guard nobody has tested.

- [ ] **Step 9: Check whether the deployed-model verifier needs the new arms**

Read `scripts/verify-capability.sql`. If it enumerates capabilities or role presets, add the revenue pair the same way, keeping its existing shape. If it only evaluates the deployed CASE against role names, it needs no change. Say which in your report.

- [ ] **Step 10: Full suite, lint, build, commit**

```bash
npm test && npm run lint && npm run build
git add supabase/migrations/20260903120000_revenue_capabilities.sql src/lib/capabilities.ts tests/capabilities.test.ts
git commit -m "revenue: the client_month_revenue table and the two capabilities that gate it"
```

If `scripts/verify-capability.sql` changed, stage it too.

---

### Task 2: Money formatting

**Files:**
- Create: `src/revenue/money.ts`, `src/revenue/money.test.ts`
- Test: `src/revenue/money.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `formatMoney(cents: number): string`, `parseMoney(input: string): number | null`, `MAX_CENTS: number`.

Its own module with its own tests, the way `tenureMath` is. Formatting logic inside a component is where nobody looks for a trap.

- [ ] **Step 1: Write the failing tests**

Create `src/revenue/money.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { formatMoney, parseMoney, MAX_CENTS } from './money'

describe('formatMoney', () => {
  it('renders whole dollars without a decimal tail', () => {
    // The overwhelmingly common case at this agency: retainers are round
    // numbers. "$4,000.00" is noise on a screen where every figure ends .00.
    expect(formatMoney(400000)).toBe('$4,000')
  })

  it('renders cents when there are any', () => {
    expect(formatMoney(400010)).toBe('$4,000.10')
    expect(formatMoney(1)).toBe('$0.01')
  })

  it('renders zero as a dollar amount, not as a dash', () => {
    // An entered zero is a fact -- "billed nothing this month" -- and must look
    // like a number. A dash is what an ABSENT row renders as, and the whole
    // slice depends on those two never looking the same.
    expect(formatMoney(0)).toBe('$0')
  })

  it('groups thousands', () => {
    expect(formatMoney(123456789)).toBe('$1,234,567.89')
  })
})

describe('parseMoney', () => {
  it('reads a plain number of dollars', () => {
    expect(parseMoney('4000')).toBe(400000)
  })

  it('reads what a person actually types', () => {
    // Every one of these has been typed into a money field by somebody.
    expect(parseMoney('$4,000')).toBe(400000)
    expect(parseMoney(' 4000 ')).toBe(400000)
    expect(parseMoney('4,000.10')).toBe(400010)
    expect(parseMoney('4000.1')).toBe(400010)
  })

  it('reads an empty field as zero, not as a refusal', () => {
    // The grid pre-fills nothing. A blank project-work field means zero, and
    // making the person type 0 in ten rows to save a month is a worse tool.
    expect(parseMoney('')).toBe(0)
    expect(parseMoney('   ')).toBe(0)
  })

  it('refuses what is not a number', () => {
    expect(parseMoney('four thousand')).toBe(null)
    expect(parseMoney('4000abc')).toBe(null)
    expect(parseMoney('--4000')).toBe(null)
  })

  it('refuses a negative amount', () => {
    // The column has a check constraint. Refusing here means the person sees
    // why in the field rather than as a failed save of the whole month.
    expect(parseMoney('-4000')).toBe(null)
  })

  it('refuses more than the column can hold', () => {
    // integer cents tops out at 2147483647. A value past it would be accepted
    // by the browser, sent, and rejected by Postgres as a numeric overflow --
    // an error message about int4 range, on a screen about a retainer.
    expect(MAX_CENTS).toBe(2147483647)
    expect(parseMoney('21474836.47')).toBe(MAX_CENTS)
    expect(parseMoney('21474836.48')).toBe(null)
  })

  it('refuses a fraction of a cent rather than rounding it away', () => {
    // 0.005 dollars is half a cent. Rounding silently turns a typo into a
    // number the person never entered; refusing shows them the field.
    expect(parseMoney('4000.005')).toBe(null)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/revenue/money.test.ts`
Expected: FAIL — `Failed to resolve import "./money"`.

- [ ] **Step 3: Write the implementation**

Create `src/revenue/money.ts`:

```ts
// Money, in cents, everywhere. A number of dollars never exists as a variable
// in this codebase -- it exists as a string a person typed and as a string a
// person reads, and both conversions happen here.
//
// Its own module rather than a helper inside the grid, for the same reason
// tenureMath is not inside Tenure.tsx: the traps here are invisible until a
// value is unusual, and a component is not where anybody looks for them.

// The ceiling of a Postgres `integer` column, in cents: $21,474,836.47. A value
// past it is accepted by the browser, sent, and rejected by the database as an
// int4 overflow -- surfacing as an error about numeric range on a screen about
// a retainer. Refused here instead, where the field can say so.
export const MAX_CENTS = 2147483647

export function formatMoney(cents: number): string {
  const dollars = cents / 100
  // Whole dollars lose the .00 tail. Retainers here are round numbers, and a
  // column where every figure ends in .00 spends two characters per row saying
  // nothing. A figure WITH cents keeps both digits, because dropping them there
  // would round a real amount on screen.
  const hasCents = cents % 100 !== 0
  return dollars.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: hasCents ? 2 : 0,
  })
}

// Null means "this is not a number I will accept", and the caller shows the
// person their field. It never means zero: an empty field IS zero, deliberately,
// so that saving a month does not require typing 0 into every row with no
// project work.
export function parseMoney(input: string): number | null {
  const trimmed = input.trim()
  if (trimmed === '') return 0

  // Strip what people type around a number, not inside it. Commas and a leading
  // dollar sign are formatting; anything else left over is a refusal below.
  const stripped = trimmed.replace(/^\$/, '').replace(/,/g, '')

  // Anchored, and no sign accepted: the column is `>= 0`, so a negative is
  // refused here rather than at the database. Up to two decimal places, because
  // a third is a fraction of a cent -- rounding it would turn a typo into a
  // number the person never entered.
  if (!/^\d+(\.\d{1,2})?$/.test(stripped)) return null

  // Rounded, not truncated, and via a string-free path: 4000.10 * 100 is
  // 400009.99999999994 in IEEE 754, which truncation would turn into $4,000.09.
  const cents = Math.round(Number(stripped) * 100)
  if (!Number.isFinite(cents) || cents > MAX_CENTS) return null
  return cents
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/revenue/money.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Prove the float trap test is real**

Change the last line of `parseMoney` to `Math.trunc(Number(stripped) * 100)` and run the file. The `'4,000.10'` and `'4000.1'` assertions must FAIL with `400009` — the exact bug the comment describes. Restore `Math.round` and re-run. Put both outputs in your report.

- [ ] **Step 6: Full suite, lint, build, commit**

```bash
npm test && npm run lint && npm run build
git add src/revenue/money.ts src/revenue/money.test.ts
git commit -m "revenue: cents in, dollars out, and the rounding trap between them"
```

---

### Task 3: The arithmetic — shares, rates, and concentration

**Files:**
- Create: `src/revenue/revenueMath.ts`, `src/revenue/revenueMath.test.ts`
- Test: `src/revenue/revenueMath.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type RevenueRow = { client_id: number; period: string; retainer_cents: number; project_cents: number }`
  - `type EligibleClient = { id: number; name: string }`
  - `type ConcentrationEntry = { clientId: number; name: string; cents: number; share: number | null }`
  - `type ConcentrationReport = { named: ConcentrationEntry[]; rest: { count: number; cents: number; share: number | null } | null; totalCents: number; entered: number; missing: number }`
  - `share(part: number, whole: number): number | null`
  - `rate(periods: readonly number[]): number | null`
  - `MIN_RATE_PERIODS: 13`, `NAMED_CLIENTS: 4`
  - `concentration(clients: readonly EligibleClient[], rows: readonly RevenueRow[]): ConcentrationReport`

`revenueMath.ts` and not `revenue.ts`: `Revenue.tsx` already exists in `src/shell/`, and on macOS a case-only difference resolves to the wrong file. `matrixMath.ts` and `tenureMath.ts` carry their names for exactly this reason.

- [ ] **Step 1: Write the failing tests**

Create `src/revenue/revenueMath.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  concentration,
  MIN_RATE_PERIODS,
  NAMED_CLIENTS,
  rate,
  share,
  type EligibleClient,
  type RevenueRow,
} from './revenueMath'

const CLIENTS: EligibleClient[] = [
  { id: 1, name: 'Acme' },
  { id: 2, name: 'Delta' },
  { id: 3, name: 'East Bay' },
  { id: 4, name: 'Northgate' },
  { id: 5, name: 'Harbor Row' },
  { id: 6, name: 'Ivy Lane' },
]

function row(client_id: number, retainer_cents: number, project_cents = 0): RevenueRow {
  return { client_id, period: '2026-09-01', retainer_cents, project_cents }
}

describe('share', () => {
  it('returns a fraction, never a pre-multiplied percentage', () => {
    // 22, returned from a function called `share`, is one rename away from
    // being read as dollars. The caller multiplies; this does not.
    expect(share(2200, 10000)).toBe(0.22)
  })

  it('returns null when the whole is zero rather than dividing by it', () => {
    // A real state: a month where nothing was billed. Not an error, and not
    // NaN, which would render as the literal text "NaN%".
    expect(share(0, 0)).toBe(null)
  })
})

describe('rate', () => {
  it('names the threshold as thirteen', () => {
    // A trailing-twelve figure needs a month AND the month twelve behind it.
    expect(MIN_RATE_PERIODS).toBe(13)
  })

  it('refuses to produce a number below the threshold', () => {
    // THE guard for spec section 9. A page-level regex cannot tell a true 22%
    // from a meaningless 91.2%; a function that will not produce the second
    // one can. Six months is exactly what the owner can backfill, so this is
    // the live case and not a hypothetical.
    expect(rate(Array(6).fill(400000))).toBe(null)
    expect(rate(Array(12).fill(400000))).toBe(null)
  })

  it('produces a figure at the threshold', () => {
    const flat = Array(MIN_RATE_PERIODS).fill(400000)
    expect(rate(flat)).toBe(1)
  })

  it('measures the last period against the first', () => {
    const periods = Array(MIN_RATE_PERIODS).fill(400000)
    periods[MIN_RATE_PERIODS - 1] = 200000
    expect(rate(periods)).toBe(0.5)
  })

  it('returns null when the earliest period is zero rather than dividing by it', () => {
    const periods = Array(MIN_RATE_PERIODS).fill(400000)
    periods[0] = 0
    expect(rate(periods)).toBe(null)
  })
})

describe('concentration', () => {
  it('names the cap as four', () => {
    expect(NAMED_CLIENTS).toBe(4)
  })

  it('ranks clients by total, largest first', () => {
    const result = concentration(CLIENTS.slice(0, 3), [
      row(1, 400000),
      row(2, 250000),
      row(3, 600000),
    ])

    expect(result.named.map((entry) => entry.name)).toEqual(['East Bay', 'Acme', 'Delta'])
    expect(result.totalCents).toBe(1250000)
  })

  it('counts project work toward the total', () => {
    const result = concentration(CLIENTS.slice(0, 1), [row(1, 400000, 220000)])

    expect(result.named[0].cents).toBe(620000)
    expect(result.totalCents).toBe(620000)
  })

  it('collapses everything past the fourth into one rest row', () => {
    const result = concentration(CLIENTS, [
      row(1, 600000),
      row(2, 500000),
      row(3, 400000),
      row(4, 300000),
      row(5, 200000),
      row(6, 100000),
    ])

    expect(result.named).toHaveLength(NAMED_CLIENTS)
    expect(result.rest).not.toBe(null)
    expect(result.rest!.count).toBe(2)
    expect(result.rest!.cents).toBe(300000)
  })

  it('has no rest row when everyone is named', () => {
    // Not a rest row reading "0 others", which is a sentence about nothing.
    const result = concentration(CLIENTS.slice(0, 3), [
      row(1, 400000),
      row(2, 250000),
      row(3, 600000),
    ])

    expect(result.rest).toBe(null)
  })

  it('EXCLUDES a client with no row, and says how many it excluded', () => {
    // Spec section 3.3, and the assertion this whole slice rests on. Three
    // clients are eligible for the month; one has not been entered. The total
    // must be the two that WERE entered, and `missing` must say so out loud --
    // a chart that silently omits an unentered client overstates every share
    // it draws.
    const result = concentration(CLIENTS.slice(0, 3), [row(1, 400000), row(2, 600000)])

    expect(result.totalCents).toBe(1000000)
    expect(result.entered).toBe(2)
    expect(result.missing).toBe(1)
    expect(result.named.map((entry) => entry.name)).toEqual(['Delta', 'Acme'])
    expect(result.named.some((entry) => entry.name === 'East Bay')).toBe(false)
  })

  it('keeps an entered zero, which is not the same as an absent row', () => {
    // The other half of the rule. Delta was entered and billed nothing: it
    // appears, at zero, and does NOT count toward `missing`.
    const result = concentration(CLIENTS.slice(0, 2), [row(1, 400000), row(2, 0)])

    expect(result.entered).toBe(2)
    expect(result.missing).toBe(0)
    expect(result.named.map((entry) => entry.name)).toEqual(['Acme', 'Delta'])
    expect(result.named[1].cents).toBe(0)
  })

  it('gives every share as a fraction of the entered total', () => {
    const result = concentration(CLIENTS.slice(0, 2), [row(1, 750000), row(2, 250000)])

    expect(result.named[0].share).toBe(0.75)
    expect(result.named[1].share).toBe(0.25)
  })

  it('reports a month nobody has entered as empty rather than as zeroes', () => {
    const result = concentration(CLIENTS.slice(0, 3), [])

    expect(result.named).toEqual([])
    expect(result.rest).toBe(null)
    expect(result.totalCents).toBe(0)
    expect(result.entered).toBe(0)
    expect(result.missing).toBe(3)
  })

  it('ignores a row for a client not eligible this month', () => {
    // A row can outlive eligibility: a client entered in August and departed
    // before September still has an August row. Concentration renders the
    // month's eligible roster, so a stray row must not conjure a nameless
    // entry -- which is what a row-driven implementation would do.
    const result = concentration(CLIENTS.slice(0, 1), [row(1, 400000), row(99, 900000)])

    expect(result.totalCents).toBe(400000)
    expect(result.named).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/revenue/revenueMath.test.ts`
Expected: FAIL — `Failed to resolve import "./revenueMath"`.

- [ ] **Step 3: Write the implementation**

Create `src/revenue/revenueMath.ts`:

```ts
// The arithmetic behind the Revenue page. Pure, and separate from the
// components, so the rules below are testable without a DOM -- the same split
// as matrixMath.ts and tenureMath.ts.
//
// Named revenueMath and not revenue: src/shell/Revenue.tsx exists, and on a
// case-insensitive filesystem `./revenue` and `./Revenue` are the same path.
// Both neighbouring modules carry their names for that bug.

export type RevenueRow = {
  client_id: number
  period: string
  retainer_cents: number
  project_cents: number
}

// Only what concentration needs. Its own shape rather than the admin screen's
// client type: a report should not silently start depending on a column because
// an editing screen added one. useTenure's comment makes the same argument.
export type EligibleClient = { id: number; name: string }

export type ConcentrationEntry = {
  clientId: number
  name: string
  cents: number
  share: number | null
}

// Named ConcentrationReport, not Concentration: the component that renders it
// is Concentration.tsx and exports `function Concentration`, and a module
// cannot import a type whose name its own export shadows.
export type ConcentrationReport = {
  named: ConcentrationEntry[]
  rest: { count: number; cents: number; share: number | null } | null
  totalCents: number
  // Eligible clients WITH a row this month, and eligible clients WITHOUT one.
  // `missing` is rendered, not merely counted: see the note on the rule below.
  entered: number
  missing: number
}

// Four named, the rest collapsed. Four because that is where this roster stops
// being interesting, and because ten bars rank clients without showing
// exposure -- the question concentration exists to answer.
export const NAMED_CLIENTS = 4

// A trailing-twelve figure needs a month and the month twelve behind it.
export const MIN_RATE_PERIODS = 13

// A share of one complete period, as a fraction in [0, 1]. Never
// pre-multiplied: a function called `share` that returns 22 is one rename away
// from being read as dollars, and the caller that formats it is the caller that
// knows whether it wants a percentage or a bar width.
//
// Null when the whole is zero -- a real state, a month where nothing was
// billed -- rather than NaN, which renders as the literal text "NaN%".
export function share(part: number, whole: number): number | null {
  if (whole === 0) return null
  return part / whole
}

// A rate across periods, oldest first. Null -- not a number -- until there are
// enough periods for it to mean anything.
//
// THIS IS THE ENFORCEMENT for spec section 9's amendment. Slice 6b forbade any
// percentage on the Revenue page with a regex over the rendered output, which
// was the right instinct and the wrong mechanism: a regex cannot tell a true
// "22% of September" from a meaningless "91.2% GRR". A function that refuses to
// produce the second one can. Nothing calls this yet -- no rate ships in slice
// 6c -- and it exists anyway, because removing the old guard without putting
// this one in place in the same change would leave a window with neither.
export function rate(periods: readonly number[]): number | null {
  if (periods.length < MIN_RATE_PERIODS) return null
  const first = periods[0]
  if (first === 0) return null
  return periods[periods.length - 1] / first
}

export function concentration(
  clients: readonly EligibleClient[],
  rows: readonly RevenueRow[],
): ConcentrationReport {
  const byClient = new Map(rows.map((entry) => [entry.client_id, entry]))

  // Driven by the ELIGIBLE ROSTER, not by the rows. Two consequences, both
  // deliberate:
  //
  // 1. A client with no row is absent from the chart and counted in `missing`.
  //    A row with 0 means "entered; billed nothing" and appears at zero; no row
  //    means "nobody has said yet". If those collapse, an unfilled month reads
  //    as a client billing nothing, which on this page reads as churn. Spec
  //    section 3.3, and the same rule as checkins.legacy_total_score being null
  //    whenever a pillar is null.
  //
  // 2. A row whose client is not eligible this month is ignored rather than
  //    rendered nameless. Rows outlive eligibility -- a client who departed in
  //    August still has an August row -- and a row-driven loop would invent an
  //    entry for one.
  const entered: ConcentrationEntry[] = []
  let missing = 0

  for (const client of clients) {
    const found = byClient.get(client.id)
    if (found === undefined) {
      missing += 1
      continue
    }
    entered.push({
      clientId: client.id,
      name: client.name,
      cents: found.retainer_cents + found.project_cents,
      share: null,
    })
  }

  // Descending by amount, then by name so the order is stable when two clients
  // bill the same -- without it, two equal rows swap places between renders for
  // no reason the reader can see.
  entered.sort((left, right) => right.cents - left.cents || left.name.localeCompare(right.name))

  const totalCents = entered.reduce((sum, item) => sum + item.cents, 0)
  const withShares = entered.map((item) => ({ ...item, share: share(item.cents, totalCents) }))

  const named = withShares.slice(0, NAMED_CLIENTS)
  const remainder = withShares.slice(NAMED_CLIENTS)

  // Null rather than a zero-count rest row: "and 0 others" is a sentence about
  // nothing, and drawing it makes a complete list look truncated.
  const rest =
    remainder.length === 0
      ? null
      : {
          count: remainder.length,
          cents: remainder.reduce((sum, item) => sum + item.cents, 0),
          share: share(
            remainder.reduce((sum, item) => sum + item.cents, 0),
            totalCents,
          ),
        }

  return { named, rest, totalCents, entered: withShares.length, missing }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/revenue/revenueMath.test.ts`
Expected: PASS, 16 tests.

- [ ] **Step 5: Prove the missing-row rule is actually enforced**

This is the mutation the whole slice depends on. In `concentration`, replace the `if (found === undefined)` branch with one that pushes a zero entry instead of counting it missing:

```ts
    if (found === undefined) {
      entered.push({ clientId: client.id, name: client.name, cents: 0, share: null })
      continue
    }
```

Run: `npx vitest run src/revenue/revenueMath.test.ts`
Expected: FAIL on `EXCLUDES a client with no row, and says how many it excluded` — `missing` is 0 and `East Bay` is present. **If it does not fail, the test is not testing the rule and must be rewritten before you continue.** Restore exactly and re-run. Put both outputs in your report.

- [ ] **Step 6: Prove the rate threshold is enforced**

Change `MIN_RATE_PERIODS` to `2`. Run the file and confirm `refuses to produce a number below the threshold` FAILS. Restore to `13`, re-run, and report both.

- [ ] **Step 7: Full suite, lint, build, commit**

```bash
npm test && npm run lint && npm run build
git add src/revenue/revenueMath.ts src/revenue/revenueMath.test.ts
git commit -m "revenue: shares that are exact, rates that refuse, and a missing row that stays missing"
```

---

### Task 4: The read seam

**Files:**
- Create: `src/revenue/useRevenue.ts`, `src/revenue/useRevenue.dom.test.ts`
- Test: `src/revenue/useRevenue.dom.test.ts`

**Interfaces:**
- Consumes: `RevenueRow`, `EligibleClient` from `./revenueMath`.
- Produces: `useRevenue(period: string): UseRevenue` where
  `type UseRevenue = { status: 'loading' | 'ready' | 'error'; loadError: string | null; clients: EligibleClient[]; rows: RevenueRow[]; reload: () => void }`.

Two reads, because both are needed to tell an absent row from a zero one: the eligible roster for the month, and whatever revenue rows exist for it. A single joined query returns only clients that have rows, which is exactly the information this slice must not lose.

Model it on `src/revenue/useTenure.ts` — same cancellation flag, same "report the error and leave the list alone" branch, same `describeError`.

- [ ] **Step 1: Write the failing tests**

Create `src/revenue/useRevenue.dom.test.ts`. Read `src/revenue/useTenure.dom.test.ts` first and mirror its mocking of `../lib/supabase`; the shape below assumes the same approach.

```ts
// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/supabase', () => ({ supabase: { from: vi.fn() } }))

import { supabase } from '../lib/supabase'
import { useRevenue } from './useRevenue'

const CLIENT = { id: 1, name: 'Acme' }
const ROW = { client_id: 1, period: '2026-09-01', retainer_cents: 400000, project_cents: 0 }

// Two tables, two answers. The queue is keyed by table name rather than by call
// order, so a test does not silently pass because the hook happened to read
// them in the order the fixture listed.
function given(answers: Record<string, { data: unknown; error: unknown }>) {
  vi.mocked(supabase.from).mockImplementation((table: string) => {
    const answer = answers[table] ?? { data: [], error: null }
    const chain = {
      select: () => chain,
      eq: () => chain,
      or: () => chain,
      order: () => Promise.resolve(answer),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(answer).then(resolve),
    }
    return chain as never
  })
}

afterEach(() => vi.mocked(supabase.from).mockReset())

describe('useRevenue', () => {
  it('reports both reads landing as ready', async () => {
    given({
      clients: { data: [CLIENT], error: null },
      client_month_revenue: { data: [ROW], error: null },
    })

    const { result } = renderHook(() => useRevenue('2026-09-01'))

    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.clients).toEqual([CLIENT])
    expect(result.current.rows).toEqual([ROW])
    expect(result.current.loadError).toBe(null)
  })

  it('reports a failed roster read as an error, not as an empty month', async () => {
    // The defect this project keeps guarding against: a broken tool looking
    // like an empty one. An empty roster on this screen reads as "no clients".
    given({
      clients: { data: null, error: { message: 'permission denied' } },
      client_month_revenue: { data: [ROW], error: null },
    })

    const { result } = renderHook(() => useRevenue('2026-09-01'))

    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.loadError).toContain('permission denied')
  })

  it('reports a failed revenue read as an error rather than as an unentered month', async () => {
    // Worse than the roster case and the reason it gets its own test: an empty
    // rows array is INDISTINGUISHABLE from a month nobody has entered, and
    // concentration would render "10 clients unaccounted for" as though that
    // were a fact about the data rather than about the network.
    given({
      clients: { data: [CLIENT], error: null },
      client_month_revenue: { data: null, error: { message: 'permission denied' } },
    })

    const { result } = renderHook(() => useRevenue('2026-09-01'))

    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.rows).toEqual([])
  })

  it('leaves the previously-loaded month in place when a reload fails', async () => {
    // Distinguishes "left alone" from "wiped" by loading successfully FIRST.
    // Comparing against [] would also match the initial state and prove
    // nothing -- the exact hole a review found in useTenure.
    given({
      clients: { data: [CLIENT], error: null },
      client_month_revenue: { data: [ROW], error: null },
    })

    const { result } = renderHook(() => useRevenue('2026-09-01'))
    await waitFor(() => expect(result.current.status).toBe('ready'))

    given({
      clients: { data: [CLIENT], error: null },
      client_month_revenue: { data: null, error: { message: 'gone' } },
    })
    act(() => result.current.reload())

    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.rows).toEqual([ROW])
  })

  it('re-reads when the period changes', async () => {
    given({
      clients: { data: [CLIENT], error: null },
      client_month_revenue: { data: [ROW], error: null },
    })

    const { rerender } = renderHook(({ period }) => useRevenue(period), {
      initialProps: { period: '2026-09-01' },
    })
    await waitFor(() => expect(vi.mocked(supabase.from)).toHaveBeenCalled())
    const before = vi.mocked(supabase.from).mock.calls.length

    rerender({ period: '2026-08-01' })

    // Without `period` in the effect's dependencies the screen would show
    // September's figures under an August heading -- a wrong answer that looks
    // exactly like a right one.
    await waitFor(() =>
      expect(vi.mocked(supabase.from).mock.calls.length).toBeGreaterThan(before),
    )
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/revenue/useRevenue.dom.test.ts`
Expected: FAIL — `Failed to resolve import "./useRevenue"`.

- [ ] **Step 3: Write the implementation**

Create `src/revenue/useRevenue.ts`:

```ts
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { describeError } from '../lib/errorText'
import type { EligibleClient, RevenueRow } from './revenueMath'

// One month of revenue, plus the roster that month is measured against. A seam,
// in the same shape as useBoard and useTenure: the screen's fetch has to be
// mockable.
//
// TWO reads rather than one joined query, and this is the whole reason the hook
// exists in this shape. A join returns only clients that HAVE a revenue row --
// which discards precisely the information slice 6c is built on, that an
// eligible client with no row is unentered rather than unbilled. The roster has
// to arrive independently for the absence to be visible at all.

const CLIENT_COLUMNS = 'id, name'
const REVENUE_COLUMNS = 'client_id, period, retainer_cents, project_cents'

export type UseRevenue = {
  status: 'loading' | 'ready' | 'error'
  loadError: string | null
  clients: EligibleClient[]
  rows: RevenueRow[]
  reload: () => void
}

export function useRevenue(period: string): UseRevenue {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [clients, setClients] = useState<EligibleClient[]>([])
  const [rows, setRows] = useState<RevenueRow[]>([])

  const load = useCallback(
    async (isCancelled: () => boolean) => {
      try {
        // Eligible for THIS month: everyone whose ended_on is null or falls on
        // or after the first of it. The boundary is inclusive on purpose -- the
        // one departed client on production ended 2026-08-25 and billed part of
        // August, so August must offer them a row and September must not. Spec
        // section 6.1.
        const rosterQuery = supabase
          .from('clients')
          .select(CLIENT_COLUMNS)
          .or(`ended_on.is.null,ended_on.gte.${period}`)
          .order('name')

        const revenueQuery = supabase
          .from('client_month_revenue')
          .select(REVENUE_COLUMNS)
          .eq('period', period)
          .order('client_id')

        const [roster, revenue] = await Promise.all([rosterQuery, revenueQuery])

        if (isCancelled()) return

        // Either failure is an error, and neither falls through to an empty
        // array. An empty roster reads as "no clients"; an empty rows array is
        // indistinguishable from a month nobody has entered, which would make
        // concentration report every client as unaccounted for and present that
        // as a fact about the data.
        const failure = roster.error ?? revenue.error
        if (failure) {
          setLoadError(describeError(failure))
          setStatus('error')
          return
        }

        setClients((roster.data ?? []) as EligibleClient[])
        setRows((revenue.data ?? []) as RevenueRow[])
        setLoadError(null)
        setStatus('ready')
      } catch (thrown: unknown) {
        if (isCancelled()) return
        setLoadError(describeError(thrown))
        setStatus('error')
      }
    },
    [period],
  )

  useEffect(() => {
    // A fresh flag per run, marked cancelled on unmount, so a slow response
    // cannot resolve into a torn-down tree. `load` depends on `period`, so
    // changing the month re-runs this -- without which the screen would show
    // one month's figures under another month's heading.
    let cancelled = false
    void load(() => cancelled)
    return () => {
      cancelled = true
    }
  }, [load])

  return {
    status,
    loadError,
    clients,
    rows,
    reload: () => void load(() => false),
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/revenue/useRevenue.dom.test.ts`
Expected: PASS, 5 tests. If the mock chain shape does not match how the real client is called, adjust the `given()` helper — not the hook — and say so in your report.

- [ ] **Step 5: Prove the reload test distinguishes "left alone" from "wiped"**

Add `setRows([])` to the error branch, above `setStatus('error')`. Run the file and confirm `leaves the previously-loaded month in place when a reload fails` FAILS. Remove the line and re-run. Report both outputs.

- [ ] **Step 6: Full suite, lint, build, commit**

```bash
npm test && npm run lint && npm run build
git add src/revenue/useRevenue.ts src/revenue/useRevenue.dom.test.ts
git commit -m "revenue: read the month and the roster separately, so an absent row stays visible"
```

---

### Task 5: Navigation — the third admin section and the revenue gate

**Files:**
- Modify: `src/shell/destination.ts:16` (`AdminSection`), `:62-71` (`adminSections`, `canSeeAdmin`), `:76-93` (`openDestination`)
- Modify: `src/shell/MenuBar.tsx:40` (the filter)
- Test: `src/shell/destination.test.ts`

**Interfaces:**
- Consumes: `can` from `../lib/capabilities`.
- Produces: `AdminSection` gains `'revenue'`. New export `canSeeDestination(kind: DestinationKind, role: string): boolean`.

Two gates, and they are different. `edit_revenue` decides whether the Admin **entry** section exists; `view_revenue` decides whether the **Revenue** destination is in the menu bar at all. A viewer holds neither.

- [ ] **Step 1: Write the failing tests**

Append to `src/shell/destination.test.ts`:

```ts
describe('the revenue gates', () => {
  it('offers the revenue admin section to an admin and not to an account manager', () => {
    // edit_revenue, not view_revenue. An account manager who reached this
    // screen would see an entry grid the database refuses -- the exact thing
    // parent spec section 7.2 forbids drawing.
    expect(adminSections('admin')).toContain('revenue')
    expect(adminSections('account_manager')).not.toContain('revenue')
    expect(adminSections('viewer')).not.toContain('revenue')
  })

  it('puts Revenue in the bar for an account manager and takes it from a viewer', () => {
    // view_revenue. The reports are the account manager's; the entry screen is
    // not. A viewer sees neither.
    expect(canSeeDestination('revenue', 'admin')).toBe(true)
    expect(canSeeDestination('revenue', 'account_manager')).toBe(true)
    expect(canSeeDestination('revenue', 'viewer')).toBe(false)
  })

  it('refuses to open Revenue for somebody who cannot see it', () => {
    // Null means the press does nothing. Returning a Destination anyway and
    // letting the screen render an error is the failure openDestination exists
    // to prevent.
    expect(openDestination('revenue', 'viewer')).toBe(null)
    expect(openDestination('revenue', 'account_manager')).toEqual({ kind: 'revenue' })
  })

  it('leaves the destinations every role can see alone', () => {
    for (const role of ['admin', 'account_manager', 'viewer']) {
      expect(canSeeDestination('overview', role)).toBe(true)
      expect(canSeeDestination('clients', role)).toBe(true)
    }
  })

  it('answers false for a role it does not know', () => {
    // Closed by default, matching `can`. An unknown role must not be handed
    // the revenue screens by a lookup that missed.
    expect(canSeeDestination('revenue', 'sales')).toBe(false)
    expect(adminSections('sales')).toEqual([])
  })
})
```

Add `canSeeDestination` to the file's existing import from `./destination`.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/shell/destination.test.ts`
Expected: FAIL — `canSeeDestination` is not exported.

- [ ] **Step 3: Update `destination.ts`**

Change the section union and add the gate:

```ts
export type AdminSection = 'people' | 'clients' | 'revenue'
```

```ts
// The sections a role can actually reach, in the bar's order. Revenue entry is
// gated on edit_revenue and not on view_revenue, deliberately: an account
// manager can read every figure on the Revenue destination and cannot enter
// one, so showing them the grid would be drawing a control the database will
// refuse.
export function adminSections(role: string): readonly AdminSection[] {
  const sections: AdminSection[] = []
  if (can(role, 'manage_users')) sections.push('people')
  if (can(role, 'manage_clients')) sections.push('clients')
  if (can(role, 'edit_revenue')) sections.push('revenue')
  return sections
}

// Whether a destination appears in the menu bar for this role. Admin was a
// special case in MenuBar's filter -- `entry.kind !== 'admin' || canSeeAdmin`
// -- and Revenue makes it two, at which point the rule belongs beside the
// destinations it is about rather than inside the component that draws them.
// The switch is exhaustive, so a fifth destination stops compiling here until
// somebody decides who can see it, rather than defaulting to everybody.
export function canSeeDestination(kind: DestinationKind, role: string): boolean {
  switch (kind) {
    case 'overview':
    case 'clients':
      return true
    case 'revenue':
      return can(role, 'view_revenue')
    case 'admin':
      return canSeeAdmin(role)
  }
}
```

And route `openDestination` through it, so the bar and the press cannot disagree:

```ts
    case 'revenue':
      return canSeeDestination('revenue', role) ? { kind: 'revenue' } : null
```

- [ ] **Step 4: Update the MenuBar filter**

In `src/shell/MenuBar.tsx`, replace the filter on line 40:

```tsx
      {DESTINATIONS.filter((entry) => canSeeDestination(entry.kind, role)).map(
```

Change the import on line 1 to `import { canSeeDestination, DESTINATIONS } from './destination'`. If `canSeeAdmin` is now unused in that file, remove it from the import — `npm run build` fails on an unused import.

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run src/shell/destination.test.ts src/shell/MenuBar.dom.test.tsx`
Expected: PASS. If a MenuBar test asserted four buttons for a viewer, it now expects three — update it, and note in your report that the count changed because a viewer can no longer see Revenue.

- [ ] **Step 6: Full suite, lint, build, commit**

`npm run build` will fail in `Shell.tsx` and `Admin.tsx` until Task 6 handles the `'revenue'` section — that is the exhaustiveness check doing its job. If it does, add the minimal `case 'revenue':` returning a placeholder `<p>` in `Admin.tsx` **only**, and say so in your report so Task 6 knows to replace it.

```bash
npm test && npm run lint && npm run build
git add src/shell/destination.ts src/shell/MenuBar.tsx src/shell/destination.test.ts
git commit -m "shell: gate Revenue on view_revenue and its entry screen on edit_revenue"
```

---

### Task 6: The entry grid

**Files:**
- Create: `src/revenue/RevenueAdmin.tsx`, `src/revenue/RevenueAdmin.module.css`, `src/revenue/RevenueAdmin.dom.test.tsx`
- Modify: `src/shell/Admin.tsx` (render the new section)
- Test: `src/revenue/RevenueAdmin.dom.test.tsx`

**Interfaces:**
- Consumes: `useRevenue`, `formatMoney`, `parseMoney`, `MAX_CENTS`, `periodOptions`, `formatPeriod`, `defaultPeriod`.
- Produces: `<RevenueAdmin onWritingChange={(writing: boolean) => void} />`.

Read `src/users/UsersAdmin.tsx` and `src/clients/ClientsAdmin.tsx` first and follow their house pattern: the section heading, the Back button carrying the in-flight-write guard, `onWritingChange` lifted so the menu bar disables while a write is in flight.

**Do not remove the Back button.** The in-flight-write guard lives on it.

- [ ] **Step 1: Write the failing tests**

Create `src/revenue/RevenueAdmin.dom.test.tsx`. Mock `./useRevenue` and `../lib/supabase` the way the sibling admin screens' tests do.

```tsx
// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./useRevenue', () => ({ useRevenue: vi.fn() }))

import { RevenueAdmin } from './RevenueAdmin'
import { useRevenue } from './useRevenue'

const CLIENTS = [
  { id: 1, name: 'Acme' },
  { id: 2, name: 'Delta' },
]
const ROW = { client_id: 1, period: '2026-09-01', retainer_cents: 400000, project_cents: 0 }

function given(over: Partial<ReturnType<typeof useRevenue>> = {}) {
  vi.mocked(useRevenue).mockReturnValue({
    status: 'ready',
    loadError: null,
    clients: CLIENTS,
    rows: [ROW],
    reload: vi.fn(),
    ...over,
  })
  return render(<RevenueAdmin onWritingChange={vi.fn()} />)
}

afterEach(() => {
  document.body.innerHTML = ''
  vi.mocked(useRevenue).mockReset()
})

describe('the revenue entry grid', () => {
  it('gives every eligible client a row, entered or not', () => {
    given()

    expect(screen.getByText('Acme')).toBeTruthy()
    // Delta has no row for the month and must still be enterable -- a grid that
    // only lists clients with existing rows can never record a first month.
    expect(screen.getByText('Delta')).toBeTruthy()
  })

  it('prefills an entered amount and leaves an unentered field empty', () => {
    given()

    // THE distinction, at the field level. Acme's zero project work shows as a
    // real zero; Delta's absent row shows as empty, not as 0 -- which would
    // make an unentered month look entered the moment somebody opened it.
    const acmeRetainer = screen.getByLabelText('Acme retainer') as HTMLInputElement
    const deltaRetainer = screen.getByLabelText('Delta retainer') as HTMLInputElement
    expect(acmeRetainer.value).toBe('4000')
    expect(deltaRetainer.value).toBe('')
  })

  it('says how many clients the month is still missing', () => {
    given()

    expect(document.body.textContent).toContain('1 of 2')
  })

  it('refuses to save a field it cannot parse, and says which', async () => {
    const user = userEvent.setup()
    given()

    await user.clear(screen.getByLabelText('Acme retainer'))
    await user.type(screen.getByLabelText('Acme retainer'), 'four thousand')
    await user.click(screen.getByRole('button', { name: /save/i }))

    // Named, not a bare "invalid input". Ten rows and a generic message means
    // hunting for the field.
    expect(screen.getByRole('alert').textContent).toContain('Acme')
  })

  it('refuses an amount past what the column can hold', async () => {
    const user = userEvent.setup()
    given()

    await user.clear(screen.getByLabelText('Acme retainer'))
    await user.type(screen.getByLabelText('Acme retainer'), '99999999')
    await user.click(screen.getByRole('button', { name: /save/i }))

    expect(screen.getByRole('alert')).toBeTruthy()
  })

  it('offers a past month so six months can be backfilled', () => {
    given()

    // Spec section 6.3. The owner has six months of records and they are the
    // reason the later slices work at all; a grid that can only reach the
    // current month cannot accept them.
    const months = screen.getByLabelText(/month/i)
    expect(months).toBeTruthy()
    expect(months.querySelectorAll('option').length).toBeGreaterThanOrEqual(6)
  })

  it('shows a failed read as an error, not as an empty roster', () => {
    given({ status: 'error', loadError: 'permission denied', clients: [], rows: [] })

    expect(screen.getByRole('alert').textContent).toContain('permission denied')
  })

  it('says it is loading rather than showing an empty grid', () => {
    given({ status: 'loading', clients: [], rows: [] })

    expect(screen.getByText(/loading/i)).toBeTruthy()
  })

  it('keeps the Back button, which carries the in-flight-write guard', () => {
    given()

    expect(screen.getByRole('button', { name: /back/i })).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/revenue/RevenueAdmin.dom.test.tsx`
Expected: FAIL — `Failed to resolve import "./RevenueAdmin"`.

- [ ] **Step 3: Build the component**

Requirements it must satisfy, each of which has a test above:

1. A month control built from `periodOptions()` — reuse it, do not write a second one — defaulting to `defaultPeriod()`, labelled and rendered with `formatPeriod`.
2. One row per client in `clients`, whether or not a revenue row exists.
3. Each row: the client name, a retainer field and a project-work field, both labelled `` `${name} retainer` `` and `` `${name} project work` `` so the tests above can reach them and a screen reader announces which client a field belongs to.
4. A field for an existing row prefills with whole dollars (`String(cents / 100)`); a field for a client with no row is **empty**, never `'0'`.
5. A line stating how many eligible clients have no row yet, in the form `1 of 2` — the §3.3 rule, said out loud on the screen where it can be fixed.
6. Save validates every field with `parseMoney` **before writing anything**. On any `null`, render a `role="alert"` naming the client and write nothing.
7. Save is one `upsert` of every row in the month, with `onConflict: 'client_id,period'`, and `entered_by` set from the signed-in user. One statement, so a failure leaves the month exactly as it was.
8. `onWritingChange(true)` before the write and `onWritingChange(false)` after it, in a `finally`, so a thrown error cannot leave the menu bar disabled forever.
9. A Back button, matching the sibling admin screens.
10. Loading and error branches that never render an empty grid.

Styling comes from `RevenueAdmin.module.css`, following `src/users/UsersAdmin.module.css` — semantic tokens only, `t-subhead` for the section heading, `t-caption` for the missing-count line.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/revenue/RevenueAdmin.dom.test.tsx`
Expected: PASS, 9 tests.

- [ ] **Step 5: Wire it into Admin**

In `src/shell/Admin.tsx`, add the `'revenue'` case rendering `<RevenueAdmin onWritingChange={onWritingChange} />`, replacing any placeholder Task 5 left. Confirm the section switch is exhaustive — if it uses an object map rather than a switch, follow whatever shape is there.

- [ ] **Step 6: Prove the prefill distinction is enforced**

Change the empty-field case to render `'0'` instead of `''`. Run `npx vitest run src/revenue/RevenueAdmin.dom.test.tsx` and confirm `prefills an entered amount and leaves an unentered field empty` FAILS. Restore and re-run. Report both.

- [ ] **Step 7: Full suite, lint, build, commit**

```bash
npm test && npm run lint && npm run build
git add src/revenue/RevenueAdmin.tsx src/revenue/RevenueAdmin.module.css src/revenue/RevenueAdmin.dom.test.tsx src/shell/Admin.tsx
git commit -m "revenue: a month at a time, every eligible client, and an empty field that means unentered"
```

---

### Task 7: Concentration, and replacing the percentage guard

**Files:**
- Create: `src/revenue/Concentration.tsx`, `src/revenue/Concentration.dom.test.tsx`
- Modify: `src/revenue/Revenue.module.css` (add the concentration rules), `src/shell/Revenue.tsx`, `src/shell/Revenue.dom.test.tsx:109-113` (the page-level regex)
- Test: `src/revenue/Concentration.dom.test.tsx`, `src/shell/Revenue.dom.test.tsx`

**Interfaces:**
- Consumes: `concentration`, `ConcentrationReport` type, `NAMED_CLIENTS` from `./revenueMath`; `formatMoney` from `./money`; `useRevenue`.
- Produces: `<Concentration month={string} />`.

- [ ] **Step 1: Write the failing tests**

Create `src/revenue/Concentration.dom.test.tsx`, mocking `./useRevenue` as Task 6 does:

```tsx
// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./useRevenue', () => ({ useRevenue: vi.fn() }))

import { Concentration } from './Concentration'
import { useRevenue } from './useRevenue'

const CLIENTS = [
  { id: 1, name: 'Acme' },
  { id: 2, name: 'Delta' },
  { id: 3, name: 'East Bay' },
  { id: 4, name: 'Northgate' },
  { id: 5, name: 'Harbor Row' },
  { id: 6, name: 'Ivy Lane' },
]

function row(client_id: number, retainer_cents: number) {
  return { client_id, period: '2026-09-01', retainer_cents, project_cents: 0 }
}

const FULL = [
  row(1, 450000),
  row(2, 250000),
  row(3, 600000),
  row(4, 400000),
  row(5, 200000),
  row(6, 100000),
]

function given(over: Partial<ReturnType<typeof useRevenue>> = {}) {
  vi.mocked(useRevenue).mockReturnValue({
    status: 'ready',
    loadError: null,
    clients: CLIENTS,
    rows: FULL,
    reload: vi.fn(),
    ...over,
  })
  return render(<Concentration month="2026-09-01" />)
}

afterEach(() => {
  document.body.innerHTML = ''
  vi.mocked(useRevenue).mockReset()
})

describe('concentration', () => {
  it('names the month it is describing', () => {
    // Without it the figures are undated, and this component is mounted beside
    // two others that describe a different span entirely.
    given()

    expect(document.body.textContent).toContain('September 2026')
  })

  it('ranks the named clients largest first, with amounts', () => {
    given()

    const names = screen
      .getAllByTestId('concentration-name')
      .map((node) => node.textContent)
    expect(names).toEqual(['East Bay', 'Acme', 'Northgate', 'Delta'])
    expect(document.body.textContent).toContain('$6,000')
  })

  it('shows a share as an exact percentage of the month', () => {
    // Allowed by the section 9 amendment: a share of a COMPLETE month,
    // computed from complete data and inferred from nothing. East Bay is
    // 600000 of 2000000, which is exactly 30%.
    given()

    expect(document.body.textContent).toMatch(/30%/)
  })

  it('collapses the tail into one row naming how many', () => {
    given()

    // Six eligible, four named, so two collapse -- and the row says two rather
    // than listing them, which is the difference between showing exposure and
    // ranking a roster.
    expect(document.body.textContent).toContain('2 others')
  })

  it('says how many clients the month is missing rather than omitting them silently', () => {
    // Spec section 7. A chart that quietly drops three unentered clients
    // overstates every share it draws, and looks exactly like a complete one.
    given({ rows: [row(1, 450000), row(3, 600000)] })

    expect(document.body.textContent).toContain('4 of 6')
  })

  it('excludes an unentered client from the ranking entirely', () => {
    // The other half: not merely counted as missing, but absent from the bars,
    // because a bar at zero reads as a client who billed nothing.
    given({ rows: [row(1, 450000), row(3, 600000)] })

    const names = screen
      .getAllByTestId('concentration-name')
      .map((node) => node.textContent)
    expect(names).toEqual(['East Bay', 'Acme'])
  })

  it('says a month nobody has entered is unentered, not that everyone billed zero', () => {
    // The empty state. Rendered as zeroes this reads as total collapse of the
    // business, which is the single most alarming way this page could lie.
    given({ rows: [] })

    expect(document.body.textContent).toMatch(/not been entered|nothing entered|no revenue entered/i)
    expect(document.body.textContent).not.toMatch(/\d+%/)
  })

  it('shows a failed read as an error rather than an empty chart', () => {
    given({ status: 'error', loadError: 'permission denied', clients: [], rows: [] })

    expect(screen.getByRole('alert').textContent).toContain('permission denied')
  })

  it('says it is loading rather than drawing an empty chart', () => {
    given({ status: 'loading', clients: [], rows: [] })

    expect(screen.getByText(/loading/i)).toBeTruthy()
  })
})
```

Each named row carries `data-testid="concentration-name"` so the ranking can be asserted as an ordered list rather than by searching the whole page for names in any order — a `toContain` per name passes on a chart that ranks them backwards.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/revenue/Concentration.dom.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Build the component**

It reads `useRevenue(month)`, passes `clients` and `rows` to `concentration()`, and renders the named entries with amount and share, the rest row when present, and the missing count. Bars are proportional widths from `share`; a bar is decoration for the number, so it carries `aria-hidden` and the figure stays in the text.

- [ ] **Step 4: Replace the page-level percentage guard**

In `src/shell/Revenue.dom.test.tsx`, replace the `renders no percentage anywhere on the page` test:

```tsx
  // Spec section 9. The old rule here was "no percentage anywhere on this
  // page", enforced by a regex over the rendered output. That was the right
  // instinct and the wrong mechanism: a regex cannot tell a true "22% of
  // September" from a meaningless "91.2% GRR", so it had to forbid both, and
  // concentration needs the first one.
  //
  // The rule now lives where the number is COMPUTED -- revenueMath.rate()
  // returns null below MIN_RATE_PERIODS, and revenueMath.test.ts fails if that
  // threshold is relaxed. What remains here is the half a compute-site guard
  // cannot cover: that no percentage is written into this page as a literal,
  // bypassing the arithmetic entirely.
  it('renders no percentage that did not come from the arithmetic', () => {
    given()

    const source = readFileSync(
      join(import.meta.dirname, 'Revenue.tsx'),
      'utf8',
    )
    expect(source).not.toMatch(/\d\s*%/)
  })
```

If reading the file from a `src/` test breaks the build for want of Node types, move this assertion into `tests/` beside the other repo-walking guards and say so in your report — do not delete it.

- [ ] **Step 5: Mount Concentration on the Revenue page**

Add `<Concentration month={defaultPeriod()} />` to `src/shell/Revenue.tsx`, above the tenure and churn sections. Update the paragraph about what is still missing: revenue retention is still not here, but "a history of monthly amounts" now exists, so the sentence must say what is actually outstanding — that a rate needs thirteen months and the first is April 2027.

- [ ] **Step 6: Verify both suites**

Run: `npx vitest run src/revenue/Concentration.dom.test.tsx src/shell/Revenue.dom.test.tsx`
Expected: PASS.

- [ ] **Step 7: Prove the replacement guard works**

Add the literal text `87%` to a paragraph in `src/shell/Revenue.tsx`. Confirm the new test FAILS. Remove it and re-run. Report both.

- [ ] **Step 8: Full suite, lint, build, commit**

```bash
npm test && npm run lint && npm run build
git add src/revenue/Concentration.tsx src/revenue/Concentration.dom.test.tsx src/revenue/Revenue.module.css src/shell/Revenue.tsx src/shell/Revenue.dom.test.tsx
git commit -m "revenue: who we are most exposed to, and a percentage rule that moved to the arithmetic"
```

---

## After the tasks

**The owner applies the migration**, not an implementer. Staging first (`dexsdhtpfsswgiytxntl`), then production (`jizavsawtbkmvzllxhtk`). Nothing in this plan touches a live database.

**`rls.test.ts` and `scripts/verify-privileges.sql`** need the three new policies exercised — specifically the account-manager asymmetry: select succeeds, insert and update are refused. Both need live credentials and run against **staging**, because `verify:privileges` performs real writes and advances `clients_id_seq` on whatever it is aimed at. That is a follow-up task the owner runs, not a task here, and it is the only part of spec §8.5 this plan cannot execute.
