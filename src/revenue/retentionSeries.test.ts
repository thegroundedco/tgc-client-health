import { describe, expect, it } from 'vitest'
import { axisMax, candidateAnchors, retentionSeries, seriesGeometry, seriesSegments } from './retentionSeries'
import type { SeriesPoint } from './retentionSeries'
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
