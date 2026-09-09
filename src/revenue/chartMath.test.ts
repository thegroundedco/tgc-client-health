import { describe, expect, it } from 'vitest'
import {
  CHART_MONTHS,
  barGeometry,
  monthlyTotals,
  type MonthTotal,
  type RevenueRow,
} from './chartMath'

function row(client_id: number, period: string, retainer: number, project = 0): RevenueRow {
  return { client_id, period, retainer_cents: retainer, project_cents: project }
}

describe('monthlyTotals — the window', () => {
  it('names the window as thirteen', () => {
    // A year plus the month that anchors it, matching MIN_RATE_PERIODS and the
    // span retention measures across.
    expect(CHART_MONTHS).toBe(13)
  })

  it('sums both halves across every client in a month', () => {
    const totals = monthlyTotals(
      [row(1, '2026-09-01', 400000, 50000), row(2, '2026-09-01', 100000, 0)],
      '2026-09-01',
    )

    expect(totals).toHaveLength(1)
    expect(totals[0]).toEqual({
      period: '2026-09-01',
      retainerCents: 500000,
      projectCents: 50000,
      entered: true,
    })
  })

  it('shows FEWER bars when there is less history, never padding', () => {
    // Spec section 4.3. Padding to a fixed thirteen would draw empty columns for
    // months that predate the agency's records, which reads as "we billed
    // nothing then" -- the same lie section 4.2 refuses of a line.
    const totals = monthlyTotals(
      [row(1, '2026-08-01', 100000), row(1, '2026-09-01', 100000)],
      '2026-09-01',
    )

    expect(totals.map((total) => total.period)).toEqual(['2026-08-01', '2026-09-01'])
  })

  it('keeps at most thirteen months, oldest dropped first', () => {
    const rows = []
    for (let i = 0; i < 20; i++) {
      const month = ((i % 12) + 1).toString().padStart(2, '0')
      rows.push(row(1, `${2025 + Math.floor(i / 12)}-${month}-01`, 100000))
    }
    const totals = monthlyTotals(rows, '2026-08-01')

    expect(totals).toHaveLength(CHART_MONTHS)
    expect(totals[totals.length - 1].period).toBe('2026-08-01')
  })

  it('KEEPS the slot of a month inside the window that has no rows', () => {
    // THE rule of this module. Dropping the column would slide every later month
    // left and silently change the shape of the year; the gap has to be visible
    // AS a gap, in position. `entered: false` is what the renderer draws nothing
    // for.
    const totals = monthlyTotals(
      [row(1, '2026-07-01', 100000), row(1, '2026-09-01', 100000)],
      '2026-09-01',
    )

    expect(totals.map((total) => total.period)).toEqual([
      '2026-07-01',
      '2026-08-01',
      '2026-09-01',
    ])
    expect(totals[1]).toEqual({
      period: '2026-08-01',
      retainerCents: 0,
      projectCents: 0,
      entered: false,
    })
  })

  it('distinguishes a month that was ENTERED at zero from one nobody entered', () => {
    // The two states must not look alike, so they must not compute alike. A
    // month somebody entered as nothing is a fact about the month; a month
    // nobody touched is not.
    const totals = monthlyTotals(
      [row(1, '2026-08-01', 0, 0), row(1, '2026-09-01', 100000)],
      '2026-09-01',
    )

    expect(totals[0]).toEqual({
      period: '2026-08-01',
      retainerCents: 0,
      projectCents: 0,
      entered: true,
    })
  })

  it('ignores rows after the anchor month', () => {
    // The anchor is the latest month with data, but a caller could pass an
    // earlier one; nothing to its right belongs on the chart.
    const totals = monthlyTotals(
      [row(1, '2026-08-01', 100000), row(1, '2026-09-01', 999999)],
      '2026-08-01',
    )

    expect(totals.map((total) => total.period)).toEqual(['2026-08-01'])
  })

  it('returns nothing at all when no revenue has been entered', () => {
    expect(monthlyTotals([], '2026-09-01')).toEqual([])
  })
})

