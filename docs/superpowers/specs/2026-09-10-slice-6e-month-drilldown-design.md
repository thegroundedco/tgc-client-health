# Slice 6e — Clicking a month

## 1. What this is for

**[owner]**, 2026-09-10, on seeing the billing chart with a year of data in it:

> "It would be really cool if when you click on a month's bar in the bar chart, it took you
> into that month's breakdown of which client paid what. Essentially just a deeper drive into
> the month. And if you hover on a bar in the bar chart, it shows you the Retainer amount, the
> Project amount, and the revenue retention over the last month."

The chart answers *what are we billing and is it moving*. It cannot answer *why* — every bar is
an aggregate over the whole roster, and the composition behind two identical bars can be
completely different. This slice makes the chart the way IN to the month rather than the end of
the reading.

### 1.1 It costs no new queries, and that decided the shape

`useRetention` already reads the **whole** revenue table (`client_id, period, retainer_cents,
project_cents`) and the **whole** roster with names and lifecycle dates. `Revenue.tsx` owns that
one read and hands it to Billing.

So every number this slice shows is already in memory on the page. No fetch, no spinner, no
loading state, no new failure mode — a panel that opens instantly. That is why the drill-down is
a panel on this page rather than a route: a route would have to re-read data the page is already
holding, and would introduce a load state for numbers that are already present.

---

## 2. The decisions this rests on

| | Decision | Source |
|---|---|---|
| Click a bar → per-client breakdown for that month | **[owner]** | §4 |
| A panel below the chart, not a route, not a swap | **[owner]** chose from three | §4 |
| The rest of the page does NOT follow the selection | **[owner]** chose from two | §6 |
| Hover: retainer, project, total, change vs last month | **[owner]** | §3 |
| The monthly retention rate lives in the PANEL, not the tooltip | **[owner]**, after §3.1 | §3.1 |

---

## 3. The hover

Retainer, project work, total, and the change against the month before — the same four figures
the breakdown table now carries, for the month under the pointer.

`—` rather than a figure where a change cannot be measured, on `chartMath.monthRows`'s rule: no
month precedes this one, this month is unentered, or the month before it is. An unentered month
still says *not entered* and never `$0`.

### 3.1 Why the retention rate is NOT on the tooltip

**[owner]** asked for "revenue retention over the last month" on the hover. Three objections were
put to him and he moved it to the panel.

1. **It would be retainer-only sitting beside two figures that are not.** Slice 6f-1 excluded
   project work from retention deliberately, and `RetentionRow` has no such field. A tooltip
   reading `$48,800 retainer · $5,000 project · 96% net` invites the reader to assume all three
   describe the same money. They do not.
2. **One month of a fourteen-client roster is noise.** A single client invoicing a week late
   moves a monthly rate by ten points or more with nothing having changed about the business.
3. **It cannot carry its own caveats.** The Retention section states its basis — *"Based on 5 of
   16 clients · 1 had no entry for September 2026 · 10 started since"* — and that sentence is
   what makes the figure defensible upward, which is the first of the four uses **[owner]** named
   for this page. A bare `96% net` in a tooltip is the number that gets quoted in a meeting and
   then cannot be stood behind.

The panel has room for the rate AND its basis, so that is where it goes.

---

## 4. The panel

Opens between the chart and the thirteen-month breakdown. Contains, in order:

1. **The month**, named, as a heading.
2. **Net and gross retention against the previous month**, with the basis line underneath —
   the same disclosure sentence the Retention section builds, on a monthly base.
3. **Every client with an entry that month**: name, retainer, project work, total. Sorted by
   total descending, then by name, so the biggest payer leads and ties do not reorder between
   renders.
4. **A count of clients with no entry** for that month, stated rather than shown as zeros.

### 4.1 A missing row is still not a zero

The panel lists clients **who have a row**. A client with no row for that month is absent from the
list and counted in the disclosure line instead. Rendering them at `$0` would state that the
agency billed them nothing, which is the claim spec 6c §3.3 exists to prevent.

A client with an entered `0` **is** listed, at `$0`. That is a fact about the month.

### 4.2 Which clients count as "no entry"

Only clients who could have been billed that month: started on or before it, and not ended before
it. A client who left in 2024 is not a gap in a 2026 month.

**A client with no start date on file is counted.** With nothing on file we cannot say they were
not active, and the honest bucket is the one that says so — the same ruling retention §3.1a makes
for the same reason.

### 4.3 The bars become buttons

They are currently `<g tabIndex={0}>` with hover and focus handlers and no role: focusable,
but announced as nothing and not activatable by keyboard. Adding a click makes that a defect
rather than an untidiness.

Each bar becomes `role="button"` with an accessible name naming its month, `aria-expanded`
reflecting whether its panel is open, and Enter and Space both activating it. Escape closes the
panel. The selected bar carries a visible mark that is not colour alone.

---

## 5. Monthly retention needs one change to `retention()`

`retention(clients, rows, currentPeriod)` derives its base as `basePeriodFor(currentPeriod)` —
twelve months back, always. A monthly rate needs an arbitrary base, so the base becomes an
optional fourth argument defaulting to today's behaviour. Every existing caller is unchanged.

### 5.1 And it exposes a deferred defect, which this slice fixes

Deferred finding 2 from slice 6f-1: `useRetention` reads the whole roster, so a client who left
**before the base month** has no base figure and lands in `unenteredBase` — counted in the
disclosure as "had no entry" when in truth they were not a client at all. It was deferred as
latent because no client in the data left before September 2025.

On a **monthly** base it is not latent: every client who has ever left is before last month.
Dixxon and Test Client August 24th would be counted as gaps in every monthly figure.

So `retention()` now excludes a client whose `ended_on` falls before the base period. The annual
figure is unchanged — verified, and pinned by a test — because no client left before the annual
base. The monthly figure is correct rather than inflated.

---

## 6. What does NOT change

**Concentration keeps its own month.** **[owner]** chose this over wiring it to the selection.
Clicking a bar changes exactly one thing on the page, so no reader can take a figure from the
selected month and read it beside a figure from last month believing both describe the same
period.

Concentration remains hardcoded to `defaultPeriod()` with no control. That is a separate gap and
is recorded here so it is not rediscovered as new.

---

## 7. Where the code goes

| File | Why |
|---|---|
| `src/revenue/breakdownMath.ts` | **New.** Pure: roster + rows + period in, per-client breakdown and the missing count out. No React, so §4.1 and §4.2 are provable without a DOM. |
| `src/revenue/retentionMath.ts` | **Modify.** Optional base period (§5); exclude clients who left before it (§5.1). |
| `src/revenue/MonthPanel.tsx` | **New.** Renders the panel. No arithmetic. |
| `src/revenue/Billing.tsx` | **Modify.** Selection state, bars as buttons (§4.3), the tooltip's two extra figures, mounts the panel. Gains a `clients` prop. |
| `src/shell/Revenue.tsx` | **Modify.** Passes `revenue.clients` to Billing. |
| `src/revenue/Revenue.module.css` | **Modify.** Panel and selected-bar styles. |

---

## 8. Not in this slice

- **Concentration's month control** (§6).
- **A URL for a selected month.** The panel is page state. A shareable link to one month is a
  route, and §1.1 is the argument against making this one.
- **Editing from the panel.** It reads; RevenueAdmin writes.
