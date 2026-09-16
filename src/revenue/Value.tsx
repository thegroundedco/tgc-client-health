import { useState } from 'react'
import { formatMoney } from './money'
import {
  clientValue,
  departedCount,
  departedToggleLabel,
  eligibleCount,
  lengthToggleLabel,
  showsLengthControl,
  visibleRows,
} from './valueMath'
import type { ValueRow, Verdict } from './valueMath'
import type { RevenueRow } from './chartMath'
import type { RetentionClient } from './retentionMath'
import styles from './Revenue.module.css'

// What each client is worth, replacing "Retainer vs project" -- which answered
// the same question with two medians side by side and which the owner reported
// he could not read.
//
// It measures EVERY month entered, not the page's selected range: what a
// relationship was worth is not a property of three months. Said out loud
// below, because this section sits under a range control that does not govern
// it.
//
// Tenure is deliberately absent. Most of this roster arrived through the 2026
// import with a start date set to the first invoice month -- a floor on the
// relationship rather than its beginning -- so every tenure figure needed a
// paragraph of caveat before it could be believed. Lifetime value is money
// that was actually billed and needs none. Tenure and Churn carry that
// question, with the caveat, where it belongs.

function VerdictLine({ verdict }: { verdict: Verdict }) {
  const { clientCount, projectMedianCents, retainerMedianCents, winner } = verdict

  // Every branch names the population it was drawn from, per spec 2.1. The
  // sentence does NOT follow the list's filter, so a reader who has just
  // pressed "show departed" needs the sentence to say what it counted.
  const population = `Across all ${clientCount} clients ever billed`

  // Only one kind of client has billed anything. A comparison drawn from one
  // group is not a comparison.
  if (retainerMedianCents === null || projectMedianCents === null) {
    return (
      <p className="t-body prose" data-testid="value-verdict">
        {population}, only one kind of client has billed anything, so there is nothing to
        compare.
      </p>
    )
  }

  // A DEAD HEAT IS NOT EVIDENCE FOR THE BELIEF BEING TESTED, so it is reported
  // as a dead heat rather than resolved toward the hypothesis.
  if (winner === null) {
    return (
      <p className="t-body prose" data-testid="value-verdict">
        {population}, retainer and project clients are worth about the same:{' '}
        {formatMoney(retainerMedianCents)} for the typical client of either kind.
      </p>
    )
  }

  const winnerMedian = winner === 'retainer' ? retainerMedianCents : projectMedianCents
  const loserMedian = winner === 'retainer' ? projectMedianCents : retainerMedianCents
  const loser = winner === 'retainer' ? 'project' : 'retainer'

  return (
    <p className="t-body prose" data-testid="value-verdict">
      {population}, {winner} clients are worth more: the typical one has billed{' '}
      {formatMoney(winnerMedian)}, against {formatMoney(loserMedian)} for the typical {loser}{' '}
      client.
    </p>
  )
}

function Row({ entry }: { entry: ValueRow }) {
  return (
    <li aria-label={entry.name} className={styles.row}>
      <span className={styles.who}>
        <span className="t-body" data-testid="value-name">
          {entry.name}
        </span>
        {/* Words, not a colour: the primary reader of this tool is colourblind. */}
        <span className={`t-caption ${styles.marker}`}>{entry.kind}</span>
      </span>
      <span className={`t-body ${styles.measure}`} data-testid="value-total">
        {formatMoney(entry.totalCents)}
      </span>
      {/* Null only when no month was billed, which cannot happen for a listed
          client -- clientMix drops those before they reach here. */}
      {entry.monthlyEquivalentCents !== null && (
        <span className={`t-caption ${styles.detail}`} data-testid="value-rate">
          {formatMoney(entry.monthlyEquivalentCents)} a month
        </span>
      )}
    </li>
  )
}

export function Value({
  clients,
  loadError,
  rows,
  status,
}: {
  clients: readonly RetentionClient[]
  loadError: string | null
  rows: readonly RevenueRow[]
  status: 'loading' | 'ready' | 'error'
}) {
  const [showDeparted, setShowDeparted] = useState(false)
  const [showAll, setShowAll] = useState(false)

  const result = status === 'ready' ? clientValue(clients, rows) : null

  return (
    <section className={styles.section}>
      <h3 className="t-subhead">What each client is worth</h3>

      {status === 'loading' && <p className="t-body">Loading…</p>}

      {/* A failed read must never fall through to an empty ranking: a list with
          nothing in it reads as every client billing nothing at once. */}
      {status === 'error' && (
        <p className="alert prose" role="alert">
          {loadError}
        </p>
      )}

      {result !== null && result.rows.length === 0 && (
        <p className="t-body prose">
          No revenue has been entered, so there is nothing to rank.
        </p>
      )}

      {result !== null && result.rows.length > 0 && (
        <ValueReady
          result={result}
          setShowAll={setShowAll}
          setShowDeparted={setShowDeparted}
          showAll={showAll}
          showDeparted={showDeparted}
        />
      )}
    </section>
  )
}

function ValueReady({
  result,
  setShowAll,
  setShowDeparted,
  showAll,
  showDeparted,
}: {
  result: { rows: ValueRow[]; verdict: Verdict }
  setShowAll: (update: (shown: boolean) => boolean) => void
  setShowDeparted: (update: (shown: boolean) => boolean) => void
  showAll: boolean
  showDeparted: boolean
}) {
  const departed = departedCount(result.rows)
  const eligible = eligibleCount(result.rows, showDeparted)
  const visible = visibleRows(result.rows, showDeparted, showAll)

  return (
    <>
      <VerdictLine verdict={result.verdict} />

      <p className={`t-caption ${styles.summary}`}>
        Every month entered, not the range selected above: what a relationship was worth is not a
        property of three months.
      </p>

      <ul aria-label="What each client is worth" className={styles.list} role="list">
        {visible.map((entry) => (
          <Row entry={entry} key={entry.clientId} />
        ))}
      </ul>

      <div className={styles.buttonRow}>
        {/* Each control is drawn only when it has something to do. A control
            that reveals nothing is worse than no control: it implies something
            is hidden. The rule is in valueMath rather than a condition here,
            because the two controls interfering is exactly the bug it fixes. */}
        {showsLengthControl(eligible) ? (
          <button
            aria-expanded={showAll}
            className="button button--quiet"
            onClick={() => setShowAll((shown) => !shown)}
            type="button"
          >
            {lengthToggleLabel(eligible, showAll)}
          </button>
        ) : null}

        {departed > 0 && (
          <button
            aria-expanded={showDeparted}
            className="button button--quiet"
            onClick={() => setShowDeparted((shown) => !shown)}
            type="button"
          >
            {departedToggleLabel(departed, showDeparted)}
          </button>
        )}
      </div>
    </>
  )
}
