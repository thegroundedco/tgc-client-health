# Slice 6f-3 — Retention over time

The Retention section reports one rate: the latest month against the month a window before it. That
figure moves sharply on one client's invoice timing, and the section says so on its face. This
slice draws the same measurement at every anchor the data supports, so the reader can see whether
the number they are looking at is the pattern or an outlier.

**It is no longer data-blocked.** The 6f-1 spec put a second trailing-twelve point at "autumn
2027" on thirteen months of data. The 2025 backfill (slice 6i) made the record twenty-one months,
and the series exists today.

---

## 1. What it answers, and the number that prompted it

September 2026 against September 2025 reads **NRR 26.5%, GRR 17.7%**. Alone that reads as a
collapse. The series **at the twelve-month window**, computed over the same data with the same
function:

| anchor | NRR | GRR |
|---|---|---|
| 2026-01 | 41% | 41% |
| 2026-02 | 31% | 31% |
| 2026-03 | 44% | 31% |
| 2026-04 | 47% | 30% |
| 2026-05 | 38% | 29% |
| 2026-06 | 51% | 37% |
| 2026-07 | 35% | 27% |
| 2026-08 | 20% | 20% |
| 2026-09 | 26% | 18% |

Persistently low, no trend. September is the middle of a pattern rather than a fall from grace, and
August is lower still. **That is a different conversation from the one the headline alone starts**,
and it is the reason the chart leads and the number follows (§4).

The figures above were produced by running `retention()` over the real staging data during design.
They are not a prediction of what the slice will render; they are what it will render, and the
implementation is expected to reproduce them.

---

## 2. The series costs no new query

`useRetention` already reads the whole table — the 6f-1 spec §7 says so explicitly, and that it
"gives slice 6f-3 its series for free." Every point is the existing `retention()` called at a
different anchor.

**No retention arithmetic is reimplemented.** If the headline is right, the series is right by
construction, and a disagreement between the two is impossible rather than merely unlikely. This
is the whole reason the slice is small.

---

## 3. Which anchors, and what a gap means

### 3.1 The window control already exists and the series must follow it

Slice 6f-2 shipped the window control — 1, 3, 6 and 12 months (`RETENTION_WINDOWS`). The series
is drawn for **the selected window**, not a hardcoded twelve. An anchor's base is
`baseForWindow(anchor, months)`, the same function the headline uses.

On twenty-one months of data that gives roughly `21 − months` points: nine at a twelve-month
window, fifteen at six, eighteen at three. The count is not fixed and must not be assumed.

**The short-window caution carries to the chart.** `isShortWindow` already marks anything under six
months, and the section already prints a caution for it. A twenty-point line at a one-month window
is more inviting to over-read than a single number was, not less, so the caution stays visible with
the chart rather than being attached to the headline alone.

### 3.2 An anchor with no usable base produces a GAP, not a zero

A point exists only where the base month holds entered revenue. Where it does not, the line
**breaks** — it does not slope through the missing month, and it does not plot zero.

This is `monthlyTotals`' `entered: false` rule in another shape: a missing month is not a zero. It
matters more here than on the bar chart, because a line *interpolates by nature* — two points
joined across a gap assert a path through months nobody entered.

**This is the rule most likely to be "simplified" into a continuous line**, and it gets a mutation
test: joining across a gap must fail a test, not merely look different.

### 3.3 Every point is a different cohort, and the chart says so

Nine points are nine separate measurements over nine different sets of clients, not one quantity
observed over time. A line invites the second reading. The section states the first, in the
register it already uses for `"Read it as a direction, not a figure to report."`

This is a disclosure, not a hedge: it is the difference between "retention fell" and "each of these
cohorts kept between a fifth and a half of its retainer revenue."

---

## 4. What the reader sees

**The chart leads.** It sits above the headline figure, which is named beneath it as the latest
point. The 26.5% is the detail; the band is the claim. Below that, the expansion / contraction /
churn split and the movers list are unchanged.

**Both rates, always.** NRR and GRR are drawn together whatever the headline toggle says — the
*gap between them is the expansion story*, and in the current data it opens from nothing in
January to eight points by September. The net/gross toggle continues to choose which figure is
named beneath the chart; it does not hide a line.

### 4.1 The y axis is anchored at 0–100%

Not scaled to the data. A 20–51% band scaled to fill the plot area produces the same picture a
business falling from 95% to 60% would produce, and a screenshot carries the shape but not the
axis. Anchored, the truthful reading — a low, flat band — is the one the eye gets first.

A dotted reference line at 100% marks *kept everything*. Ticks at 0, 25, 50, 75, 100: fixed, so no
tick computation is needed and `chartMath.axisTicks` — which is money-shaped — is not reused.

