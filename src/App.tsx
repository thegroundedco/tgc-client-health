import { supabase } from './lib/supabase'
import { useSession } from './auth/useSession'
import { useProfile } from './auth/useProfile'
import { SignIn } from './auth/SignIn'
import { PendingAccess } from './auth/PendingAccess'

export default function App() {
  const { session, status: sessionStatus } = useSession()
  const { profile, status: profileStatus, error } = useProfile(session)

  if (sessionStatus === 'loading') return <main>Loading…</main>
  if (!session) return <SignIn />
  if (profileStatus === 'loading') return <main>Loading…</main>

  if (profileStatus === 'error') {
    return (
      <main>
        <h1>Cannot reach the database</h1>
        <p role="alert">{error}</p>
        <p>Your data is safe. Try again in a moment.</p>
      </main>
    )
  }

  if (!profile || !profile.is_active) {
    return (
      <PendingAccess
        email={session.user.email ?? 'unknown'}
        onSignOut={() => void supabase.auth.signOut()}
      />
    )
  }

  return (
    <main>
      <h1>TGC Client Health</h1>
      <p>Signed in as {profile.email}</p>
      <button type="button" onClick={() => void supabase.auth.signOut()}>
        Sign out
      </button>
    </main>
  )
}
