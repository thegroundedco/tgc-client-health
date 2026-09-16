// @vitest-environment jsdom

import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import type { RevenueRow } from './chartMath'
import type { RetentionClient } from './retentionMath'
import { Value } from './Value'

// No jest-dom in this repo -- every sibling *.dom.test.tsx reads `.textContent`
// directly instead of `toHaveTextContent`/`toBeInTheDocument`, and resets the
// DOM by hand between tests rather than relying on an auto-cleanup this
// project does not install. Following that convention rather than the
// brief's jest-dom calls, which this repo has no package for.
afterEach(() => {
  document.body.innerHTML = ''
})

function client(id: number, name: string, status = 'active'): RetentionClient {
  return { id, name, status, started_on: '2025-01-01', ended_on: null, end_reason_code: null }
}

function row(
  client_id: number,
  period: string,
  retainer_cents: number,
  project_cents: number,
): RevenueRow {
  return { client_id, period, retainer_cents, project_cents }
}

const CLIENTS = [
  client(1, 'Babaloo'),
  client(2, 'Colorfil'),
  client(3, 'Sno-Go', 'churned'),
]

const ROWS = [
  row(1, '2026-01-01', 400_000, 0),
  row(1, '2026-02-01', 400_000, 0),
  row(2, '2026-01-01', 0, 300_000),
  row(3, '2026-01-01', 5_000_000, 0),
]

function draw(over: Partial<React.ComponentProps<typeof Value>> = {}) {
  return render(
    <Value clients={CLIENTS} loadError={null} rows={ROWS} status="ready" {...over} />,
  )
}

describe('What each client is worth', () => {
  it('ranks the most valuable active client first', () => {
    draw()
    const names = screen.getAllByTestId('value-name').map((node) => node.textContent)
    expect(names).toEqual(['Babaloo', 'Colorfil'])
  })

  it('shows what a client has billed and what that is per month', () => {
    draw()
    const babaloo = screen.getByRole('listitem', { name: 'Babaloo' })
    expect(within(babaloo).getByTestId('value-total').textContent).toContain('$8,000')
    expect(within(babaloo).getByTestId('value-rate').textContent).toContain('$4,000')
  })

  it('leaves departed clients out until they are asked for', async () => {
    draw()
    expect(screen.queryByText('Sno-Go')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Show 1 departed' }))
    expect(screen.getByText('Sno-Go')).toBeTruthy()
  })

  // The consequence the spec accepts: a departed client outranks the book.
  it('ranks a revealed departed client into the list, not after it', async () => {
    draw()
    await userEvent.click(screen.getByRole('button', { name: 'Show 1 departed' }))

    const names = screen.getAllByTestId('value-name').map((node) => node.textContent)
    expect(names).toEqual(['Sno-Go', 'Babaloo', 'Colorfil'])
  })

  it('answers the question in a sentence, naming the clients it drew from', () => {
    draw()
    const verdict = screen.getByTestId('value-verdict').textContent ?? ''
    expect(verdict).toContain('Across all 3 clients ever billed')
    expect(verdict).toMatch(/retainer clients are worth more/i)
  })

  // THE MUTANT THIS SLICE INVITES. The verdict is drawn from every client ever
  // billed; the list is filtered. A verdict recomputed from the visible rows
  // would pass every other test here.
  it('does not change the verdict when the list is filtered', async () => {
    draw()
    const before = screen.getByTestId('value-verdict').textContent

    await userEvent.click(screen.getByRole('button', { name: 'Show 1 departed' }))
    expect(screen.getByTestId('value-verdict').textContent).toBe(before)
  })

  it('says so when a read failed, rather than showing an empty ranking', () => {
    draw({ status: 'error', loadError: 'Could not reach the database.' })
    expect(screen.getByRole('alert').textContent).toContain('Could not reach the database.')
    expect(screen.queryByTestId('value-name')).toBeNull()
  })

  it('says nothing has been entered rather than ranking nobody', () => {
    draw({ rows: [] })
    expect(screen.getByText(/No revenue has been entered/)).toBeTruthy()
    expect(screen.queryByTestId('value-name')).toBeNull()
  })
})
