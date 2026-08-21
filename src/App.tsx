import { supabase } from './lib/supabase'
import { useSession } from './auth/useSession'
import { useProfile } from './auth/useProfile'
import { SignIn } from './auth/SignIn'
import { PendingAccess } from './auth/PendingAccess'
import { deriveAppState } from './appState'
import { Board } from './board/Board'
import styles from './App.module.css'

export default function App() {
  const { session, status: sessionStatus, error: sessionError } = useSession()
  const { profile, status: profileStatus, error } = useProfile(session)

  const state = deriveAppState(
    sessionStatus,
    session,
    profileStatus,
    profile,
    error,
    sessionError,
  )

  switch (state.kind) {
    case 'loading':
      return (
        <main className={styles.centred}>
          <p className="t-body">Loading…</p>
        </main>
      )

    case 'signed-out':
      return <SignIn />

    case 'db-error':
      return (
        <main className={styles.centred}>
          <p className="t-eyebrow">Client Health</p>
          <h1 className="t-header">Cannot reach the database</h1>
          <p className="alert prose" role="alert">
            {state.error}
          </p>
          <p className="t-body prose">Your data is safe. Try again in a moment.</p>
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
        <div className={styles.shell}>
          <header className={styles.header}>
            <div className={styles.wordmark}>
              <p className="t-eyebrow">The Grounded Company</p>
              <h1 className="t-header">Client Health</h1>
            </div>
            <div className={styles.identity}>
              <p className="t-caption">{state.profile.email}</p>
              <button
                className="button button--quiet"
                type="button"
                onClick={() => void supabase.auth.signOut()}
              >
                Sign out
              </button>
            </div>
          </header>
          <main className={styles.content}>
            {/* Rendered inside the existing `active` case rather than behind any
                new session/profile branching: deriveAppState stays the single
                place that decides what the app is showing. */}
            <Board profile={state.profile} />
          </main>
        </div>
      )

    default: {
      // Exhaustiveness check: if AppState grows a new kind, this line stops
      // compiling instead of silently rendering nothing.
      const _exhaustive: never = state
      throw new Error(`Unhandled app state: ${JSON.stringify(_exhaustive)}`)
    }
  }
}
