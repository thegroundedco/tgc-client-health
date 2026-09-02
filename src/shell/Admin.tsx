import { ClientsAdmin } from '../clients/ClientsAdmin'
import { UsersAdmin } from '../users/UsersAdmin'
import { adminSections } from './destination'
import type { AdminSection } from './destination'
import styles from './Admin.module.css'

// Admin's two sections behind one destination. They were two independent
// booleans on the board -- showingClients and showingUsers -- which could both
// be true, with the order of two early returns silently deciding the winner.
// One section value cannot disagree with itself.
//
// The switcher is drawn only when there is something to switch BETWEEN. An
// account manager holds manage_clients and not manage_users, so they have one
// section, and a switcher offering one choice is a control with nothing to
// control -- the same argument Board.tsx makes about not drawing the view
// toggle on an empty roster.
//
// aria-pressed rather than aria-current here, unlike MenuBar: this switches
// between two renderings WITHIN one destination, which is the board's
// Cards | Matrix situation rather than a navigation one.
export function Admin({
  section,
  role,
  onSection,
  onLeave,
  currentUserId,
}: {
  section: AdminSection
  role: string
  onSection: (next: AdminSection) => void
  onLeave: () => void
  currentUserId: string
}) {
  const sections = adminSections(role)
  const LABELS: Record<AdminSection, string> = {
    people: 'People',
    clients: 'Clients roster',
  }

  return (
    <>
      {sections.length > 1 ? (
        <div aria-label="Admin section" className={styles.sections} role="group">
          {sections.map((entry) => (
            <button
              aria-pressed={section === entry}
              className="button button--quiet"
              key={entry}
              onClick={() => onSection(entry)}
              type="button"
            >
              {LABELS[entry]}
            </button>
          ))}
        </div>
      ) : null}

      {section === 'people' ? (
        <UsersAdmin currentUserId={currentUserId} onBack={onLeave} />
      ) : (
        <ClientsAdmin onBack={onLeave} />
      )}
    </>
  )
}
