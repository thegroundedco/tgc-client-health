# Slice 6f-3 — Retention Over Time Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Draw NRR and GRR over every anchor the data supports, so the reader can see whether the headline figure is the pattern or an outlier.

**Architecture:** A new pure module (`retentionSeries.ts`) decides which anchors are valid, where the line breaks, and the SVG geometry. A new thin component (`RetentionChart.tsx`) renders it. `Retention.tsx` mounts the chart above its headline. Every point is the existing `retention()` called at a different anchor — no retention arithmetic is reimplemented.

**Tech Stack:** TypeScript, React, inline SVG, CSS modules, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-15-slice-6f-3-retention-over-time-design.md`

## Global Constraints

- **The primary reader is colourblind.** The two lines differ by **stroke style** and carry **direct end labels**. Never by colour alone. Tests assert style and text, never colour.
- **A missing base month is a GAP, not a zero.** The line breaks; it does not slope through or plot zero. A missing anchor still **keeps its place on the x axis** — same rule as `monthlyTotals`' `entered: false`.
- **Every `%` in a guarded file must be preceded by `}`** — the close of an interpolation. `tests/revenueLiterals.test.ts` enforces it; a typed `25%` fails. Axis labels are interpolated from an array.
- **`RetentionChart.tsx` must be added to `GUARDED_FILES`** in `tests/revenueLiterals.test.ts:45-50`.
- **The series follows the selected window** (`RETENTION_WINDOWS` = 1, 3, 6, 12), never a hardcoded twelve.
- **No retention arithmetic is reimplemented.** Points come from `retention()`.
- **Synthetic client names in every test.** This repository is public.
- Commands: `npm test`, `npm run lint`, `npm run build`.

---

### Task 1: The series and its geometry

**Files:**
- Create: `src/revenue/retentionSeries.ts`
- Test: `tests/../src/revenue/retentionSeries.test.ts` → actually `src/revenue/retentionSeries.test.ts` (this repo colocates math tests beside the module — see `retentionMath.test.ts`)

**Interfaces:**
- Consumes: `retention`, `RetentionClient`, `RetentionRow` from `./retentionMath`; `baseForWindow` from `./retentionControls`.
- Produces:
  - `type SeriesPoint = { anchor: string; basePeriod: string; nrr: number; grr: number }`
  - `candidateAnchors(rows: readonly RetentionRow[], months: number): string[]` — every entered month whose window reaches back to at least the earliest entered month. These are the x-axis slots, gaps included.
  - `retentionSeries(clients: readonly RetentionClient[], rows: readonly RetentionRow[], months: number): SeriesPoint[]` — the subset of anchors that produced usable rates.
  - `seriesSegments(points: readonly SeriesPoint[], anchors: readonly string[]): SeriesPoint[][]` — runs of points adjacent on the anchor axis.
  - `axisMax(points: readonly SeriesPoint[]): number` — 100, or the next multiple of 25 above the highest rate.
  - `AXIS_STEP = 25`
  - `seriesGeometry(segments, anchors, max, width, height): { nrr: string[]; grr: string[] }` — SVG `points` attribute strings, one per segment.

- [ ] **Step 1: Write the failing test**

Create `src/revenue/retentionSeries.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { candidateAnchors, retentionSeries } from './retentionSeries'
import type { RetentionClient, RetentionRow } from './retentionMath'

// Synthetic throughout: this repository is public.
//
// A client "on a retainer" here just means a row with retainer_cents. Retention
// reads retainer_cents only -- RetentionRow has no project_cents field at all --
// so these fixtures cannot accidentally test project work.

// RetentionClient carries end_reason_code -- read only by
// retentionControls.excludeUncontested, never by retention() itself, but
// required by the type. Omitting it does not compile.
function client(id: number, name: string): RetentionClient {
  return { id, name, status: 'active', started_on: null, ended_on: null, end_reason_code: null }
}

function row(client_id: number, period: string, retainer_cents: number): RetentionRow {
  return { client_id, period, retainer_cents }
}

