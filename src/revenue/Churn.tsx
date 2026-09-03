import { reasonLabel } from '../clients/clientForm'
import { formatDay, formatTenure } from './tenureMath'
import type { DepartedRow } from './tenureMath'
import styles from './Revenue.module.css'

// Who left, when, why, and how long they had been with you.
//
// A LEDGER, not an analysis, and spec §6 is the reason. A churn rate computed
// on one departure is 9.1% -- a number that reads as a fact, carries a decimal
// place, and means nothing -- and tenure-at-churn cohorts would render empty
// bands, because the only departure on record has no start date to sort into
// one. Both would be machinery that looks like analysis while having nothing to
// analyse. The sentence below says so, and stops being true on its own the day
// the data supports the real thing.
export function Churn({ rows }: { rows: readonly DepartedRow[] }) {
  return (
    <section className={styles.section}>
      <h3 className="t-subhead">Who has left</h3>

      {rows.length === 0 ? (
        // An explicit empty state rather than a blank region, which reads as a
        // failed load.
        <p className="t-body prose">
          Nobody has left yet. When a client is marked cancelled or former on the Admin screen,
          they appear here with the reason recorded at the time.
        </p>
      ) : (
        <>
          <ul aria-label="Departures" className={styles.list} role="list">
            {rows.map((row) => (
              <li className={styles.row} key={row.client.id}>
                <span className={styles.who}>
                  <span className="t-body">{row.client.name}</span>
                  <span className={`t-small ${styles.marker}`}>
                    {reasonLabel(row.client.end_reason_code)}
                  </span>
                </span>
                <span className={`t-body ${styles.measure}`}>
                  {row.client.ended_on === null ? 'unknown' : formatDay(row.client.ended_on)}{' '}
                  · {formatTenure(row.days)}
                </span>
                {/* Both halves of the reason, because the parent spec says a
                    coded reason alone loses the story and free text alone
                    cannot be counted. */}
                {row.client.end_reason_note !== null && (
                  <p className={`t-small ${styles.detail}`} data-testid="churn-note">
                    {row.client.end_reason_note}
                  </p>
                )}
              </li>
            ))}
          </ul>

          <p className="t-small prose">
            No churn rate and no tenure-at-churn breakdown yet: a rate needs more than one
            departure to mean anything, and the breakdown needs the clients who left to have a
            recorded start date.
          </p>
        </>
      )}
    </section>
  )
}
