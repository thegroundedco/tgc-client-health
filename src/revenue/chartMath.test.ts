import { describe, expect, it } from 'vitest'
import {
  CHART_MONTHS,
  axisTicks,
  axisLabels,
  comparisonTotals,
  barGeometry,
  monthRows,
  monthlyTotals,
  type MonthTotal,
  type RevenueRow,
  sharePair,
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

describe('monthRows — the table\'s two derived columns', () => {
  it('totals the two halves of a month', () => {
    const rows = monthRows(totalsOf(['2026-09-01', 400000, 100000]))

    expect(rows[0].totalCents).toBe(500000)
  })

  it('has no change for the first month, because nothing precedes it', () => {
    // Not zero. Zero is a claim that the month matched the one before it, and
    // there is no month before it to match.
    const rows = monthRows(totalsOf(['2026-08-01', 100000, 0], ['2026-09-01', 150000, 0]))

    expect(rows[0].changeCents).toBeNull()
    expect(rows[1].changeCents).toBe(50000)
  })

  it('reports a fall as a negative, not as an absolute', () => {
    const rows = monthRows(totalsOf(['2026-08-01', 150000, 0], ['2026-09-01', 100000, 0]))

    expect(rows[1].changeCents).toBe(-50000)
  })

  it('reports a flat month as ZERO, which is not the same as no answer', () => {
    // The distinction the whole module turns on, in the change column: "we
    // billed the same" is a finding; "we cannot say" is not.
    const rows = monthRows(totalsOf(['2026-08-01', 100000, 0], ['2026-09-01', 100000, 0]))

    expect(rows[1].changeCents).toBe(0)
  })

  // THE rule of this function. A change is a comparison of two months, so it
  // needs both of them; measured against a month nobody entered it is a number
  // the data does not contain.
  it('refuses a change measured against an UNENTERED month', () => {
    const totals: MonthTotal[] = [
      { period: '2026-07-01', retainerCents: 100000, projectCents: 0, entered: true },
      { period: '2026-08-01', retainerCents: 0, projectCents: 0, entered: false },
      { period: '2026-09-01', retainerCents: 150000, projectCents: 0, entered: true },
    ]
    const rows = monthRows(totals)

    expect(rows[1].changeCents).toBeNull()
    // September is entered and July is entered, but AUGUST is the month before
    // September and it is not. Reaching past it to July would compare two
    // months two apart and label the answer "change".
    expect(rows[2].changeCents).toBeNull()
  })

  it('gives an unentered month no total either', () => {
    const totals: MonthTotal[] = [
      { period: '2026-09-01', retainerCents: 0, projectCents: 0, entered: false },
    ]

    expect(monthRows(totals)[0].totalCents).toBeNull()
  })

  it('gives an ENTERED zero month a total of zero and a real change', () => {
    const totals: MonthTotal[] = [
      { period: '2026-08-01', retainerCents: 100000, projectCents: 0, entered: true },
      { period: '2026-09-01', retainerCents: 0, projectCents: 0, entered: true },
    ]
    const rows = monthRows(totals)

    expect(rows[1].totalCents).toBe(0)
    expect(rows[1].changeCents).toBe(-100000)
  })
})

describe('axisLabels — the months under the bars', () => {
  it('abbreviates the month so thirteen of them fit', () => {
    expect(axisLabels(totalsOf(['2026-09-01', 100000, 0]))[0].month).toBe('Sep')
  })

  it('carries the year on the first label, so the axis is dated at all', () => {
    expect(axisLabels(totalsOf(['2025-09-01', 100000, 0]))[0].year).toBe('2025')
  })

  // Thirteen repetitions of the same year is noise. The year is information
  // only where it changes, which is also the one place the reader needs it.
  it('repeats the year only where it CHANGES', () => {
    const labels = axisLabels(
      totalsOf(
        ['2025-11-01', 100000, 0],
        ['2025-12-01', 100000, 0],
        ['2026-01-01', 100000, 0],
        ['2026-02-01', 100000, 0],
      ),
    )

    expect(labels.map((label) => label.year)).toEqual(['2025', null, '2026', null])
  })

  it('labels an unentered month too, because its slot is still on the axis', () => {
    const totals: MonthTotal[] = [
      { period: '2026-08-01', retainerCents: 0, projectCents: 0, entered: false },
    ]

    expect(axisLabels(totals)[0].month).toBe('Aug')
  })

  it('gives one label per bar, in the same order', () => {
    const totals = totalsOf(['2026-07-01', 1, 0], ['2026-08-01', 1, 0], ['2026-09-01', 1, 0])

    expect(axisLabels(totals).map((label) => label.period)).toEqual(
      totals.map((total) => total.period),
    )
  })
})

describe('axisTicks — the y scale', () => {
  it('always starts at zero', () => {
    // Non-negotiable for a bar chart: a bar's LENGTH is the quantity, so a
    // truncated baseline makes a 5% difference look like a doubling.
    expect(axisTicks(1234500)[0]).toBe(0)
  })

  it('ends at or above the tallest bar, never below it', () => {
    // A bar taller than the top gridline would be drawn outside the plot, or
    // clipped -- either way the axis would be describing a chart it does not
    // match.
    for (const max of [1, 999, 100000, 1234500, 10857450, 99999999]) {
      const ticks = axisTicks(max)
      expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(max)
    }
  })

  it('uses round numbers a reader can hold in their head', () => {
    // $108,574.50 rounds up to $125,000, in steps of $25,000. The whole point
    // of the axis is a ROUGH feel, which an exact maximum cannot give.
    expect(axisTicks(10857450)).toEqual([0, 2500000, 5000000, 7500000, 10000000, 12500000])
  })

  it('is evenly spaced', () => {
    for (const max of [500, 48000, 1234500, 10857450]) {
      const ticks = axisTicks(max)
      const step = ticks[1] - ticks[0]
      for (let i = 1; i < ticks.length; i++) {
        expect(ticks[i] - ticks[i - 1]).toBe(step)
      }
    }
  })

  it('keeps the count near what was asked for', () => {
    for (const max of [500, 48000, 1234500, 10857450, 77000000]) {
      const ticks = axisTicks(max, 4)
      expect(ticks.length).toBeGreaterThanOrEqual(3)
      expect(ticks.length).toBeLessThanOrEqual(7)
    }
  })

  it('gives a single zero tick when there is nothing to scale', () => {
    // No revenue at all. Inventing a $0–$100 axis would imply a scale the data
    // does not have.
    expect(axisTicks(0)).toEqual([0])
  })

  it('handles a tiny maximum without collapsing to one step', () => {
    const ticks = axisTicks(500)
    expect(ticks[0]).toBe(0)
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(500)
    expect(ticks.length).toBeGreaterThan(1)
  })
})

describe('barGeometry — scaling to the axis', () => {
  // The consequence of having an axis at all: bars must be measured against
  // the TOP GRIDLINE, not against the tallest bar, or the tallest bar touches
  // the top of the plot while the axis says it is short of the last label.
  it('scales against a given ceiling rather than the tallest bar', () => {
    const { bars } = barGeometry(totalsOf(['2026-09-01', 100000, 0]), SIZE, 200000)

    expect(bars[0].retainerHeight).toBe(100)
  })

  it('still fills the height when no ceiling is given', () => {
    // The behaviour every caller before the axis relied on.
    const { bars } = barGeometry(totalsOf(['2026-09-01', 100000, 0]), SIZE)

    expect(bars[0].retainerHeight).toBe(200)
  })

  it('ignores a ceiling below the data rather than drawing outside the plot', () => {
    const { bars } = barGeometry(totalsOf(['2026-09-01', 100000, 0]), SIZE, 50000)

    expect(bars[0].retainerHeight).toBeLessThanOrEqual(200)
  })
})

describe('monthlyTotals — an explicit range', () => {
  // Slice 6h: the chart's window stops being "the trailing thirteen" and
  // becomes whatever the reader asked for. The old behaviour is the default,
  // so every caller that predates the range control is unchanged.
  it('spans exactly the months given', () => {
    const rows = []
    for (let m = 1; m <= 9; m++) {
      rows.push(row(1, `2026-${String(m).padStart(2, '0')}-01`, 100000))
    }
    const totals = monthlyTotals(rows, '2026-06-01', '2026-04-01')

    expect(totals.map((t) => t.period)).toEqual(['2026-04-01', '2026-05-01', '2026-06-01'])
  })

  it('keeps an unentered month inside the range, as ever', () => {
    const totals = monthlyTotals(
      [row(1, '2026-04-01', 100000), row(1, '2026-06-01', 100000)],
      '2026-06-01',
      '2026-04-01',
    )

    expect(totals.map((t) => t.entered)).toEqual([true, false, true])
  })

  it('still falls back to the trailing window when no start is given', () => {
    const totals = monthlyTotals(
      [row(1, '2026-08-01', 100000), row(1, '2026-09-01', 100000)],
      '2026-09-01',
    )

    expect(totals.map((t) => t.period)).toEqual(['2026-08-01', '2026-09-01'])
  })

  it('does not invent months before the earliest row even when asked', () => {
    // A range reaching past the records would draw empty columns for months
    // the agency has no data for, which reads as "we billed nothing then".
    const totals = monthlyTotals([row(1, '2026-06-01', 100000)], '2026-06-01', '2026-01-01')

    expect(totals.map((t) => t.period)).toEqual(['2026-06-01'])
  })
})

describe('comparisonTotals', () => {
  // Aligned to the primary months BY CONSTRUCTION: each entry is the month a
  // fixed offset behind the primary month at the same index. Pairing two
  // independently-built lists by index would drift the moment one of them was
  // trimmed for want of data, and the drift would be invisible -- every bar
  // would still have a ghost, just the wrong one.
  const PERIODS = ['2026-04-01', '2026-05-01', '2026-06-01']

  it('returns one figure per primary month, offset back', () => {
    const rows = [
      row(1, '2026-01-01', 100000),
      row(1, '2026-02-01', 200000),
      row(1, '2026-03-01', 300000),
    ]

    expect(comparisonTotals(rows, PERIODS, 3)).toEqual([
      { retainerCents: 100000, projectCents: 0 },
      { retainerCents: 200000, projectCents: 0 },
      { retainerCents: 300000, projectCents: 0 },
    ])
  })

  it('keeps the two halves apart, because the comparison bar is stacked too', () => {
    // The owner's call, 2026-09-11: one flat grey block beside a divided one
    // made the halves incomparable. The split has to survive this far.
    expect(comparisonTotals([row(1, '2026-01-01', 100000, 50000)], PERIODS, 3)).toEqual([
      { retainerCents: 100000, projectCents: 50000 },
      null,
      null,
    ])
  })

  it('sums every client in the comparison month', () => {
    const rows = [row(1, '2026-01-01', 100000), row(2, '2026-01-01', 400000)]

    expect(comparisonTotals(rows, PERIODS, 3)[0]).toEqual({
      retainerCents: 500000,
      projectCents: 0,
    })
  })

  // NULL, never zero. A comparison month nobody entered has no ghost at all --
  // a ghost at zero would claim the agency billed nothing then, which is the
  // one thing this codebase refuses to say.
  it('is null for a comparison month with no rows', () => {
    expect(comparisonTotals([], PERIODS, 3)).toEqual([null, null, null])
  })

  it('distinguishes an ENTERED zero from a month nobody entered', () => {
    const rows = [row(1, '2026-01-01', 0, 0)]

    expect(comparisonTotals(rows, PERIODS, 3)).toEqual([
      { retainerCents: 0, projectCents: 0 },
      null,
      null,
    ])
  })

  it('reaches back a year when that is the offset', () => {
    expect(comparisonTotals([row(1, '2025-04-01', 700000)], PERIODS, 12)).toEqual([
      { retainerCents: 700000, projectCents: 0 },
      null,
      null,
    ])
  })
})

describe('barGeometry — the comparison bar', () => {
  it('measures the comparison against the same ceiling as the bar', () => {
    // Two scales on one plot is the dual-axis mistake wearing a different hat.
    const { bars } = barGeometry(totalsOf(['2026-09-01', 100000, 0]), SIZE, 200000, [{ retainerCents: 100000, projectCents: 0 }])

    expect(bars[0].compareRetainerHeight).toBe(100)
    expect(bars[0].retainerHeight).toBe(100)
  })

  it('PAIRS the two bars side by side, at equal width', () => {
    // Two lengths from a common baseline is the easiest comparison the eye can
    // make. The outline this replaced asked the reader to compare an edge with
    // an area, which the owner reported as hard to read.
    const plain = barGeometry(totalsOf(['2026-09-01', 100000, 0]), SIZE)
    const compared = barGeometry(totalsOf(['2026-09-01', 100000, 0]), SIZE, 200000, [{ retainerCents: 50000, projectCents: 0 }])
    const bar = compared.bars[0]

    expect(bar.width).toBeLessThan(plain.bars[0].width)
    expect(bar.compareWidth).toBe(bar.width)
    // Beside, not behind: the comparison begins after the period's bar ends.
    expect(bar.compareX).toBeGreaterThanOrEqual(bar.x + bar.width)
  })

  it('keeps the comparison on the period\u2019s right, always', () => {
    // A fixed order is what lets a reader tell the two apart without relying on
    // colour -- the secondary encoding the comparison's low chroma requires.
    const { bars } = barGeometry(
      totalsOf(['2026-08-01', 100000, 0], ['2026-09-01', 100000, 0]),
      SIZE,
      200000,
      [
        { retainerCents: 50000, projectCents: 0 },
        { retainerCents: 150000, projectCents: 0 },
      ],
    )

    for (const bar of bars) expect(bar.compareX).toBeGreaterThan(bar.x)
  })

  it('keeps the pair inside its own month\u2019s slot', () => {
    const { bars } = barGeometry(
      totalsOf(['2026-08-01', 100000, 0], ['2026-09-01', 100000, 0]),
      SIZE,
      200000,
      [
        { retainerCents: 50000, projectCents: 0 },
        { retainerCents: 50000, projectCents: 0 },
      ],
    )

    expect(bars[0].compareX + bars[0].compareWidth).toBeLessThanOrEqual(bars[1].x)
  })

  it('sits the comparison on the baseline, like the bar', () => {
    const { bars } = barGeometry(totalsOf(['2026-09-01', 100000, 0]), SIZE, 200000, [{ retainerCents: 50000, projectCents: 0 }])

    expect(bars[0].compareRetainerY + (bars[0].compareRetainerHeight ?? 0)).toBe(SIZE.height)
  })

  // A comparison month nobody entered draws nothing. Null is not zero, and a
  // flat bar on the baseline would read as "they billed nothing then".
  it('draws no comparison bar where the comparison has no figure', () => {
    const { bars } = barGeometry(totalsOf(['2026-09-01', 100000, 0]), SIZE, 200000, [null])

    expect(bars[0].compareRetainerHeight).toBeNull()
  })

  it('leaves the bars full width and unpaired when no comparison is given', () => {
    const { bars } = barGeometry(totalsOf(['2026-09-01', 100000, 0]), SIZE, 200000)

    expect(bars[0].compareRetainerHeight).toBeNull()
    expect(bars[0].width).toBeCloseTo(600 * 0.7, 6)
  })

  it('stacks the comparison the same way the period’s bar stacks', () => {
    // Retainer underneath, project above, with the same surface gap between
    // them -- if the two bars stacked differently the eye would have to learn
    // two conventions to read one chart.
    const { bars } = barGeometry(totalsOf(['2026-09-01', 100000, 0]), SIZE, 200000, [
      { retainerCents: 100000, projectCents: 50000 },
    ])
    const bar = bars[0]

    expect(bar.compareRetainerY).toBeGreaterThan(bar.compareProjectY)
    // The gap comes out of the USABLE height, exactly as it does for the
    // period's own bar -- so the two segments together occupy the value's
    // share of (height - gap), not of height. Asserting the latter is what
    // this test tried first, and it was the expectation that was wrong.
    expect((bar.compareRetainerHeight ?? 0) + bar.compareProjectHeight).toBeCloseTo(
      (150000 / 200000) * (SIZE.height - SIZE.gap),
      6,
    )
    expect(bar.compareRetainerY + (bar.compareRetainerHeight ?? 0)).toBe(SIZE.height)
  })

  it('gives a comparison month with no project work no upper segment', () => {
    const { bars } = barGeometry(totalsOf(['2026-09-01', 100000, 0]), SIZE, 200000, [
      { retainerCents: 100000, projectCents: 0 },
    ])

    expect(bars[0].compareProjectHeight).toBe(0)
  })
})

describe('sharePair — what each kind took of the month', () => {
  // The owner, looking at September: "I'd love for there to be a percentage of
  // what each item took up that month... retainer took up 60%, roughly, and
  // project took up 40%."
  it('splits a month into two whole percentages', () => {
    expect(sharePair(600_000, 400_000)).toEqual({ retainer: 60, project: 40 })
  })

  it('ALWAYS sums to 100, even where rounding each alone would not', () => {
    // Concentration learned this the hard way: independently rounded rows added
    // up to 101. One figure is rounded and the other is the remainder, so the
    // pair cannot disagree with itself on screen.
    // THE DISCRIMINATING CASE, and it has to be chosen deliberately: 1:7 is
    // 12.5% and 87.5%, which round INDEPENDENTLY to 13 and 88 -- 101 on screen.
    // A pair picked at random almost always sums to 100 either way, which is
    // why the first version of this test passed against the very bug it was
    // written to catch.
    expect(sharePair(1, 7)).toEqual({ retainer: 13, project: 87 })
    for (const [r, p] of [[1, 7], [7, 1], [3, 5], [5, 3], [1, 2], [335, 1000]]) {
      const each = sharePair(r, p)!
      expect(each.retainer + each.project).toBe(100)
    }
  })

  it('gives a month with no money no shares at all, rather than 0% and 0%', () => {
    // A month nobody billed has no composition. Rendering "0% / 0%" would state
    // a split that does not exist, and 0/0 is NaN besides.
    expect(sharePair(0, 0)).toBeNull()
  })

  it('reads a single-kind month as the whole of it', () => {
    expect(sharePair(500_000, 0)).toEqual({ retainer: 100, project: 0 })
    expect(sharePair(0, 500_000)).toEqual({ retainer: 0, project: 100 })
  })
})
