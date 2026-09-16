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
  client(1, 'Client Alpha'),
  client(2, 'Client Bravo'),
  client(3, 'Client Charlie', 'former'),
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
    expect(names).toEqual(['Client Alpha', 'Client Bravo'])
  })

  it('shows what a client has billed and what that is per month', () => {
    draw()
    const alpha = screen.getByRole('listitem', { name: 'Client Alpha' })
    expect(within(alpha).getByTestId('value-total').textContent).toContain('$8,000')
    expect(within(alpha).getByTestId('value-rate').textContent).toContain('$4,000')
  })

  it('leaves departed clients out until they are asked for', async () => {
    draw()
    expect(screen.queryByText('Client Charlie')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Show 1 departed' }))
    expect(screen.getByText('Client Charlie')).toBeTruthy()
  })

  // The consequence the spec accepts: a departed client outranks the book.
  it('ranks a revealed departed client into the list, not after it', async () => {
    draw()
    await userEvent.click(screen.getByRole('button', { name: 'Show 1 departed' }))

    const names = screen.getAllByTestId('value-name').map((node) => node.textContent)
    expect(names).toEqual(['Client Charlie', 'Client Alpha', 'Client Bravo'])
  })

  // The two figures are asserted IN THEIR ROLES, not merely present. Swapping
  // the winner's median for the loser's renders "retainer clients are worth
  // more: the typical one has billed $3,000, against $29,000 for the typical
  // project client" -- a sentence contradicting its own numbers, on the
  // page's headline finding.
  it('answers the question in a sentence, naming the clients it drew from', () => {
    draw()
    const verdict = screen.getByTestId('value-verdict').textContent ?? ''
    expect(verdict).toBe(
      'Across all 3 clients ever billed, retainer clients are worth more: the typical one ' +
        'has billed $29,000, against $3,000 for the typical project client.',
    )
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

// THE VERDICT THIS SLICE IS MOST LIKELY TO GET WRONG, at the layer the owner
// actually reads. valueMath proves `winner` takes 'project' and null, but
// every fixture above confirms the boss's belief, so the SENTENCE was free to
// be hard-coded to "retainer" and pass all of it. The whole point of this
// section is that the answer may contradict him.
describe('the verdict sentence, in every branch it has', () => {
  function drawVerdict(clients: RetentionClient[], rows: RevenueRow[]) {
    render(<Value clients={clients} loadError={null} rows={rows} status="ready" />)
    return screen.getByTestId('value-verdict').textContent ?? ''
  }

  it('says PROJECT clients are worth more when they are', () => {
    const verdict = drawVerdict(
      [client(1, 'Client Alpha'), client(2, 'Client Bravo')],
      [row(1, '2026-01-01', 100_000, 0), row(2, '2026-01-01', 0, 900_000)],
    )

    expect(verdict).toBe(
      'Across all 2 clients ever billed, project clients are worth more: the typical one ' +
        'has billed $9,000, against $1,000 for the typical retainer client.',
    )
  })

  // A DEAD HEAT IS REPORTED AS A DEAD HEAT. Resolving it toward the belief
  // being tested would be the section manufacturing its own evidence.
  it('calls a dead heat a dead heat rather than picking a side', () => {
    const verdict = drawVerdict(
      [client(1, 'Client Alpha'), client(2, 'Client Bravo')],
      [row(1, '2026-01-01', 500_000, 0), row(2, '2026-01-01', 0, 500_000)],
    )

    expect(verdict).toBe(
      'Across all 2 clients ever billed, retainer and project clients are worth about the ' +
        'same: $5,000 for the typical client of either kind.',
    )
  })

  // Spec 2.1 requires the sentence to name its population, and this branch
  // was the one verdict that did not.
  it('names its population even when there is nothing to compare', () => {
    const verdict = drawVerdict(
      [client(1, 'Client Alpha'), client(2, 'Client Bravo')],
      [row(1, '2026-01-01', 100_000, 0), row(2, '2026-01-01', 900_000, 0)],
    )

    expect(verdict).toBe(
      'Across all 2 clients ever billed, only one kind of client has billed anything, so ' +
        'there is nothing to compare.',
    )
  })
})

// More than ten clients, which nothing above builds -- so the length control
// was never rendered, never pressed, and its render condition could be
// replaced with `false` without a test noticing.
describe('how much of the list is drawn', () => {
  // Descending totals, so the ranking is Client 1 .. Client 14 and a row count
  // is enough to say how much was drawn.
  function manyClients(activeCount: number): RetentionClient[] {
    return Array.from({ length: 14 }, (_, index) =>
      client(
        index + 1,
        `Client ${index + 1}`,
        index < activeCount ? 'active' : index % 2 === 0 ? 'former' : 'cancelled',
      ),
    )
  }

  const MANY_ROWS = Array.from({ length: 14 }, (_, index) =>
    index % 2 === 0
      ? row(index + 1, '2026-01-01', (14 - index) * 100_000, 0)
      : row(index + 1, '2026-01-01', 0, (14 - index) * 100_000),
  )

  function drawMany(activeCount: number) {
    render(
      <Value clients={manyClients(activeCount)} loadError={null} rows={MANY_ROWS} status="ready" />,
    )
  }

  const rowCount = () => screen.queryAllByTestId('value-name').length

  it('draws ten of fourteen until the reader asks for the rest', async () => {
    drawMany(14)
    expect(rowCount()).toBe(10)

    await userEvent.click(screen.getByRole('button', { name: 'Show all 14' }))
    expect(rowCount()).toBe(14)

    await userEvent.click(screen.getByRole('button', { name: 'Show top 10' }))
    expect(rowCount()).toBe(10)
  })

  // THE INTERFERENCE. Length and eligibility are independent controls, and
  // `showAll` is state that outlives a change in eligibility: this sequence
  // used to end with "Show top 10" offered above a list of two, which changed
  // nothing when pressed and then disappeared.
  it('withdraws the length control when hiding the departed shortens the list', async () => {
    drawMany(2)
    expect(rowCount()).toBe(2)
    expect(screen.queryByRole('button', { name: /Show all|Show top/ })).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Show 12 departed' }))
    expect(rowCount()).toBe(10)

    await userEvent.click(screen.getByRole('button', { name: 'Show all 14' }))
    expect(rowCount()).toBe(14)

    await userEvent.click(screen.getByRole('button', { name: 'Hide 12 departed' }))
    expect(rowCount()).toBe(2)
    expect(screen.queryByRole('button', { name: /Show all|Show top/ })).toBeNull()
  })
})
