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
//
// TWO ANCHOR LISTS, AND THEY ARE NOT THE SAME LIST. `pointAnchors` is where a
// point may exist; `anchorAxis` is the x axis, which includes the months where
// one may not. Collapsing them in either direction is a bug with a shape:
// axis-from-points draws a gap at zero width, and points-from-axis plots a
// fabricated 0%.

export type SeriesPoint = {
  anchor: string
  basePeriod: string
  nrr: number
  grr: number
}

/** Rate ticks, in percent. Fixed, so no tick computation is needed. */
export const AXIS_STEP = 25

/**
 * The next calendar month.
 *
 * `baseForWindow` is month-number arithmetic that reaches BACK by its second
 * argument, so a negative one reaches forward -- the same idiom chartMath uses
 * to walk its axis (`monthsBefore(period, -1)`). Reusing it rather than
 * repeating the arithmetic keeps one tested implementation: a bare
 * YYYY-MM-DD handed to `new Date` parses as UTC midnight, whose local calendar
 * day -- and in January its local MONTH -- is the one before, and this
 * repository has been bitten by that more than once.
 */
function nextMonth(period: string): string {
  return baseForWindow(period, -1)
}

/** Every month that carries rows, deduplicated and in order. */
function enteredMonths(rows: readonly RetentionRow[]): string[] {
  return [...new Set(rows.map((r) => r.period))].sort()
}

/**
 * The ENTERED months whose window reaches back to real data -- the months that
 * may carry a point.
 *
 * Entered only. An anchor month nobody entered has no retainer revenue to
 * measure, and `retention()` would return a rate of 0 against an entered base
 * rather than null: a fabricated total collapse. See `retentionSeries`, which
 * refuses that case a second time rather than trusting this list.
 *
 * This is NOT the x axis. Handing it to a chart as the axis would give a
 * missing month no width and draw the months either side of it as neighbours.
 */
export function pointAnchors(rows: readonly RetentionRow[], months: number): string[] {
  const entered = enteredMonths(rows)
  if (entered.length === 0) return []
  const earliest = entered[0]
  return entered.filter((period) => baseForWindow(period, months) >= earliest)
}

/**
 * The x axis: EVERY CALENDAR MONTH from the first anchor to the last,
 * including the ones that will turn out to be gaps.
 *
 * The bar chart settled this in slice 6c and `monthlyTotals` still does it --
 * a month with no entry keeps its slot with `entered: false`, because a slot
 * silently removed makes the months either side look adjacent when they are
 * a month apart. It matters more on a line than on bars: bars merely sit
 * closer together, whereas a line drawn between two slots that are neighbours
 * only because the month between them was dropped asserts a value for that
 * month at every pixel it crosses.
 *
 * Walked with month arithmetic, never a parsed Date -- see `nextMonth`.
 */
export function anchorAxis(anchors: readonly string[]): string[] {
  if (anchors.length === 0) return []
  const last = anchors[anchors.length - 1]
  const axis: string[] = []
  for (let period = anchors[0]; period <= last; period = nextMonth(period)) axis.push(period)
  return axis
}

/**
 * A point per anchor that produced usable rates.
 *
 * TWO WAYS AN ANCHOR YIELDS NOTHING, and both must be refused here.
 *
 * 1. The BASE month holds no retainer revenue. `retention()` returns null
 *    rates for that -- there is nothing to measure against, and a rate of zero
 *    would assert total loss where the truth is an absence.
 * 2. The ANCHOR month itself was never entered. `retention()` does NOT return
 *    null for this one: an unentered current month against an entered base is
 *    arithmetically 0/base, and it would plot as a total collapse that never
 *    happened. Nothing downstream can tell that 0% from a real one, so it is
 *    refused here, explicitly, rather than left to whichever list the caller
 *    happened to pass.
 */
export function retentionSeries(
  clients: readonly RetentionClient[],
  rows: readonly RetentionRow[],
  anchors: readonly string[],
  months: number,
): SeriesPoint[] {
  const entered = new Set(rows.map((r) => r.period))
  const points: SeriesPoint[] = []
  for (const anchor of anchors) {
    // Reason 2. Deliberately not an assertion that the caller passed the right
    // list: passing the axis here is the obvious simplification, and it must
    // produce a gap rather than a zero.
    if (!entered.has(anchor)) continue
    const report = retention(clients, rows, anchor, baseForWindow(anchor, months))
    // Reason 1.
    if (report.nrr === null || report.grr === null) continue
    points.push({ anchor, basePeriod: report.basePeriod, nrr: report.nrr, grr: report.grr })
  }
  return points
}

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
 * x is the anchor's SLOT on the axis, not its position among the points: a gap
 * occupies axis space, so the months either side of it are drawn apart.
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
