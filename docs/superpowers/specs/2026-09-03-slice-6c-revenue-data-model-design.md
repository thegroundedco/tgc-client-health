# Slice 6c — the revenue data model, entry, and concentration

**Status:** approved 2026-09-03. Supersedes nothing; amends §6 of
`2026-09-03-slice-6b-tenure-churn-design.md` (see §9).

**Owner decisions** are marked **[owner]** and were made in conversation on 2026-09-03. They are
not open for a reviewer to relitigate.

---

## 1. What this is for

The Revenue destination currently says revenue retention is not here yet, and explains that the
hard part is needing a history of monthly amounts that one editable retainer field cannot produce.
This slice builds that history.

Four questions the owner wants Revenue to answer, **[owner]** all four:

| | Question | Needs | Ships |
|---|---|---|---|
| 1 | What are we billing, and is it moving? | 2 months | slice 6d |
| 2 | Who are we most exposed to? | 1 month | **this slice** |
| 3 | Is each client growing or shrinking? | ~6 months | slice 6e |
| 4 | Standard retention rates (GRR / NRR) | 13 months | slice 6f, April 2027 |

**This slice ships the table, the entry screen, and question 2 only.** The other three are separate
slices on the same table. That none of them requires a schema change is the test of whether this
table is right; if one does, this spec was wrong.

### 1.1 Why the sequencing is what it is

The owner can enter six months of real history — April 2026 through September 2026 — and no more,
because six months is what the records support. **[owner]** That is a data fact, not an appetite:
entering a seventh month would mean entering a remembered number as though it were a record.

Six months makes questions 1, 2 and 3 answerable on the day the backfill lands. It does not make
question 4 answerable. A trailing-twelve figure needs a month and the month twelve behind it, so
the first honest GRR/NRR is **April 2027**. Shipping it earlier would render a partial figure that
looks identical to a real one, which is precisely what §6 of the tenure/churn spec refused.

---

## 2. The shape of the money

**[owner]** TGC bills a recurring retainer plus variable project work. Two numbers per
client-month, and only the first is what retention is about: project work is real revenue but not
something anyone expects to repeat.

Both are stored. Retention math in later slices reads the retainer; totals and concentration read
both. Nothing in this slice needs the distinction beyond storing it correctly, but storing only the
sum would make slice 6f impossible without a migration and a re-entry of six months of history.

---

## 3. The table

```sql
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

create trigger client_month_revenue_touch_updated_at
  before update on public.client_month_revenue
  for each row execute function private.touch_updated_at();
```

Every other table in this schema with an `updated_at` column wires one of these triggers
(`profiles`, `clients`, `checkins`); without it `updated_at` never advances past insert time, which
would quietly gut the audit story §8.6 claims for this table while Task 6's upsert path made every
row look freshly written.

The migration opens with `revoke all on public.client_month_revenue from anon, authenticated;`
before its grants, per the standing rule for every new table in `public`.

### 3.1 Integer cents, never a float

`4000.10` has no exact binary floating-point representation. A retention figure summed from a
hundred such values drifts, and the drift is invisible until someone reconciles against an invoice.
Postgres `numeric` would also be correct; cents is smaller and harder to misuse, and the interface
speaks in whole dollars anyway.

`integer` not `bigint`: the maximum is $21,474,836.47 per client-month, which is four orders of
magnitude above anything this agency will bill. `bigint` would cost nothing, but naming a limit
that cannot be reached is how a reader learns the unit is cents.

### 3.2 `on delete restrict`, deliberately unlike `checkins`

`checkins.client_id` is `ON DELETE CASCADE`. Deleting a client therefore destroys its check-in
history silently, and the newest backup is up to a day old — a trap already recorded against this
project.

Financial history must refuse rather than vanish. With `restrict`, deleting a client that has
revenue rows fails loudly and the operator sets `status = 'former'` instead, which is the
reversible action they wanted. This is a deliberate divergence from the neighbouring table and a
reviewer should not "fix" it to match.

`entered_by` is `on delete set null`, following `clients.owner_id` and
`checkins.submitted_by`: losing a person must never delete the record of the work.

### 3.3 A missing row is not a zero

**This is the rule the rest of the slice depends on.**

A row with `project_cents = 0` means *entered; billed nothing*. No row at all means *nobody has
said yet*. If those two collapse, a month that simply has not been filled in reads as a client
billing nothing — which, on a page whose job is measuring churn, reads as churn.

The codebase already holds this rule in another form: `checkins.legacy_total_score` is null
whenever any pillar is null, with the comment "a missing pillar must never read as a low score: a
false 'at risk' is as harmful as a false 'healthy'." Same rule, same reason.

Enforcement is in §8.2, and it is a test that must be shown to fail when the two are collapsed.

