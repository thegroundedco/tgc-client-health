// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MonthPanel } from './MonthPanel'
import type { RevenueRow } from './chartMath'
import type { RetentionClient } from './retentionMath'

const PERIOD = '2026-08-01'
const BEFORE = '2026-07-01'

function client(id: number, name: string, over: Partial<RetentionClient> = {}): RetentionClient {
  return { id, name, started_on: '2020-01-01', ended_on: null, end_reason_code: null, ...over }
}

function row(client_id: number, period: string, retainer: number, project = 0): RevenueRow {
  return { client_id, period, retainer_cents: retainer, project_cents: project }
}

const CLIENTS = [client(1, 'Acme'), client(2, 'Beta')]
const ROWS: RevenueRow[] = [
  row(1, BEFORE, 400000),
  row(2, BEFORE, 200000),
  row(1, PERIOD, 500000, 100000),
  row(2, PERIOD, 200000),
]

afterEach(() => {
  document.body.innerHTML = ''
})

function show(over: Partial<Parameters<typeof MonthPanel>[0]> = {}) {
  return render(
    <MonthPanel
      clients={CLIENTS}
      onClose={vi.fn()}
      period={PERIOD}
      rows={ROWS}
      {...over}
    />,
  )
}

describe('MonthPanel', () => {
  it('names the month it is showing', () => {
    show()

    expect(screen.getByRole('heading', { name: /August 2026/ })).toBeTruthy()
  })

  it('lists every client with an entry, biggest first, split in two', () => {
    show()

    const table = screen.getByRole('table', { name: /August 2026/ })
    expect(table.textContent).toContain('Acme')
    expect(table.textContent).toContain('$5,000')
    expect(table.textContent).toContain('$1,000')
    expect(table.textContent).toContain('$6,000')

    const names = screen
      .getAllByTestId('month-panel-client')
      .map((node) => node.textContent)
    expect(names).toEqual(['Acme', 'Beta'])
  })

  it('gives the month a total, split into its two halves', () => {
    show()

    const total = screen.getByTestId('month-panel-total').textContent ?? ''
    expect(total).toContain('$8,000')
    expect(total).toContain('$7,000')
    expect(total).toContain('$1,000')
  })

  // The owner's ask: the point of opening a month is the figure, and having to
  // scroll a client list to reach it puts the answer behind the workings.
  it('puts the total ABOVE the client list, not after it', () => {
    show()

    const total = screen.getByTestId('month-panel-total')
    const table = screen.getByRole('table', { name: /August 2026/ })
    // Node.DOCUMENT_POSITION_FOLLOWING: the table comes after the total.
    expect(total.compareDocumentPosition(table) & 4).toBeTruthy()
  })

  it('does not repeat the total at the foot of the table', () => {
    // Said once. Two copies of one figure is two things to keep in step, and
    // the reason to have it at the bottom was that it was not at the top.
    show()

    expect(screen.getByRole('table', { name: /August 2026/ }).querySelector('tfoot')).toBeNull()
  })

  it('shows no total for a month nobody entered', () => {
    // $0 would be a claim about the month. There is no total of nothing.
    show({ rows: [] })

    expect(screen.queryByTestId('month-panel-total')).toBeNull()
  })

  // The owner's ask, moved here from the tooltip because this is the only
  // place with room for the sentence that makes it defensible.
  it('reports retention against the month BEFORE, not against last year', () => {
    show()

    const rate = screen.getByTestId('month-panel-rate').textContent ?? ''
    // 700,000 against 600,000 = 117% net.
    expect(rate).toContain('117%')
    expect(rate).toContain('net')
    expect(screen.getByTestId('month-panel-window').textContent).toContain('July 2026')
  })

  it('carries the basis sentence with the rate, never the rate alone', () => {
    // Spec 6e §3.1 objection 3, and the reason the figure is not in a tooltip.
    show()

    expect(screen.getByTestId('month-panel-basis').textContent).toContain('Based on 2 of 2')
  })

  it('says how many clients have NO entry rather than listing them at zero', () => {
    // Spec 6e §4.1. A table with a gap looks unfinished, which is exactly the
    // pressure that puts $0 in it and turns "nobody said" into "we billed
    // them nothing".
    show({ clients: [...CLIENTS, client(3, 'Silent')] })

    expect(screen.getByTestId('month-panel-missing').textContent).toMatch(/1 client/)
    expect(screen.queryByText('Silent')).toBeNull()
  })

  it('says nothing about missing clients when none are missing', () => {
    show()

    expect(screen.queryByTestId('month-panel-missing')).toBeNull()
  })

  it('lists a client whose entry is zero, because somebody entered it', () => {
    show({
      clients: [...CLIENTS, client(3, 'Free')],
      rows: [...ROWS, row(3, PERIOD, 0, 0)],
    })

    expect(screen.getByText('Free')).toBeTruthy()
    expect(screen.queryByTestId('month-panel-missing')).toBeNull()
  })

  it('says a month was never entered rather than showing an empty table', () => {
    show({ rows: [] })

    expect(screen.queryByRole('table')).toBeNull()
    expect(document.body.textContent).toMatch(/no entries|not entered/i)
  })

  it('refuses a rate when the month before it has nothing entered', () => {
    // Both rates share a denominator, so both are null together. Printing a
    // percentage here would be inventing one.
    show({ rows: [row(1, PERIOD, 500000)] })

    expect(screen.queryByTestId('month-panel-rate')).toBeNull()
    expect(document.body.textContent).toMatch(/July 2026 has no entered revenue/i)
  })

  it('closes on the close button', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    show({ onClose })

    await user.click(screen.getByRole('button', { name: /close/i }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes on Escape, so it is dismissable without hunting for the button', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    show({ onClose })

    await user.keyboard('{Escape}')

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
