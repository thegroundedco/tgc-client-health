// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Two mocks, and the second is not optional. Mocking the hook is why useUsers
// exists as a seam at all; `../lib/supabase` must be mocked as well because
// useUsers imports the client at module scope, and readSupabaseConfig THROWS
// when no VITE_ config is present -- which is exactly how CI runs vitest.
vi.mock('../lib/supabase', () => ({ supabase: {} }))
vi.mock('./useUsers', () => ({ useUsers: vi.fn() }))

import { UsersAdmin } from './UsersAdmin'
import { useUsers } from './useUsers'
import styles from './UsersAdmin.module.css'

afterEach(() => {
  document.body.innerHTML = ''
  vi.mocked(useUsers).mockReset()
})

const ME = 'me-id'

function profile(over: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    email: 'adam@thegroundedcompany.com',
    full_name: null,
    role: 'viewer',
    is_active: false,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

function mount(over: Record<string, unknown> = {}, onWritingChange = vi.fn()) {
  vi.mocked(useUsers).mockReturnValue({
    status: 'ready',
    loadError: null,
    profiles: [profile()],
    invitations: [],
    inviteState: { kind: 'idle' },
    editState: { kind: 'idle' },
    editStateFor: null,
    reload: vi.fn(),
    invite: vi.fn(),
    revokeInvite: vi.fn(),
    setRole: vi.fn(),
    setActive: vi.fn(),
    resetInvite: vi.fn(),
    resetEdit: vi.fn(),
    ...over,
  } as unknown as ReturnType<typeof useUsers>)
  return render(<UsersAdmin currentUserId={ME} onWritingChange={onWritingChange} />)
}

describe('a person without a name', () => {
  // The defect the owner photographed: rowName falls back to the email when
  // full_name is null, and the row then printed rowName AND row.email -- so
  // everyone without a name had their address rendered twice, one line above
  // the other. Only the owner's row looked right, because only his has a name.
  it('shows their address once, not twice', () => {
    mount()

    expect(screen.getAllByText('adam@thegroundedcompany.com')).toHaveLength(1)
  })

  it('still shows both when there is a real name to sit above the address', () => {
    mount({ profiles: [profile({ full_name: 'Adam Adams' })] })

    expect(screen.getByText('Adam Adams')).toBeTruthy()
    expect(screen.getAllByText('adam@thegroundedcompany.com')).toHaveLength(1)
  })
})

describe('the screen headings', () => {
  // The masthead already says PEOPLE / ACCESS. A section heading reading
  // "People" underneath it said the same word twice and told the reader
  // nothing; these two name what actually separates the lists.
  it('name what separates the two lists rather than echoing the masthead', () => {
    mount()

    expect(screen.getByRole('heading', { name: 'With access' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Invited — not yet signed in' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'People', level: 3 })).toBe(null)
  })
})

describe('leaving the screen', () => {
  // The Back button is gone: the shell's menu bar is above this screen and is
  // the way out, so a third stacked navigation control was one more than the
  // screen needed. Its write-guard is NOT gone -- see below.
  it('offers no back button of its own, because the menu bar is the way out', () => {
    mount()

    expect(screen.queryByRole('button', { name: 'Clients' })).toBe(null)
    expect(screen.queryByRole('navigation')).toBe(null)
  })

  // This is what the Back button's `disabled` used to be half of, and it is the
  // half that still matters. Leaving mid-write unmounts this screen and the
  // update lands with nobody to read its confirmation -- a write that worked
  // looking exactly like one that did not. The screen reports the write outward
  // and the shell shuts the bar. ClientsAdmin has had this test; this screen
  // never did, which is why removing its button without adding one would have
  // left the guard entirely unheld.
  it('reports a write in flight so the shell can shut its own exits', () => {
    const onWritingChange = vi.fn()
    mount({ inviteState: { kind: 'saving' } }, onWritingChange)

    expect(onWritingChange).toHaveBeenCalledWith(true)
  })

  it('reports itself idle again once nothing is in flight', () => {
    const onWritingChange = vi.fn()
    mount({}, onWritingChange)

    expect(onWritingChange).toHaveBeenCalledWith(false)
  })
})

describe('the row layout', () => {
  // jsdom computes no layout, so tests/adminLayout.test.ts pins what the rules
  // DO. This pins that the markup gives them something to act on -- a row that
  // is one card, with its identity and its controls as distinct blocks rather
  // than four stacked paragraphs.
  it('gives each person one card, with identity and controls apart', () => {
    mount()

    const row = document.querySelector(`.${styles.row}`)
    expect(row).not.toBeNull()
    expect(row?.querySelector(`.${styles.identity}`)).not.toBeNull()
    expect(row?.querySelector(`.${styles.actions}`)).not.toBeNull()
    expect(row?.querySelector(`.${styles.actions} select`)).not.toBeNull()
  })
})
