import { useEffect, useState } from 'react'
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
//
// The unmount discards the board's OTHER state as well, and that half is a real
// cost rather than a benefit: period, view, showArchived and selected all reset,
// so somebody reading June in the matrix who steps into Admin comes back to the
// default month in cards, and somebody who steps out of a half-filled check-in
// comes back to the board rather than to the check-in. The check-in half costs
// nothing beyond the trip, because draftCache.ts has already written every
// answer to local storage; the period half is the one that stings. Left as it is
// deliberately. Lifting period out of the board and into the shell is a decision
// about where a month belongs -- the check-in reads the same value, and the two
// must never disagree -- and that is a later slice's call, not a side effect of
// moving navigation.
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

  // Whether the destination below has a write in flight. The admin screens used
  // to be able to guard this themselves, because their own Back button was the
  // only exit; the bar added four more, and a write whose confirmation nobody is
  // left to read is indistinguishable from one that failed. So the screen
  // reports and the bar refuses.
  const [busy, setBusy] = useState(false)

  // Cleared whenever the destination changes, and this is not belt-and-braces: a
  // screen that has been unmounted cannot report itself idle, so without this a
  // write still in flight as the destination changed would leave the bar
  // disabled with nothing left on screen able to re-enable it. The screen owns
  // "I am writing"; the shell owns "that screen is gone".
  useEffect(() => {
    setBusy(false)
  }, [destination])

  // Bumped every time Clients is chosen, and used as the board's key so that
  // choosing it again REMOUNTS the board. Without this the one tab naming the
  // screen you are on is the only one with no effect: with a check-in open the
  // Clients button carries aria-current="page" and does nothing, because it
  // renders the same element in the same position, so React preserves Board and
  // its `selected` along with it -- aria-current claiming you are on a screen
  // the press cannot take you back to.
  //
  // A key rather than hoisting the check-in into a Destination variant: spec §4
  // rejected that deliberately, because CheckIn needs `period` and
  // `board.reload()`, both of which live in Board, so promoting it would turn a
  // navigation change into a data-ownership change.
  //
  // The cost, stated: pressing Clients while already on the board also remounts
  // it, so the month and the Cards|Matrix choice reset. That is the same cost
  // leaving and returning already pays, and it is the honest reading of pressing
  // the tab you are on -- "take me to Clients", answered by the screen Clients
  // opens on. The alternative, a press that works from a check-in and does
  // nothing from the board, is a control whose behaviour depends on a state the
  // bar does not show.
  const [clientsVisit, setClientsVisit] = useState(0)

  // A press that cannot go anywhere does nothing, rather than navigating to a
  // screen the person cannot use. MenuBar already hides Admin from anybody in
  // that position, so this is the second of the two guards -- and the one that
  // still holds if the bar is ever changed.
  function navigate(kind: DestinationKind) {
    const next = openDestination(kind, profile.role)
    if (!next) return
    if (kind === 'clients') setClientsVisit((visit) => visit + 1)
    setDestination(next)
  }

  // The destinations, as a switch rather than four `&&` expressions. The
  // difference is the default branch: with `&&`, a fifth Destination variant
  // compiles cleanly and renders an empty <main>, which is this project's
  // signature failure -- a broken screen looking like an empty one. This mirrors
  // App.tsx's switch over AppState, which the shell was always meant to.
  function content() {
    switch (destination.kind) {
      case 'overview':
        return <Overview />
      case 'clients':
        return <Board key={clientsVisit} profile={profile} />
      case 'revenue':
        return <Revenue />
      case 'admin':
        return (
          <Admin
            currentUserId={profile.id}
            onLeave={() => navigate('clients')}
            onSection={(section: AdminSection) =>
              setDestination({ kind: 'admin', section })
            }
            onWritingChange={setBusy}
            role={profile.role}
            section={destination.section}
          />
        )
      default: {
        // Exhaustiveness check: if Destination grows a new kind, this line stops
        // compiling instead of silently rendering nothing.
        const _exhaustive: never = destination
        throw new Error(`Unhandled destination: ${JSON.stringify(_exhaustive)}`)
      }
    }
  }

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.wordmark}>
          <p className="t-eyebrow">The Grounded Company</p>
          <h1 className="t-header">Client Health</h1>
        </div>
        <MenuBar
          busy={busy}
          current={destination}
          onNavigate={navigate}
          role={profile.role}
        />
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
      <main className={styles.content}>{content()}</main>
    </div>
  )
}
