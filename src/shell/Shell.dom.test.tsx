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
// UsersAdmin stands in for any destination that can have a write in flight. The
// real screen reports its `writing` value from an effect; this one reports it on
// demand, which is what lets a test hold the shell in the mid-write state and
// look at what the bar is doing while it is there.
vi.mock('../users/UsersAdmin', () => ({
  UsersAdmin: ({ onWritingChange }: { onWritingChange?: (writing: boolean) => void }) => (
    <>
      <p>people and access</p>
      <button onClick={() => onWritingChange?.(true)} type="button">
        begin a write
      </button>
      <button onClick={() => onWritingChange?.(false)} type="button">
        finish the write
      </button>
    </>
  ),
}))

const ENTRIES = ['Overview', 'Clients', 'Revenue', 'Admin']

function barDisabled(): boolean[] {
  return ENTRIES.map((name) =>
    (screen.getByRole('button', { name }) as HTMLButtonElement).disabled,
  )
}

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

  // The guard the bar took away and this puts back. Before the shell, an admin
  // screen owned the whole viewport and its own Back button was the only exit,
  // so `disabled={writing}` on that one button was airtight. The bar draws four
  // more exits above it: change a role, press Clients while the PATCH is in
  // flight, and UsersAdmin unmounts with the refusal landing where nobody can
  // read it -- a write that failed looking exactly like one that worked.
  it('disables every menu entry while the screen below has a write in flight', async () => {
    renderShell('admin')
    await userEvent.click(screen.getByRole('button', { name: 'Admin' }))
    expect(barDisabled()).toEqual([false, false, false, false])

    await userEvent.click(screen.getByRole('button', { name: 'begin a write' }))
    expect(barDisabled()).toEqual([true, true, true, true])
  })

  // The other half, and it is the half that makes the first one safe: a bar that
  // latched would be worse than no guard at all.
  it('re-enables the menu when the write finishes', async () => {
    renderShell('admin')
    await userEvent.click(screen.getByRole('button', { name: 'Admin' }))
    await userEvent.click(screen.getByRole('button', { name: 'begin a write' }))
    expect(barDisabled()).toEqual([true, true, true, true])

    await userEvent.click(screen.getByRole('button', { name: 'finish the write' }))
    expect(barDisabled()).toEqual([false, false, false, false])
  })

  // A screen that has been unmounted cannot report itself idle, so the shell
  // clears the flag on every destination change. Reached here through the
  // section switcher, which is the one control still live while the bar is
  // disabled: switching sections mid-write unmounts the screen that reported it.
  it('clears the busy flag when the destination changes underneath it', async () => {
    renderShell('admin')
    await userEvent.click(screen.getByRole('button', { name: 'Admin' }))
    await userEvent.click(screen.getByRole('button', { name: 'begin a write' }))
    expect(barDisabled()).toEqual([true, true, true, true])

    await userEvent.click(screen.getByRole('button', { name: 'Clients roster' }))
    expect(barDisabled()).toEqual([false, false, false, false])
  })

  // Spec §4: "The menu bar stays visible during a check-in", which is new --
  // before this slice the check-in screen returned above the nav and Back was
  // the only way out. Safe specifically because draftCache.ts writes every
  // click and keystroke to local storage as they happen, so leaving mid-edit
  // loses nothing.
  //
  // The REAL board and a REAL check-in, opened by clicking a client the way a
  // person does. The test this replaces stubbed the board and never entered a
  // check-in at all, so it asserted the bar was on screen on the screen that is
  // not in question -- it would have passed with an early return above
  // <MenuBar>, which is the single edit that breaks this behaviour.
  it('keeps the menu bar on screen inside a check-in', async () => {
    await useRealBoard({})
    renderShell('admin')

    // The check-in's own Back button, which no other screen renders now that the
    // two admin screens say "Clients" -- so this is the assertion that says a
    // check-in really is open rather than the board still being on screen.
    await userEvent.click(screen.getByRole('button', { name: 'Acme' }))
    expect(screen.getByRole('button', { name: 'Board' })).toBeTruthy()
    expect(screen.queryByRole('list', { name: 'Clients' })).toBe(null)

    expect(screen.getByRole('navigation', { name: 'Sections' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Overview' })).toBeTruthy()
  })

  // Visible is not the same as working. With a check-in open, Clients carries
  // aria-current="page" and used to do nothing at all: same element, same
  // position, so React kept Board mounted and `selected` with it -- the one
  // button naming the screen you are on being the only one with no effect, and
  // aria-current claiming a screen the press could not reach. The board's key is
  // what makes the press a remount.
  it('returns to the board when Clients is pressed inside a check-in', async () => {
    await useRealBoard({})
    renderShell('admin')

    await userEvent.click(screen.getByRole('button', { name: 'Acme' }))
    expect(screen.getByRole('button', { name: 'Board' })).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: 'Clients' }))
    expect(screen.getByRole('list', { name: 'Clients' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Board' })).toBe(null)
  })
})
