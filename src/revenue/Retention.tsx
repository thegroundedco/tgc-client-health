import { formatPeriod } from '../lib/month'
import { formatMoney } from './money'
import { latestPeriod, retention } from './retentionMath'
import type { RetentionClient, RetentionRow } from './retentionMath'
import type { UseRetention } from './useRetention'
import styles from './Revenue.module.css'

// Whole percentages. The underlying ratio is exact; the display is rounded
// once, here, and never summed afterwards -- Concentration learned that lesson
// the hard way when independently rounded rows added up to 101.
function formatRate(rate: number): string {
  return `${Math.round(rate * 100)}%`
}

// The per-client movement, signed. formatMoney already carries a minus on a
// negative, so only a rise needs a mark -- and it needs one: without a sign a
// rise and a fall look alike until the reader compares the two figures beside
// it and subtracts. Spec section 5 point 4 puts the delta on the row, and the
// list's ordering depends on it being there: the rows are sorted by ABSOLUTE
// delta, which spec section 4 calls "the answer to why did it move", and eleven
// before/after pairs in an order with no visible basis read as arbitrary.
function formatDelta(cents: number): string {
  return cents > 0 ? `+${formatMoney(cents)}` : formatMoney(cents)
}

// What happened to the money we already had. NRR leads and GRR sits beside it,
// which is the owner's ruling verbatim: "Net is most important, but we still
// want visibility into gross."
// Takes the read rather than making it, as of slice 6d. Billing needs the same
// whole-table rows, and two components each calling useRetention would issue two
// identical reads -- and, worse, could resolve either side of a save and anchor
// to DIFFERENT latest months while both looked authoritative. Revenue.tsx owns
// the call and hands it down. Concentration keeps its own useRevenue read: that
// one reads a single month through a different filter and shares nothing here.
export function Retention({ read }: { read: UseRetention }) {

  return (
    <section className={styles.section}>
      <h3 className="t-subhead">Retention</h3>

      {read.status === 'loading' && <p className="t-body">Loading…</p>}

      {read.status === 'error' && (
        <p className="alert prose" role="alert">
          {read.loadError}
        </p>
      )}

      {read.status === 'ready' && <RetentionReady clients={read.clients} rows={read.rows} />}
    </section>
  )
}

function RetentionReady({
  clients,
  rows,
}: {
  clients: readonly RetentionClient[]
  rows: readonly RetentionRow[]
}) {
  // Ordered deliberately: latestPeriod returns null for an empty table, and
  // retention() cannot be called with it. Computing the report first and
  // checking afterwards would be a type error at best and a crash at worst.
  const period = latestPeriod(rows)
  if (period === null) {
    return (
      <p className="t-body prose">
        No retention yet: no revenue has been entered, so there is no history to measure across.
      </p>
    )
  }

  // NO CLIENTS AT ALL, which is not the same fact as a base month nobody
  // entered and must not borrow the sentence below. Both leave baseCents at 0
  // and both rates null, so this branch has to come first -- Concentration.tsx
  // hit the identical trap and its comment says the sentence "must not be
  // borrowed".
  //
  // The distinction is an instruction, not a nicety: "September 2025 has no
  // entered revenue" tells a reader to go and enter September 2025, which is
  // right when clients are waiting and wrong when the roster is empty -- there
  // is nobody to enter it for, and the entry grid would be blank too. And an
  // empty roster is exactly what a broken eligibility filter produces
  // (useRetention losing its roster arm returns no clients whatsoever), so the
  // entry sentence would send somebody hunting for missing data entry instead
  // of for the bug.
  //
  // Keyed on the ROSTER, not on the arithmetic, for the same reason
  // Concentration keys its version on roster length: the claim the sentence
  // makes is about the roster, so it has to read the roster.
  if (clients.length === 0) {
    return (
      <p className="t-body prose">
        No clients were on the books, so there is nothing to measure retention across.
      </p>
    )
  }

  const report = retention(clients, rows, period)

  // Both rates are null together -- they share a denominator. Rendering a
  // percentage here would be inventing one, which is the whole thing spec
  // section 9 refuses.
  if (report.nrr === null || report.grr === null) {
    return (
      <p className="t-body prose">
        Not enough history for a retention rate yet: {formatPeriod(report.basePeriod)} has no
        entered revenue to measure {formatPeriod(report.currentPeriod)} against.
      </p>
    )
  }

  const considered =
    report.included + report.unenteredBase + report.unenteredCurrent + report.newBusiness

  return (
    <>
      <p className="t-caption" data-testid="retention-window">
        {formatPeriod(report.currentPeriod)} against {formatPeriod(report.basePeriod)}
      </p>

      <p className="t-score" data-testid="retention-nrr">
        {formatRate(report.nrr)} net
      </p>
      <p className={`t-body ${styles.measure}`} data-testid="retention-grr">
        {formatRate(report.grr)} gross
      </p>

      {/* The three movements that produce those two rates. Churn is kept apart
          from contraction because "a client shrank" and "a client left" are
          different events that a single number would blend. */}
      <p className={`t-caption ${styles.summary}`} data-testid="retention-movement">
        {formatMoney(report.expansionCents)} expansion ·{' '}
        {formatMoney(Math.abs(report.contractionCents))} contraction ·{' '}
        {formatMoney(Math.abs(report.churnedCents))} churn
      </p>

      {/* The disclosure travels WITH the number, not as a footnote. An
          unentered client silently shrinking the denominator is exactly the
          kind of quiet wrongness this page exists to avoid.

          Two clauses, because spec section 3 produces two kinds of unentered
          and they are absences in DIFFERENT MONTHS. Naming the base month for
          both -- which this did -- tells the owner his October 2025 is missing
          when October 2025 is entered in full and it is October 2026 he has yet
          to type. Whichever month is actually absent is the month named. */}
      <p className={`t-caption ${styles.summary}`} data-testid="retention-basis">
        Based on {report.included} of {considered} clients
        {report.unenteredBase > 0 &&
          ` · ${report.unenteredBase} had no entry for ${formatPeriod(report.basePeriod)}`}
        {report.unenteredCurrent > 0 &&
          ` · ${report.unenteredCurrent} had no entry for ${formatPeriod(report.currentPeriod)}`}
        {report.newBusiness > 0 && ` · ${report.newBusiness} started since`}
      </p>

      {/* role="list" because base.css removes markers globally, and WebKit drops
          a list's semantics when its markers are removed -- so in Safari with
          VoiceOver this would announce as unrelated paragraphs. Tenure and the
          admin screens do the same. */}
      <ul aria-label="Retention contributions" className={styles.list} role="list">
        {report.contributions.map((entry) => (
          <li className={styles.row} key={entry.clientId}>
            <span className={styles.who}>
              <span className="t-body" data-testid="retention-contribution-name">
                {entry.name}
              </span>
              {entry.kind === 'churned' && (
                <span className={`t-caption ${styles.marker}`}>Left</span>
              )}
            </span>
            <span className={`t-body ${styles.measure}`}>
              {formatMoney(entry.baseCents)} → {formatMoney(entry.currentCents)} ·{' '}
              {formatDelta(entry.deltaCents)}
            </span>
          </li>
        ))}
      </ul>
    </>
  )
}
