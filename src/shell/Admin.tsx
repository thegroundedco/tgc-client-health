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
//
// onWritingChange is a pass-through, not a wrapper: the shell hands its own
// setter down and the section screens call it from an effect, so the bar can be
// disabled while a write is in flight. Passing the prop straight through keeps
// its identity stable, which is what stops the child's effect re-firing on every
// render of this component.
export function Admin({
  section,
  role,
  onSection,
  onWritingChange,
  currentUserId,
}: {
  section: AdminSection
  role: string
  onSection: (next: AdminSection) => void
  onWritingChange?: (writing: boolean) => void
  currentUserId: string
}) {
  const sections = adminSections(role)
  const LABELS: Record<AdminSection, string> = {
    people: 'People',
    clients: 'Clients roster',
  }

  // Unreachable today -- MenuBar hides Admin from anybody with no sections and
  // openDestination refuses to build the destination for them, so this is the
  // third of three guards. It exists because the alternative is dishonest: with
  // no early return, a role holding neither capability falls through the ternary
  // below to ClientsAdmin, so a person who can manage nothing would be shown the
  // client roster. Better to render nothing than to render the wrong screen if
  // either guard above is ever loosened.
  if (sections.length === 0) return null

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
        <UsersAdmin
          currentUserId={currentUserId}
          onWritingChange={onWritingChange}
        />
      ) : (
        <ClientsAdmin onWritingChange={onWritingChange} />
      )}
    </>
  )
}
