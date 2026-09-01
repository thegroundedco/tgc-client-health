// @vitest-environment jsdom

import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Profile } from '../auth/useProfile'
import { currentPeriod, defaultPeriod, formatPeriod, periodOptions, previousPeriod } from '../lib/month'
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
// The third mock, and it is not optional. Board now renders ClientsAdmin, which
// uses useClients, which imports the Supabase client. `supabase` is mocked as
// `{}` above, so an unmocked useClients would call `.from` on an empty object
// and this file would fail on navigation rather than on anything it is testing.
vi.mock('../clients/useClients', () => ({
  useClients: () => ({
    status: 'ready',
    loadError: null,
    clients: [],
    owners: [],
    addState: { kind: 'idle' },
    editState: { kind: 'idle' },
    editStateFor: null,
    reload: vi.fn(),
    addClient: vi.fn(),
    saveClient: vi.fn(),
    resetAdd: vi.fn(),
    resetEdit: vi.fn(),
  }),
}))

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
  { id: 1, name: 'Babaloo', status: 'active', started_on: null },
  { id: 2, name: 'Colorfil', status: 'active', started_on: null },
  { id: 3, name: 'Sno-Go', status: 'active', started_on: null },
]

// REPAIR (task 4, not in its step list): this fixture used to be built from
// total_score and the five retired pillar columns. Both are gone from
// CardCheckin -- the six bucket score columns replaced them -- so it is
// rebuilt from client_id, submitted_at, submitted_by and those six.
const SUBMITTED: CardCheckin = {
  client_id: 2,
  submitted_at: '2026-08-21T17:04:00.000Z',
  submitted_by: ME,
  comm_score: 5,
  growth_score: 4,
  fin_score: 4,
  rel_score: 4,
  del_score: 4,
  adv_score: 4,
}

function board(overrides: Partial<UseBoard> = {}): UseBoard {
  return {
    status: 'ready',
    loadError: null,
    clients: CLIENTS,
    checkins: new Map(),
    // REPAIR (task 4, not in its step list): task 2 added `scores` to
    // UseBoard, so this helper stopped typechecking without it. `overrides`
    // below replaces it exactly as it already does for the other fields.
    scores: new Map(),
    submitted: 0,
    // All three of CLIENTS are active, so this is the same number as
    // clients.length here -- but it is a separate field, and overrides below
    // that shrink clients must shrink this too.
    activeTotal: 3,
    reload: () => {},
    ...overrides,
  }
}

const given = (state: Partial<UseBoard> = {}) => {
  vi.mocked(useBoard).mockReturnValue(board(state))
  return render(<Board profile={PROFILE} />)
}

const clientList = () => screen.queryByRole('list', { name: /clients/i })

