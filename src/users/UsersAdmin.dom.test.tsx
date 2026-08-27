// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AdminProfile } from './userForm'

// The screen reads its data through useUsers, so the hook is mocked away and
// this file tests what the component DRAWS -- the same split ClientsAdmin.dom
// .test.tsx uses, and the reason its zero-row paths live in useClients.dom
// .test.ts instead.
//
// Until this file existed, NOTHING in the suite rendered UsersAdmin. The final
// whole-branch review of Slice 3 named that gap; the duplicated email address
// below is what shipped through it. A row whose full_name is null fell back to
// the email for its heading and then printed the email AGAIN underneath, so
// anyone who signed in by magic link and never set a name appeared twice on
// screen. Every account on production is in exactly that state.
vi.mock('../lib/supabase', () => ({ supabase: {} }))
vi.mock('./useUsers', () => ({ useUsers: vi.fn() }))

import { UsersAdmin } from './UsersAdmin'
import { useUsers } from './useUsers'

afterEach(() => {
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

const JOSH = '11111111-1111-1111-1111-111111111111'
const ADAM = '22222222-2222-2222-2222-222222222222'

function profile(overrides: Partial<AdminProfile> = {}): AdminProfile {
  return {
    id: ADAM,
    email: 'adam@example.com',
    full_name: null,
    role: 'viewer',
    is_active: false,
    updated_at: '2026-08-26T12:00:00.000Z',
    ...overrides,
  }
}

function hook(overrides: Record<string, unknown> = {}) {
  return {
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
    ...overrides,
  } as unknown as ReturnType<typeof useUsers>
}

function mount(overrides: Record<string, unknown> = {}) {
  vi.mocked(useUsers).mockReturnValue(hook(overrides))
  render(<UsersAdmin onBack={vi.fn()} currentUserId={JOSH} />)
}

// Counts how many times an address appears as its own line of text, rather than
// searching the whole subtree -- getByText would match the <li> as well as the
// <p> inside it and could not tell one rendering from two.
function linesReading(text: string): number {
  return screen.queryAllByText(text, { selector: 'p' }).length
}

describe('a person row, and who it names', () => {
  it('prints the email ONCE when the account has no name', () => {
    mount({ profiles: [profile({ full_name: null })] })

    expect(linesReading('adam@example.com')).toBe(1)
  })

  it('prints the email once when full_name is only whitespace', () => {
    // rowName already trims, so a whitespace-only name falls back to the email
    // exactly as null does. Pinned because the two paths are one line apart and
    // a future edit could easily fix null and miss this.
    mount({ profiles: [profile({ full_name: '   ' })] })

    expect(linesReading('adam@example.com')).toBe(1)
  })

  it('shows the name AND the email when the account has a name', () => {
    // The other direction, so a fix cannot be "stop rendering the email".
    mount({ profiles: [profile({ full_name: 'Adam' })] })

    expect(linesReading('Adam')).toBe(1)
    expect(linesReading('adam@example.com')).toBe(1)
  })

  it('still names the person on its controls when it has no name to use', () => {
    // The accessible name is the reason rowName falls back to the email at all
    // -- a bare "Activate" repeated down the list is unusable in a screen
    // reader's control list. Removing the duplicate line must not cost that.
    mount({ profiles: [profile({ full_name: null, is_active: false })] })

    expect(screen.getByRole('button', { name: 'Activate adam@example.com' })).toBeTruthy()
  })
})
