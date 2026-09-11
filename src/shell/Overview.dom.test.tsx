// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../revenue/useRetention', () => ({ useRetention: vi.fn() }))
vi.mock('../board/useBoard', () => ({ useBoard: vi.fn() }))

import { Overview } from './Overview'
import { useRetention } from '../revenue/useRetention'
import { useBoard } from '../board/useBoard'

function client(id: number, name: string) {
  return {
    id,
    name,
    status: 'active',
    started_on: '2025-01-01',
    ended_on: null,
    end_reason_code: null,
  }
}

function row(client_id: number, retainer: number) {
  return { client_id, period: '2026-09-01', retainer_cents: retainer, project_cents: 0 }
}

// Acme is 700,000 of 1,000,000 -- 70%. Beta is 300,000 -- 30%. Both over.
const CLIENTS = [client(1, 'Acme'), client(2, 'Beta')]
const ROWS = [row(1, 700000), row(2, 300000)]

function given(over: { board?: unknown; revenue?: unknown } = {}) {
  vi.mocked(useRetention).mockReturnValue({
    status: 'ready',
    loadError: null,
    clients: CLIENTS,
    rows: ROWS,
    reload: vi.fn(),
    ...(over.revenue as object),
  } as ReturnType<typeof useRetention>)
  vi.mocked(useBoard).mockReturnValue({
    status: 'ready',
    loadError: null,
    clients: [],
    checkins: new Map(),
    scores: new Map(),
    submitted: 0,
    activeTotal: 0,
    reload: vi.fn(),
    ...(over.board as object),
  } as ReturnType<typeof useBoard>)
  return render(<Overview />)
}

beforeEach(() => {
  vi.mocked(useRetention).mockReset()
  vi.mocked(useBoard).mockReset()
})
afterEach(() => {
  document.body.innerHTML = ''
})

describe('Overview', () => {
  it('names what the page is for', () => {
    given()

    expect(screen.getByRole('heading', { name: /needs attention/i })).toBeTruthy()
  })

  it('lists a client over a fifth of the revenue, and says why', () => {
    given()

    const item = screen.getByRole('listitem', { name: /Acme/ })
    expect(item.textContent).toMatch(/70%/)
    expect(item.textContent).toMatch(/of revenue/i)
  })

  it('lists a client scoring at risk, and says why', () => {
    given({
      board: {
        clients: [{ id: 3, name: 'Gamma', status: 'active' }],
        scores: new Map([[3, { client_id: 3, overall_score: 1.4, advocacy_applies: false }]]),
      },
    })

    const item = screen.getByRole('listitem', { name: /Gamma/ })
    expect(item.textContent).toMatch(/at risk/i)
  })

  it('gives a client with both problems both reasons, once', () => {
    given({
      board: {
        clients: [{ id: 1, name: 'Acme', status: 'active' }],
        scores: new Map([[1, { client_id: 1, overall_score: 1.2, advocacy_applies: false }]]),
      },
    })

    expect(screen.getAllByRole('listitem', { name: /Acme/ })).toHaveLength(1)
    const item = screen.getByRole('listitem', { name: /Acme/ })
    expect(item.textContent).toMatch(/of revenue/i)
    expect(item.textContent).toMatch(/at risk/i)
  })

  it('says so plainly when nothing needs attention', () => {
    // An empty list on a page whose job is raising alarms reads as broken.
    given({ revenue: { clients: [], rows: [] } })

    expect(screen.queryByRole('list')).toBeNull()
    expect(document.body.textContent).toMatch(/nothing needs attention/i)
  })

  it('states what the percentages are a share OF', () => {
    // There is no range control on this page, so the basis has to be stated or
    // the reader will assume it matches whatever Revenue was last set to.
    given()

    expect(screen.getByTestId('overview-basis').textContent).toMatch(/months|entered/i)
  })

  it('waits rather than declaring all clear while a read is loading', () => {
    // "Nothing needs attention" shown before the data arrives is the most
    // dangerous sentence this page can print.
    given({ revenue: { status: 'loading' } })

    expect(document.body.textContent).not.toMatch(/nothing needs attention/i)
    expect(document.body.textContent).toMatch(/loading/i)
  })

  it('shows a failed read as an error, never as all clear', () => {
    given({ revenue: { status: 'error', loadError: 'permission denied' } })

    expect(screen.getByRole('alert').textContent).toContain('permission denied')
    expect(document.body.textContent).not.toMatch(/nothing needs attention/i)
  })
})
