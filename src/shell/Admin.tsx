import { ClientsAdmin } from '../clients/ClientsAdmin'
import { RevenueAdmin } from '../revenue/RevenueAdmin'
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
  // 'Revenue entry', not 'Revenue': the menu bar already has a button named
  // Revenue, and this switcher sits on the same screen as that bar once an
  // admin has more than one section -- an identical label would make
  // `getByRole('button', { name: 'Revenue' })` ambiguous, and a person tab
  // through two same-named buttons that go to different places.
  const LABELS: Record<AdminSection, string> = {
    people: 'People',
    clients: 'Clients roster',
    revenue: 'Revenue entry',
  }

  // Unreachable today -- MenuBar hides Admin from anybody with no sections and
  // openDestination refuses to build the destination for them, so this is the
  // third of three guards. It exists because the alternative is dishonest: with
  // no early return, a role holding none of the three capabilities falls through
  // to whatever the switch below defaults to, so a person who can manage nothing
  // would be shown a section anyway. Better to render nothing than to render the
  // wrong screen if either guard above is ever loosened.
  if (sections.length === 0) return null

  // A switch rather than the two-way ternary this replaces, for the same reason
  // Shell.tsx's content() is a switch and not `&&` chains: a fourth
  // AdminSection compiles cleanly against `&&` and falls through to whichever
  // branch is last, rendering someone's screen for a section that is not
  // theirs. The default branch turns that into a build failure instead.
  function screen() {
    switch (section) {
      case 'people':
        return <UsersAdmin currentUserId={currentUserId} onWritingChange={onWritingChange} />
      case 'clients':
        return <ClientsAdmin onWritingChange={onWritingChange} />
      case 'revenue':
        return <RevenueAdmin onWritingChange={onWritingChange} />
      default: {
        const _exhaustive: never = section
        throw new Error(`Unhandled admin section: ${JSON.stringify(_exhaustive)}`)
      }
    }
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

      {screen()}
    </>
  )
}
