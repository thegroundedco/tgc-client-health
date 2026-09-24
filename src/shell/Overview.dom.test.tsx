// @vitest-environment jsdom

import { render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../revenue/useRetention', () => ({ useRetention: vi.fn() }))
vi.mock('../board/useBoard', () => ({ useBoard: vi.fn() }))
vi.mock('../clients/usePackages', () => ({ usePackages: vi.fn() }))

import { Overview } from './Overview'
import { useRetention } from '../revenue/useRetention'
import { useBoard } from '../board/useBoard'
import { usePackages } from '../clients/usePackages'

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

function stint(client_id: number, package_code: string, started_on: string) {
  return { id: client_id * 100 + Number(started_on.slice(2, 4)), client_id, package_code, started_on, note: null }
}

function given(
  over: {
    board?: unknown
    revenue?: unknown
    packages?: unknown
    role?: string
  } = {},
) {
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
  vi.mocked(usePackages).mockReturnValue({
    status: 'ready',
    loadError: null,
    byClient: new Map(),
    ...(over.packages as object),
  } as ReturnType<typeof usePackages>)
  return render(<Overview role={over.role ?? 'admin'} />)
}

beforeEach(() => {
  vi.mocked(useRetention).mockReset()
  vi.mocked(useBoard).mockReset()
  vi.mocked(usePackages).mockReset()
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
    // Scoped to the attention list's own name: the ladder section below adds
    // its own "Clients by package" list, unrelated to whether anyone needs
    // attention.
    given({ revenue: { clients: [], rows: [] } })

    expect(screen.queryByRole('list', { name: 'Needs attention' })).toBeNull()
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

describe('the ladder', () => {
  it('counts the roster by rung, and says how many are unrecorded', () => {
    given({
      packages: {
        byClient: new Map([[1, [stint(1, 'grow', '2025-01-01')]]]),
      },
    })

    expect(screen.getByTestId('rung-grow').textContent).toBe('1')
    expect(screen.getByTestId('rung-foundation').textContent).toBe('0')
    // Beta has no stint, and is counted as unrecorded rather than dropped.
    expect(screen.getByTestId('rung-unrecorded').textContent).toBe('1')
  })

  it('names a client who has climbed, and the move', () => {
    given({
      packages: {
        byClient: new Map([
          [1, [stint(1, 'foundation', '2025-01-01'), stint(1, 'grow', '2026-01-01')]],
        ]),
      },
    })

    // SCOPED to the climbers list on purpose. Acme is also 70% of revenue, so
    // it has a row in the attention list above with the same accessible name,
    // and an unscoped query matches both and throws.
    const climbers = within(screen.getByRole('list', { name: 'Moved up' }))
    const row = climbers.getByRole('listitem', { name: 'Acme' })
    expect(row.textContent).toContain('Foundation')
    expect(row.textContent).toContain('Grow')
  })

  it('says when nobody has moved', () => {
    given()

    expect(screen.getByText(/no client has changed package yet/i)).toBeTruthy()
  })

  it('refuses the verdict until both sides have enough ended relationships', () => {
    given()

    expect(screen.getByTestId('onramp-verdict').textContent).toMatch(/not answerable yet/i)
    expect(screen.getByTestId('onramp-verdict').textContent).toContain('3')
  })

  it('states the verdict when it can, naming both medians and the sample', () => {
    const departed = (id: number, name: string, ended_on: string) => ({
      id,
      name,
      status: 'former',
      started_on: '2025-01-01',
      ended_on,
      end_reason_code: null,
    })

    given({
      revenue: {
        clients: [
          departed(1, 'Acme', '2026-01-01'),
          departed(2, 'Beta', '2026-01-01'),
          departed(3, 'Gamma', '2026-01-01'),
          departed(4, 'Delta', '2025-03-01'),
          departed(5, 'Epsilon', '2025-03-01'),
          departed(6, 'Zeta', '2025-03-01'),
        ],
        rows: [],
      },
      packages: {
        byClient: new Map([
          [1, [stint(1, 'foundation', '2025-01-01')]],
          [2, [stint(2, 'foundation', '2025-01-01')]],
          [3, [stint(3, 'foundation', '2025-01-01')]],
          [4, [stint(4, 'grow', '2025-01-01')]],
          [5, [stint(5, 'grow', '2025-01-01')]],
          [6, [stint(6, 'grow', '2025-01-01')]],
        ]),
      },
    })

    const verdict = screen.getByTestId('onramp-verdict').textContent ?? ''
    expect(verdict).toMatch(/joined at Foundation stayed longer/i)
    expect(verdict).toContain('from 3 and 3 ended relationships')
  })

  // BOTH GATES. Deleting either must fail.
  it('is absent entirely for somebody who cannot read packages', () => {
    given({ role: 'viewer' })

    expect(screen.queryByText(/moving up the ladder/i)).toBeNull()
    expect(screen.queryByTestId('rung-unrecorded')).toBeNull()
  })

  it('does not ask for packages it may not read', () => {
    given({ role: 'viewer' })

    expect(vi.mocked(usePackages)).toHaveBeenCalledWith(false)
  })

  // The degradation rule: a failed secondary read must not blank the page.
  it('reports a failed package read and still shows what needs attention', () => {
    given({
      packages: { status: 'error', loadError: 'permission denied for table client_packages' },
    })

    expect(screen.getByRole('alert').textContent).toContain('permission denied')
    // Acme is 70% of revenue and must still be listed.
    expect(screen.getByRole('listitem', { name: 'Acme' })).toBeTruthy()
  })

  it('does not make the attention list wait for the packages', () => {
    given({ packages: { status: 'loading' } })

    expect(screen.getByRole('listitem', { name: 'Acme' })).toBeTruthy()
  })

  // Task 2's onRampComparison unit tests already cover the 'above' branch of
  // verdictSentence; this proves the PAGE actually renders it rather than
  // always taking the 'foundation' wording it happens to share a shape with.
  it('states the verdict the other way when the above-Foundation group stayed longer', () => {
    const departed = (id: number, name: string, ended_on: string) => ({
      id,
      name,
      status: 'former',
      started_on: '2025-01-01',
      ended_on,
      end_reason_code: null,
    })

    given({
      revenue: {
        clients: [
          departed(1, 'Acme', '2025-03-01'),
          departed(2, 'Beta', '2025-03-01'),
          departed(3, 'Gamma', '2025-03-01'),
          departed(4, 'Delta', '2026-01-01'),
          departed(5, 'Epsilon', '2026-01-01'),
          departed(6, 'Zeta', '2026-01-01'),
        ],
        rows: [],
      },
      packages: {
        byClient: new Map([
          [1, [stint(1, 'foundation', '2025-01-01')]],
          [2, [stint(2, 'foundation', '2025-01-01')]],
          [3, [stint(3, 'foundation', '2025-01-01')]],
          [4, [stint(4, 'grow', '2025-01-01')]],
          [5, [stint(5, 'grow', '2025-01-01')]],
          [6, [stint(6, 'grow', '2025-01-01')]],
        ]),
      },
    })

    const verdict = screen.getByTestId('onramp-verdict').textContent ?? ''
    expect(verdict).toMatch(/joined above Foundation stayed longer/i)
  })
})
