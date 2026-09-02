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
export function MenuBar({
  current,
  role,
  onNavigate,
}: {
  current: Destination
  role: string
  onNavigate: (kind: DestinationKind) => void
}) {
  return (
    <nav aria-label="Sections" className={styles.bar}>
      {DESTINATIONS.filter((entry) => entry.kind !== 'admin' || canSeeAdmin(role)).map(
        (entry) => (
          <button
            aria-current={current.kind === entry.kind ? 'page' : undefined}
            className="button button--quiet"
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
