// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AdminProfile, WriteState } from './userForm'
import { InviteForm } from './InviteForm'

// InviteForm and UsersAdmin were, until this file, the two component changes
// of the fix wave that shipped with no DOM test at all -- src/users/ held only
// useUsers.dom.test.ts, which never renders either. That gap is what let the
// regression this file exists to catch ship unnoticed: `state` here is
// admin.inviteState from useUsers, and that single state is shared between
// invite() and revokeInvite() by design (one invite-level message region on
// screen). A `saved` produced by a revoke looks, from inside this component,
// identical to a `saved` produced by this form's own submit. The effect that
// clears the draft on 'saved' must therefore be able to tell the two apart --
// see the `submitted` ref in InviteForm.tsx -- and this file proves it does.

afterEach(() => {
  document.body.innerHTML = ''
})

function props(overrides: Partial<Parameters<typeof InviteForm>[0]> = {}) {
  return {
    profiles: [] as readonly AdminProfile[],
    state: { kind: 'idle' } as WriteState,
    onInvite: vi.fn(),
    onEdited: vi.fn(),
    ...overrides,
  }
}

async function typeDraft() {
  await userEvent.type(screen.getByLabelText('Email address'), 'new@example.com')
  await userEvent.selectOptions(screen.getByLabelText('Role'), 'admin')
}

describe('InviteForm, clearing the draft', () => {
  it('does not clear a typed draft when a revoke -- not this form -- produces the saved state', async () => {
    // The regression itself. Reachable by the documented way to correct a wrong
    // address: type the corrected email, then revoke the old invitation. This
    // form never called onInvite, so the 'saved' state below belongs entirely
    // to that revoke.
    const { rerender } = render(<InviteForm {...props()} />)
    await typeDraft()

    rerender(
      <InviteForm
        {...props({
          state: { kind: 'saved', at: '2026-08-25T15:42:00.000Z', what: 'Invitation for old@example.com revoked' },
        })}
      />,
    )

    expect(screen.getByLabelText('Email address')).toHaveProperty('value', 'new@example.com')
    expect(screen.getByLabelText('Role')).toHaveProperty('value', 'admin')
  })

  it('clears the draft once THIS form\'s own invite is confirmed', async () => {
    const onInvite = vi.fn()
    const { rerender } = render(<InviteForm {...props({ onInvite })} />)
    await typeDraft()
    await userEvent.click(screen.getByRole('button', { name: 'Invite' }))
    expect(onInvite).toHaveBeenCalledWith({ email: 'new@example.com', role: 'admin' })

    // A second render, matching how the parent actually delivers this: the
    // hook only knows the write succeeded once its async round trip resolves,
    // which is after this component has already re-rendered with 'saving'.
    rerender(<InviteForm {...props({ onInvite, state: { kind: 'saving' } })} />)
    rerender(
      <InviteForm
        {...props({ onInvite, state: { kind: 'saved', at: '2026-08-25T15:42:00.000Z', what: 'new@example.com invited' } })}
      />,
    )

    expect(screen.getByLabelText('Email address')).toHaveProperty('value', '')
    expect(screen.getByLabelText('Role')).toHaveProperty('value', 'viewer')
  })

  it('keeps a refused invite\'s draft in the fields', async () => {
    // Issue 3: a failed write must not lose what was typed -- the moment
    // somebody most wants to look at it and change one word.
    const onInvite = vi.fn()
    const { rerender } = render(<InviteForm {...props({ onInvite })} />)
    await typeDraft()
    await userEvent.click(screen.getByRole('button', { name: 'Invite' }))

    rerender(
      <InviteForm
        {...props({ onInvite, state: { kind: 'failed', message: 'new@example.com has already been invited.' } })}
      />,
    )

    expect(screen.getByLabelText('Email address')).toHaveProperty('value', 'new@example.com')
    expect(screen.getByLabelText('Role')).toHaveProperty('value', 'admin')
  })
})