describe('candidateAnchors — the x axis', () => {
  it('offers every month whose window reaches back to real data', () => {
    const rows = [
      row(1, '2025-01-01', 100_000),
      row(1, '2025-02-01', 100_000),
      row(1, '2025-03-01', 100_000),
      row(1, '2025-04-01', 100_000),
    ]
    // A three-month window: only April reaches back to January.
    expect(candidateAnchors(rows, 3)).toEqual(['2025-04-01'])
    // A one-month window: February, March and April each reach the month before.
    expect(candidateAnchors(rows, 1)).toEqual(['2025-02-01', '2025-03-01', '2025-04-01'])
  })
})

describe('retentionSeries — the points', () => {
  it('produces one point per anchor, agreeing with retention() itself', () => {
    const clients = [client(1, 'Alpha')]
    const rows = [
      row(1, '2025-01-01', 100_000),
      row(1, '2025-02-01', 50_000),
      row(1, '2025-03-01', 100_000),
    ]
    const points = retentionSeries(clients, rows, 1)
    expect(points.map((p) => p.anchor)).toEqual(['2025-02-01', '2025-03-01'])
    // February against January: half the retainer retained.
    expect(points[0].nrr).toBeCloseTo(0.5)
    expect(points[0].basePeriod).toBe('2025-01-01')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/revenue/retentionSeries.test.ts`
Expected: FAIL — cannot find module `./retentionSeries`.

- [ ] **Step 3: Write the implementation**

Create `src/revenue/retentionSeries.ts`:

```ts
import { retention } from './retentionMath'
import type { RetentionClient, RetentionRow } from './retentionMath'
import { baseForWindow } from './retentionControls'

// Retention at every anchor the data supports, and the geometry to draw it.
//
// WHY THIS IS A SEPARATE MODULE. It contains no retention arithmetic at all --
// every point is retentionMath.retention() called at a different anchor. If the
// headline figure is right, the series is right BY CONSTRUCTION, and the two
// cannot drift apart. A second implementation of the rate, however careful,
// could disagree with the number printed six lines below it.
//
// What lives here is the part the headline never had to decide: which anchors
// are answerable, where the line must BREAK rather than slope, and where the
// points sit in an SVG.

export type SeriesPoint = {
  anchor: string
  basePeriod: string
  nrr: number
  grr: number
}

/** Rate ticks, in percent. Fixed, so no tick computation is needed. */
export const AXIS_STEP = 25

/**
 * The months that can carry a point at this window -- the x axis, INCLUDING
 * the slots that turn out to be gaps.
 *
 * A gap keeps its place. The bar chart settled this in slice 6c: a month with
 * no entry holds its slot and says so, because a missing column silently
 * removed makes the months either side look adjacent when they are not.
 */
export function candidateAnchors(rows: readonly RetentionRow[], months: number): string[] {
  const entered = [...new Set(rows.map((r) => r.period))].sort()
  if (entered.length === 0) return []
  const earliest = entered[0]
  return entered.filter((period) => baseForWindow(period, months) >= earliest)
}

/**
 * A point per anchor that produced usable rates.
 *
 * `retention()` returns null rates when the base month holds no retainer
 * revenue -- there is nothing to measure against, and a rate of zero would
 * assert total loss where the truth is an absence. Those anchors yield no
 * point, which is what makes the line break there.
 */
export function retentionSeries(
  clients: readonly RetentionClient[],
  rows: readonly RetentionRow[],
  months: number,
): SeriesPoint[] {
  const points: SeriesPoint[] = []
  for (const anchor of candidateAnchors(rows, months)) {
    const report = retention(clients, rows, anchor, baseForWindow(anchor, months))
    if (report.nrr === null || report.grr === null) continue
    points.push({ anchor, basePeriod: report.basePeriod, nrr: report.nrr, grr: report.grr })
  }
  return points
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/revenue/retentionSeries.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Add the gap rule and the geometry**

Append to `src/revenue/retentionSeries.ts`:

```ts
/**
 * Runs of points that are ADJACENT on the anchor axis.
 *
 * THIS IS THE RULE MOST LIKELY TO BE "SIMPLIFIED" AND MUST NOT BE. A line
 * interpolates by nature: joining two points across a missing anchor draws a
 * path through a month nobody could measure, and states a value for it at
 * every pixel between. Breaking the line is the only honest rendering, and it
 * is the same judgement `monthRows` makes when it refuses a month-over-month
 * comparison that would span an unentered month.
 */
export function seriesSegments(
  points: readonly SeriesPoint[],
  anchors: readonly string[],
): SeriesPoint[][] {
  const slot = new Map(anchors.map((anchor, index) => [anchor, index]))
  const segments: SeriesPoint[][] = []
  let current: SeriesPoint[] = []
  let previousSlot: number | null = null

  for (const point of points) {
    const here = slot.get(point.anchor)
    if (here === undefined) continue
    if (previousSlot !== null && here !== previousSlot + 1) {
      if (current.length > 0) segments.push(current)
      current = []
    }
    current.push(point)
    previousSlot = here
  }
  if (current.length > 0) segments.push(current)
  return segments
}

/**
 * The top of the axis, in percent.
 *
 * Anchored at 100 rather than scaled to the data: a band between 20 and 50
 * stretched to fill the plot draws the same picture a business falling from 95
 * to 60 would draw, and a screenshot carries the shape but not the axis.
 *
 * It EXTENDS above 100 when it must. NRR exceeds 100% whenever expansion
 * outruns churn, and an axis that clipped it would hide the one number anybody
 * would most want to see.
 */
export function axisMax(points: readonly SeriesPoint[]): number {
  const highest = points.reduce((max, p) => Math.max(max, p.nrr, p.grr), 0) * 100
  if (highest <= 100) return 100
  return Math.ceil(highest / AXIS_STEP) * AXIS_STEP
}

/**
 * SVG `points` attributes, one string per segment, for each series.
 *
 * x is the anchor's SLOT, not its position among the points: a gap occupies
 * axis space, so the months either side of it are drawn apart.
 */
export function seriesGeometry(
  segments: readonly (readonly SeriesPoint[])[],
  anchors: readonly string[],
  max: number,
  width: number,
  height: number,
): { nrr: string[]; grr: string[] } {
  const slot = new Map(anchors.map((anchor, index) => [anchor, index]))
  // One anchor would divide by zero; it is drawn in the middle instead.
  const x = (anchor: string) =>
    anchors.length <= 1 ? width / 2 : ((slot.get(anchor) ?? 0) / (anchors.length - 1)) * width
  const y = (rate: number) => height - (rate * 100 / max) * height
  const render = (pick: (p: SeriesPoint) => number) =>
    segments.map((segment) =>
      segment.map((p) => `${x(p.anchor).toFixed(2)},${y(pick(p)).toFixed(2)}`).join(' '),
    )
  return { nrr: render((p) => p.nrr), grr: render((p) => p.grr) }
}
```

- [ ] **Step 6: Test the gap rule and the geometry**

Append to `src/revenue/retentionSeries.test.ts`:

```ts
import { axisMax, seriesGeometry, seriesSegments } from './retentionSeries'

describe('seriesSegments — a gap breaks the line', () => {
  const anchors = ['2025-02-01', '2025-03-01', '2025-04-01', '2025-05-01']
  const at = (anchor: string): SeriesPoint =>
    ({ anchor, basePeriod: '2025-01-01', nrr: 0.5, grr: 0.5 })

  it('keeps adjacent points in one segment', () => {
    const segments = seriesSegments([at('2025-02-01'), at('2025-03-01')], anchors)
    expect(segments).toHaveLength(1)
    expect(segments[0]).toHaveLength(2)
  })

  it('splits when an anchor slot is missing, rather than joining across it', () => {
    // March produced no point. February and April must NOT be joined.
    const segments = seriesSegments([at('2025-02-01'), at('2025-04-01')], anchors)
    expect(segments).toHaveLength(2)
    expect(segments[0].map((p) => p.anchor)).toEqual(['2025-02-01'])
    expect(segments[1].map((p) => p.anchor)).toEqual(['2025-04-01'])
  })
})

describe('axisMax — anchored, but never clipping', () => {
  const p = (nrr: number): SeriesPoint =>
    ({ anchor: '2025-02-01', basePeriod: '2025-01-01', nrr, grr: 0.1 })

  it('stays at 100 for any rate at or below it', () => {
    expect(axisMax([p(0.26)])).toBe(100)
    expect(axisMax([p(1)])).toBe(100)
  })

  it('extends in steps of 25 when expansion pushes a rate above 100', () => {
    expect(axisMax([p(1.1)])).toBe(125)
    expect(axisMax([p(1.4)])).toBe(150)
  })
})

describe('seriesGeometry', () => {
  const anchors = ['2025-02-01', '2025-03-01', '2025-04-01']
  const at = (anchor: string, nrr: number): SeriesPoint =>
    ({ anchor, basePeriod: '2025-01-01', nrr, grr: nrr })

  it('puts 0% on the floor and the axis maximum on the ceiling', () => {
    const g = seriesGeometry([[at('2025-02-01', 0), at('2025-03-01', 1)]], anchors, 100, 200, 80)
    expect(g.nrr[0]).toBe('0.00,80.00 100.00,0.00')
  })

  it('leaves a gap its width on the x axis', () => {
    // Two segments either side of the missing March: February at x=0,
    // April at x=200 -- not side by side at 0 and 100.
    const g = seriesGeometry(
      [[at('2025-02-01', 0.5)], [at('2025-04-01', 0.5)]], anchors, 100, 200, 80)
    expect(g.nrr[0]).toBe('0.00,40.00')
    expect(g.nrr[1]).toBe('200.00,40.00')
  })
})
```

Run: `npx vitest run src/revenue/retentionSeries.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 7: Prove the gap rule can fail**

Temporarily change `seriesSegments` so it never splits — replace the body of the `if (previousSlot !== null && here !== previousSlot + 1)` block with nothing:

Run: `npx vitest run src/revenue/retentionSeries.test.ts`
Expected: FAIL — "splits when an anchor slot is missing" fails.

Then restore the line and re-run. Expected: PASS, 8 tests.

A test that passes whether or not the line breaks is not testing the rule the spec calls load-bearing.

- [ ] **Step 8: Run the full suite, lint and build**

Run: `npm test && npm run lint && npm run build`
Expected: all pass. `npm test` green is not a clean build — run all three.

- [ ] **Step 9: Commit**

```bash
git add src/revenue/retentionSeries.ts src/revenue/retentionSeries.test.ts
git commit -m "feat(revenue): retention at every anchor the data supports

Every point is retentionMath.retention() at a different anchor, so if
the headline is right the series is right by construction and the two
cannot drift apart.

A missing base month breaks the line rather than sloping through it. A
line interpolates by nature: joining across a gap draws a path through a
month nobody could measure and states a value for it at every pixel in
between. The gap still occupies its slot on the x axis, so the months
either side are drawn apart -- the same rule the bar chart has kept
since 6c.

The axis is anchored at 100% and extends in steps of 25 above it. A
20-50% band scaled to fill the plot draws the same picture a business
falling from 95% to 60% would, and a screenshot carries the shape but
not the axis -- but clipping an NRR above 100% would hide the one number
anybody would most want to see."
```

---

### Task 2: The chart

**Files:**
- Create: `src/revenue/RetentionChart.tsx`
- Create: `src/revenue/RetentionChart.dom.test.tsx`
- Modify: `src/revenue/Revenue.module.css` (append)
- Modify: `tests/revenueLiterals.test.ts:45-50` (add the new file to `GUARDED_FILES`)

**Interfaces:**
- Consumes: `SeriesPoint`, `candidateAnchors`, `retentionSeries`, `seriesSegments`, `axisMax`, `seriesGeometry`, `AXIS_STEP` from `./retentionSeries`.
- Produces: `<RetentionChart clients={...} rows={...} months={...} />`, a `<figure>` containing one `<svg>`.

- [ ] **Step 1: Write the failing test**

Create `src/revenue/RetentionChart.dom.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { RetentionChart } from './RetentionChart'
import type { RetentionClient, RetentionRow } from './retentionMath'

const clients: RetentionClient[] = [
  // end_reason_code is required by the type even though retention() never reads it.
  { id: 1, name: 'Alpha', status: 'active', started_on: null, ended_on: null, end_reason_code: null },
]
const rows: RetentionRow[] = [
  { client_id: 1, period: '2025-01-01', retainer_cents: 100_000 },
  { client_id: 1, period: '2025-02-01', retainer_cents: 50_000 },
  { client_id: 1, period: '2025-03-01', retainer_cents: 100_000 },
]

describe('RetentionChart', () => {
  it('draws both series and names them without relying on colour', () => {
    render(<RetentionChart clients={clients} months={1} rows={rows} />)
    // Named in text, at the end of each line -- not in a colour key. The
    // primary reader of this page is colourblind.
    expect(screen.getByText('NRR')).toBeInTheDocument()
    expect(screen.getByText('GRR')).toBeInTheDocument()
  })

  it('distinguishes the two lines by stroke style, not colour alone', () => {
    const { container } = render(<RetentionChart clients={clients} months={1} rows={rows} />)
    const nrr = container.querySelector('[data-testid="retention-series-nrr"]')
    const grr = container.querySelector('[data-testid="retention-series-grr"]')
    expect(nrr).not.toBeNull()
    expect(grr).not.toBeNull()
    expect(nrr?.getAttribute('class')).not.toBe(grr?.getAttribute('class'))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/revenue/RetentionChart.dom.test.tsx`
Expected: FAIL — cannot find module `./RetentionChart`.

- [ ] **Step 3: Write the component**

Create `src/revenue/RetentionChart.tsx`:

```tsx
import styles from './Revenue.module.css'
import type { RetentionClient, RetentionRow } from './retentionMath'
import {
  AXIS_STEP,
  axisMax,
  candidateAnchors,
  retentionSeries,
  seriesGeometry,
  seriesSegments,
} from './retentionSeries'

// Retention at every anchor, as two lines.
//
// The section's headline reports ONE anchor. That figure moves sharply on a
// single client's invoice timing -- the caption beneath it says so -- and a
// reader has no way to tell an outlier from the pattern. This is that context.
//
// BOTH RATES ARE ALWAYS DRAWN, whatever the headline toggle says: the gap
// between net and gross IS the expansion story, and hiding one line to match a
// toggle would remove the comparison the chart exists to make.
//
// THE TWO LINES DIFFER BY STROKE STYLE AND CARRY THEIR OWN LABELS. The primary
// reader of this page is colourblind. A colour key would make the chart
// unreadable for him, which is the same reason the loss segments below share a
// colour and differ by texture.

const WIDTH = 640
const HEIGHT = 200
const PAD_RIGHT = 44 // room for the end labels
const PAD_TOP = 8

export function RetentionChart({
  clients,
  months,
  rows,
}: {
  clients: readonly RetentionClient[]
  months: number
  rows: readonly RetentionRow[]
}) {
  const anchors = candidateAnchors(rows, months)
  const points = retentionSeries(clients, rows, months)
  if (points.length === 0) return null

  const max = axisMax(points)
  const plotWidth = WIDTH - PAD_RIGHT
  const plotHeight = HEIGHT - PAD_TOP
  const segments = seriesSegments(points, anchors)
  const geometry = seriesGeometry(segments, anchors, max, plotWidth, plotHeight)

  // Ticks as NUMBERS, rendered through interpolation below. A literal "25%"
  // typed into this markup is exactly what tests/revenueLiterals.test.ts
  // forbids: a percentage that looks computed and is not.
  const ticks: number[] = []
  for (let value = 0; value <= max; value += AXIS_STEP) ticks.push(value)

  const last = points[points.length - 1]
  const y = (rate: number) => PAD_TOP + plotHeight - (rate * 100 / max) * plotHeight

  return (
    <figure className={styles.retentionChart}>
      <svg
        aria-label="Retention over time"
        role="img"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              className={tick === 100 ? styles.retentionKeptAll : styles.retentionGrid}
              x1={0}
              x2={plotWidth}
              y1={PAD_TOP + plotHeight - (tick / max) * plotHeight}
              y2={PAD_TOP + plotHeight - (tick / max) * plotHeight}
            />
            <text
              className={styles.retentionTick}
              x={plotWidth + 4}
              y={PAD_TOP + plotHeight - (tick / max) * plotHeight}
            >
              {tick}%
            </text>
          </g>
        ))}

        {geometry.grr.map((points_, index) => (
          <polyline
            className={styles.retentionGrr}
            data-testid="retention-series-grr"
            key={`grr-${index}`}
            points={points_}
            transform={`translate(0 ${PAD_TOP})`}
          />
        ))}
        {geometry.nrr.map((points_, index) => (
          <polyline
            className={styles.retentionNrr}
            data-testid="retention-series-nrr"
            key={`nrr-${index}`}
            points={points_}
            transform={`translate(0 ${PAD_TOP})`}
          />
        ))}

        <text className={styles.retentionEndLabel} x={plotWidth + 4} y={y(last.nrr)}>
          NRR
        </text>
        <text className={styles.retentionEndLabel} x={plotWidth + 4} y={y(last.grr)}>
          GRR
        </text>
      </svg>
      <figcaption className="t-caption">
        Each point is a different set of clients, not one group followed over time. Read the band,
        not the line.
      </figcaption>
    </figure>
  )
}
```

- [ ] **Step 4: Add the styles**

Append to `src/revenue/Revenue.module.css`:

```css
/* Retention over time. The two series differ by STROKE STYLE and carry their
   own end labels -- the primary reader of this page is colourblind, so a
   colour key would make the chart unreadable for him. Same reason the loss
   segments above share a colour and differ by texture. */
.retentionChart svg {
  width: 100%;
  height: auto;
  overflow: visible;
}

.retentionNrr {
  fill: none;
  stroke: var(--chart-retainer);
  stroke-width: 2.5;
  stroke-linejoin: round;
}

.retentionGrr {
  fill: none;
  stroke: var(--chart-retainer);
  stroke-width: 2;
  stroke-dasharray: 5 4;
  stroke-linejoin: round;
}

.retentionGrid {
  stroke: var(--rule-hairline);
  stroke-width: 1;
}

/* 100% is "kept everything" -- a reference, not a gridline, so it reads
   differently from the rest of the scale. */
.retentionKeptAll {
  stroke: var(--rule-hairline);
  stroke-width: 1;
  stroke-dasharray: 2 3;
}

.retentionTick,
.retentionEndLabel {
  fill: var(--text-secondary);
  font-size: 0.75rem;
  dominant-baseline: middle;
}

.retentionEndLabel {
  fill: var(--text-primary);
  font-weight: 600;
}
```

These four tokens are the real ones, verified against `src/styles/tokens.css`: `--chart-retainer`,
`--rule-hairline`, `--text-secondary`, `--text-primary`.

**Do not invent a custom property and do not write a colour literal.** `src/styles/tokenRules.ts`
enforces that every colour in the repository lives in `tokens.css` — its own comment explains why:
"the first time somebody needs a slightly different grey at 6pm, a hex literal lands in a component
and nobody notices for a month."

`--chart-retainer` is the right token on the merits, not just the nearest available: retention
measures retainer revenue and nothing else, so the series is drawn in the colour the rest of the
page already uses for retainer money. The two lines are then separated by stroke style, which is
what the colourblind constraint requires anyway.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/revenue/RetentionChart.dom.test.tsx`
Expected: PASS, 2 tests.

- [ ] **Step 6: Add the file to the literals guard**

In `tests/revenueLiterals.test.ts`, add to `GUARDED_FILES` (currently at `:45-50`):

```ts
  join(ROOT, 'src', 'revenue', 'RetentionChart.tsx'),
```

Run: `npx vitest run tests/revenueLiterals.test.ts`
Expected: PASS. The `{tick}%` in the component is preceded by `}`, which is what the rule requires.

- [ ] **Step 7: Prove the guard now covers the new file**

Temporarily insert `<p>Retention is running at 91.2% this year.</p>` into `RetentionChart.tsx`'s returned markup.

Run: `npx vitest run tests/revenueLiterals.test.ts`
Expected: FAIL, naming `RetentionChart.tsx`.

Remove the line and re-run. Expected: PASS.

This is the check a reviewer used to prove `Tenure.tsx` was missing from the list. Adding a file to the array without it proves nothing.

- [ ] **Step 8: Run the full suite, lint and build**

Run: `npm test && npm run lint && npm run build`
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add src/revenue/RetentionChart.tsx src/revenue/RetentionChart.dom.test.tsx \
        src/revenue/Revenue.module.css tests/revenueLiterals.test.ts
git commit -m "feat(revenue): draw retention as two lines

Both rates always, whatever the headline toggle says -- the gap between
net and gross is the expansion story, and hiding one to match a toggle
would remove the comparison the chart exists to make.

The lines differ by stroke style and carry their own end labels rather
than a colour key. The primary reader of this page is colourblind; this
is the same reason the loss segments share a colour and differ by
texture.

The axis ticks are numbers rendered through interpolation. A literal
25% typed into the markup is precisely what revenueLiterals.test.ts
forbids, and a fixed axis invites exactly that mistake -- so the new
file joins that guard's list, verified by inserting a fabricated rate
and watching it fail."
```

---

### Task 3: Mount it, chart first

**Files:**
- Modify: `src/revenue/Retention.tsx` — import, and render above the headline (the `return` in `RetentionReady`, currently around `:191`)
- Modify: `src/revenue/Retention.dom.test.tsx`

**Interfaces:**
- Consumes: `<RetentionChart clients rows months />` from Task 2.
- Produces: nothing new.

- [ ] **Step 1: Write the failing test**

Append to `src/revenue/Retention.dom.test.tsx`, inside the existing top-level `describe`:

```tsx
  it('puts the chart above the headline figure', () => {
    // The chart leads and the number follows. One anchor on a small cohort
    // moves sharply on a single invoice; the series is the more honest first
    // reading, and the headline becomes the detail rather than the claim.
    const { container } = given()
    const chart = container.querySelector('[aria-label="Retention over time"]')
    const headline = container.querySelector('#retention-headline')
    expect(chart).not.toBeNull()
    expect(headline).not.toBeNull()
    // compareDocumentPosition: 4 means `headline` FOLLOWS `chart`.
    expect(chart!.compareDocumentPosition(headline!) & 4).toBeTruthy()
  })
```

`given(over?)` is the existing helper in that file (`Retention.dom.test.tsx:24`): it mocks
`useRetention` and returns the render result. Use it rather than adding a second fixture.

Note what the existing `ROWS` fixture contains: September 2025 and September 2026 only. At the
default twelve-month window that is exactly ONE valid anchor, so the chart renders a single point.
That is a real state the component must survive — `seriesGeometry` places a lone point at the
middle of the x axis rather than dividing by zero — and it is why this test asserts ORDER rather
than the shape of a line.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/revenue/Retention.dom.test.tsx`
Expected: FAIL — the chart element is null.

- [ ] **Step 3: Mount the chart**

In `src/revenue/Retention.tsx`, add the import:

```tsx
import { RetentionChart } from './RetentionChart'
```

Then in `RetentionReady`'s returned markup, immediately after `{controls}` and the existing window caption, before the headline block:

```tsx
      <RetentionChart clients={roster} months={months} rows={rows} />
```

`roster`, `rows` and `months` are already in scope — `report` is computed from them at `:171`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/revenue/Retention.dom.test.tsx`
Expected: PASS.

- [ ] **Step 5: Check the not-enough-history path still renders**

The chart returns `null` when there are no points, so a roster with too little history must still render the existing refusal rather than an empty box.

Run: `npx vitest run src/revenue/Retention.dom.test.tsx src/revenue/useRetention.dom.test.ts`
Expected: PASS, including the existing "not enough history" test.

- [ ] **Step 6: Run the full suite, lint and build**

Run: `npm test && npm run lint && npm run build`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/revenue/Retention.tsx src/revenue/Retention.dom.test.tsx
git commit -m "feat(revenue): the chart leads, the number follows

One anchor on a sixteen-client cohort moves sharply on a single
client's invoice timing -- the caption under the headline has said so
since 6f-1. Leading with the series makes the band the claim and the
latest figure the detail, which is the difference between 'retention
collapsed' and 'each cohort kept between a fifth and a half'."
```

---

## Verify against the real data

After Task 3, the chart should reproduce the figures in the spec's §1 table — nine points at a twelve-month window, NRR running 41, 31, 44, 47, 38, 51, 35, 20, 26.

Those came from `retention()` over real staging data during design. If the rendered chart disagrees with them, the series is not "right by construction" as §2 claims, and that is a defect in this slice rather than a surprise in the data.

The dev server points at staging via `.env.local`: `npm run dev`, then the Revenue page.

## Out of scope

Everything in spec §7 — no retention rule changes, no cohort-size series, no export. **And hover**,
deferred in spec §4.3: the chart adds no information that exists nowhere else, so a cursor-following
card is a convenience on top of an answer the page already gives. Revisit once someone has used it. And spec §8's open question stands: the 2025 retainer/project classification underpinning every base figure is still unreviewed by the owner. The chart redraws from whatever the data says; the numbers on it depend on that answer.