// Module scope, not inside one describe: both 'reaching the clients admin'
// and 'the show-archived toggle' build their fixtures from this one client.
const READY = {
  status: 'ready' as const,
  loadError: null,
  clients: [{ id: 1, name: 'Acme', status: 'active', started_on: null }],
  checkins: new Map(),
  // Same repair as board()'s, above: task 2 added `scores` to UseBoard, and
  // this fixture is a second place it must exist for the file to typecheck.
  scores: new Map(),
  submitted: 0,
  activeTotal: 1,
  reload: vi.fn(),
}

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
    // Scoped to the client list itself, rather than the whole page: the board
    // now also carries the Clients admin-link button above the grid, which is
    // page-level chrome, not a second button on any one card.
    expect(within(clientList()!).getAllByRole('button')).toHaveLength(CLIENTS.length)
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
  const monthSelect = () => screen.getByRole('combobox', { name: 'Month' }) as HTMLSelectElement

  // The visible text of the chosen option. Read through selectedIndex rather
  // than by matching text, because every month in the list is rendered and
  // getByText would find twelve of them.
  const selectedMonthLabel = () => {
    const select = monthSelect()
    return select.options[select.selectedIndex]?.textContent
  }

  it('names the month, and opens on last month', () => {
    given()
    expect(monthSelect().value).toBe(defaultPeriod())
    // The selected option's own text, not the select's value: this is the
    // string on screen, and it is the one a person reads to know which month
    // they are about to score.
    expect(selectedMonthLabel()).toBe(formatPeriod(defaultPeriod()))
  })

  it('jumps straight to any month in one step', () => {
    // The point of the change: reaching a month four back was four clicks and
    // four board reads through the old arrows.
    given()
    const target = periodOptions()[4]
    fireEvent.change(monthSelect(), { target: { value: target } })
    expect(monthSelect().value).toBe(target)
    expect(selectedMonthLabel()).toBe(formatPeriod(target))
  })

  it('offers no month later than this one, oldest at the top', () => {
    // What replaces the old disabled next arrow. A month that cannot be scored
    // is absent rather than present-and-refused, so there is no disabled state
    // to get wrong.
    //
    // Asserted against periodOptions() in full rather than as a set, so the
    // rendered ORDER is pinned here too: month.test.ts pins what the list
    // contains, and only this can catch a .reverse() or a .sort() creeping in
    // between the helper and the DOM.
    given()
    const offered = [...monthSelect().options].map((option) => option.value)
    expect(offered).toEqual(periodOptions())
    expect(offered[offered.length - 1]).toBe(currentPeriod())
    expect(offered).toContain(defaultPeriod())
  })

  it('opens the check-in on the month the board is showing', () => {
    // One period, never two. A card reading "Draft, 8 of 21" for one month while
    // opening a check-in for another is what makes a person stop trusting the
    // number.
    given()
    const shown = previousPeriod(defaultPeriod())
    fireEvent.change(monthSelect(), { target: { value: shown } })
    fireEvent.click(screen.getByRole('button', { name: /Colorfil/ }))
    expect(screen.getByText(formatPeriod(shown))).toBeTruthy()
  })

  it('counts submissions in the progress line', () => {
    given({ submitted: 2 })
    expect(
      screen.getByText(`2 of 3 check-ins submitted for ${formatPeriod(defaultPeriod())}`),
    ).toBeTruthy()
  })

  it('carries each card its own check-in, and names the viewer in the footer', () => {
    // The wiring test: useBoard's map reaches the right card, and the viewer id
    // reaches cardFooter. Getting the viewer wrong would say "another account
    // manager" about your own work.
    given({ checkins: new Map([[2, SUBMITTED]]), submitted: 1 })

    expect(screen.getByText(/^Submitted .* by you$/)).toBeTruthy()
    expect(screen.getAllByText('Not started')).toHaveLength(2)
  })

  it('gives each card its own score row', () => {
    // The other half of the wiring test above: useBoard's scores map has to
    // reach the right card too, not just its checkins map. Acme is past 90
    // days and draws six bars; Beta is inside the gate and draws five.
    given({
      clients: [
        { id: 1, name: 'Acme', status: 'active', started_on: '2026-01-01' },
        { id: 2, name: 'Beta', status: 'active', started_on: '2026-08-01' },
      ],
      activeTotal: 2,
      scores: new Map([
        [1, { client_id: 1, overall_score: 4.5, advocacy_applies: true }],
        [2, { client_id: 2, overall_score: 2.0, advocacy_applies: false }],
      ]),
    })

    expect(screen.getAllByTestId('bucket-bar')).toHaveLength(11)
  })

  it('says it is loading, and shows no list', () => {
    given({ status: 'loading', clients: [], activeTotal: 0 })
    expect(clientList()).toBeNull()
    // Not a blank screen. "A broken tool looks like an empty one" is the v1
    // failure this whole rebuild exists to end.
    expect(document.body.textContent?.trim()).not.toBe('')
  })

  it('shows a failed read instead of an empty board, and offers a retry', async () => {
    const reload = vi.fn()
    const user = userEvent.setup()
    given({ status: 'error', loadError: 'the connection failed', clients: [], activeTotal: 0, reload })

    expect(screen.getByRole('alert').textContent).toContain('the connection failed')
    expect(clientList()).toBeNull()

    await user.click(screen.getByRole('button', { name: /Try again/i }))
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('says the roster is empty, and how to fix it, rather than rendering nothing', () => {
    given({ clients: [], activeTotal: 0 })
    expect(screen.getByText('No active clients')).toBeTruthy()
    expect(screen.getByText(/client admin screen/)).toBeTruthy()
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

describe('reaching the clients admin', () => {
  it('offers the link to an account manager', () => {
    vi.mocked(useBoard).mockReturnValue(READY)
    render(<Board profile={PROFILE} />)

    expect(screen.getByRole('button', { name: 'Clients' })).toBeTruthy()
  })

  it('offers it to an admin', () => {
    vi.mocked(useBoard).mockReturnValue(READY)
    render(<Board profile={{ ...PROFILE, role: 'admin' }} />)

    expect(screen.getByRole('button', { name: 'Clients' })).toBeTruthy()
  })

  it('does not draw it for a viewer', () => {
    // Convenience, not security -- spec §7.2. A viewer who reached the screen
    // anyway would have every write refused by clients_insert_manage_clients
    // and clients_update_manage_clients, which is what actually enforces this.
    // Hiding the control just stops offering somebody a button that fails.
    vi.mocked(useBoard).mockReturnValue(READY)
    render(<Board profile={{ ...PROFILE, role: 'viewer' }} />)

    expect(screen.queryByRole('button', { name: 'Clients' })).toBeNull()
  })

  it('does not draw it for a role nobody has heard of', () => {
    vi.mocked(useBoard).mockReturnValue(READY)
    render(<Board profile={{ ...PROFILE, role: 'sales' }} />)

    expect(screen.queryByRole('button', { name: 'Clients' })).toBeNull()
  })

  it('opens the screen, and comes back', async () => {
    // A fresh spy rather than READY's own: READY is module-scoped, shared by
    // this describe and 'the show-archived toggle', so its reload is the same
    // vi.fn() across every test that does not override it -- and
    // vi.mocked(useBoard).mockReset() in afterEach does not clear the calls
    // recorded on a function inside it.
    const reload = vi.fn()
    vi.mocked(useBoard).mockReturnValue({ ...READY, reload })
    render(<Board profile={PROFILE} />)

    await userEvent.click(screen.getByRole('button', { name: 'Clients' }))
    expect(screen.getByRole('heading', { name: 'Client admin' })).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: 'Board' }))
    expect(screen.queryByRole('heading', { name: 'Client admin' })).toBeNull()
    expect(screen.getByRole('list', { name: 'Clients' })).toBeTruthy()

    // The board re-reads on the way back, which is the whole reason onBack does
    // more than flip a boolean: without it an account manager renames a client,
    // returns here, sees the old name, and cannot tell a working rename from a
    // failed one. Deleting board.reload() from Board.tsx left all 413 tests
    // green until this line existed.
    expect(reload).toHaveBeenCalled()
  })

  it('offers the link when the board is empty, which is when it is needed most', () => {
    // The old copy sent the reader to the Supabase dashboard. A board with no
    // clients and no way to add one is the exact state this screen exists for.
    vi.mocked(useBoard).mockReturnValue({ ...READY, clients: [], activeTotal: 0 })
    render(<Board profile={PROFILE} />)

    expect(screen.getByRole('button', { name: 'Clients' })).toBeTruthy()
    expect(screen.queryByText(/Supabase dashboard/)).toBeNull()
  })

  it('offers the link when the read failed, so the screen is not a dead end', () => {
    vi.mocked(useBoard).mockReturnValue({
      ...READY,
      status: 'error',
      loadError: 'the connection failed',
    })
    render(<Board profile={PROFILE} />)

    expect(screen.getByRole('button', { name: 'Clients' })).toBeTruthy()
  })
})

describe('the show-archived toggle', () => {
  const MIXED = {
    ...READY,
    clients: [
      { id: 1, name: 'Acme', status: 'active', started_on: null },
      { id: 2, name: 'Bellwether', status: 'paused', started_on: null },
      { id: 3, name: 'Test Client', status: 'former', started_on: null },
    ],
    activeTotal: 1,
  }

  const cardNames = () =>
    [...screen.getByRole('list', { name: 'Clients' }).querySelectorAll('h3')].map(
      (heading) => heading.textContent,
    )

  it('shows only the active roster by default', () => {
    vi.mocked(useBoard).mockReturnValue(MIXED)
    render(<Board profile={PROFILE} />)

    expect(cardNames()).toEqual(['Acme'])
  })

  it('offers a toggle naming how many are hidden', () => {
    vi.mocked(useBoard).mockReturnValue(MIXED)
    render(<Board profile={PROFILE} />)

    expect(screen.getByRole('button', { name: 'Show 2 archived' })).toBeTruthy()
  })

  it('reveals them, active roster first, and offers to hide them again', async () => {
    vi.mocked(useBoard).mockReturnValue(MIXED)
    render(<Board profile={PROFILE} />)

    await userEvent.click(screen.getByRole('button', { name: 'Show 2 archived' }))

    expect(cardNames()).toEqual(['Acme', 'Bellwether', 'Test Client'])
    expect(screen.getByRole('button', { name: 'Hide 2 archived' })).toBeTruthy()
  })

  it('hides them again', async () => {
    vi.mocked(useBoard).mockReturnValue(MIXED)
    render(<Board profile={PROFILE} />)

    await userEvent.click(screen.getByRole('button', { name: 'Show 2 archived' }))
    await userEvent.click(screen.getByRole('button', { name: 'Hide 2 archived' }))

    expect(cardNames()).toEqual(['Acme'])
  })

  it('does not draw the toggle when nothing is archived', () => {
    // A control that reveals nothing is worse than no control: it implies
    // there is something hidden.
    vi.mocked(useBoard).mockReturnValue(READY)
    render(<Board profile={PROFILE} />)

    expect(screen.queryByRole('button', { name: /archived/ })).toBeNull()
  })

  it('never counts an archived client in the progress line', async () => {
    // The sharpest requirement in this step. "1 of 3" would tell the reader
    // that three check-ins are owed this month, two of them for a paused
    // client and a client who has left.
    vi.mocked(useBoard).mockReturnValue({ ...MIXED, submitted: 1 })
    render(<Board profile={PROFILE} />)

    expect(screen.getByRole('status').textContent).toBe(
      `All 1 check-ins submitted for ${formatPeriod(defaultPeriod())}`,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Show 2 archived' }))

    // Unchanged by the toggle. This is the assertion that would fail if the
    // denominator were clients.length.
    expect(screen.getByRole('status').textContent).toBe(
      `All 1 check-ins submitted for ${formatPeriod(defaultPeriod())}`,
    )
  })

  it('offers the toggle when every client is archived, rather than an empty board', async () => {
    // Reachable the moment somebody retires their last client. Without the
    // toggle here, the roster would look permanently empty with no hint that
    // three clients exist.
    vi.mocked(useBoard).mockReturnValue({
      ...MIXED,
      clients: [{ id: 3, name: 'Test Client', status: 'former', started_on: null }],
      activeTotal: 0,
      submitted: 0,
    })
    render(<Board profile={PROFILE} />)

    expect(screen.getByText('No active clients')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Show 1 archived' }))
    expect(cardNames()).toEqual(['Test Client'])
  })

  it('still tells the reader how to add a client when the empty roster also offers the toggle', () => {
    // The empty branch used to be one ternary: the toggle OR the instruction,
    // never both. That left the exact moment somebody retires their last
    // client -- when the toggle first appears -- as the moment the sentence
    // telling them how to get a working roster back disappeared.
    vi.mocked(useBoard).mockReturnValue({
      ...MIXED,
      clients: [{ id: 3, name: 'Test Client', status: 'former', started_on: null }],
      activeTotal: 0,
      submitted: 0,
    })
    render(<Board profile={PROFILE} />)

    expect(screen.getByText('No active clients')).toBeTruthy()
    expect(screen.getByText(/Add one on the client admin screen/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Show 1 archived' })).toBeTruthy()
  })

  it('marks the toggle expanded or collapsed for a screen reader', async () => {
    vi.mocked(useBoard).mockReturnValue(MIXED)
    render(<Board profile={PROFILE} />)

    const toggle = screen.getByRole('button', { name: 'Show 2 archived' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')

    await userEvent.click(toggle)

    expect(screen.getByRole('button', { name: 'Hide 2 archived' }).getAttribute('aria-expanded')).toBe(
      'true',
    )
  })

  it('does not offer the toggle on a failed read', () => {
    // MIXED, not READY: useBoard does not clear `clients` on a failed reload
    // (its error branches return before setClients), so a failed read can
    // leave the previous successful load's rows -- archived ones included --
    // still sitting in state. A fixture with clients: [] would pass this
    // assertion whether the toggle were suppressed on error or simply had
    // nothing to show; archivedCount(MIXED.clients) is 2, so this fixture
    // fails if the suppression is ever removed.
    vi.mocked(useBoard).mockReturnValue({
      ...MIXED,
      status: 'error',
      loadError: 'the connection failed',
    })
    render(<Board profile={PROFILE} />)

    expect(screen.queryByRole('button', { name: /archived/ })).toBeNull()
    expect(screen.getByRole('alert')).toBeTruthy()
  })
})
