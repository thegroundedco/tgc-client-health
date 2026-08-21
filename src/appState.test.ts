import { describe, expect, it } from 'vitest'
import type { Session } from '@supabase/supabase-js'
import { deriveAppState } from './appState'
import type { Profile } from './auth/useProfile'

// Only `user.email` is ever read from a session by deriveAppState, so a
// minimal fake is enough — no need to construct a real Session shape.
function fakeSession(email: string | undefined): Session {
  return { user: { email } } as unknown as Session
}

function fakeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: 'user-1',
    email: 'person@example.com',
    full_name: null,
    role: 'viewer',
    is_active: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('deriveAppState', () => {
  it('is loading while the session is still resolving, regardless of the rest', () => {
    expect(deriveAppState('loading', null, 'loading', null, null)).toEqual({
      kind: 'loading',
    })
    expect(
      deriveAppState('loading', fakeSession('a@b.com'), 'ready', fakeProfile(), null),
    ).toEqual({ kind: 'loading' })
  })

  it('is signed-out when there is no session', () => {
    expect(deriveAppState('ready', null, 'ready', null, null)).toEqual({
      kind: 'signed-out',
    })
  })

  it('is loading while a resolved session\'s profile query is still in flight', () => {
    expect(
      deriveAppState('ready', fakeSession('a@b.com'), 'loading', null, null),
    ).toEqual({ kind: 'loading' })
  })

  it('is db-error when the profile query failed, carrying the error message', () => {
    expect(
      deriveAppState('ready', fakeSession('a@b.com'), 'error', null, 'network down'),
    ).toEqual({ kind: 'db-error', error: 'network down' })
  })

  // The regression this file exists to catch: a failed read and an absent
  // row must never collapse into the same state, even though both leave
  // `profile` as null. Only `profileStatus` distinguishes them.
  it('does not conflate a failed profile query with an absent profile row', () => {
    const session = fakeSession('a@b.com')
    const errored = deriveAppState('ready', session, 'error', null, 'boom')
    const noRow = deriveAppState('ready', session, 'ready', null, null)

    expect(errored.kind).toBe('db-error')
    expect(noRow.kind).toBe('pending')
    expect(errored.kind).not.toBe(noRow.kind)
  })

  it('is pending when signed in with no profile row at all', () => {
    expect(
      deriveAppState('ready', fakeSession('a@b.com'), 'ready', null, null),
    ).toEqual({ kind: 'pending', email: 'a@b.com' })
  })

  it('is pending when signed in with a profile row that is not active', () => {
    const profile = fakeProfile({ is_active: false })
    expect(
      deriveAppState('ready', fakeSession('a@b.com'), 'ready', profile, null),
    ).toEqual({ kind: 'pending', email: 'a@b.com' })
  })

  it('falls back to "unknown" for the pending email when the session has none', () => {
    expect(
      deriveAppState('ready', fakeSession(undefined), 'ready', null, null),
    ).toEqual({ kind: 'pending', email: 'unknown' })
  })

  it('is active when signed in with an active profile row', () => {
    const profile = fakeProfile({ is_active: true })
    expect(
      deriveAppState('ready', fakeSession('a@b.com'), 'ready', profile, null),
    ).toEqual({ kind: 'active', profile })
  })
})