const SIZE = { width: 600, height: 200, gap: 2 }

function totalsOf(...pairs: [string, number, number][]): MonthTotal[] {
  return pairs.map(([period, retainerCents, projectCents]) => ({
    period,
    retainerCents,
    projectCents,
    entered: true,
  }))
}

describe('barGeometry', () => {
  it('scales the tallest month to the full height', () => {
    const { bars, maxCents } = barGeometry(
      totalsOf(['2026-08-01', 50000, 0], ['2026-09-01', 100000, 0]),
      SIZE,
    )

    expect(maxCents).toBe(100000)
    expect(bars[1].retainerHeight).toBe(200)
    expect(bars[0].retainerHeight).toBe(100)
  })

  it('stacks project work ABOVE the retainer, both measured from the baseline', () => {
    // Retainer underneath because it is the money that recurs; the variable
    // money sits on top of it. y grows downward in SVG, so the retainer's top
    // edge is BELOW the project's.
    const { bars } = barGeometry(totalsOf(['2026-09-01', 75000, 25000]), SIZE)
    const bar = bars[0]

    expect(bar.retainerHeight + bar.projectHeight + SIZE.gap).toBe(200)
    expect(bar.retainerY).toBeGreaterThan(bar.projectY)
    expect(bar.retainerY + bar.retainerHeight).toBe(200)
  })

  it('puts a surface gap between the two segments so they read as two marks', () => {
    // The dataviz skill's mark spec. Without it a stacked bar reads as one bar
    // that changes colour partway up rather than as two quantities.
    const { bars } = barGeometry(totalsOf(['2026-09-01', 50000, 50000]), SIZE)
    const bar = bars[0]

    expect(bar.retainerY - (bar.projectY + bar.projectHeight)).toBe(SIZE.gap)
  })

  it('gives an unentered month NO bar, while keeping its position', () => {
    // The gap, rendered. It holds its x so the months either side do not close
    // over it.
    const totals: MonthTotal[] = [
      { period: '2026-08-01', retainerCents: 0, projectCents: 0, entered: false },
      { period: '2026-09-01', retainerCents: 100000, projectCents: 0, entered: true },
    ]
    const { bars } = barGeometry(totals, SIZE)

    expect(bars[0].entered).toBe(false)
    expect(bars[0].retainerHeight).toBe(0)
    expect(bars[0].projectHeight).toBe(0)
    expect(bars[1].x).toBeGreaterThan(bars[0].x)
  })

  it('gives an ENTERED zero month a visible baseline mark, not nothing', () => {
    // An entered zero is a fact -- "we billed them nothing" -- and must be
    // distinguishable from the gap above. Zero height, but `entered` true, so
    // the renderer can draw a baseline tick where the gap draws none.
    const { bars } = barGeometry(
      totalsOf(['2026-08-01', 0, 0], ['2026-09-01', 100000, 0]),
      SIZE,
    )

    expect(bars[0].entered).toBe(true)
    expect(bars[0].retainerHeight).toBe(0)
  })

  it('refuses to divide when every month is zero', () => {
    // No maximum to scale against. Every bar is flat rather than NaN-tall.
    const { bars, maxCents } = barGeometry(totalsOf(['2026-09-01', 0, 0]), SIZE)

    expect(maxCents).toBe(0)
    expect(bars[0].retainerHeight).toBe(0)
    expect(Number.isNaN(bars[0].retainerHeight)).toBe(false)
  })

  it('spaces bars evenly across the width without overflowing it', () => {
    const { bars } = barGeometry(
      totalsOf(
        ['2026-07-01', 100000, 0],
        ['2026-08-01', 100000, 0],
        ['2026-09-01', 100000, 0],
      ),
      SIZE,
    )

    expect(bars[0].x).toBeGreaterThanOrEqual(0)
    const last = bars[2]
    expect(last.x + last.width).toBeLessThanOrEqual(SIZE.width)
    expect(bars[1].x - bars[0].x).toBe(bars[2].x - bars[1].x)
  })
})