### 3.4 Composite primary key

`primary key (client_id, period)` rather than a surrogate `id` with a unique constraint. `checkins`
does the latter — `checkins_pkey` on `id` plus `checkins_client_id_period_key`. Either enforces
one row per client per month; the composite key states it as the identity of the row rather than as
a constraint on it, and nothing in this table needs a stable single-column handle.

---

## 4. Permissions

**[owner]** Admin edits, account managers view, viewers see nothing.

Two new capabilities, in the pair the codebase already uses for scores:

| | `view_revenue` | `edit_revenue` |
|---|---|---|
| `admin` | ✓ | ✓ |
| `account_manager` | ✓ | — |
| `viewer` | — | — |

`CAPABILITIES` goes from four to six. `src/lib/capabilities.ts` says a new capability "should have
to be made in more than one place" and `tests/capabilities.test.ts` reads the preset arrays out of
the migration and asserts both copies match in both directions — so the SQL function and the
TypeScript map cannot be edited apart.

### 4.1 The first read-without-write role

This is the first capability where `account_manager` can view but not edit. The Revenue reports
become the first read-only surface in the app for a role that is not `viewer`.

The consequence for the UI: Revenue must not draw an edit affordance it will refuse. `can()` decides
what is drawn; the policies decide what happens. A screen that shows an account manager an entry
control and then refuses the write is worse than one that never drew it — §7.2 of the parent spec.

### 4.2 Policies

Three policies on `client_month_revenue`, matching the established shape exactly:

```sql
select → private.has_capability('view_revenue')
insert → private.has_capability('edit_revenue')   -- with check
update → private.has_capability('edit_revenue')   -- using and with check
```

No delete policy. Removing a month's revenue is not an operation the screen offers; a month entered
in error is corrected by editing it. Absent a policy, delete is refused for everyone, which is the
intended behaviour and needs no additional machinery.

---

## 5. Where it sits

**Entry lives under Admin as a third section**, beside People and Clients, because `edit_revenue` is
admin-only and that destination is where admin-only writes already happen. It inherits the
in-flight-write guard the admin screens carry on their Back button.

**Reports live on Revenue**, gated by `view_revenue`, so account managers get the numbers without
an edit surface they cannot use.

`Destination` gains nothing. `AdminSection` gains a third member, and the exhaustiveness switch in
`Shell.tsx` plus the type-level assertion on `DESTINATIONS` fail the build until it is handled —
which is what those were added for.

---

## 6. The entry grid

One month at a time, chosen by the same month control the board uses.

### 6.1 Which clients get a row

Every client that could plausibly have billed in that month: all of them **except** those whose
`ended_on` is earlier than the first day of that month.

The boundary is inclusive on purpose. The one departed client on production ended 2026-08-25, and
they billed part of August — so August must offer them a row, and September must not. A rule
written as "ended before the month ends" would silently drop that month's revenue for every client
who ever leaves.

A client with no `started_on` is **included**, not excluded. The tool does not infer a tenure it
cannot prove — the same rule the Advocacy gate already follows, where a null start date means the
gate stays closed rather than being guessed open. Two of the twelve clients on production have no
`started_on` today, so this is a live case and not a hypothetical.

A `paused` client is included: paused describes the work, not the billing, and a paused client may
still be invoiced.

### 6.2 Saving

The whole month saves as one action, not one write per row.

Ten rows saving themselves individually means ten writes and a half-saved month on any failure —
and a half-saved month is worse than an unsaved one precisely because §3.3 makes a missing row
meaningful. One upsert of every row in the month means a failure leaves the month exactly as it
was.

### 6.3 Backfill

The entry screen must be able to reach a past month from the day it ships, because the owner's six
months of history are the reason the later slices work at all. This is a requirement of this slice,
not a later addition: retrofitting month navigation onto a screen built for the current month only
is the awkward version of the same work.

---

## 7. Concentration

The one report in this slice. It answers "who are we most exposed to?" and needs exactly one month
of data, so it works from the first save.

For the chosen month: each client's total (`retainer_cents + project_cents`) as a share of the
month, largest first. The four largest are named individually and the remainder collapses into one
row — four because that is where the current roster stops being interesting, and because a list of
ten bars ranks clients without showing exposure. The sentence that carries the meaning is the
comparison — that the largest client outweighs the smallest several combined — not the ranking
itself.

Clients with no row for the month are **absent from the list, and their absence is stated**, per
§3.3. A concentration chart that silently omits three unentered clients overstates every share it
draws.

---

## 8. What must be true, and what proves it

Every requirement below names the test that enforces it. A requirement without one is a requirement
this project has historically shipped broken.

### 8.1 Shares are exact; rates refuse to guess

