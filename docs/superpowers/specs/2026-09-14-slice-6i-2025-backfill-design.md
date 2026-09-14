# Slice 6i — Backfilling 2025, and the rule that finally moves into code

The tool holds nine months of revenue: January to September 2026. Everything that measures change
over time is therefore measuring one partial year against itself. This slice adds 2025, and in
doing so pays off a debt the 2026 import left behind — the rule that decides whether a client's
money is retainer or project work has never existed in code. It was applied by hand, client by
client, and frozen into a JSON map. That is fine for one year and untenable for two, because the
rule reads runs of consecutive months and a run does not stop at New Year.

---

## 1. What this buys, stated as measurements

`MIN_RATE_PERIODS` is 13 (`src/revenue/revenueMath.ts:80`). Nine months of data cannot produce a
retention rate; twenty-one can. The consequences, in order of how much they matter to the reader:

- **6f-3 (retention over time) stops being data-blocked.** The earlier note put a second
  trailing-twelve point at roughly September 2027. A whole 2025 puts the first one at December
  2025 and gives ten points by September 2026.
- **The year-over-year comparison built in 6h gets a real other side.** Today "vs previous year"
  resolves to nothing and the preset is correctly not offered (`rangeMath.ts:144`).
- **Tenure stops being a floor for the ten clients who span both years.** Most of the roster was
  imported with `started_on` set to its first 2026 invoice month, which is why the retainer vs
  project section carries a disclosure saying its tenure half cannot be trusted.
- **Churn becomes visible for the first time at scale.** Of 32 TGC clients in 2025, ten continue
  into 2026. The other twenty-two left, and the tool has no record that they ever existed.

That last number is the honest headline of this slice. Retention currently computes on a roster
that silently excludes almost every client the agency has lost.

---

## 2. The source, and the hole in it

`TGC_Invoices_Pivot_2025_2026` (Drive, owned by **[owner]**) carries a `2025 Data` tab in exactly
the shape `planCells` already reads — `Month, Month #, Entity, Client (as entered), Client,
Invoice #, Invoice Amount, Amount Paid, Outstanding`. A dry run over it returned **zero problems**,
109 client-months and 32 clients, with every month's TGC total tying to the sheet's own subtotal
row exactly.

The figures themselves, the extracted CSV and the reconciliation live in
`~/Downloads/tgc-import-2026/`, **not here** — this repository is public. That folder's `RESUME.md`
is the index.

**The tab is truncated at July.** The sheet's own notes record it: August arrived as subtotal rows
only, no line items, and September through December did not arrive at all, because the Drive
connector truncates long tabs — 2025 is the longest tab in the file. A little under half a year is
missing. The fix is for **[owner]** to copy the 2025 tab to a new spreadsheet and send that link.

### 2.1 This slice does not import a partial year

A partial import would not *lie* — the app is already careful here. `monthlyTotals` marks every
month `entered: true | false` (`chartMath.ts:113`), Billing renders an unentered month as a kept
slot reading "not entered" (`Billing.tsx:179`), and `monthRows` refuses a month-over-month
comparison that would span one (`chartMath.ts:239`). Five honest gaps, not five fabricated zeros.

It would nonetheless be the wrong thing to write, for a reason the display cannot fix: **end dates
inferred from a truncated ledger are wrong and unfalsifiable.** Twenty-two clients would be created
with `ended_on` set to their last invoice month. A client who actually ran to November 2025 reads
as ending in July, the owner is handed that date to confirm, and nothing in the sheet reveals the
error. `client_month_revenue` has no delete policy by design, so a wrong row is permanent.

**Gate: no write of any kind until the full 2025 tab is in hand.** Everything below is built and
proven against Jan–Jul, which is sound as a rehearsal and unsound as a result.

---

## 3. The recurrence rule moves into code

Today `planCells` decides with one line — `const kind = overrides[asEntered] ?? defaultKind`
(`revenue-import-read.mjs:185`), with `defaultKind = 'retainer'`. The actual rule lives in the
owner's head and in a 26-entry hand-built map:

> A bare client name is a RETAINER only if it recurs in consecutive months — three or more, or
> still running at the anchor. Otherwise it is project work. A named line item ("Gibs Website") is
> always project work. The owner's direct calls outrank the rule: Conduit and Maverick are
> retainers despite short runs.

Two years make hand-application untenable. A run of Nov–Dec 2025 plus Jan–Feb 2026 is two short
project runs when the years are classified separately and one four-month retainer when they are
joined — and only the joined reading is true.

