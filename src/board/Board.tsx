import { useState } from 'react'
import { currentPeriod, formatPeriod } from '../lib/month'
import type { Profile } from '../auth/useProfile'
import { CheckIn } from '../checkin/CheckIn'
import { can } from '../lib/capabilities'
import { ClientsAdmin } from '../clients/ClientsAdmin'
import { ClientCard } from './ClientCard'
import { progressLine } from './cardSummary'
import { useBoard } from './useBoard'
import type { BoardClient } from './useBoard'
import styles from './Board.module.css'

type Props = { profile: Profile }

// The board reads and navigates. It no longer writes anything at all: `Score all
// 3s` is gone, and the only write in the application is the check-in screen's
// upsert. That button wrote a fixed value, so it was a guaranteed no-op whenever
// the data already matched -- a control that could not tell success from having
// done nothing, which is the second half of the finding this slice exists to
// fix. The first half was that a save gave no feedback; each card's footer is
// now that feedback, and it survives a reload, which a toast would not.
export function Board({ profile }: Props) {
  const period = currentPeriod()

  // §5.1: state-based navigation, in the board container. No router, therefore
  // no URL change, therefore a refresh returns here. A linkable check-in URL
  // needs the GitHub Pages 404.html redirect trick, which is not worth buying
  // until somebody wants to send a colleague a link to one check-in.
  const [selected, setSelected] = useState<BoardClient | null>(null)

  // §5.1 again: state-based navigation in the board container, no router,
  // therefore no URL change and a refresh returns to the board. A linkable
  // admin URL needs the GitHub Pages 404.html redirect trick, which is not
  // worth buying until somebody wants to send a colleague a link to it.
  const [showingClients, setShowingClients] = useState(false)

  const board = useBoard(period)

  if (selected) {
    return (
      <CheckIn
        client={selected}
        onBack={() => {
          setSelected(null)
          // Re-read on the way back, so a check-in that was just saved shows
          // its new total and footer on the card. Without this the board would
          // show what it read before the save, which is the same picture as a
          // save that did nothing.
          board.reload()
        }}
        period={period}
        profile={profile}
      />
    )
  }

  if (showingClients) {
    return (
      <ClientsAdmin
        onBack={() => {
          setShowingClients(false)
          // Re-read on the way back, so a client added, renamed or retired here
          // shows correctly on the board. Without this the board would show what
          // it read before the change -- the same picture as a change that did
          // nothing.
          board.reload()
        }}
      />
    )
  }

  // Drawn only for a role whose preset includes manage_clients. Convenience,
  // not security: spec §7.2, "UI hiding is convenience; the database refusing is
  // the security". A viewer who reached the screen would have every write
  // refused by clients_insert_manage_clients and clients_update_manage_clients.
  // This is the first caller of can() in the application.
  //
  // Defined here, above the four early returns below, and included in every one
  // of them. It has to be reachable from the empty state and from the failed
  // read in particular: a board with no clients is exactly when somebody needs
  // to add one, and a failed read is not a reason to strand them.
  const adminLink = can(profile.role, 'manage_clients') ? (
    <nav className={styles.adminLink}>
      <button
        className="button button--quiet"
        onClick={() => setShowingClients(true)}
        type="button"
      >
        Clients
      </button>
    </nav>
  ) : null

  // Error before loading: a failed read must never fall through to a screen
  // that looks merely empty. That is v1's "a broken tool looks like an empty
  // one", and it is the reason useBoard reports a status rather than just a
  // list.
  if (board.status === 'error') {
    return (
      <section className={styles.state}>
        {adminLink}
        <h2 className="t-header">Cannot reach the database</h2>
        <p className="alert prose" role="alert">
          {board.loadError}
        </p>
        <button className="button" type="button" onClick={board.reload}>
          Try again
        </button>
      </section>
    )
  }

  if (board.status === 'loading') {
    return (
      <section className={styles.state}>
        {adminLink}
        <p className="t-body">Loading…</p>
      </section>
    )
  }

  if (board.clients.length === 0) {
    return (
      <section className={styles.state}>
        {adminLink}
        {/* The same sentence progressLine gives the populated board, so the two
            empty states cannot drift apart in wording. */}
        <h2 className="t-header">{progressLine(0, 0)}</h2>
        <p className="t-body prose">
          Add one on the client admin screen to see it here.
        </p>
      </section>
    )
  }

  return (
    <section className={styles.board}>
      {adminLink}
      <div className={styles.periodBar}>
        <h2 className="t-header">{formatPeriod(period)}</h2>
        {/* §6's progress line. role="status" because this number changes on the
            way back from a check-in -- the one moment somebody wants to hear
            that their submission counted. */}
        <p className="t-caption" role="status">
          {progressLine(board.submitted, board.clients.length)}
        </p>
      </div>

      {/* role="list" because base.css removes the markers globally, and WebKit
          drops a list's semantics when its markers are removed — so in Safari
          with VoiceOver this would otherwise announce as a group of paragraphs
          with no count and no position. The role puts the semantics back. The
          label is what lets a test address this list, and what tells a screen
          reader which list it is. */}
      <ul aria-label="Clients" className={styles.grid} role="list">
        {board.clients.map((client) => (
          <ClientCard
            checkin={board.checkins.get(client.id) ?? null}
            client={client}
            key={client.id}
            onOpen={() => setSelected(client)}
            viewerId={profile.id}
          />
        ))}
      </ul>
    </section>
  )
}
