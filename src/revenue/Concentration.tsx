import { formatPeriod } from '../lib/month'
import { formatMoney } from './money'
import {
  CONCENTRATION_ALERT,
  allocatePercentages,
  concentrationOverRange,
  overExposed,
} from './revenueMath'
import type { RangeClient, RevenueRow } from './revenueMath'
import styles from './Revenue.module.css'

// Points are already the reconciled, whole-number output of
// allocatePercentages -- never a fraction rounded independently per row. See
// that function's own comment for why: rounding row by row does not
// guarantee the column sums to 100, and this is the one report in the app
// built specifically to be trustworthy about exact shares.
function formatPoints(points: number): string {
  return `${points}%`
}

// Who the firm is most exposed to: the largest clients by this month's
// revenue, named individually up to NAMED_CLIENTS, with everyone past that
// collapsed into one row that says how many rather than listing them --
// spec's distinction between showing exposure and ranking a roster.
// Who the firm is most exposed to: the largest clients by revenue over the
// page's date range, named individually up to NAMED_CLIENTS, with everyone past
// that collapsed into one row that says how many rather than listing them --
// the spec's distinction between showing exposure and ranking a roster.
//
// Slice 6h: it follows the page's RANGE rather than always last month, on the
// owner's ask -- "so we can see where we were most exposed during said date
// range". It also stopped making its own query to do it: the page already
// holds the whole revenue table and the whole roster for Billing and
// Retention, so this reads those instead of fetching a month of its own.
export function Concentration({
  clients,
  from,
  loadError,
  rows,
  status,
  to,
}: {
  clients: readonly RangeClient[]
  from: string | null
  loadError: string | null
  rows: readonly RevenueRow[]
  status: 'loading' | 'ready' | 'error'
  to: string | null
}) {
  return (
    <section className={styles.section}>
      <h3 className="t-subhead">Concentration</h3>

      {status === 'loading' && <p className="t-body">Loading…</p>}

      {/* A failed read must never fall through to an empty chart: a ranking
          with nothing in it reads as every client billing nothing at once. */}
      {status === 'error' && (
        <p className="alert prose" role="alert">
          {loadError}
        </p>
      )}

      {status === 'ready' && (from === null || to === null || from > to) && (
        <p className="t-body prose">
          No months are selected, so there is nothing to rank.
        </p>
      )}

      {status === 'ready' && from !== null && to !== null && from <= to && (
        <ConcentrationReady clients={clients} from={from} rows={rows} to={to} />
      )}
    </section>
  )
}