**Design: a new pure module, `scripts/revenue-classify.mjs`, exporting `classifyRuns({ cells,
anchor, overrides })`.** It takes every cell across the whole span, groups by as-entered line-item
name, finds maximal runs of consecutive months, and returns a kind per line item plus the run that
justified it. It sits beside `revenue-import-plan.mjs` for the same reason that module exists
separately from the script that talks to the database: *these decisions are the whole safety
contract, and an untested contract is not a contract.*

`overrides` keeps its meaning and shrinks to what it should always have been — **exceptions and
exclusions only**. The owner's direct calls still outrank the rule, now by construction rather than
by having been typed into the map first.

### 3.1 The anchor

"Still running at the anchor" needs an anchor, and it must be the latest month holding an entry
across the combined span, never the calendar — the rule `latestPeriod` has enforced since 6f-1 and
`rangeMath` since 6h. With the full sheet that is September 2026.

### 3.2 Gap months are not run-breakers, and explicit zeros are

A month with no invoice between a client's first and last is written as an explicit `$0` (the 2026
ruling). A `$0` month is **not** a billing month and breaks a run. A month absent from the sheet
entirely, inside a client's span, is the same thing by a different route and breaks it too. This
must be explicit in the code and in its tests, because the two readings produce different clients.

---

## 4. The diff, which is the safety net

Recomputing across the span can change rows already in production: the same invoice moves from
`project_cents` to `retainer_cents` or back. That table has no delete policy, so an update is the
only correction available and there is no undo beyond another update.

`planImport` already upserts deliberately and already surfaces `overwrites` so nobody silently
overwrites a month somebody typed into the entry screen (`revenue-import-plan.mjs:192`). What it
reports is *that* a client-month would be rewritten — a name and a period. What this slice needs is
*what the values become*.

**Change:** `existing` grows from `{ client_id, period }` to
`{ client_id, period, retainer_cents, project_cents }`, and `overwrites` entries carry
`{ clientName, period, from: {retainerCents, projectCents}, to: {retainerCents, projectCents} }`.
`reportOf` gains a section that prints only entries where the values actually differ, with the run
that caused the reclassification, and states the count of identical rewrites separately so a
re-run's no-op overwrites cannot hide a real change in a long list.

**Note:** every run of `build-sql.mjs` to date passed `existing: []`, so this protection has never
once been exercised. It is load-bearing for the first time in this slice.

### 4.1 Getting `existing` is itself a step, and production is not readable from here

A diff needs the rows as they currently stand, and nothing in the toolchain reads them — the
roster snapshots (`roster.json`, `roster-production.json`) hold clients, not revenue. So the
pipeline gains a snapshot step alongside them, and it is **asymmetric**:

- **Staging** can be read directly.
- **Production cannot.** The sandbox refuses every production query, read as well as write. The
  owner runs a `select client_id, period, retainer_cents, project_cents` himself and returns the
  result, which is saved beside the roster snapshots.

This matters for sequencing: the production diff cannot be generated until he has done that, and a
staging diff is **not** a preview of it — production holds 31 clients where staging holds 34, and
the three extra are test fixtures. Reporting a staging diff as though it were production's is a
mistake available at exactly this step.

### 4.1 The owner rules on the diff before anything is written

Established by the 2026 import and reaffirmed here: reconciliation report first, the owner reads
it, then staging, then production. Nothing is written before he has seen the numbers.

---

## 5. Start dates move back to the new floor

For the ten clients spanning both years, `started_on` currently holds their first 2026 invoice
month — a floor recorded as if it were a start, which is why a client will otherwise show revenue
in months *before* the date on their own record.

Revenue rows are not lost to this: `monthBreakdown` consults `started_on` only for the `missing`
count (`breakdownMath.ts:56`), and totals are unaffected. The damage is to tenure and to the
reader's trust.

**Design:** `started_on` moves to the earliest invoice month across the combined span, and every
move is listed in the report — old date, new date, the invoice that justifies it — for the owner to
confirm or correct.

**This is still a floor.** A client billing in January 2025 may have started in 2023. The
disclosure on the retainer vs project section stays until real start dates are entered, and the
report says so on its face rather than letting a better floor pass as a fact.

---

## 6. The twenty-two, and their end dates

Twenty-two clients appear in 2025 and not in 2026, against ten that span both years. The roster
itself is a departure list, so it lives with the other import decisions in
`~/Downloads/tgc-import-2026/` and not in this file. It will grow when August–December arrive.

Each is created with `started_on` at its first invoice month, `ended_on` **proposed** at its last,
and the report hands the owner that list to confirm or correct before anything is written. The
alternative — creating them with a null `ended_on` — was considered and rejected: retention would
classify them "unentered" and drop them from both sides, making every 2025 departure invisible to
the measure built to catch departures. That is the exact failure this project keeps refusing, the
one that once reported 111% net retention with $0 churn.

