// The geometry behind the billing chart. Pure, and separate from the component,
// so the rules below are testable without a DOM -- the same split as
// matrixMath.ts, tenureMath.ts, revenueMath.ts and retentionMath.ts.
//
// Numbers only. Nothing here builds an SVG string or knows a colour; it turns
// months into rectangles and the component draws them. That is what lets the
// one rule this module exists to enforce -- an unentered month is not a zero --
// be proven without rendering anything.

export type RevenueRow = {
  client_id: number
  period: string
  retainer_cents: number
  project_cents: number
}

// `entered` is the whole point of this type. A month with rows totalling zero
// and a month nobody has touched both have zero cents, and they are completely
// different facts: the first says the agency billed nothing, the second says
// nobody has said yet. Spec 6c section 3.3, carried into the chart.
export type MonthTotal = {
  period: string
  retainerCents: number
  projectCents: number
  entered: boolean
}

export type Bar = {
  period: string
  entered: boolean
  x: number
  width: number
  // SVG y grows downward, so a segment's y is its TOP edge and the baseline is
  // at `height`. The retainer sits on the baseline; project work stacks above.
  retainerY: number
  retainerHeight: number
  projectY: number
  projectHeight: number
}

// Thirteen: a year plus the month that anchors it. The same span
// MIN_RATE_PERIODS names and retention measures across, so the chart and the
// retention figure cover the same window rather than two that merely look alike.
export const CHART_MONTHS = 13

// The first of the month n months before a period. String arithmetic, never a
// parsed Date: a bare YYYY-MM-DD parses as UTC midnight, whose local calendar
// day is the day before in any western zone -- the trap tenureMath.ts documents
// at length and this module would otherwise walk into a second time.
function monthsBefore(period: string, n: number): string {
  const year = Number(period.slice(0, 4))
  const month = Number(period.slice(5, 7))
  const total = year * 12 + (month - 1) - n
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}-01`
}

/**
 * The trailing window ending at `currentPeriod`, one entry per month.
 *
 * A month inside the window with no rows KEEPS ITS PLACE with `entered: false`.
 * Dropping it would slide every later month left and silently change the shape
 * of the year -- the reader would see a smooth series where the data has a hole.
 *
 * Months before the earliest row are omitted entirely rather than padded: a
 * padded column reads as "we billed nothing then" about a month that predates
 * the records, which is the same lie a line drawn through a gap tells.
 */
export function monthlyTotals(
  rows: readonly RevenueRow[],
  currentPeriod: string,
): MonthTotal[] {
  if (rows.length === 0) return []

  const byPeriod = new Map<string, { retainerCents: number; projectCents: number }>()
  let earliest: string | null = null
  for (const row of rows) {
    if (row.period > currentPeriod) continue
    if (earliest === null || row.period < earliest) earliest = row.period
    const found = byPeriod.get(row.period) ?? { retainerCents: 0, projectCents: 0 }
    found.retainerCents += row.retainer_cents
    found.projectCents += row.project_cents
    byPeriod.set(row.period, found)
  }
  if (earliest === null) return []

  // Walk back from the anchor, stopping at the window OR at the earliest month
  // with data, whichever comes first.
  const oldest = monthsBefore(currentPeriod, CHART_MONTHS - 1)
  const start = oldest > earliest ? oldest : earliest

  const totals: MonthTotal[] = []
  for (let period = start; period <= currentPeriod; period = monthsBefore(period, -1)) {
    const found = byPeriod.get(period)
    totals.push({
      period,
      retainerCents: found?.retainerCents ?? 0,
      projectCents: found?.projectCents ?? 0,
      entered: found !== undefined,
    })
  }
  return totals
}

/**
 * Rectangles, in SVG coordinates, for a list of months.
 *
 * `gap` is a surface-coloured space between the two stacked segments so they
 * read as two marks rather than one bar that changes colour partway up. It is
 * subtracted from the drawable height rather than added to it, so a full-height
 * month still ends exactly on the baseline.
 */
export function barGeometry(
  totals: readonly MonthTotal[],
  { width, height, gap }: { width: number; height: number; gap: number },
): { bars: Bar[]; maxCents: number } {
  let maxCents = 0
  for (const total of totals) {
    const sum = total.retainerCents + total.projectCents
    if (sum > maxCents) maxCents = sum
  }

  const slot = totals.length === 0 ? 0 : width / totals.length
  // A little air either side of each bar, so adjacent months do not touch --
  // the same reason the two segments get a gap.
  const barWidth = slot * 0.7

  const bars = totals.map((total, index) => {
    const x = slot * index + (slot - barWidth) / 2

    // No maximum means every month is zero; scaling against it would divide by
    // zero and render NaN-tall bars, which in SVG silently draw nothing at all.
    const stacked = total.entered && maxCents > 0
    const usable = height - (total.projectCents > 0 ? gap : 0)
    const retainerHeight = stacked ? (total.retainerCents / maxCents) * usable : 0
    const projectHeight = stacked ? (total.projectCents / maxCents) * usable : 0

    const retainerY = height - retainerHeight
    const projectY = retainerY - gap - projectHeight

    return {
      period: total.period,
      entered: total.entered,
      x,
      width: barWidth,
      retainerY,
      retainerHeight,
      projectY,
      projectHeight,
    }
  })

  return { bars, maxCents }
}
