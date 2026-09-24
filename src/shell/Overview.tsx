import { useBoard } from '../board/useBoard'
import { packageLabel } from '../clients/clientPackages'
import { MIN_GROUP, ladderStanding, movements, onRampComparison } from '../clients/packageProgress'
import type { Comparison } from '../clients/packageProgress'
import { usePackages } from '../clients/usePackages'
import { can } from '../lib/capabilities'
import { defaultPeriod, formatPeriod } from '../lib/month'
import { bandFor } from '../lib/scoreMath'
import { resolveRange } from '../revenue/rangeMath'
import { concentrationOverRange } from '../revenue/revenueMath'
import { formatTenure, todayISO } from '../revenue/tenureMath'
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
// His boss then added Foundation-to-Grow progression, which the schema now
// carries -- see the ladder section below, and tests/overviewProvenance.test.ts
// for what changed when it arrived.

// The verdict, in the shape slice C established: a finding stated as a
// sentence, naming its population, and capable of coming out the other way.
function verdictSentence(comparison: Extract<Comparison, { kind: 'ready' }>): string {
  const atFoundation = formatTenure(comparison.foundation.medianDays)
  const above = formatTenure(comparison.above.medianDays)
  const basis = `from ${comparison.foundation.measured} and ${comparison.above.measured} ended relationships`
  const opening = 'Of the relationships that have ended with a package recorded, those who joined'

  // formatTenure buckets to whole months and years, so two medians that are
  // NOT equal -- comparison.longer is computed on exact days and would not
  // call this a tie -- can still format to the identical string (400 and 396
  // days both read "1 yr 1 mo"). Printing "stayed longer... a median of X,
  // against X" would contradict itself in the same breath, so that
  // combination gets its own sentence instead of falling into the
  // longer/shorter wording below.
  if (comparison.longer !== 'tie' && atFoundation === above) {
    return `${opening} at Foundation and those who joined above it stayed about the same length of time: both round to a median of ${atFoundation}, but the two medians are not exactly equal — they differ by less than that figure shows — ${basis}.`
  }

  if (comparison.longer === 'tie') {
    return `${opening} at Foundation and those who joined above it stayed the same: a median of ${atFoundation} each — ${basis}.`
  }
  if (comparison.longer === 'foundation') {
    return `${opening} at Foundation stayed longer: a median of ${atFoundation}, against ${above} for those who joined above it — ${basis}.`
  }
  return `${opening} above Foundation stayed longer: a median of ${above}, against ${atFoundation} for those who joined at Foundation — ${basis}.`
}

