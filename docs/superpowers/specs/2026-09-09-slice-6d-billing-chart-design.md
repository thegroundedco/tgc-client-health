# Slice 6d — Billing over time, and the Revenue page's order

## 1. What this is for

Question 1 of the four the owner wants Revenue to answer: **what are we billing, and is it
moving?** The 2026-09-03 slice 6c spec scoped it as slice 6d needing two months; the thirteen-month
backfill makes the full picture available.

It also answers a second problem, reported by the owner on 2026-09-09 after seeing the page with
data in it: **"It's a bit confusing to read."** Asked which part, he said all four sections — no
sense of time anywhere, too many numbers at once on Retention, Concentration's bars not helping,
and no order to the page as a whole.

**[owner]** This slice takes the first and last of those. The two report refinements are deferred
to §8 deliberately: both will sit in a different context once the page has a lead, and how much
weight they need is easier to judge then than now.

### 1.1 Why a chart is the fix and not decoration

Every screen on this page shows **one month**. There are now thirteen. The most natural question
about monthly data — is it going up — is the one thing currently invisible, and no amount of
reordering text answers it.

---

## 2. The decisions this rests on

| | Decision | Source |
|---|---|---|
| Stacked retainer + project work, one bar per month | **[owner]**, 2026-09-09 | §4 |
| Hand-rolled inline SVG, no charting library | Derived — see §4.1 | |
| Bars, never a line | Derived, and load-bearing — see §4.2 | |
| Trailing 13 months | §4.3 | |
| Page reordered, billing first, retention second | **[owner]** approved the order | §3 |

---

## 3. The page's order

Today: Concentration, Tenure, Churn, Retention. That buries the number the owner reports upward
at the bottom of the page.

New order, top to bottom:

| | Section | The question it answers |
|---|---|---|
| 1 | **Billing** *(new)* | What are we billing, and is it moving? |
| 2 | **Retention** | How much of last year's book did we keep? |
| 3 | **Concentration** | Who are we most exposed to? |
| 4 | **Tenure** | How long do clients stay? |
| 5 | **Churn** | Who left, and why? |

The trend leads because it is the most legible thing on the page and gives the eye somewhere to
land. Retention is second because **[owner]** it is the figure his boss asks for. The rest descend
from aggregate to individual.

---

## 4. The chart

One bar per month. Each bar is **retainer on the bottom, project work stacked above** — the money
that recurs underneath the money that does not. **[owner]**

Both halves are stored per client-month and this slice sums them across clients. Nothing new is
computed that `client_month_revenue` does not already hold.

### 4.1 Inline SVG, and no charting library

The app has **three runtime dependencies**: React, ReactDOM, supabase-js. A charting library would
roughly double that, add real weight to a 296 kB chunk, and then fight the token system on every
colour — this project pins three tokens out of the dark flip and bans brand-layer references
outside `tokens.css`, with tests enforcing both.

The shapes needed here are rectangles over at most thirteen points. Hand-rolled SVG costs less than
the integration would, and it lets the geometry be a **pure function with tests**, which is how
every other rule in this codebase is verified.

### 4.2 Bars, never a line — this is the load-bearing decision

A line interpolates between its points. Across an **unentered month** it would draw a value nobody
entered, presenting a straight line through a gap as though it were data.

That is spec 6c §3.3's rule — *a missing row is not a zero* — expressed in pixels, and it is not
hypothetical: `RevenueAdmin.handleSave` deliberately skips a client left blank with no row on file,
so partially-entered months are a normal state of this system rather than an edge case.

Bars let an absent month be a **visible gap**. A month with entries but totalling zero is a
different picture again — a zero-height bar on a labelled axis position — and the two must not
look alike.

### 4.3 Trailing thirteen months

Thirteen, matching `MIN_RATE_PERIODS`: a year plus the month that anchors it. The window stays
fixed as history grows, so the chart does not slowly compress toward illegibility, and it is the
same span retention measures across.

Anchored on the **latest month holding any entry**, not today's calendar month — the same rule
`retentionMath.latestPeriod` already uses, and for the same reason: early in a month almost nothing
is entered.

**Fewer than thirteen months of history shows fewer bars, never padding.** A chart padded to a
fixed thirteen slots would draw empty columns for months that predate the agency's records, which
reads as "we billed nothing then" — the same lie §4.2 refuses. The axis spans what exists.

**A month inside the window with no entries at all keeps its labelled slot and draws no bar.** Not
a removed column: dropping it would slide every later month left and silently change the shape of
the year. The gap has to be visible AS a gap, in position, which is the whole argument of §4.2.

---

## 5. Colour and theming

Two series need two fills that stay distinguishable in **both** themes, at a legible contrast
against the page ground and against each other.

They become **new semantic tokens** — `--chart-retainer` and `--chart-project` — defined in
`tokens.css`, the only file permitted a colour literal, and flipped deliberately for dark rather
than inheriting. `tests/brandLayering.test.ts` already bans brand-layer references outside that
file and `tests/themeParity.test.ts` covers the flip; both extend to these.

**The `dataviz` skill is to be loaded before any chart colour is chosen.** It carries a
contrast-validated method. Picking two chart colours by eye is how this project shipped
`.status-pill--ended` at 9.64:1 in light and **1.45:1 in dark**, where a churned client's status
word vanished entirely.

### 5.1 AMENDED 2026-09-09 — the palette was validated, and the brand pair failed

