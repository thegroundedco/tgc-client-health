// @vitest-environment jsdom

import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Shell } from './Shell'
import type { Profile } from '../auth/useProfile'
import { useBoard } from '../board/useBoard'
import type { UseBoard } from '../board/useBoard'

// The board reaches Supabase, and most of this file is about navigation rather
// than about the board, so it is stubbed to a fixed screen -- a failed fetch
// must not be able to masquerade as a navigation failure.
//
// `boardImpl` is the seam, and it exists because a stub cannot fail. Fix round 1
// found that the two tests claiming to prove "a broken board is not a dead end"
// rendered the same placeholder as every other test and passed with navigation
// entirely broken. The two tests below swap in the REAL Board, with useBoard
// mocked, so a failed read and an empty roster are genuinely on screen.
let boardImpl: (props: { profile: Profile }) => ReactNode = () => <CountingBoard />

vi.mock('../board/Board', () => ({
  Board: (props: { profile: Profile }) => boardImpl(props),
}))
vi.mock('../board/useBoard', () => ({ useBoard: vi.fn() }))
// Needed only by the real-Board tests: Board renders CheckIn, CheckIn uses
// useCheckin, and useCheckin imports the Supabase client, which throws at module
// scope when no VITE_ config is present. Board.test.tsx carries the same line
// for the same reason.
vi.mock('../lib/supabase', () => ({ supabase: {} }))
vi.mock('../clients/ClientsAdmin', () => ({ ClientsAdmin: () => <p>client roster</p> }))
vi.mock('../users/UsersAdmin', () => ({ UsersAdmin: () => <p>people and access</p> }))

// Mounts, not renders: the counter is incremented from an effect with an empty
// dependency array, so it moves only when React actually mounts the component.
// This is what pins the remount that replaced ClientsAdmin's board.reload().
let mounts = 0

function CountingBoard() {
  useEffect(() => {
    mounts += 1
  }, [])
  return <p>the board</p>
}

const BOARD: UseBoard = {
  status: 'ready',
  loadError: null,
  clients: [{ id: 1, name: 'Acme', status: 'active', started_on: null }],
  checkins: new Map(),
  scores: new Map(),
  submitted: 0,
  activeTotal: 1,
  reload: () => {},
}

// The real component, reached past this file's own mock of it. importActual
// un-mocks only the module named: Board's own import of useBoard still resolves
// to the mock above, which is what makes an error or an empty roster
// constructible here.
async function useRealBoard(state: Partial<UseBoard>) {
  const actual = await vi.importActual<typeof import('../board/Board')>('../board/Board')
  vi.mocked(useBoard).mockReturnValue({ ...BOARD, ...state })
  boardImpl = (props) => <actual.Board {...props} />
}

afterEach(() => {
  document.body.innerHTML = ''
  boardImpl = () => <CountingBoard />
  mounts = 0
  vi.mocked(useBoard).mockReset()
})

function profile(role: string): Profile {
  return {
    id: 'p1',
    email: 'josh@thegroundedcompany.com',
    role,
    is_active: true,
  } as Profile
}

function renderShell(role = 'admin') {
  return render(
    <Shell
      onSignOut={vi.fn()}
      onThemeChange={vi.fn()}
      preference="light"
      profile={profile(role)}
    />,
  )
}

