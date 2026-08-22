// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Profile } from '../auth/useProfile'
import type { CardCheckin } from './cardSummary'
import type { UseBoard } from './useBoard'

// TWO mocks, and the second is not optional.
//
// Mocking the hook is the whole reason useBoard exists. Ruling 13 left four
// tests in this file permanently skipped because Board held its read in an
// inline useState/useEffect pair with no seam to mock, and effects never run
// under `renderToStaticMarkup` -- the only renderer available before this repo
// had a DOM. Those four checks are the first four tests below.
//
// `../lib/supabase` must be mocked as well, even though the rewritten Board no
// longer imports it: Board renders CheckIn, CheckIn uses useCheckin, and
// useCheckin imports the client. The unmocked client calls readSupabaseConfig at
// module scope, which THROWS when VITE_ config is absent -- and CI runs
// `npx vitest run` with no VITE_ env at all (test.yml puts that env block on the
// build step only). Without this line the file passes locally off .env.local and
// fails in CI.
vi.mock('../lib/supabase', () => ({ supabase: {} }))
vi.mock('./useBoard', () => ({ useBoard: vi.fn() }))

import { Board } from './Board'
import { useBoard } from './useBoard'

const ME = 'profile-1'

const PROFILE: Profile = {
  id: ME,
  email: 'amy@example.com',
  full_name: 'Amy Account',
  is_active: true,
  role: 'account_manager',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
}

const CLIENTS = [
  { id: 1, name: 'Babaloo' },
  { id: 2, name: 'Colorfil' },
  { id: 3, name: 'Sno-Go' },
]

const SUBMITTED: CardCheckin = {
  total_score: 21,
  submitted_at: '2026-08-21T17:04:00.000Z',
  submitted_by: ME,
  relationship: 5,
  delivery: 4,
  financial: 4,
  sentiment: 4,
  growth: 4,
}

function board(overrides: Partial<UseBoard> = {}): UseBoard {
  return {
    status: 'ready',
    loadError: null,
    clients: CLIENTS,
    checkins: new Map(),
    submitted: 0,
    reload: () => {},
    ...overrides,
  }
}

const given = (state: Partial<UseBoard> = {}) => {
  vi.mocked(useBoard).mockReturnValue(board(state))
  return render(<Board profile={PROFILE} />)
}

const clientList = () => screen.queryByRole('list', { name: /clients/i })

afterEach(() => {
  document.body.innerHTML = ''
  vi.mocked(useBoard).mockReset()
})

describe('the loaded client grid', () => {
  // These four were `it.skip` under Ruling 13. They are the reason useBoard
  // exists.
  it('renders the client name inside a button, not as bare text', () => {
    given()
    for (const client of CLIENTS) {
      const button = screen.getByRole('button', { name: new RegExp(client.name) })
      expect(button.tagName).toBe('BUTTON')
    }
  })

  it('renders exactly one such button per client card', () => {
    given()
    // One per card and nothing else: no Score all 3s, no per-card menu. A second
    // button on a card would sit under the click overlay and stop responding.
    expect(screen.getAllByRole('button')).toHaveLength(CLIENTS.length)
  })

  it('has deleted Score all 3s', () => {
    // §6: it wrote a constant, so it was a guaranteed no-op whenever the data
    // already matched -- the second half of the owner's original finding.
    given()
    expect(screen.queryByRole('button', { name: /Score all 3s/i })).toBeNull()
  })

  it('renders its role="list" with one item per client', () => {
    given()
    expect(clientList()).toBeTruthy()
    expect(screen.getAllByRole('listitem')).toHaveLength(CLIENTS.length)
  })
})

describe('the board', () => {
  it('names the month', () => {
    given()
    expect(screen.getByRole('heading', { level: 2 }).textContent).toMatch(/\w+ 20\d\d/)
  })

  it('counts submissions in the progress line', () => {
    given({ submitted: 2 })
    expect(screen.getByText('2 of 3 check-ins submitted this month')).toBeTruthy()
  })

  it('carries each card its own check-in, and names the viewer in the footer', () => {
    // The wiring test: useBoard's map reaches the right card, and the viewer id
    // reaches cardFooter. Getting the viewer wrong would say "another account
    // manager" about your own work.
    given({ checkins: new Map([[2, SUBMITTED]]), submitted: 1 })

    expect(screen.getByText(/^Submitted .* by you$/)).toBeTruthy()
    expect(screen.getAllByText('Not started')).toHaveLength(2)
  })

  it('says it is loading, and shows no list', () => {
    given({ status: 'loading', clients: [] })
    expect(clientList()).toBeNull()
    // Not a blank screen. "A broken tool looks like an empty one" is the v1
    // failure this whole rebuild exists to end.
    expect(document.body.textContent?.trim()).not.toBe('')
  })

  it('shows a failed read instead of an empty board, and offers a retry', async () => {
    const reload = vi.fn()
    const user = userEvent.setup()
    given({ status: 'error', loadError: 'the connection failed', clients: [], reload })

    expect(screen.getByRole('alert').textContent).toContain('the connection failed')
    expect(clientList()).toBeNull()

    await user.click(screen.getByRole('button', { name: /Try again/i }))
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('says the roster is empty, and how to fix it, rather than rendering nothing', () => {
    given({ clients: [] })
    expect(screen.getByText('No active clients')).toBeTruthy()
    expect(screen.getByText(/Supabase dashboard/)).toBeTruthy()
    expect(clientList()).toBeNull()
  })

  it('never renders a save error, because it can no longer save', () => {
    // Board had two error states: one for a failed read and one for a failed
    // write. The write is gone, so the second would be unreachable code that
    // looks live.
    given()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