function ConcentrationReady({
  clients,
  from,
  rows,
  to,
}: {
  clients: readonly RangeClient[]
  from: string
  rows: readonly RevenueRow[]
  to: string
}) {
  const result = concentrationOverRange(clients, rows, from, to)
  // What the figures describe, stated: "August 2026" when the range is one
  // month, "January to September 2026" when it is more. A ranking with no
  // period named is a ranking a reader will assume is current.
  const month = from === to ? formatPeriod(from) : `${formatPeriod(from)} to ${formatPeriod(to)}`
  const total = result.entered + result.missing

  // NO CLIENTS AT ALL, which is not the same fact as no entries and must not
  // borrow the sentence below. Both satisfy `entered === 0`, so this branch has
  // to come first.
  //
  // The distinction is an instruction, not a nicety: "nobody has entered
  // September yet" tells a reader to go and enter it, which is right when
  // clients are waiting and wrong when the roster is empty -- the entry grid
  // would be blank too. And an empty roster is exactly what a broken
  // eligibility filter produces (useRevenue's `ended_on.is.null` arm going
  // missing returns no clients whatsoever), so the entry sentence would send
  // somebody hunting for missing data entry instead of for the bug.
  //
  // Keyed on the ROSTER LENGTH, not on `entered + missing`. Those were the same
  // number until paused clients stopped counting toward `missing`; now a roster
  // of nothing but paused clients has an expected-figure count of zero while
  // clients plainly exist, and this sentence would deny they do. The claim it
  // makes is about the roster, so it has to read the roster.
  if (clients.length === 0) {
    return (
      <p className="t-body prose">
        No clients were on the books for {month}, so there is nothing to rank.
      </p>
    )
  }

  // Nobody has entered anything for the month yet. Rendered as a ranking of
  // zeroes this would read as every client billing nothing at once -- total
  // collapse of the business, and the single most alarming way this page
  // could lie -- so it gets its own sentence instead of a chart with nothing
  // on it.
  if (result.entered === 0) {
    return (
      <p className="t-body prose">
        No revenue has been entered for {month}: this chart has nothing entered to
        rank.
      </p>
    )
  }

  // Every row that will show a percentage, named entries then the rest row,
  // allocated together so the column they form sums to exactly 100 -- see
  // allocatePercentages's own comment. Null when totalCents is 0, which
  // happens when every entered client billed exactly nothing; the individual
  // entry.share values are null in that case too (share()'s zero-whole rule),
  // so the percentage text below disappears on its own without a separate
  // check here.
  const displayCents = [
    ...result.named.map((entry) => entry.cents),
    ...(result.rest !== null ? [result.rest.cents] : []),
  ]
  const points = allocatePercentages(displayCents, result.totalCents)

  // Nick Stagge, 2026-09-11: "anytime we have a single client that breaks 20%
  // of our revenue, like it should be flagged... that's a major concern."
  //
  // Named clients only. The collapsed "others" row can carry any share at all
  // and is not one client carrying that risk -- flagging it would fire on
  // every healthy roster and turn the alarm into wallpaper.
  const exposed = result.named.filter((entry) => overExposed(entry.share))

  return (
    <>
      <p className="t-caption" data-testid="concentration-month">
        {month}
      </p>

      {/* Absent when nobody is over. A permanent "0 flagged" line teaches the
          reader to skip the place the alarm appears. */}
      {exposed.length > 0 && (
        <p className={`t-caption ${styles.caution}`} data-testid="concentration-alert">
          {/* The threshold is DERIVED from the rule, not typed here.
              tests/revenueLiterals.test.ts refuses a percentage literal in this
              page's markup -- a hard-coded percentage is a fabricated statistic
              -- and it caught this line. Deriving it is the better fix anyway:
              change CONCENTRATION_ALERT and the sentence follows. */}
          {exposed.length === 1 ? '1 client is' : `${exposed.length} clients are`} over{' '}
          {Math.round(CONCENTRATION_ALERT * 100)}% of revenue for this period. Losing one would
          take that much of the book with it.
        </p>
      )}

      <ul aria-label="Concentration" className={styles.list} role="list">
        {result.named.map((entry, index) => (
          <li
            aria-label={entry.name}
            className={styles.row}
            data-exposed={overExposed(entry.share) ? 'true' : 'false'}
            key={entry.clientId}
          >
            <span className={styles.who}>
              <span className="t-body" data-testid="concentration-name">
                {entry.name}
              </span>
              {/* Words, not a colour. The primary reader of this tool is
                  colourblind -- established on the 2026-09-11 call -- so a red
                  row would say nothing to the person it is warning. */}
              {overExposed(entry.share) && (
                <span className={`t-caption ${styles.marker}`}>over-exposed</span>
              )}
            </span>
            <span className={`t-body ${styles.measure}`}>
              {formatMoney(entry.cents)}
              {points !== null && ` · ${formatPoints(points[index])}`}
            </span>
            {/* Decoration for the number above, not a second source of it: the
                figure is already in the text, so the bar itself carries
                aria-hidden and contributes nothing to the accessible name.
                The bar's own width stays the raw, unrounded share -- only the
                printed percentage needs the whole roster reconciled to 100. */}
            <span aria-hidden="true" className={styles.barTrack}>
              <span
                className={styles.barFill}
                style={{ inlineSize: `${(entry.share ?? 0) * 100}%` }}
              />
            </span>
          </li>
        ))}

        {result.rest !== null && (
          <li
            aria-label={`${result.rest.count} others`}
            className={styles.row}
            data-exposed="false"
            key="rest"
          >
            <span className={styles.who}>
              <span className="t-body" data-testid="concentration-rest">
                {result.rest.count} others
              </span>
            </span>
            <span className={`t-body ${styles.measure}`}>
              {formatMoney(result.rest.cents)}
              {points !== null && ` · ${formatPoints(points[result.named.length])}`}
            </span>
            <span aria-hidden="true" className={styles.barTrack}>
              <span
                className={styles.barFill}
                style={{ inlineSize: `${(result.rest.share ?? 0) * 100}%` }}
              />
            </span>
          </li>
        )}
      </ul>

      {/* Spec section 7. A missing row is not a zero: a client with no row
          this month is absent from the ranking above, and their number is
          stated here rather than folded silently into the total -- a chart
          that drops unentered clients without a word overstates every share
          it draws. */}
      {result.missing > 0 && (
        <p className="t-caption prose" data-testid="concentration-missing">
          Revenue entered for {result.entered} of {total} clients this month —{' '}
          {result.missing} of {total} still unentered.
        </p>
      )}
    </>
  )
}
