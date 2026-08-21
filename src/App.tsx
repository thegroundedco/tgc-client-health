import { supabase } from './lib/supabase'
import { useSession } from './auth/useSession'
import { useProfile } from './auth/useProfile'
import { SignIn } from './auth/SignIn'
import { PendingAccess } from './auth/PendingAccess'
import { deriveAppState } from './appState'

export default function App() {
  const { session, status: sessionStatus } = useSession()
  const { profile, status: profileStatus, error } = useProfile(session)

  const state = deriveAppState(sessionStatus, session, profileStatus, profile, error)

  switch (state.kind) {
    case 'loading':
      return <main>Loading…</main>

    case 'signed-out':
      return <SignIn />

    case 'db-error':
      return (
        <main>
          <h1>Cannot reach the database</h1>
          <p role="alert">{state.error}</p>
          <p>Your data is safe. Try again in a moment.</p>
        </main>
      )

    case 'pending':
      return (
        <PendingAccess
          email={state.email}
          onSignOut={() => void supabase.auth.signOut()}
        />
      )

    case 'active':
      return (
        <main>
          <h1>TGC Client Health</h1>
          <p>Signed in as {state.profile.email}</p>
          <button type="button" onClick={() => void supabase.auth.signOut()}>
            Sign out
          </button>
        </main>
      )

    default: {
      // Exhaustiveness check: if AppState grows a new kind, this line stops
      // compiling instead of silently rendering nothing.
      const _exhaustive: never = state
      throw new Error(`Unhandled app state: ${JSON.stringify(_exhaustive)}`)
    }
  }
}
