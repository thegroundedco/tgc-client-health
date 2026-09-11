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
  // Slice 6h. Given, the window is exactly this range; omitted, it is the
  // trailing CHART_MONTHS the chart drew before there was a range control.
  // Either way it never reaches past the earliest row -- see below.
  startPeriod?: string,
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
  const oldest = startPeriod ?? monthsBefore(currentPeriod, CHART_MONTHS - 1)
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
  // The value the top of the plot represents. Given by the caller once there
  // is a Y AXIS, because bars then have to be measured against the top
  // GRIDLINE rather than against the tallest bar -- otherwise the tallest bar
  // touches the top of the plot while the axis says it falls short of the last
  // label, and the axis describes a chart it does not match.
  //
  // Omitted, it falls back to the tallest bar, which is what every caller
  // before the axis relied on. A ceiling BELOW the data is ignored for the
  // same reason: a bar taller than the plot is either drawn outside it or
  // clipped, and both lie.
  scaleTo?: number,
): { bars: Bar[]; maxCents: number } {
  let maxCents = 0
  for (const total of totals) {
    const sum = total.retainerCents + total.projectCents
    if (sum > maxCents) maxCents = sum
  }
  const ceiling = scaleTo !== undefined && scaleTo > maxCents ? scaleTo : maxCents

  const slot = totals.length === 0 ? 0 : width / totals.length
  // A little air either side of each bar, so adjacent months do not touch --
  // the same reason the two segments get a gap.
  const barWidth = slot * 0.7

  const bars = totals.map((total, index) => {
    const x = slot * index + (slot - barWidth) / 2

    // No maximum means every month is zero; scaling against it would divide by
    // zero and render NaN-tall bars, which in SVG silently draw nothing at all.
    const stacked = total.entered && ceiling > 0
    const usable = height - (total.projectCents > 0 ? gap : 0)
    const retainerHeight = stacked ? (total.retainerCents / ceiling) * usable : 0
    const projectHeight = stacked ? (total.projectCents / ceiling) * usable : 0

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

// A month as the TABLE shows it: the two entered halves plus the two figures
// derived from them. Separate from MonthTotal rather than folded into it,
// because barGeometry needs none of this and a geometry type that carries a
// month-over-month delta invites somebody to draw one.
export type MonthRow = MonthTotal & {
  /** null for an unentered month -- there is no total of nothing. */
  totalCents: number | null
  /** null where a change cannot be measured. See monthRows. */
  changeCents: number | null
}

export type AxisLabel = {
  period: string
  /** Abbreviated, so thirteen of them fit under thirteen bars. */
  month: string
  /** The year, only where it changes. null everywhere else. */
  year: string | null
}

/**
 * The months again, with a total and a month-over-month change.
 *
 * `changeCents` is null in three cases, and they are the same case: there is no
 * pair of months to compare. The first month has nothing before it; an
 * unentered month is not one end of a comparison; and neither is the month
 * AFTER an unentered one, because the month immediately before it is the one a
 * change is measured against and nobody entered it. Reaching further back to
 * find a month that was entered would compare two months two apart and label
 * the answer "change".
 *
 * Zero is not null. "We billed the same as last month" is a finding; "we cannot
 * say" is not, and a column that prints $0 for both is lying about one of them.
 */
export function monthRows(totals: readonly MonthTotal[]): MonthRow[] {
  return totals.map((total, index) => {
    const totalCents = total.entered ? total.retainerCents + total.projectCents : null
    const before = index === 0 ? undefined : totals[index - 1]
    const beforeCents =
      before !== undefined && before.entered
        ? before.retainerCents + before.projectCents
        : null

    return {
      ...total,
      totalCents,
      changeCents: totalCents === null || beforeCents === null ? null : totalCents - beforeCents,
    }
  })
}

// Built from the period string rather than a Date. A bare YYYY-MM-DD parses as
// UTC midnight, whose local calendar day -- and in January its local MONTH --
// is the one before in any western zone. monthsBefore above documents the same
// trap; this is the second place in the file that would fall into it.
const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

/**
 * One label per bar, in the same order, so the axis can be laid out as a row of
 * equal cells beneath the chart.
 *
 * The year appears on the first label and then only where it CHANGES. Thirteen
 * repetitions of "2026" is noise, and the one place the reader needs the year
 * is the place it stops being the same one.
 *
 * An unentered month is labelled like any other: its slot is on the axis, and
 * an unlabelled gap in a row of labels reads as a layout fault rather than as
 * the missing month it is.
 */
export function axisLabels(totals: readonly MonthTotal[]): AxisLabel[] {
  let previousYear: string | null = null
  return totals.map((total) => {
    const year = total.period.slice(0, 4)
    const month = MONTH_NAMES[Number(total.period.slice(5, 7)) - 1]
    const label = { period: total.period, month, year: year === previousYear ? null : year }
    previousYear = year
    return label
  })
}

/**
 * Round values from zero up to a ceiling at or above `maxCents`, evenly
 * spaced, for the Y axis.
 *
 * ZERO ALWAYS. A bar's length is the quantity it represents, so a truncated
 * baseline makes a five per cent difference look like a doubling. This is the
 * one axis rule that is not a matter of taste.
 *
 * The step is snapped to 1, 2, 2.5 or 5 times a power of ten -- the values a
 * reader can do arithmetic with at a glance. $108,574.50 becomes a $125,000
 * axis in $25,000 steps, which is the "rough feel" the axis exists to give;
 * an exact maximum of $108,574.50 gives none.
 */
// Five, not four. Four steps against this data rounds $108,574.50 up to a
// $150,000 ceiling and leaves the tallest bar at 72% of the plot height --
// a flatter chart and a coarser scale. Five gives $125,000 in $25,000 steps
// and fills 87%.
export function axisTicks(maxCents: number, count = 5): number[] {
  if (maxCents <= 0) return [0]

  const rough = maxCents / count
  const magnitude = 10 ** Math.floor(Math.log10(rough))
  const normalised = rough / magnitude
  const nice = normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 2.5 ? 2.5 : normalised <= 5 ? 5 : 10
  const step = nice * magnitude

  const ticks: number[] = []
  // Rounded at each step rather than accumulated: a 2.5 x 10^n step is not
  // exactly representable in binary, and adding it repeatedly drifts the later
  // labels off the round numbers that are the whole point.
  for (let i = 0; i * step < maxCents + step; i++) {
    ticks.push(Math.round(i * step))
    if (ticks[ticks.length - 1] >= maxCents) break
  }
  return ticks
}
