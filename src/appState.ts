import type { Session } from '@supabase/supabase-js'
import type { Profile } from './auth/useProfile'

// The decision that used to live inline in App.tsx, pulled out so it can be
// unit-tested on its own. This is the exact branch selection v1 got wrong —
// it rendered a failed profile read the same way it rendered "no profile
// yet", which made a broken tool indistinguishable from an empty one. A
// discriminated union makes that conflation a compile error instead of a
// runtime surprise: each branch below carries only the data that state
// actually has.
export type AppState =
  | { kind: 'loading' }
  | { kind: 'signed-out' }
  | { kind: 'db-error'; error: string | null }
  | { kind: 'pending'; email: string }
  | { kind: 'active'; profile: Profile }

export function deriveAppState(
  sessionStatus: 'loading' | 'ready' | 'error',
  session: Session | null,
  profileStatus: 'loading' | 'ready' | 'error',
  profile: Profile | null,
  error: string | null,
  // Appended last, with a default, rather than slotted in beside `session`
  // where it logically belongs: this function is called positionally and
  // inserting a parameter in the middle would silently re-bind every existing
  // call and every existing test to the wrong argument. The default is only
  // ever taken by tests written before useSession could fail.
  sessionError: string | null = null,
): AppState {
  if (sessionStatus === 'loading') return { kind: 'loading' }

  // Checked before `!session`, for the same reason profileStatus === 'error' is
  // checked before `!profile` below: a failed session lookup and a genuinely
  // absent session both leave `session` null, and only the status tells them
  // apart. Rendering the sign-in form after a failed lookup would be v1's
  // "a broken tool looks like an empty one" on the very first screen.
  if (sessionStatus === 'error') return { kind: 'db-error', error: sessionError }

  if (!session) return { kind: 'signed-out' }
  if (profileStatus === 'loading') return { kind: 'loading' }

  // Checked before the no-profile case, and on profileStatus alone rather
  // than on `profile` being falsy — a failed query and a genuinely absent row
  // can both leave `profile` as null, and only profileStatus tells them
  // apart. This ordering is the regression this file exists to guard.
  if (profileStatus === 'error') return { kind: 'db-error', error }

  if (!profile || !profile.is_active) {
    return { kind: 'pending', email: session.user.email ?? 'unknown' }
  }

  return { kind: 'active', profile }
}
