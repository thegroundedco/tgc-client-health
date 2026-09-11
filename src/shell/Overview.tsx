import { useBoard } from '../board/useBoard'
import { defaultPeriod, formatPeriod } from '../lib/month'
import { bandFor } from '../lib/scoreMath'
import { resolveRange } from '../revenue/rangeMath'
import { concentrationOverRange } from '../revenue/revenueMath'
import { useRetention } from '../revenue/useRetention'
import { flagged } from './overviewMath'
import type { ScoreBand } from './overviewMath'
import styles from './Overview.module.css'

// The snapshot: the few things worth seeing the moment the tool opens.
//
// THIS PAGE'S CONTENTS WERE SOURCED, NOT GUESSED, and the distinction matters
// because six stat lines were once proposed for exactly this screen, the owner
// did not recognise them when asked, and they were retired as never-sourced.
//
// The source is the 2026-09-11 call, the owner describing this screen to his
// boss: "I imagine you'll want to see anything that's flagged like the clients
// that are taking up 20% at least 20% of revenue as far as concentration goes,
// and then clients who are flagged as at risk in the scores. I just don't want
// you to have to like go through and sort all this if you aren't wanting to --
// you can just open the overview and it'll show every [flagged thing]."
//
// His boss then added Foundation-to-Grow progression, which needs a schema
// change and is NOT here yet. Nothing else has been invented to fill space.
export function Overview() {
  const revenue = useRetention()
  const board = useBoard(defaultPeriod())

  const status =
    revenue.status === 'error' || board.status === 'error'
      ? 'error'
      : revenue.status === 'loading' || board.status === 'loading'
        ? 'loading'
        : 'ready'

  // Shares over the same window Revenue defaults to, so the two screens cannot
  // quietly disagree about who the big clients are. A single month is too
  // volatile for a risk list -- one large project invoice would put a client
  // over the line for a month and out of it the next.
  const months = [...new Set(revenue.rows.map((row) => row.period))].sort()
  const extent = {
    anchor: months.length > 0 ? months[months.length - 1] : null,
    earliest: months.length > 0 ? months[0] : null,
  }
  const range = resolveRange('last12', extent)

  const shares =
    range === null
      ? []
      : concentrationOverRange(
          revenue.clients.map((client) => ({ ...client, status: client.status })),
          revenue.rows,
          range.from,
          range.to,
        ).named.map((entry) => ({
          clientId: entry.clientId,
          name: entry.name,
          share: entry.share,
        }))

  const bands = new Map<number, ScoreBand>()
  for (const client of board.clients) {
    const score = board.scores.get(client.id)?.overall_score ?? null
    bands.set(client.id, { name: client.name, band: bandFor(score), score })
  }

  const attention = status === 'ready' ? flagged({ bands, shares }) : []

  return (
    <section className={styles.page}>
      <h2 className="t-header">Overview</h2>
      <h3 className="t-subhead">What needs attention</h3>

      {status === 'loading' && <p className="t-body">Loading…</p>}

      {/* Never "all clear" on a failed or pending read. A page whose job is
          raising alarms saying nothing is wrong, because it could not look, is
          the most dangerous sentence here. */}
      {status === 'error' && (
        <p className="alert prose" role="alert">
          {revenue.loadError ?? board.loadError}
        </p>
      )}

      {status === 'ready' && attention.length === 0 && (
        <p className="t-body prose">
          Nothing needs attention: no client is over a fifth of revenue, and none is scoring at
          risk this month.
        </p>
      )}

      {status === 'ready' && attention.length > 0 && (
        <>
          {/* There is no range control on this page, so the basis is stated or
              the reader assumes it matches whatever Revenue was last set to. */}
          <p className={`t-caption ${styles.basis}`} data-testid="overview-basis">
            Shares are of the last twelve months entered
            {range !== null && `, ${formatPeriod(range.from)} to ${formatPeriod(range.to)}`}.
            Scores are {formatPeriod(defaultPeriod())}&rsquo;s check-ins.
          </p>

          {/* role="list" because base.css removes markers globally and WebKit
              drops a list's semantics with them -- the same reason Tenure,
              Churn and the admin screens carry it. */}
          <ul aria-label="Needs attention" className={styles.list} role="list">
            {attention.map((entry) => (
              <li aria-label={entry.name} className={styles.row} key={entry.clientId}>
                <span className="t-body">{entry.name}</span>
                <span className={`t-caption ${styles.why}`}>
                  {entry.flags
                    .map((flag) =>
                      flag.kind === 'exposure'
                        ? `${Math.round(flag.share * 100)}% of revenue`
                        : flag.score === null
                          ? 'at risk'
                          : `at risk, scoring ${flag.score}`,
                    )
                    .join(' · ')}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
