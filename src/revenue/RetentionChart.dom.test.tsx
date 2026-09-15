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
  })
})