export function Overview({ role }: { role: string }) {
  const revenue = useRetention()
  const board = useBoard(defaultPeriod())

  // BOTH gates, and both are load-bearing. client_packages is select-gated on
  // manage_clients in RLS, so drawing this section for anyone else would render
  // an empty ladder that reads as "nobody has a package recorded" -- a
  // different and false statement.
  const maySeePackages = can(role, 'manage_clients')
  const packages = usePackages(maySeePackages)

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

  const asOf = todayISO()
  const standing = ladderStanding(revenue.clients, packages.byClient, asOf)
  const moved = movements(revenue.clients, packages.byClient, asOf)
  const comparison = onRampComparison(revenue.clients, packages.byClient)
  const unmeasured =
    comparison.kind === 'ready'
      ? comparison.foundation.count -
        comparison.foundation.measured +
        (comparison.above.count - comparison.above.measured)
      : 0

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

      {maySeePackages && (
        <>
          <h3 className="t-subhead">Moving up the ladder</h3>

          {packages.status === 'loading' && <p className="t-body">Loading…</p>}

          {/* A failure here says so and stops there. It does NOT join the page's
              status: a secondary section must never be able to hide the clients who
              need attention, which is what this page is for. */}
          {packages.status === 'error' && (
            <p className="alert prose" role="alert">
              {packages.loadError}
            </p>
          )}

          {/* GATED ON revenue.status TOO, not just packages.status -- the ladder's
              numbers are computed from revenue.clients (the roster), which
              useRetention holds as an empty array while loading and on error. Packages
              is one small table against useRetention's two-query Promise.all, so
              packages resolving first is the likely order, not the unlikely one: without
              this gate the page would show a confident "Foundation 0 · Grow 0 · Scale
              0 · No package recorded 0" and "no client has changed package" while it
              could not yet read who the clients even are. `status` (the page-level
              union) is deliberately NOT used here -- a useBoard failure has nothing to
              do with the ladder and must not blank it; only revenue.status does. */}
          {packages.status === 'ready' && revenue.status === 'loading' && (
            <p className="t-body">Loading…</p>
          )}

          {packages.status === 'ready' && revenue.status === 'error' && (
            <p className="t-body prose">
              The client roster could not be read, so the ladder cannot be shown.
            </p>
          )}

          {packages.status === 'ready' && revenue.status === 'ready' && (
            <>
              <ul aria-label="Clients by package" className={styles.rungs} role="list">
                {standing.rungs.map((rung) => (
                  <li className={styles.rung} key={rung.code}>
                    <span className="t-body">{packageLabel(rung.code)}</span>
                    <span className="t-body" data-testid={`rung-${rung.code}`}>
                      {rung.count}
                    </span>
                  </li>
                ))}
                <li className={styles.rung} key="unrecorded">
                  <span className="t-body">{packageLabel(null)}</span>
                  <span className="t-body" data-testid="rung-unrecorded">
                    {standing.unrecorded}
                  </span>
                </li>
              </ul>

              {moved.climbed.length === 0 && moved.descended.length === 0 && (
                <p className="t-body prose">
                  {packages.byClient.size === 0
                    ? 'No package history has been recorded yet, so no movement can be shown.'
                    : 'No client has changed package yet.'}
                </p>
              )}

              {moved.climbed.length > 0 && (
                <div className={styles.movesGroup}>
                  <p className={`t-caption ${styles.basis}`}>Moved up</p>
                  <ul aria-label="Moved up" className={styles.list} role="list">
                    {moved.climbed.map((move) => (
                      <li aria-label={move.name} className={styles.row} key={move.clientId}>
                        <span className="t-body">{move.name}</span>
                        <span className={`t-caption ${styles.why}`}>
                          {packageLabel(move.from)} → {packageLabel(move.to)}
                          {move.now !== null && `, now ${packageLabel(move.now)}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* The descents list was proposed here, not asked for: the owner's boss
                  asked to see who climbs, and showing only promotions makes this page
                  flatter the roster than the ladder actually is. A client stepping DOWN
                  is closer to what this page is for. Approved by the owner, 2026-09-24. */}
              {moved.descended.length > 0 && (
                <div className={styles.movesGroup}>
                  <p className={`t-caption ${styles.basis}`}>Moved down</p>
                  <ul aria-label="Moved down" className={styles.list} role="list">
                    {moved.descended.map((move) => (
                      <li aria-label={move.name} className={styles.row} key={move.clientId}>
                        <span className="t-body">{move.name}</span>
                        <span className={`t-caption ${styles.why}`}>
                          {packageLabel(move.from)} → {packageLabel(move.to)}
                          {move.now !== null && `, now ${packageLabel(move.now)}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {comparison.kind === 'waiting' ? (
                <p className="t-body prose" data-testid="onramp-verdict">
                  Whether clients who join at Foundation stay longer is not answerable yet. It needs{' '}
                  {MIN_GROUP} ended relationships on each side with a package recorded, and there are{' '}
                  {comparison.foundation} who joined at Foundation and {comparison.above} who joined
                  above it. Recording the package history of clients who have already left is what
                  answers it.
                </p>
              ) : (
                <>
                  <p className="t-body prose" data-testid="onramp-verdict">
                    {verdictSentence(comparison)}
                  </p>
                  <p className={`t-caption ${styles.basis}`} data-testid="onramp-basis">
                    Clients brought in by the 2026 import have a start date of their first invoice
                    month rather than the day they signed, so tenure understates — unevenly, and not
                    necessarily equally between the two groups.
                    {unmeasured > 0 &&
                      ` ${unmeasured} ended relationships have no start date and are counted but not measured.`}
                  </p>
                </>
              )}
            </>
          )}
        </>
      )}
    </section>
  )
}