The share/rate distinction lives where the number is computed, not where it renders:

```ts
// A share of one complete month, as a fraction in [0, 1] — never a
// pre-multiplied percentage. Formatting decides how it is displayed;
// a function that returns 22 is one rename away from being read as
// dollars.
export function share(part: number, whole: number): number | null

// A rate across periods. Null — not a number — until there are enough
// periods for it to mean anything. MIN_RATE_PERIODS is 13: a
// trailing-twelve figure needs a month and the month twelve behind it.
export function rate(periods: readonly Period[]): number | null
```

`share` returns null only when `whole` is zero, which is a real state (a month where nothing was
billed) and not an error.

**No rate ships in this slice**, so `rate()` has no caller yet. It is built here anyway because §9
removes the page-level regex, and something has to stand between this page and a plausible-looking
fabricated rate in the interval before slice 6f. A guard added in the same change that removes the
old one is a replacement; a guard added later is a gap.

`rate` returning null is what renders an honest sentence instead of a figure. **This is the
enforcement mechanism for §9's amendment**: a page-level regex cannot tell a true 22% from a
meaningless 91.2%, but a function that refuses to produce the second one can.

**Covering test:** `rate()` returns null below the period threshold. Must be shown to fail when the
threshold is relaxed.

### 8.2 A missing row never becomes a zero

**Covering test:** a month in which one client has no row — the total excludes that client, and the
rendered output says how many clients are unaccounted for.

**Must be shown to fail** when the query is changed to `coalesce(sum(...), 0)` over absent clients.
A test that passes under that mutation is not testing this requirement.

### 8.3 Money formatting is a module, not a component detail

Cents in, display out, in its own file with its own tests, the way `tenureMath` is. No formatting
logic inside a component. The zone-safe date lesson applies to money too: the trap is invisible
until the value is unusual, and a component is not where anyone looks for it.

### 8.4 The capability map cannot drift

Already enforced by `tests/capabilities.test.ts`, which reads the preset arrays out of
`supabase/migrations/*_has_capability.sql`. It asserts the count as well as the membership, so
going from four capabilities to six must be made in both places.

### 8.5 RLS is exercised, not asserted

New policies get coverage in `rls.test.ts` and `scripts/verify-privileges.sql`, both aimed at
**staging**. `verify:privileges` performs real writes and advances `clients_id_seq` on whatever it
is pointed at; it must never be aimed at production.

The account-manager case is the one that matters and the one a careless test will miss: an AM must
be able to select and must be refused on insert and update. A test that only checks the admin path
proves nothing about the boundary this slice introduces.

### 8.6 Accepted limits, stated rather than discovered

- **No concurrent-edit detection.** With one or two admins, last-write-wins is correct. Optimistic
  locking here would be machinery without a problem.
- **No audit trail beyond `entered_by` and `updated_at`.** Who changed a figure and when is
  recorded; what it was before is not. If that becomes necessary it is a separate table, not a
  column.
- **No currency field.** Every amount is USD. A currency column that is always `'USD'` teaches a
  reader that multi-currency is handled when it is not.

---

## 9. Amendment to slice 6b §6

Slice 6b's §6 says no percentage appears anywhere on the Revenue page, and
`src/shell/Revenue.dom.test.tsx` enforces it with `expect(...).not.toMatch(/\d\s*%/)`.

**[owner]** That rule is amended, because it was written narrower than it was worded. Its actual
argument is that *a rate computed from too few events* is meaningless — "a rate computed on one
event is 9.1%, a number that reads as a fact, carries a decimal place, and means nothing." §6
itself anticipated this, saying the sentence "stops being true on its own, the day the data
supports it."

The amended rule:

- **Allowed:** a share of a complete period. "East Bay is 22% of September's revenue" is exactly
  true, computed from complete data, and inferred from nothing.
- **Still refused:** a rate derived from fewer periods than it claims. A churn rate on one event, a
  trailing-twelve GRR built from two months.

The page-level regex in `Revenue.dom.test.tsx` is **replaced**, not deleted, by §8.1's
compute-site enforcement. Deleting it outright would remove the only thing standing between this
page and a plausible-looking fabricated rate; the replacement has to be in place in the same
change.

---

## 10. Open, and deliberately not decided here

- **Overview's contents.** Still the owner's. Six invented stat lines were retired once as
  never-sourced, and concentration is not a substitute for that conversation.
- **The GRR/NRR window.** April 2027 is when a trailing-twelve becomes possible. Whether slice 6f
  shows a shorter window before then, clearly labelled, is a decision for that slice and not this
  one.
- **Where the figures come from.** Productive holds them, but its MCP connection was unauthenticated
  when this was written, so nothing here assumes a live source. Entry is by hand. If that changes,
  the table does not.
