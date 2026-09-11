// Which months the billing chart draws. Pure, and separate from the component,
// so the rules below are provable without a DOM -- the same split as
// chartMath, retentionMath, revenueMath, breakdownMath and tenureMath.
//
// EVERY PRESET RESOLVES AGAINST THE DATA, never against today's calendar. The
// anchor is the latest month holding an entry and the earliest is the first,
// which is the rule latestPeriod has enforced since slice 6f-1 and for the
// same reason: on the 2nd of a month almost nothing is entered, and a
// calendar-anchored "last three months" would quietly include a month nobody
// has typed.

export type RangePreset =
  | 'all'
  | 'last3'
  | 'last6'
  | 'last12'
  | 'ytd'
  | 'q1'
  | 'q2'
  | 'q3'
  | 'q4'
  | 'h1'
  | 'h2'
  | 'year'
  | 'custom'

export type Range = { from: string; to: string }

/** What the chart knows about its own data. Both null when nothing is entered. */
export type Extent = { anchor: string | null; earliest: string | null }

// Declared in the order the control offers them: the rolling windows first,
// because they never go stale and work against thin history, then the calendar
// shapes, then everything, then the escape hatch.
export const RANGE_PRESETS: readonly { id: RangePreset; label: string }[] = [
  { id: 'last3', label: 'Last 3 months' },
  { id: 'last6', label: 'Last 6 months' },
  { id: 'last12', label: 'Last 12 months' },
  { id: 'ytd', label: 'Year to date' },
  { id: 'q1', label: 'Q1' },
  { id: 'q2', label: 'Q2' },
  { id: 'q3', label: 'Q3' },
  { id: 'q4', label: 'Q4' },
  { id: 'h1', label: 'First half' },
  { id: 'h2', label: 'Second half' },
  { id: 'year', label: 'Full year' },
  { id: 'all', label: 'All time' },
  { id: 'custom', label: 'Custom…' },
]

// String arithmetic on the year and month numbers, never a parsed Date: a bare
// YYYY-MM-DD parses as UTC midnight, whose local calendar day -- and in
// January its local MONTH -- is the one before in any western zone. The trap
// tenureMath documents at length and every module here avoids the same way.
function shift(period: string, months: number): string {
  const total = Number(period.slice(0, 4)) * 12 + (Number(period.slice(5, 7)) - 1) + months
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}-01`
}

function monthIn(year: string, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}-01`
}

/**
 * The months a preset covers, clamped to what has actually been entered.
 *
 * Null means "this preset shows nothing here" -- a quarter that has not
 * happened, a half that predates the records, or no data at all. The control
 * leaves those out rather than offering a choice that blanks the chart.
 *
 * CLAMPING IS NOT TIDYING. Without it "Full year" would run to December and
 * draw October, November and December as unentered months -- a claim about
 * months that have not happened yet, which is the same lie as a zero for a
 * month nobody typed. Clamping the start likewise stops a twelve-month window
 * padding empty columns over months that predate the agency's records.
 */
export function resolveRange(preset: RangePreset, extent: Extent): Range | null {
  const { anchor, earliest } = extent
  if (preset === 'custom' || anchor === null || earliest === null) return null

  const year = anchor.slice(0, 4)
  let from: string
  let to: string = anchor

  switch (preset) {
    case 'all':
      from = earliest
      break
    case 'last3':
      from = shift(anchor, -2)
      break
    case 'last6':
      from = shift(anchor, -5)
      break
    case 'last12':
      from = shift(anchor, -11)
      break
    case 'ytd':
      from = monthIn(year, 1)
      break
    case 'year':
      from = monthIn(year, 1)
      to = monthIn(year, 12)
      break
    case 'h1':
      from = monthIn(year, 1)
      to = monthIn(year, 6)
      break
    case 'h2':
      from = monthIn(year, 7)
      to = monthIn(year, 12)
      break
    default: {
      const quarter = Number(preset.slice(1))
      from = monthIn(year, quarter * 3 - 2)
      to = monthIn(year, quarter * 3)
    }
  }

  if (from < earliest) from = earliest
  if (to > anchor) to = anchor
  // Entirely outside the data once clamped: not a narrow view, an empty one.
  return from > to ? null : { from, to }
}

/**
 * The presets worth offering for this data.
 *
 * Custom is always last and always present: it is the escape hatch from the
 * presets, and the only way to express a range that is not a calendar shape --
 * "October through March" being the case the owner raised.
 */
// The calendar shapes are ambiguous without a year -- "Q1" in a list says
// nothing about WHICH Q1, and will say less the moment there is more than one
// year of data. The rolling windows need no year: they are relative by
// definition.
const DATED: readonly RangePreset[] = ['ytd', 'q1', 'q2', 'q3', 'q4', 'h1', 'h2', 'year']

export function availablePresets(extent: Extent): { id: RangePreset; label: string }[] {
  const year = extent.anchor?.slice(0, 4) ?? ''
  return RANGE_PRESETS.filter(
    (preset) => preset.id === 'custom' || resolveRange(preset.id, extent) !== null,
  ).map((preset) => ({
    ...preset,
    label: DATED.includes(preset.id) ? `${preset.label} ${year}` : preset.label,
  }))
}
