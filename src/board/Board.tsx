import { useState } from 'react'
import { currentPeriod, formatPeriod } from '../lib/month'
import type { Profile } from '../auth/useProfile'
import { CheckIn } from '../checkin/CheckIn'
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

  // Error before loading: a failed read must never fall through to a screen
  // that looks merely empty. That is v1's "a broken tool looks like an empty
  // one", and it is the reason useBoard reports a status rather than just a
  // list.
  if (board.status === 'error') {
    return (
      <section className={styles.state}>
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

  if (board.status === 'loading') return <p className="t-body">Loading…</p>

  if (board.clients.length === 0) {
    return (
      <section className={styles.state}>
        {/* The same sentence progressLine gives the populated board, so the two
            empty states cannot drift apart in wording. */}
        <h2 className="t-header">{progressLine(0, 0)}</h2>
        <p className="t-body prose">Add one in the Supabase dashboard to see it here.</p>
      </section>
    )
  }

  return (
    <section className={styles.board}>
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