Loaded the skill and ran its validator rather than reasoning about it. **The obvious choice —
brand teal `#83C1C0` with brand blush `#FFB3AB` — FAILS**, and not marginally:

| Check | Brand pair, light |
|---|---|
| Lightness band | FAIL — blush at 0.837, outside the band |
| Chroma floor | FAIL — both read as gray |
| **CVD separation** | **FAIL — ΔE 3.4 (protan)** |
| Contrast vs surface | WARN — 1.98 and 1.66, both under 3:1 |

ΔE 3.4 means a red-green colourblind reader sees **two identical bars**. The retainer/project
distinction — the entire point of stacking — would not exist for them.

**The validated pair is `--chart-retainer: #0D9488` and `--chart-project: #C2410C`.** All five
checks pass in BOTH modes:

| | Light (`#FBF7EB`) | Dark (`#201D18`) |
|---|---|---|
| Lightness band | PASS (0.43–0.77) | PASS (0.48–0.67) |
| Chroma floor | PASS ≥ 0.1 | PASS ≥ 0.1 |
| CVD separation | **PASS ΔE 13.7** (deutan), 32.5 tritan | same |
| Normal-vision floor | PASS ΔE 27.1 | same |
| Contrast vs surface | PASS ≥ 3:1 | PASS ≥ 3:1 |

**These two tokens DO NOT FLIP between themes, and that is a selection rather than laziness.**
Dark steps were chosen and validated independently as the skill requires; the lighter candidates
tried first (`#2DD4BF`/`#FB923C`, `#26C6B4`/`#F0803C`, `#14B8A6`/`#F97316`) all FAIL dark's
lightness band. The same two values pass both. They therefore join `--text-on-band`,
`--band-none` and `--brand-red-legible` as **pinned out of the dark flip**, and
`tests/themeParity.test.ts` must assert they do not move.

### 5.2 AMENDED — what else the skill mandates, beyond colour

Non-negotiables from the skill that §6 as originally written did not cover:

- **A legend is always present for two or more series.** Identity may never be colour alone.
- **A table view of the same numbers must exist.** Stronger than the "reachable as text" §6 asked
  for, and it is also what discharges the contrast obligation on any mark.
- **A per-mark hover tooltip**, on focus as well as hover so it is reachable by keyboard. The
  skill exempts only a bare stat tile.
- **A 2px surface-coloured gap between stacked segments**, so retainer and project read as two
  marks rather than one bar with a colour change.
- **Text wears text tokens, never the series colour.** Values and labels stay in ink; a coloured
  swatch beside them carries identity.

---

## 6. Reading it without seeing it

A chart that exists only as pixels is unreadable to a screen reader and unassertable in a test.

- The `<svg>` carries `role="img"` and an `aria-label` naming what it shows and its range.
- A **visually-hidden summary** states the span and the direction of travel in words.
- Each month is reachable as text — month, retainer, project — so the underlying numbers are
  available without the picture.

This follows the matrix, which already provides a text path for a band encoding that is otherwise
colour-only.

---

## 7. Where the code goes

| File | Why |
|---|---|
| `src/revenue/chartMath.ts` | **New.** Pure geometry: month totals in, bar rectangles out. No React, no SVG strings — numbers only, so it tests without a DOM like `matrixMath` / `tenureMath` / `revenueMath` / `retentionMath`. |
| `src/revenue/Billing.tsx` | **New.** Renders the SVG from those rectangles. No arithmetic. |
| `src/shell/Revenue.tsx` | **Modify.** Mount Billing first; reorder the four existing sections per §3; own the `useRetention` call and pass it down (§7.1). |
| `src/revenue/Retention.tsx` | **Modify.** Takes `status` / `loadError` / `clients` / `rows` as props instead of calling `useRetention` itself (§7.1). Its own tests already mock the hook, so they change shape with it. |
| `src/styles/tokens.css` | **Modify.** The two chart tokens, light and dark. |

### 7.1 The read moves up, and this is a real change rather than a detail

**No new query — but getting there is not free, and an earlier draft of this section glossed it.**

`useRetention` already reads the whole of `client_month_revenue` (6f-1 spec §6). But `Retention`
**owns that read itself** and takes no props, exactly as `Concentration` owns its `useRevenue`
call. If `Billing` simply called `useRetention` too, the page would issue **two identical
whole-table reads** — the waste this section claims to avoid.

So the call **lifts into `Revenue.tsx`**, which passes `status`, `loadError`, `clients` and `rows`
down to both `Billing` and `Retention`. That changes `Retention`'s signature from no props to
props, days after it shipped.

Worth doing rather than routing around, for a reason beyond the duplicate fetch: with the read in
one place the two sections **cannot disagree about which month is latest**. Two independent reads
resolving either side of a save would let the chart and the retention figure anchor to different
months while looking equally authoritative — the shape of defect this project keeps finding
(`RevenueAdmin` rendering one month's figures under another's heading).

`Concentration` keeps its own `useRevenue` read. It reads ONE month with a different filter and
shares nothing with these two; merging it would couple three screens to one query for no gain.

---

## 8. Not in this slice

**Retention's visual hierarchy** and **Concentration's exposure visual**, both reported confusing
by the owner on the same day. Deferred because each is a presentation refinement of a report whose
context this slice changes: with a chart leading the page and the order rewritten, how much visual
weight either needs is a different question, and better answered after the owner has used the page
than guessed at now.

The same reasoning that deferred 6f-2's controls. Neither is dropped; both are recorded here so
they are not rediscovered as new.
