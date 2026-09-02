import { useState } from 'react'
import { defaultPeriod, formatPeriod, periodOptions } from '../lib/month'
import type { Profile } from '../auth/useProfile'
import { CheckIn } from '../checkin/CheckIn'
import { ClientCard } from './ClientCard'
import { Matrix } from './Matrix'
import { progressLine } from './cardSummary'
import { useBoard } from './useBoard'
import type { BoardClient } from './useBoard'
import { archivedCount, toggleLabel, visibleClients } from './boardScope'
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
  // One period for the whole board, and for the check-in it opens. The two must
  // never disagree: a card summarising one month while its check-in edits
  // another is the kind of quiet mismatch that makes a person stop trusting the
  // number. Not persisted, like every other view state here -- a reload lands on
  // last month, which is where the work is.
  const [period, setPeriod] = useState(defaultPeriod())

  // §5.1: state-based navigation, in the board container. No router, therefore
  // no URL change, therefore a refresh returns here. A linkable check-in URL
  // needs the GitHub Pages 404.html redirect trick, which is not worth buying
  // until somebody wants to send a colleague a link to one check-in.
  const [selected, setSelected] = useState<BoardClient | null>(null)

  // Navigation left this file in Slice 6a. adminLink and usersLink used to be
  // defined above the early returns and repeated in all four render branches,
  // because a failed read and an empty roster are exactly when somebody needs
  // to reach the admin screens. The menu bar in the shell is always drawn, so
  // that requirement is now met by structure rather than by four copies.

  // Not persisted, deliberately. A reload returns to the working view, which is
  // the same choice §5.1 makes for the check-in screen: no router, no URL
  // state, so a refresh lands somewhere predictable rather than wherever the
  // last visit left off.
  const [showArchived, setShowArchived] = useState(false)

  // Not persisted, matching every other view state on this screen: a reload
  // lands on the cards, which is where the monthly work is done. The matrix is
  // a second rendering of the SAME board -- same period, same fetch, same
  // state -- so it cannot disagree with the cards about a month or a number.
  const [view, setView] = useState<'cards' | 'matrix'>('cards')

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

  // Derived before the four render branches, so every branch below can use
  // them.
  const archived = archivedCount(board.clients)
  const visible = visibleClients(board.clients, showArchived)

  // Drawn only when there is something to reveal. A control that reveals
  // nothing is worse than no control: it implies something is hidden.
  //
  // Not drawn on a failed read either -- that branch returns before this is
  // used. Not because the count would be invented: useBoard leaves the
  // previous successful load's rows in state when a reload fails, so on a
  // failed read the count can be real and simply stale. The reason is that
  // the error must own the screen -- a control offering more rows beside
  // "cannot reach the database" would invite someone to act on data of
  // unknown freshness.
  const archiveToggle = archived > 0 ? (
    <button
      aria-expanded={showArchived}
      className="button button--quiet"
      onClick={() => setShowArchived((shown) => !shown)}
      type="button"
    >
      {toggleLabel(archived, showArchived)}
    </button>
  ) : null

  // Two buttons rather than one that says what it will become: a single
  // "Matrix" button gives no indication that the current view is the cards, and
  // aria-pressed on a pair says which of the two is showing without a person
  // having to work it out from the label.
  //
  // Deliberately not in the empty-roster branch below. A view switch that
  // reveals a second empty screen is a control with nothing to control.
  const viewToggle = (
    <div aria-label="View" className={styles.viewToggle} role="group">
      <button
        aria-pressed={view === 'cards'}
        className="button button--quiet"
        onClick={() => setView('cards')}
        type="button"
      >
        Cards
      </button>
      <button
        aria-pressed={view === 'matrix'}
        className="button button--quiet"
        onClick={() => setView('matrix')}
        type="button"
      >
        Matrix
      </button>
    </div>
  )

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

  if (board.status === 'loading') {
    return (
      <section className={styles.state}>
        <p className="t-body">Loading…</p>
      </section>
    )
  }

  if (visible.length === 0) {
    return (
      <section className={styles.state}>
        {/* The same sentence progressLine gives the populated board, so the two
            empty states cannot drift apart in wording. activeTotal, not
            visible.length: this line is about the roster, not about what the
            toggle happens to be showing. */}
        <h2 className="t-header">{progressLine(board.submitted, board.activeTotal, period)}</h2>
        {/* Always rendered, not one arm of a ternary with the toggle below:
            the sentence is how to get a working roster back, and that is
            exactly what somebody needs the moment they retire their last
            client -- whether or not there is anything archived to reveal. */}
        <p className="t-body prose">Add one on the client admin screen to see it here.</p>
        {archived > 0 && (
          // Reachable the moment somebody retires their last client. Without
          // this the roster looks permanently empty with no hint that anything
          // exists.
          <div className={styles.archiveBar}>{archiveToggle}</div>
        )}
      </section>
    )
  }

  return (
    <section className={styles.board}>
      <div className={styles.periodBar}>
        {/* The month is the heading AND the control -- one element, so there is
            nothing to keep in step with anything. It replaces a pair of arrows
            that could only step one month at a time; going back to May meant
            four clicks and four board reads.

            A native <select>, not a custom menu: the platform's own dropdown
            already brings keyboard navigation, type-ahead, the touch picker and
            the "combo box, August 2026" announcement, and this list is twelve
            plain strings. aria-label rather than a visible <label>, because the
            heading is the label -- a form-field caption above a page title
            would be chrome explaining the obvious. */}
        <h2 className={styles.periodHeading}>
          <select
            aria-label="Month"
            className={styles.periodSelect}
            onChange={(event) => setPeriod(event.target.value)}
            value={period}
          >
            {periodOptions().map((option) => (
              <option key={option} value={option}>
                {formatPeriod(option)}
              </option>
            ))}
          </select>
        </h2>
        {/* §6's progress line. role="status" because this number changes on the
            way back from a check-in -- the one moment somebody wants to hear
            that their submission counted.
            activeTotal, never visible.length: a former client cannot owe a
            check-in, so counting one here would make this sentence false, and
            pressing the toggle must not change what it says. */}
        <p className="t-caption" role="status">
          {progressLine(board.submitted, board.activeTotal, period)}
        </p>
        {archiveToggle}
        {viewToggle}
      </div>

      {view === 'matrix' ? (
        // Every active client, not `visible`: the cards are the month's work
        // list and honour the archive toggle, the matrix is the roster's health
        // picture and does not. Spec §8, decision 3.
        <Matrix
          checkins={board.checkins}
          clients={board.clients}
          onOpen={setSelected}
          period={period}
          scores={board.scores}
        />
      ) : (
        /* role="list" because base.css removes the markers globally, and WebKit
           drops a list's semantics when its markers are removed — so in Safari
           with VoiceOver this would otherwise announce as a group of paragraphs
           with no count and no position. The role puts the semantics back. The
           label is what lets a test address this list, and what tells a screen
           reader which list it is. */
        <ul aria-label="Clients" className={styles.grid} role="list">
          {visible.map((client) => (
            <ClientCard
              checkin={board.checkins.get(client.id) ?? null}
              client={client}
              key={client.id}
              onOpen={() => setSelected(client)}
              score={board.scores.get(client.id) ?? null}
              viewerId={profile.id}
            />
          ))}
        </ul>
      )}
    </section>
  )
}