**The axis labels must be INTERPOLATED, not typed**, and this is a trap with teeth.
`tests/revenueLiterals.test.ts` requires every `%` in the files that render this page to be
preceded by `}` — the close of an interpolation — so that a fabricated percentage cannot be typed
into markup while looking computed. A fixed axis invites exactly that: writing `0%`, `25%`, `75%`
as text is the obvious implementation and it is the thing the guard exists to catch. The ticks come
from an array in the module and are rendered through interpolation like every other figure on the
page.

**`RetentionChart.tsx` must be ADDED to that guard's file list.** Its history is a list that kept
falling behind the page: `Tenure.tsx` was absent until a reviewer inserted a fabricated rate and
watched the suite pass, and `Concentration.tsx` was left out while the comment above it claimed to
cover "every file". A new file rendering percentages on this page and not named in that list
repeats the same gap a third time.

### 4.2 The two lines are distinguishable without colour

**The primary reader is colourblind.** This is a requirement on this project, not a nicety.

NRR is solid, GRR is dashed, and each is **labelled directly at its right-hand end** rather than
through a colour key. The existing treatment of the two loss segments is the precedent
(`Retention.tsx:334` — they "share a colour and differ by texture"). The chart must be readable in
greyscale, and a test asserts the lines differ by stroke style and carry end labels rather than
asserting colours.

### 4.3 Hover is DEFERRED, and the reason is in the sentence that proposed it

The first draft of this section specified a cursor-following card carrying a point's anchor, base
month and both rates, reusing Billing's. It then noted that **the chart adds no information that
exists nowhere else** — the headline names the latest point, the caption names both months, and the
movers list carries the per-client detail.

That sentence is an argument against building it now. The chart's job is the *shape*: whether the
figure in front of the reader is the pattern or an outlier. A hover card is a convenience on top of
an answer the page already gives, and Billing's card is a substantial piece of behaviour — cursor
tracking, segment awareness, theme-aware styling — to reproduce for it.

**Revisit once the chart has been used.** If the first question anyone asks is "what was that
month?", that is the evidence for building it, and the answer will be better for knowing which
months people actually point at.

---

## 5. Where the code goes

| File | Responsibility |
|---|---|
| `src/revenue/retentionSeries.ts` | **New, pure.** Which anchors are valid, and the SVG geometry for two polylines. No retention arithmetic. |
| `src/revenue/RetentionChart.tsx` | **New.** Renders what the module computes. |
| `src/revenue/Retention.tsx` | Mounts the chart above the headline; reorders nothing else. |
| `src/revenue/Revenue.module.css` | Stroke styles for the two lines and the reference line. |
| `tests/` | Pure tests for the module; a DOM test for the rendering. |

The split mirrors `chartMath`/`Billing` exactly, which is what makes the interesting decisions —
anchor eligibility, gaps — testable without a DOM.

**`chartMath` is not extended.** Reusing it was considered: on inspection there is little to take.
`axisTicks` is money-shaped and this axis is fixed; `axisLabels` reads `MonthTotal[]`. Adding line
support would grow a 380-line bar module into one doing two unrelated jobs for no real saving.

---

## 6. Testing

- **Anchor eligibility** — a series over data with a known shape produces exactly the expected
  anchors, at each of the four windows.
- **The gap rule** — an unentered base month yields a break, not a point and not a zero.
  **Mutated:** a version that joins across the gap must fail.
- **Agreement with the headline** — the last point of the series equals what `retention()` returns
  for the same anchor and window. This is the test that makes §2's "right by construction" true
  rather than merely intended.
- **Geometry** — a point at 0% sits on the axis, one at 100% on the reference line, and the
  mapping is linear between them.
- **Greyscale legibility (DOM)** — both lines render, differ by stroke style, and carry end
  labels. Asserts style and text, never colour.
- Synthetic client names throughout: **this repository is public.**

---

## 7. Out of scope

- **Changing any retention rule.** The classification, the exclusions, the retainer-only
  measurement: all settled, all untouched here.
- **A second series for client counts.** The cohort size moves too (15–18 clients), and it is
  worth seeing — but it is a second chart wearing one coat. Revisit once this one has been used.
- **Exporting the chart.** Nick screenshots; nobody has asked for more.
- **Widening the window vocabulary.** 1/3/6/12 is the owner's own list from 6f-2.

---

## 8. Open

1. **The 2025 classification underpinning every base figure is unreviewed.** `revenue-classify.mjs`
   was written on 2026-09-14 and has never been checked against the owner's memory of who was on a
   retainer. The 2026 half is his own and verified identical to pre-import production; the 2025
   half is computed. If a 2025 client is wrongly called a retainer, the base inflates and every
   point on this chart reads worse than the truth. **The chart does not depend on the answer — it
   will redraw from whatever the data says — but the numbers it shows do.** Cheapest check: three
   or four clients he remembers, against the run the report prints for each.
2. **Whether the cohort-size line earns its place** (§7), once this has been looked at.
