import type { RevenueRow } from './chartMath'
import { clientMix } from './mixMath'
import type { GroupSummary } from './mixMath'
import { formatMoney } from './money'
import type { RetentionClient } from './retentionMath'
import { formatTenure } from './tenureMath'
import styles from './Revenue.module.css'

// Do retainer clients last longer and pay more than project clients?
//
// The owner's boss, 2026-09-11: "my belief is the monthly retainer is a
// stronger play for us... but I might be wrong, and if I'm wrong, that grossly
// changes what maybe our focus should be."
//
// It measures EVERY month entered, not the page's selected range: a
// relationship's length and worth are not properties of three months. Said out
// loud below, because this section sits under a range control that does not
// govern it.

function Group({
  label,
  summary,
  testId,
}: {
  label: string
  summary: GroupSummary
  testId: string
}) {
  if (summary.count === 0) {
    // Zero is a measurement; "none of these" is not. A $0 median would read as
    // a kind of client that earns nothing.
    return (
      <div className={styles.mixGroup} data-testid={testId}>
        <p className="t-caption">{label}</p>
        <p className="t-body">None on the books.</p>
      </div>
    )
  }

  return (
    <div className={styles.mixGroup} data-testid={testId}>
      <p className="t-caption">{label}</p>

      {/* The median leads. The question is whether one KIND of client is worth
          more, which is a question about a typical client -- a group total
          mostly reports how many of each kind there happen to be. */}
      <p className="t-score" data-testid={`${testId}-median`}>
        {formatMoney(summary.medianTotalCents ?? 0)}
      </p>
      <p className={`t-caption ${styles.summary}`}>
        median client · {summary.count === 1 ? '1 client' : `${summary.count} clients`} ·{' '}
        {formatMoney(summary.totalCents)} in total
      </p>

      {/* Only when some start dates are known. A tenure median drawn from none
          of them would be a number with nothing behind it. */}
      {summary.medianTenureDays !== null && (
        <p className={`t-caption ${styles.summary}`}>
          {formatTenure(summary.medianTenureDays)} median tenure, from{' '}
          {summary.tenureKnown} of {summary.count} with a start date
        </p>
      )}
    </div>
  )
}

export function Mix({
  asOf,
  clients,
  loadError,
  rows,
  status,
}: {
  asOf: string
  clients: readonly RetentionClient[]
  loadError?: string | null
  rows: readonly RevenueRow[]
  status: 'loading' | 'ready' | 'error'
}) {
  const mix = status === 'ready' ? clientMix(clients, rows, asOf) : null

  return (
    <section className={styles.section}>
      <h3 className="t-subhead">Retainer vs project</h3>

      {status === 'loading' && <p className="t-body">Loading…</p>}

      {status === 'error' && (
        <p className="alert prose" role="alert">
          {loadError}
        </p>
      )}

      {mix !== null && mix.clients.length === 0 && (
        <p className="t-body prose">
          No revenue has been entered, so there is nothing to compare.
        </p>
      )}

      {mix !== null && mix.clients.length > 0 && (
        <>
          <p className={`t-caption ${styles.summary}`}>
            Every month entered, not the range selected above: how long a client stays and what
            they are worth are not properties of three months.
          </p>

          <div className={styles.mixGroups}>
            <Group label="Mostly retainer" summary={mix.retainer} testId="mix-retainer" />
            <Group label="Mostly project" summary={mix.project} testId="mix-project" />
          </div>

          {/* THE caveat this section cannot be read without. Most of the roster
              arrived through the 2026 import with a start date set to the first
              invoice month, which is a floor on the relationship rather than
              its beginning -- so the tenure figures understate, and understate
              unevenly. The money is real; the durations are not yet. */}
          <p className={`t-caption ${styles.caution}`} data-testid="mix-caveat">
            {mix.unknownStart > 0 &&
              `${mix.unknownStart} of ${mix.clients.length} clients have no start date and are left out of the tenure figures. `}
            Tenure is only as good as the start dates on file: a client imported from the invoice
            ledger carries the month they first invoiced, which is the earliest the relationship
            can have begun rather than when it did. The revenue figures have no such caveat.
          </p>
        </>
      )}
    </section>
  )
}
