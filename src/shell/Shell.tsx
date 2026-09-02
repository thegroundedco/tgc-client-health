import { useState } from 'react'
import type { Profile } from '../auth/useProfile'
import { Board } from '../board/Board'
import { ThemeControl } from '../styles/ThemeControl'
import type { ThemePreference } from '../styles/theme'
import { Admin } from './Admin'
import { MenuBar } from './MenuBar'
import { Overview } from './Overview'
import { Revenue } from './Revenue'
import { LANDING, openDestination } from './destination'
import type { AdminSection, Destination, DestinationKind } from './destination'
import styles from './Shell.module.css'

// What a signed-in, active person is looking at, and the chrome around it.
//
// The navigation that used to live in Board.tsx lives here, and that is the
// point of the slice: the board is a view again rather than a view AND the
// application's navigation host.
//
// One consequence worth knowing. Each destination is rendered conditionally, so
// leaving Clients unmounts the board and returning remounts it -- which means
// useBoard re-fetches. That is deliberate rather than tolerated: it is why
// ClientsAdmin no longer needs to ask the board to reload on the way out, since
// coming back IS a reload. The cost is a round trip per visit, which is the same
// cost the board already pays on every page load.
export function Shell({
  profile,
  preference,
  onThemeChange,
  onSignOut,
}: {
  profile: Profile
  preference: ThemePreference
  onThemeChange: (next: ThemePreference) => void
  onSignOut: () => void
}) {
  const [destination, setDestination] = useState<Destination>(LANDING)

  // A press that cannot go anywhere does nothing, rather than navigating to a
  // screen the person cannot use. MenuBar already hides Admin from anybody in
  // that position, so this is the second of the two guards -- and the one that
  // still holds if the bar is ever changed.
  function navigate(kind: DestinationKind) {
    const next = openDestination(kind, profile.role)
    if (next) setDestination(next)
  }

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.wordmark}>
          <p className="t-eyebrow">The Grounded Company</p>
          <h1 className="t-header">Client Health</h1>
        </div>
        <MenuBar current={destination} onNavigate={navigate} role={profile.role} />
        <div className={styles.identity}>
          {/* Labelled, not a bare address. Without the label a screen reader
              announces an email address next to a Sign out button and leaves
              the listener to guess the relationship. */}
          <p className="t-caption">Signed in as {profile.email}</p>
          <ThemeControl onChange={onThemeChange} preference={preference} />
          <button className="button button--quiet" onClick={onSignOut} type="button">
            Sign out
          </button>
        </div>
      </header>
      <main className={styles.content}>
        {destination.kind === 'overview' && <Overview />}
        {destination.kind === 'clients' && <Board profile={profile} />}
        {destination.kind === 'revenue' && <Revenue />}
        {destination.kind === 'admin' && (
          <Admin
            currentUserId={profile.id}
            onLeave={() => navigate('clients')}
            onSection={(section: AdminSection) =>
              setDestination({ kind: 'admin', section })
            }
            role={profile.role}
            section={destination.section}
          />
        )}
      </main>
    </div>
  )
}
