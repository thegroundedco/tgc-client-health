import { formatPeriod } from '../lib/month'
import { formatMoney } from './money'
import { allocatePercentages, concentration } from './revenueMath'
import { useRevenue } from './useRevenue'
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
export function Concentration({ month }: { month: string }) {
  const report = useRevenue(month)

  return (
    <section className={styles.section}>
      <h3 className="t-subhead">Who we are most exposed to</h3>

      {report.status === 'loading' && <p className="t-body">Loading…</p>}

      {report.status === 'error' && (
        <p className="alert prose" role="alert">
          {report.loadError}
        </p>
      )}

      {report.status === 'ready' && (
        <ConcentrationReady clients={report.clients} month={month} rows={report.rows} />
      )}
    </section>
  )
}

function ConcentrationReady({
  clients,
  month,
  rows,
}: {
  clients: Parameters<typeof concentration>[0]
  month: string
  rows: Parameters<typeof concentration>[1]
}) {
  const result = concentration(clients, rows)
  const total = result.entered + result.missing

  // Nobody has entered anything for the month yet. Rendered as a ranking of
  // zeroes this would read as every client billing nothing at once -- total
  // collapse of the business, and the single most alarming way this page
  // could lie -- so it gets its own sentence instead of a chart with nothing
  // on it.
  if (result.entered === 0) {
    return (
      <p className="t-body prose">
        No revenue has been entered for {formatPeriod(month)}: this chart has nothing entered to
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

  return (
    <>
      <p className="t-caption" data-testid="concentration-month">
        {formatPeriod(month)}
      </p>

      <ul aria-label="Concentration" className={styles.list} role="list">
        {result.named.map((entry, index) => (
          <li className={styles.row} key={entry.clientId}>
            <span className={styles.who}>
              <span className="t-body" data-testid="concentration-name">
                {entry.name}
              </span>
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
          <li className={styles.row} key="rest">
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
