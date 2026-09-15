// @vitest-environment jsdom

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

// WHERE THE STROKE STYLES ARE ASSERTED, AND WHY NOT HERE. jsdom resolves no
// CSS module: every className below is an opaque string and getComputedStyle
// reports nothing, so this file can only say the two lines carry DIFFERENT
// classes -- which stays true if the dash pattern is deleted and the two lines
// become indistinguishable. The stylesheet is therefore read as SOURCE, the way
// tests/revenueLiterals.test.ts and src/styles/tokenRules.ts read theirs, in
// tests/revenueLayout.test.ts: "draws GRR dashed and NRR solid". It lives out
// there rather than in src/ because it needs node:fs and tsconfig.app.json
// gives src/ no Node types -- `tsc -b` fails on the import, and a green test
// run is not a green build.

describe('RetentionChart', () => {
  it('draws both series and names them without relying on colour', () => {
    render(<RetentionChart clients={clients} months={1} rows={rows} />)
    // Named in text, at the end of each line -- not in a colour key. The
    // primary reader of this page is colourblind.
    expect(screen.getByText('NRR')).toBeTruthy()
    expect(screen.getByText('GRR')).toBeTruthy()
  })

  it('distinguishes the two lines by stroke style, not colour alone', () => {
    const { container } = render(<RetentionChart clients={clients} months={1} rows={rows} />)
    const nrr = container.querySelector('[data-testid="retention-series-nrr"]')
    const grr = container.querySelector('[data-testid="retention-series-grr"]')
    expect(nrr).not.toBeNull()
    expect(grr).not.toBeNull()
    expect(nrr?.getAttribute('class')).not.toBe(grr?.getAttribute('class'))

    // The classes the stylesheet test names, so the two files are provably
    // about the same two lines.
    expect(nrr?.getAttribute('class')).toContain('retentionNrr')
    expect(grr?.getAttribute('class')).toContain('retentionGrr')
  })

  it('keeps the rate scale clear of the series labels', () => {
    // They shared the right margin once: on the real data the "25%" tick and
    // the "NRR" label printed on top of each other, and that label is the only
    // thing identifying the solid line for a reader who cannot use colour.
    const { container } = render(<RetentionChart clients={clients} months={1} rows={rows} />)
    const labels = [...container.querySelectorAll('text')]
    const ticks = labels.filter((t) => t.textContent?.includes('%'))
    const ends = labels.filter((t) => t.textContent === 'NRR' || t.textContent === 'GRR')
    expect(ticks.length).toBeGreaterThan(1)
    expect(ends).toHaveLength(2)
    const tickX = Math.max(...ticks.map((t) => Number(t.getAttribute('x'))))
    const endX = Math.min(...ends.map((t) => Number(t.getAttribute('x'))))
    expect(tickX).toBeLessThan(endX)
  })

  it('prises the two end labels apart when the rates coincide', () => {
    // NRR equals GRR whenever nothing expanded -- two months of the real data
    // do it -- and equal rates put both labels on one baseline.
    const flat: RetentionRow[] = [
      { client_id: 1, period: '2025-01-01', retainer_cents: 100_000 },
      { client_id: 1, period: '2025-02-01', retainer_cents: 60_000 },
    ]
    const { container } = render(<RetentionChart clients={clients} months={1} rows={flat} />)
    const ends = [...container.querySelectorAll('text')].filter(
      (t) => t.textContent === 'NRR' || t.textContent === 'GRR',
    )
    expect(ends).toHaveLength(2)
    const [a, b] = ends.map((t) => Number(t.getAttribute('y')))
    expect(Math.abs(a - b)).toBeGreaterThanOrEqual(14)
  })
})
