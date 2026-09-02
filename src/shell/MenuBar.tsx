import { canSeeAdmin, DESTINATIONS } from './destination'
import type { Destination, DestinationKind } from './destination'
import styles from './MenuBar.module.css'

// The four destinations, rendered from DESTINATIONS so their order and
// membership live in one place.
//
// aria-current="page" rather than aria-pressed, which is what the board's
// Cards | Matrix toggle uses. The distinction is real: that toggle switches
// between two renderings of one screen, so it is a pressed state; this moves
// between places, so it is navigation, and a <nav> landmark with a current
// entry is what a screen reader expects to find.
//
// Admin is hidden from anybody who can reach neither of its sections. Gating
// the ENTRY rather than only the screen matters: a button that opens an empty
// page is worse than no button, because the person cannot tell whether they
// lack access or the tool is broken.
//
// `busy` disables every entry while the destination below has a write in
// flight. Before this bar existed, the admin screens owned the whole viewport
// and their own Back button was the only way out, so disabling that button was
// enough. The bar reopened the hole: navigating away unmounts the screen that
// asked for the write, and the confirmation -- or the refusal -- then lands with
// nobody left to read it, so a role change that was rejected looks exactly like
// one that took. Four permanently-enabled exits above a screen that can only
// guard one is the same defect with more doors.
export function MenuBar({
  current,
  role,
  busy,
  onNavigate,
}: {
  current: Destination
  role: string
  busy?: boolean
  onNavigate: (kind: DestinationKind) => void
}) {
  return (
    <nav aria-label="Sections" className={styles.bar}>
      {DESTINATIONS.filter((entry) => entry.kind !== 'admin' || canSeeAdmin(role)).map(
        (entry) => (
          <button
            aria-current={current.kind === entry.kind ? 'page' : undefined}
            className="button button--quiet"
            disabled={busy}
            key={entry.kind}
            onClick={() => onNavigate(entry.kind)}
            type="button"
          >
            {entry.label}
          </button>
        ),
      )}
    </nav>
  )
}
