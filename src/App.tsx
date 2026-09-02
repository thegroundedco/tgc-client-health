import { supabase } from './lib/supabase'
import { useSession } from './auth/useSession'
import { useProfile } from './auth/useProfile'
import { SignIn } from './auth/SignIn'
import { PendingAccess } from './auth/PendingAccess'
import { deriveAppState } from './appState'
import { Shell } from './shell/Shell'
import { useTheme } from './styles/useTheme'
import styles from './App.module.css'

export default function App() {
  const { session, status: sessionStatus, error: sessionError } = useSession()
  const { profile, status: profileStatus, error } = useProfile(session)

  // Called here, above the switch, rather than inside the `active` case: the
  // theme applies to every screen -- sign-in, access-pending, the database
  // error -- and only the CONTROL is limited to the signed-in header. Hooks
  // must run unconditionally anyway, and this is the reason that constraint
  // and this requirement agree.
  const { preference, setPreference } = useTheme()

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
          <div className="masthead">
            <p className="t-eyebrow">Client Health</p>
            <h1 className="t-header">Cannot reach the database</h1>
          </div>
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
        <Shell
          onSignOut={() => void supabase.auth.signOut()}
          onThemeChange={setPreference}
          preference={preference}
          profile={state.profile}
        />
      )

    default: {
      // Exhaustiveness check: if AppState grows a new kind, this line stops
      // compiling instead of silently rendering nothing.
      const _exhaustive: never = state
      throw new Error(`Unhandled app state: ${JSON.stringify(_exhaustive)}`)
    }
  }
}