describe('the shell', () => {
  // Spec §3.1: Clients, not Overview, while Overview is empty.
  it('lands on Clients', () => {
    renderShell()
    expect(screen.getByText('the board')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Clients' }).getAttribute('aria-current')).toBe(
      'page',
    )
  })

  it('carries the identity, the theme control and sign out', () => {
    renderShell()
    expect(document.body.textContent).toContain('josh@thegroundedcompany.com')
    expect(screen.getByRole('switch', { name: 'Dark mode' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy()
  })

  it('moves between destinations', async () => {
    renderShell()
    await userEvent.click(screen.getByRole('button', { name: 'Revenue' }))
    expect(document.body.textContent).toContain('data model')
    await userEvent.click(screen.getByRole('button', { name: 'Overview' }))
    expect(document.body.textContent).toContain('snapshot')
    await userEvent.click(screen.getByRole('button', { name: 'Clients' }))
    expect(screen.getByText('the board')).toBeTruthy()
  })

  it('opens Admin on People for an admin, who can see both sections', async () => {
    renderShell('admin')
    await userEvent.click(screen.getByRole('button', { name: 'Admin' }))
    expect(screen.getByText('people and access')).toBeTruthy()
  })

  // The case the whole of openDestination exists for.
  it('opens Admin on the client roster for an account manager', async () => {
    renderShell('account_manager')
    await userEvent.click(screen.getByRole('button', { name: 'Admin' }))
    expect(screen.getByText('client roster')).toBeTruthy()
    expect(screen.queryByText('people and access')).toBe(null)
  })

  it('offers an admin both sections and lets them switch', async () => {
    renderShell('admin')
    await userEvent.click(screen.getByRole('button', { name: 'Admin' }))
    await userEvent.click(screen.getByRole('button', { name: 'Clients roster' }))
    expect(screen.getByText('client roster')).toBeTruthy()
  })

  // An account manager has one section, so a switcher would be a control with
  // nothing to control -- the same argument Board.tsx makes about not drawing
  // the view toggle on an empty roster.
  it('draws no section switcher when there is only one section', async () => {
    renderShell('account_manager')
    await userEvent.click(screen.getByRole('button', { name: 'Admin' }))
    expect(screen.queryByRole('button', { name: 'Clients roster' })).toBe(null)
  })

  it('never shows Admin to a viewer', () => {
    renderShell('viewer')
    expect(screen.queryByRole('button', { name: 'Admin' })).toBe(null)
  })

  // Leaving Clients must unmount the board, because that unmount IS the reload
  // ClientsAdmin's onBack used to ask for. The test it replaces carried the
  // warning "Deleting board.reload() from Board.tsx left all 413 tests green
  // until this line existed", and the same silent failure is available one layer
  // up: a tab cache, a `hidden` attribute, or <Board> hoisted out of the
  // conditional would each keep a client added in Admin off the board with the
  // suite still green. Two mounts is what says the remount happened.
  it('remounts the board on the way back from Admin, which is the reload', async () => {
    renderShell('admin')
    expect(mounts).toBe(1)

    await userEvent.click(screen.getByRole('button', { name: 'Admin' }))
    expect(screen.queryByText('the board')).toBe(null)

    await userEvent.click(screen.getByRole('button', { name: 'Clients' }))
    expect(screen.getByText('the board')).toBeTruthy()
    expect(mounts).toBe(2)
  })

  // Carried over from Board.test.tsx's `reaching the clients admin`, which this
  // slice deleted: "offers the link when the read failed, so the screen is not a
  // dead end". The requirement outlives the four copies of adminLink that used
  // to satisfy it -- the bar is drawn by the shell, ABOVE whatever the
  // destination renders, so it survives a board that is broken.
  //
  // The REAL board with a real error state, not the stub: a placeholder that
  // cannot fail proves nothing about a failure. And the way out is asserted in
  // both directions, because a dead end is a screen you cannot LEAVE and return
  // from -- reaching Admin is only half of it.
  it('draws the bar, and stays navigable, when the board read failed', async () => {
    await useRealBoard({ status: 'error', loadError: 'the connection failed' })
    renderShell('admin')

    expect(screen.getByRole('navigation', { name: 'Sections' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Cannot reach the database' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Admin' })).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: 'Admin' }))
    expect(screen.getByText('people and access')).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: 'Clients' }))
    expect(screen.getByRole('heading', { name: 'Cannot reach the database' })).toBeTruthy()
    expect(screen.queryByText('people and access')).toBe(null)
  })

  // The other half of the same pair: "offers the link when the board is empty,
  // which is when it is needed most". An empty roster is the exact state in
  // which somebody needs the client admin, so the bar has to be there and the
  // trip has to work in both directions.
  it('draws the bar, and stays navigable, when the roster is empty', async () => {
    await useRealBoard({ clients: [], activeTotal: 0 })
    renderShell('account_manager')

    expect(screen.getByRole('navigation', { name: 'Sections' })).toBeTruthy()
    expect(
      screen.getByText('Add one to see it here.'),
    ).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: 'Admin' }))
    expect(screen.getByText('client roster')).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: 'Clients' }))
    expect(
      screen.getByText('Add one to see it here.'),
    ).toBeTruthy()
    expect(screen.queryByText('client roster')).toBe(null)
  })
})
