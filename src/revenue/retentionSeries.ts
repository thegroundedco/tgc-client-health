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