`end_reason_code` is left null unless the owner supplies one. A fabricated reason is worse than an
absent one.

### 6.1 Name rulings carried over and extended

- **GCC → Juan Valdez.** The 2026 ruling merges GCC and Juan Valdez into one client filed as *Juan
  Valdez*. The 2025 sheet rolls up `GCC ← GCC, Green Coffee Company`, so `rename.json` gains both
  spellings. Open for the owner to reverse if Green Coffee Company is a different company.
- **Randy Rent** stays excluded in both years — the exclusion sits in `overrides-refined.json` on
  the owner's instruction and a re-import must not restore them.
- The sheet's own notes tab carries a roll-up list for 2025 — typo spellings, a client billed under
  four project line names, two case variants. It is **transcribed** into `names.json` rather than
  re-derived, because the sheet's author already did that reconciliation against the source.
- One 2025 line item is an inter-entity payroll payback rather than a client, and is excluded.

---

## 7. Order of operations

1. Full 2025 tab arrives; extract to `data-2025.csv` and reconcile every month against the sheet's
   own TGC subtotals. A month that does not tie stops the slice.
2. Snapshot the existing revenue rows of the target (§4.1) — directly for staging, and from the
   owner for production.
3. Classify across the combined span. Produce the reconciliation report: monthly totals both years,
   clients to create with proposed lifecycles, start dates to move, **the value-level
   reclassification diff**, blank-vs-zero counts, and any leading zeros before a client's start.
4. **Owner reads and rules.** Corrections go back into the JSON as data, not into the code.
5. Staging, in one transaction, dry-run first with `commit` swapped for `rollback`. Verify: no
   revenue row after any client's `ended_on`, no row before any `started_on`, totals match the
   report.
6. Production. **The sandbox blocks every production query, read and write** — the owner runs it
   himself in the SQL editor. Generate it, verify mechanically that no `delete`, `truncate` or
   `drop` appears outside a comment, default it to `rollback;`, hand it over.

---

## 8. What becomes true in the app, and what must be re-checked

Mostly the app is ready, which is the payoff of the range work in 6h:

- `rangeMath` is already year-aware and filters presets to those that resolve against the entered
  extent (`rangeMath.ts:144`). 2025 landing simply makes previous-year and its quarters appear.
- `monthlyTotals` walks back to the earliest month with data, never past it (`chartMath.ts:103`).

To re-check once the data is in, not to redesign in advance:

- **Retention's not-enough-history state stops rendering.** Its first real output needs reading
  against the `final-preview.mjs` prediction before the owner sees it.
- **Any copy naming a date derived from the six-month entry reach.** The "April 2027" paragraph is
  already gone; a grep for a stale window is cheap insurance.
- **Twenty-one months of bars** is the widest the chart has ever drawn. Axis labels and bar widths
  want looking at rendered, not asserted.
- **The board and the matrix** read the same roster and will gain twenty-two departed clients. The
  archived toggle exists; whether the default view is still usable at that size is a question for
  the owner's eyes.

---

## 9. Testing

- `classifyRuns` is pure and gets the weight: runs that span New Year, three-month and two-month
  runs, a run still open at the anchor, an explicit `$0` breaking a run, a gap month breaking a
  run, an override outranking a computed kind, and a named line item never becoming a retainer.
  Synthetic names throughout — **this repository is public and the real names are not in it.**
- The value-level diff gets a test proving a reclassified cell reports `from` and `to`, and one
  proving an identical rewrite is counted rather than listed.
- `tests/revenueImport.test.ts` (33 tests) and `tests/revenueImportRead.test.ts` must stay green:
  the 2026 path through `planCells` is unchanged.
- **Mutation check, not just green:** the rule's tests must fail when the run-length threshold is
  changed from 3 to 2. A test that passes either way is testing nothing.

---

## 10. Out of scope

- 6f-2's retention controls. Still deliberately deferred until the owner has used real numbers.
- 6f-3 itself. This slice unblocks it; it does not build it.
- Real start dates for clients whose relationship predates 2025. The floor stays a floor.
- The client `type` vocabulary and the ladder correlation. Separate threads, separately blocked.
- Any change to how retention classifies a missing row. That rule is the substance and is settled.

---

## 11. Open, and the owner's to answer

1. **The full 2025 tab.** Everything is gated on it.
2. **Green Coffee Company** — the same company as GCC, and therefore Juan Valdez, or separate?
3. **The twenty-two end dates**, once proposed from complete data.
4. **The reclassification diff**, once it exists. It may be empty; it is not safe to assume so.
