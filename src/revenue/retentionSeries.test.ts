import { describe, expect, it } from 'vitest'
import {
  anchorAxis,
  axisMax,
  pointAnchors,
  retentionSeries,
  seriesGeometry,
  seriesSegments,
} from './retentionSeries'
import type { SeriesPoint } from './retentionSeries'
import { retention } from './retentionMath'
import type { RetentionClient, RetentionRow } from './retentionMath'
import { baseForWindow } from './retentionControls'

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

/** A client who left. retention() reads a missing row from one of these as a
 *  churn ZERO -- the single place in the codebase where absence is a zero. */
function departed(id: number, name: string, ended_on: string): RetentionClient {
  return { id, name, status: 'ended', started_on: null, ended_on, end_reason_code: null }
}

const month = (n: number) => `2025-${String(n).padStart(2, '0')}-01`

/** Twelve entered months of 2025, minus whichever the caller leaves out. */
function year(skip: number[] = []): RetentionRow[] {
  return [...Array(12).keys()]
    .map((i) => i + 1)
    .filter((m) => !skip.includes(m))
    .map((m) => row(1, month(m), 100_000))
}

describe('pointAnchors — the months that may carry a point', () => {
  // Thirteen entered months, so every one of the owner's four windows has
  // something to reach back to. The count is different at each, which is the
  // point: the series length is not a constant anyone may assume.
  const rows = [...year(), row(1, '2026-01-01', 100_000)]

  it('offers every entered month whose window reaches back to real data', () => {
    expect(pointAnchors(rows, 1)).toEqual([
      ...[2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(month),
      '2026-01-01',
    ])
    expect(pointAnchors(rows, 3)).toEqual([
      ...[4, 5, 6, 7, 8, 9, 10, 11, 12].map(month),
      '2026-01-01',
    ])
    expect(pointAnchors(rows, 6)).toEqual([
      ...[7, 8, 9, 10, 11, 12].map(month),
      '2026-01-01',
    ])
    // Twelve months of data reach exactly one twelve-month anchor.
    expect(pointAnchors(rows, 12)).toEqual(['2026-01-01'])
  })

  it('leaves an unentered month out — it can carry no point', () => {
    // June is not in the data at all. An anchor month with no retainer revenue
    // is not a 0% month; it is a month nobody entered.
    expect(pointAnchors(year([6]), 3)).not.toContain(month(6))
  })
})

describe('anchorAxis — the x axis keeps a slot for the missing month', () => {
  it('walks the calendar rather than listing the anchors it was given', () => {
    // April, May, July, August: the anchors a three-month window offers over a
    // 2025 missing June. The axis must still be five months wide, or May and
    // July are drawn as neighbours and the line runs straight through a month
    // that has no width at all.
    const axis = anchorAxis([month(4), month(5), month(7), month(8)])
    expect(axis).toEqual([month(4), month(5), month(6), month(7), month(8)])
  })

  it('crosses a year boundary by month arithmetic, not by parsing dates', () => {
    // A bare YYYY-MM-DD parses as UTC midnight, which in any western zone is
    // the previous local day -- and in January the previous local MONTH.
    expect(anchorAxis(['2025-11-01', '2026-02-01'])).toEqual([
      '2025-11-01',
      '2025-12-01',
      '2026-01-01',
      '2026-02-01',
    ])
  })

  it('is empty when there are no anchors', () => {
    expect(anchorAxis([])).toEqual([])
  })
})

describe('retentionSeries — the points', () => {
  const clients = [client(1, 'Alpha')]
  const rows = [
    row(1, '2025-01-01', 100_000),
    row(1, '2025-02-01', 50_000),
    row(1, '2025-03-01', 100_000),
  ]

  it('produces one point per anchor, agreeing with retention() itself', () => {
    const anchors = pointAnchors(rows, 1)
    const points = retentionSeries(clients, rows, anchors, 1)
    expect(points.map((p) => p.anchor)).toEqual(['2025-02-01', '2025-03-01'])
    // February against January: half the retainer retained.
    expect(points[0].nrr).toBeCloseTo(0.5)
    expect(points[0].basePeriod).toBe('2025-01-01')

    // THE AGREEMENT. Not "a point was produced with a plausible number" but
    // "the point IS what the headline function returns for the same anchor and
    // window" -- the assertion that makes "right by construction" true rather
    // than merely intended. A reimplementation of the rate in this module
    // would fail here.
    const last = points[points.length - 1]
    const headline = retention(clients, rows, last.anchor, baseForWindow(last.anchor, 1))
    expect(last.nrr).toBe(headline.nrr)
    expect(last.grr).toBe(headline.grr)
    expect(last.basePeriod).toBe(headline.basePeriod)
    // Non-vacuity: `toBe(null) === toBe(null)` would pass while measuring
    // nothing, and null is exactly what an unusable base returns.
    expect(headline.nrr).not.toBeNull()
  })

  it('produces NO POINT at an unentered anchor, rather than a 0% collapse', () => {
    // THE 0% NOBODY WOULD SEE COMING. retention() returns null rates only when
    // the BASE is empty. An unentered ANCHOR month against an entered base is
    // arithmetically 0/base, because a client who has left reads as a churn
    // zero -- so a month nobody has typed yet plots as total collapse, and
    // nothing downstream can tell that 0% from a real one.
    //
    // Gamma left in May. June is entered for nobody.
    const roster = [client(1, 'Alpha'), departed(2, 'Gamma', '2025-05-20')]
    const rowsWithGap = [
      ...year([6]),
      ...[1, 2, 3, 4, 5].map((m) => row(2, month(m), 100_000)),
    ]

    // Non-vacuity, and the reason the guard is not decorative: this is what
    // the arithmetic really says about that anchor.
    expect(retention(roster, rowsWithGap, month(6), month(3)).nrr).toBe(0)

    const anchors = pointAnchors(rowsWithGap, 3)
    expect(anchors).not.toContain(month(6))
    const points = retentionSeries(roster, rowsWithGap, anchors, 3)
    expect(points.map((p) => p.anchor)).not.toContain(month(6))
    // The surrounding months DID produce points, so the absence above is
    // June's and not the whole series failing to compute.
    expect(points.map((p) => p.anchor)).toContain(month(5))
    expect(points.map((p) => p.anchor)).toContain(month(7))

    // And the guard holds when the AXIS is handed in instead of the anchors --
    // the obvious simplification, and the one that would fabricate the zero.
    const overTheAxis = retentionSeries(roster, rowsWithGap, anchorAxis(anchors), 3)
    expect(overTheAxis.map((p) => p.anchor)).not.toContain(month(6))
    expect(overTheAxis.map((p) => p.anchor)).toEqual(points.map((p) => p.anchor))
    expect(overTheAxis.some((p) => p.nrr === 0)).toBe(false)
  })

  it('drops an anchor whose BASE month was never entered', () => {
    // September against June at a three-month window: the base is missing, so
    // there is nothing to measure against and retention() returns null rates.
    const rowsWithGap = year([6])
    const anchors = pointAnchors(rowsWithGap, 3)
    const points = retentionSeries(clients, rowsWithGap, anchors, 3)
    expect(points.map((p) => p.anchor)).not.toContain(month(9))
    expect(retention(clients, rowsWithGap, month(9), month(6)).nrr).toBeNull()
  })
})

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

  it('breaks at an unentered month, measured over the real axis', () => {
    // End to end over the axis the chart actually draws: 2025 without June, at
    // a three-month window. June carries no point because nobody entered it,
    // and September carries none because its base is June.
    const clients = [client(1, 'Alpha')]
    const rowsWithGap = year([6])
    const anchors = pointAnchors(rowsWithGap, 3)
    const axis = anchorAxis(anchors)
    const points = retentionSeries(clients, rowsWithGap, anchors, 3)
    const segments = seriesSegments(points, axis)
    expect(segments.map((s) => s.map((p) => p.anchor))).toEqual([
      [month(4), month(5)],
      [month(7), month(8)],
      [month(10), month(11), month(12)],
    ])
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
  const anchors = ['2025-02-01', '2025-03-01', '2025-04-01', '2025-05-01']
  const at = (anchor: string, nrr: number): SeriesPoint =>
    ({ anchor, basePeriod: '2025-01-01', nrr, grr: nrr })

  it('puts 0% on the floor and the axis maximum on the ceiling', () => {
    const g = seriesGeometry([[at('2025-02-01', 0), at('2025-05-01', 1)]], anchors, 100, 200, 80)
    expect(g.nrr[0]).toBe('0.00,80.00 200.00,0.00')
  })

  it('leaves a gap its width on the x axis', () => {
    // FOUR slots, two points: February at slot 0 and April at slot 2 of 3.
    // x comes from the SLOT, so April lands two thirds along at 133.33. An
    // implementation that used a point's position among the points instead
    // would put it at the end, at 200 -- which is the whole bug this test
    // exists to catch, and it could not see it with three slots.
    const g = seriesGeometry(
      [[at('2025-02-01', 0.5)], [at('2025-04-01', 0.5)]], anchors, 100, 200, 80)
    expect(g.nrr[0]).toBe('0.00,40.00')
    expect(g.nrr[1]).toBe('133.33,40.00')
  })
})
